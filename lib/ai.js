/**
 * dsh-note — AI 整理管线（Host 半侧）
 *
 * 三件事：
 *   1. 逐条队列：串行 FIFO，并发 1。整理是廉价后台活，并发只会撞 provider 限速。
 *   2. 单次旁路调用：`ctx.llm.stream({ purpose: 'stickynote-organize' })`。
 *      不建 session、不占对话上下文、不产生用户可见回合。
 *   3. 结果落盘：改 frontmatter + 重写 `## AI 补全` 段。**原文段一个字都不动。**
 *
 * 降级：`llm` 服务缺席时整条管线不启动，便签永远是素贴（没有 `+AI` 角标）。
 * 这不是错误，是设计过的状态（设计文档附录 B 的注入矩阵）。
 */

import { classifyByRule, detectDueHint } from './rules.js'

/**
 * 提示词版本。改了提示词就 +1，落进 frontmatter 的 `ai_prompt_rev`，
 * 这样用户能分辨「这条结果是用哪版提示词跑出来的」。
 */
export const PROMPT_REV = 1

/** 单次调用上限。整理一句话用不到 800 token。 */
const MAX_TOKENS = 800

/** 失败重试次数（含首次）。 */
const ATTEMPTS = 3

/** 默认类别。AI 只能在这些里面选；越界落 `未分类`。 */
export const DEFAULT_CATEGORIES = ['工作', '想法', '待办', '参考', '生活', '未分类']

/**
 * 整理提示词。
 *
 * 第 4 条是防幻觉的闸门：「宁少勿多，想不出来就返回空数组」。
 * AI「补充完善」最容易滑向编造，所以宁空勿造；而 `## AI 补全` 在界面上
 * 是独立折叠区（默认收起），用户要看才看，不会误当原文。
 */
export function buildPrompt(categories, neighbors) {
  const list = (Array.isArray(categories) && categories.length > 0 ? categories : DEFAULT_CATEGORIES).join('、')
  const near =
    Array.isArray(neighbors) && neighbors.length > 0
      ? neighbors.map((item) => `- [${item.id}] ${item.title || item.preview || ''}`).join('\n')
      : '（无）'

  return [
    '你是便签整理员。用户随手说的一句话，你要把它变成一条结构化的便签。',
    '',
    '规则：',
    '1. 不改写原文，一个字都不能动。你只产出结构。',
    '2. title 不超过 20 字，用用户自己的说法，不要造词。',
    `3. category 只能从给定列表选一个：${list}`,
    '4. points 是原文里没明说但显然成立的补充，1-3 条。宁少勿多，',
    '   想不出来就返回空数组——填空比编造更糟糕。',
    '5. todos 只抽原文里真的包含的行动项。原文没有就返回 []。',
    '6. due_hint 只在原文明确提到时间时填（"明天""下周三""月底前"），',
    '   模糊的"以后"不算。没有就返回 null。',
    '7. 如果这条和下面这些已有便签讲同一件事，把那条的 id 填进 merge_hint；',
    '   没有就返回 null。',
    `   已有便签：\n${near}`,
    '8. 只输出 JSON，不要 markdown 代码块，不要解释。',
    '',
    '输出格式：',
    '{"title":"…","category":"…","tags":["…"],"points":["…"],"todos":["…"],',
    ' "due_hint":null,"merge_hint":null,"confidence":0.0}',
  ].join('\n')
}

/** 从模型输出里抠出 JSON。模型偶尔会包 ```json 围栏或加前言。 */
export function extractJson(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (text === '') return null

  // 直接就是 JSON
  if (text.startsWith('{')) {
    const parsed = tryParse(text)
    if (parsed !== null) return parsed
  }

  // 围栏里
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence !== null) {
    const parsed = tryParse(fence[1].trim())
    if (parsed !== null) return parsed
  }

  // 第一个 { 到最后一个 }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1))
    if (parsed !== null) return parsed
  }

  return null
}

function tryParse(text) {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** 把模型输出规整成 store.applyAi 认识的形状。越界的值一律降级，不写脏数据。 */
export function normalizeResult(parsed, options) {
  const allowed = new Set(Array.isArray(options?.categories) && options.categories.length > 0 ? options.categories : DEFAULT_CATEGORIES)
  if (parsed === null) {
    return {
      state: 'failed',
      failReason: 'unparseable',
      basedOnRev: options?.rev,
      promptRev: PROMPT_REV,
      model: options?.model,
    }
  }

  const text = (value, limit) => {
    const out = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
    return out.slice(0, limit)
  }

  const listOf = (value, limit, each) => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => text(item, each))
      .filter((item) => item !== '')
      .slice(0, limit)
  }

  const wanted = text(parsed.category, 20)
  const category = allowed.has(wanted) ? wanted : '未分类'
  const categoryOutOfSet = wanted !== '' && !allowed.has(wanted)

  const confidence = Number(parsed.confidence)

  return {
    state: 'done',
    title: text(parsed.title, 40),
    category,
    categorySource: 'model',
    tags: listOf(parsed.tags, 8, 16),
    points: listOf(parsed.points, 3, 200),
    todos: listOf(parsed.todos, 5, 200),
    dueHint: text(parsed.due_hint, 30),
    mergeHint: text(parsed.merge_hint, 40),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    failReason: categoryOutOfSet ? 'category_out_of_set' : '',
    basedOnRev: options?.rev,
    promptRev: PROMPT_REV,
    model: options?.model,
  }
}

/**
 * 建一个整理队列。
 *
 * @param deps.store - 存储实例（store.js 的 createStore 返回值）
 * @param deps.llm - `ctx.llm`，缺席时 createQueue 返回 null
 * @param deps.pickModel - () => { provider, model } | null，决定用哪个模型
 * @param deps.categories - 允许的类别
 * @param deps.onChange - (note) => void，每次落盘后回调（用来广播 SSE）
 */
export function createQueue(deps) {
  const store = deps.store
  const llm = deps.llm
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') return null

  const categories = Array.isArray(deps.categories) && deps.categories.length > 0 ? deps.categories : DEFAULT_CATEGORIES
  const onChange = typeof deps.onChange === 'function' ? deps.onChange : () => {}

  /** 待整理队列（存 id）。 */
  const pending = []
  /** 已在队列里、**或正在被处理**的 id。用 Set 去重：同一条连点三次不会跑三遍。 */
  const queued = new Set()
  /** 当前是否在跑。串行，所以一个布尔就够。 */
  let running = false
  /** 队列空闲时的收尾回调。 */
  let idleWaiters = []

  function settleIdle() {
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** 入队。已经在队列里或正在跑的会直接返回。 */
  function enqueue(id) {
    if (typeof id !== 'string' || id === '') return false
    if (queued.has(id)) return false
    queued.add(id)
    pending.push(id)
    void pump()
    return true
  }

  /** 启动时把残留的 pending / running 全部重新入队 —— 进程重启也不丢。 */
  function recover() {
    let count = 0
    for (const note of store.list({ includeDeleted: false })) {
      if (note.aiState === 'pending' || note.aiState === 'running') {
        // running 在重启后视为 pending：那次调用的结果已经不可能回来了
        if (enqueue(note.id)) count += 1
      }
    }
    return count
  }

  async function pump() {
    if (running) return
    running = true
    try {
      while (pending.length > 0) {
        const id = pending.shift()
        try {
          await organize(id)
        } catch (error) {
          // 单条失败不拖垮队列
          console.warn(`[dsh-note] 整理 ${id} 失败：${error?.message || String(error)}`)
        } finally {
          // 处理完才放开去重位 —— 处理期间重复 enqueue 必须被吃掉
          queued.delete(id)
        }
      }
    } finally {
      running = false
      settleIdle()
    }
  }

  /** 处理一条。 */
  async function organize(id) {
    const note = store.read(id)
    if (note === null || note.broken) return
    if (note.deleted !== '') return

    let selection = null
    try {
      selection = typeof deps.pickModel === 'function' ? deps.pickModel() : null
    } catch {
      selection = null
    }
    if (selection === null || selection === undefined) {
      // 没有可用模型：标记 skipped，不重试、不报错
      store.applyAi(id, { state: 'skipped', failReason: 'no-model', basedOnRev: note.rev })
      return
    }

    // 邻居：同类别最近 5 条，给模型做 merge_hint 判断的上下文
    const neighbors = store
      .list({ includeDeleted: false })
      .filter((item) => item.id !== id && item.category === note.category)
      .slice(0, 5)
      .map((item) => ({ id: item.id, title: item.aiTitle, preview: item.preview }))

    // 规则层先跑：能定类的就省一次模型调用，且永远不会归错（只会归不出）。
    // 模型仍然要跑 —— 规则只能给类别，给不了标题/要点/待办。
    const ruled = classifyByRule(note.text)
    const hinted = detectDueHint(note.text)

    const prompt = buildPrompt(categories, neighbors)
    let lastFailure = ''

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      // 重试时把温度降到 0，第一次给 0.2 留一点表达空间
      const temperature = attempt === 0 ? 0.2 : 0
      let output = ''
      let failed = null

      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          purpose: 'stickynote-organize',
          system: prompt,
          messages: [{ role: 'user', content: note.text }],
          temperature,
          maxTokens: MAX_TOKENS,
        })

        for await (const chunk of stream) {
          if (chunk === null || chunk === undefined) continue
          if (chunk.type === 'text-delta') {
            output += String(chunk.text == null ? '' : chunk.text)
            continue
          }
          if (chunk.type === 'finish') {
            const reason = chunk.reason
            if (reason !== undefined && reason !== null && reason.kind !== 'stop') {
              failed = reason.failure?.message || reason.kind
            }
          }
        }
      } catch (error) {
        failed = error?.message || String(error)
      }

      if (failed !== null) {
        lastFailure = failed
        continue
      }

      const parsed = extractJson(output)
      if (parsed === null) {
        lastFailure = 'unparseable'
        continue
      }

      const result = normalizeResult(parsed, { rev: note.rev, model: selection.model, categories })
      // 结果基于这次读到的 rev；如果期间用户改了原文，UI 会标「基于旧版本」
      result.basedOnRev = note.rev

      // 规则层判定优先：它只在「看一眼就知道」时才说话，比模型更保守
      if (ruled !== null) {
        result.category = ruled.category
        result.categorySource = 'rule'
      }
      // 模型没给时间线索时用本地的（本地只认结构，模型能理解语义，两者互补）
      if (result.dueHint === '' && hinted !== null) result.dueHint = hinted.label
      const updated = store.applyAi(id, result)
      if (updated !== null) onChange(updated)
      return
    }

    // 三次都失败：标记 failed，原文完好
    const updated = store.applyAi(id, {
      state: 'failed',
      failReason: lastFailure || 'unknown',
      basedOnRev: note.rev,
      model: selection.model,
    })
    if (updated !== null) onChange(updated)
  }

  /** 等队列清空（测试用，也给「整理全部」这类操作收尾）。 */
  function whenIdle() {
    if (!running && pending.length === 0) return Promise.resolve()
    return new Promise((resolve) => idleWaiters.push(resolve))
  }

  return { enqueue, recover, whenIdle, size: () => pending.length, isRunning: () => running }
}
