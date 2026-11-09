/**
 * dsh-note — 存储层（Host 半侧）
 *
 * 一条便签 = 一个 Markdown 文件，落在 `$DSH_HOME/stickynote/`。
 * 文件名 = `<ISO时间戳>-<短id>.md`，**创建后永不改名、永不移动**：
 * AI 重分类只改文件头字段，绝不触碰路径，所以用户不会遇到「AI 搬家后点老位置是空的」。
 *
 * 三条铁律（对应设计文档 §7.2）：
 *   1. 正文第一段「原文」永不被 AI 改写；AI 输出全在 `## AI 补全` 之后。
 *   2. `ai.state` 是唯一真相：`+AI` 角标 ⇔ `ai.state === 'done'`。
 *   3. `rev` 单调递增，每次写 +1，是多端合并的唯一依据。
 *
 * frontmatter 只支持我们自己写的那个子集（标量 / 逗号列表 / JSON），
 * 不做通用 YAML。这是刻意的限制：畸形内容按纯文本降级呈现，绝不丢内容。
 *
 * 零第三方依赖，只 import node: 内置模块 —— 插件装在 profile 里时，
 * 宿主对第三方包的 ESM 解析钩子不保证可用。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { findSimilar } from './rules.js'

/** 单条正文上限（字符）。超了截断并标记，不拒绝保存 —— 用户的内容比格式重要。 */
const MAX_TEXT = 20000
/** 标签上限。 */
const MAX_TAGS = 16
/** 单条附件的数量上限。 */
const MAX_ATTACHMENTS = 8
/** 投递记录保留上限（防止一条被反复投递后无限膨胀）。 */
const MAX_DELIVERED = 50

/** 允许的来源值。 */
const SOURCES = new Set(['text', 'voice', 'image'])
/** `ai.state` 的合法值。 */
const AI_STATES = new Set(['pending', 'running', 'done', 'failed', 'skipped'])
/** 类别来源的合法值 —— `user` 一旦写入，AI 永不再覆盖（§3.5）。 */
const CATEGORY_SOURCES = new Set(['rule', 'model', 'user'])

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 短 id：时间基 + 随机。足够一机一年不撞，也够短到能在投递文本里当引用键。 */
function newId(now = Date.now()) {
  const base = now.toString(36).slice(-5)
  const rand = Math.random().toString(36).slice(2, 4)
  return base + rand
}

/** 单行化：frontmatter 里不允许出现裸换行。 */
function oneLine(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim()
}

/** 需要引号的标量：含特殊字符就加双引号并转义。 */
function needsQuote(text) {
  if (text === '') return false
  return /[":#\[\]{}&,*?|<>=!%@`]/.test(text) || /^\s|\s$/.test(text)
}

/** 写一个标量值（空值写成空，读回来是空串）。 */
function encodeScalar(value) {
  const text = oneLine(value)
  if (text === '') return ''
  return needsQuote(text) ? '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : text
}

/** 读一个标量值：去引号、解转义。 */
function decodeScalar(raw) {
  let text = String(raw == null ? '' : raw).trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return text
}

/** 逗号列表 → 数组；支持全角逗号。 */
function decodeList(raw) {
  const text = decodeScalar(raw)
  if (text === '') return []
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * 数组 → 逗号列表。
 *
 * 只用于**保证不含逗号**的字段（标签、附件文件名）。
 * 句子类的列表（AI 补全要点、抽出的待办）一定含逗号，必须用 JSON —— 见下面的 encodeJsonList。
 */
function encodeList(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  return list.map((item) => oneLine(item).replace(/[,，]/g, ' ')).filter(Boolean).join(', ')
}

/**
 * 数组 → JSON（单行）。
 *
 * 句子类列表必须走这条：`问一下 X，然后再确认超时` 里的逗号是内容的一部分，
 * 用逗号列表编码会静默把一句话拆成两条 —— 那是数据损坏，不是格式取舍。
 */
function encodeJsonList(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  return JSON.stringify(list.map((item) => oneLine(item)).filter(Boolean))
}

/** JSON 列表 → 数组；向后兼容早期的逗号写法。 */
function decodeJsonList(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (text === '') return []
  if (text.startsWith('[')) {
    const value = parseJson(text, [])
    return Array.isArray(value) ? value.map(oneLine).filter(Boolean) : []
  }
  // 早期版本写成逗号列表，读回来仍然可用
  return decodeList(text)
}

/** 安全 JSON 解析：失败返回兜底值，不抛。 */
function parseJson(raw, fallback) {
  const text = String(raw == null ? '' : raw).trim()
  if (text === '') return fallback
  try {
    const value = JSON.parse(text)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

/** 时间戳 → 本地 ISO（带时区偏移，人能看懂）。 */
function isoNow(ms = Date.now()) {
  const date = new Date(ms)
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds()) +
    sign + pad(offset / 60) + ':' + pad(offset % 60)
  )
}

/** 文件名里的时间戳：把 `:` 换成 `-`，Windows 也能用。 */
function fileStamp(ms) {
  return isoNow(ms).replace(/:/g, '-')
}

/**
 * 原子写：先写临时文件再 rename。崩在中途也不会留下半截文件。
 *
 * **编码要按内容类型选**：文本传 `'utf8'`，二进制（图片）不能带编码 ——
 * 给 Buffer 硬塞 `'utf8'` 会把字节重新解码再编码，图片直接损坏。
 * 早期版本这里写死了 `'utf8'`，是个只在存图时才会暴露的坑。
 *
 * @param target - 目标路径
 * @param content - 字符串或 Buffer / Uint8Array
 */
function writeFileAtomic(target, content) {
  const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
  if (typeof content === 'string') writeFileSync(temp, content, 'utf8')
  else writeFileSync(temp, content)
  renameSync(temp, target)
}

/** 宽松时间解析：ISO 带偏移 / 纯数字都吃，失败返回 0。 */
function parseWhen(value) {
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : 0
}

// ---------------------------------------------------------------------------
// frontmatter 编解码
// ---------------------------------------------------------------------------

/** 一条便签的默认形状。读盘时用它与文件内容合并，缺字段不会崩。 */
function blankNote() {
  return {
    id: '',
    rev: 0,
    created: '',
    updated: '',
    source: 'text',
    category: '未分类',
    categorySource: 'model',
    tags: [],
    aiState: 'skipped',
    aiAt: '',
    aiTitle: '',
    aiConf: 0,
    aiModel: '',
    aiPromptRev: 0,
    aiBasedOnRev: 0,
    aiPoints: [],
    aiTodos: [],
    aiDueHint: '',
    aiMergeHint: '',
    aiFailReason: '',
    pinned: false,
    archived: false,
    deleted: '',        // 空串 = 未删除；有值 = 删除时间（软删除）
    attachments: [],
    delivered: [],      // [{ session, at, mode, form, beforeAi }]
    text: '',           // 原文，永不被 AI 改写
    aiBody: '',         // `## AI 补全` 之后的 Markdown（AI 输出）
    broken: false,      // frontmatter 解析失败时为 true，正文按纯文本降级
  }
}

/** 便签 → 文件全文。 */
function serialize(note) {
  const lines = [
    '---',
    `id: ${encodeScalar(note.id)}`,
    `rev: ${Number(note.rev) || 0}`,
    `created: ${encodeScalar(note.created)}`,
    `updated: ${encodeScalar(note.updated)}`,
    `source: ${encodeScalar(note.source)}`,
    `category: ${encodeScalar(note.category)}`,
    `category_source: ${encodeScalar(note.categorySource)}`,
    `tags: ${encodeList(note.tags)}`,
    `ai_state: ${encodeScalar(note.aiState)}`,
    `ai_at: ${encodeScalar(note.aiAt)}`,
    `ai_title: ${encodeScalar(note.aiTitle)}`,
    `ai_conf: ${Number(note.aiConf) || 0}`,
    `ai_model: ${encodeScalar(note.aiModel)}`,
    `ai_prompt_rev: ${Number(note.aiPromptRev) || 0}`,
    `ai_based_on_rev: ${Number(note.aiBasedOnRev) || 0}`,
    `ai_points: ${encodeJsonList(note.aiPoints)}`,
    `ai_todos: ${encodeJsonList(note.aiTodos)}`,
    `ai_due_hint: ${encodeScalar(note.aiDueHint)}`,
    `ai_merge_hint: ${encodeScalar(note.aiMergeHint)}`,
    `ai_fail_reason: ${encodeScalar(note.aiFailReason)}`,
    `pinned: ${note.pinned ? 'true' : 'false'}`,
    `archived: ${note.archived ? 'true' : 'false'}`,
    `deleted: ${encodeScalar(note.deleted)}`,
    `attachments: ${encodeList(note.attachments)}`,
    `delivered: ${note.delivered.length > 0 ? JSON.stringify(note.delivered) : ''}`,
    '---',
    '',
    note.text,
  ]
  if (note.aiBody !== '') {
    lines.push('', note.aiBody)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * 文件全文 → 便签。
 *
 * 解析失败不抛：置 `broken = true`，整份内容当作原文（纯文本降级），
 * 用户至少还能看到自己写了什么。这是 §12「不丢内容」的落点。
 */
function parse(source, fallbackId) {
  const note = blankNote()
  note.id = fallbackId

  const raw = String(source == null ? '' : source)
  if (!raw.startsWith('---')) {
    note.broken = true
    note.text = raw.trim()
    note.aiState = 'skipped'
    return note
  }

  const closeAt = raw.indexOf('\n---', 3)
  if (closeAt === -1) {
    note.broken = true
    note.text = raw.trim()
    return note
  }

  const head = raw.slice(3, closeAt)
  const rest = raw.slice(closeAt + 4).replace(/^\r?\n/, '')

  /** 累积出来的键值对。 */
  const fields = new Map()
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    fields.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim())
  }

  const take = (key, fallback = '') => (fields.has(key) ? fields.get(key) : fallback)

  note.id = decodeScalar(take('id')) || fallbackId
  note.rev = Number(take('rev', '0')) || 0
  note.created = decodeScalar(take('created'))
  note.updated = decodeScalar(take('updated'))

  const sourceValue = decodeScalar(take('source', 'text'))
  note.source = SOURCES.has(sourceValue) ? sourceValue : 'text'

  note.category = decodeScalar(take('category')) || '未分类'
  const catSource = decodeScalar(take('category_source', 'model'))
  note.categorySource = CATEGORY_SOURCES.has(catSource) ? catSource : 'model'
  note.tags = decodeList(take('tags')).slice(0, MAX_TAGS)

  const aiState = decodeScalar(take('ai_state', 'skipped'))
  note.aiState = AI_STATES.has(aiState) ? aiState : 'skipped'
  note.aiAt = decodeScalar(take('ai_at'))
  note.aiTitle = decodeScalar(take('ai_title'))
  note.aiConf = Number(take('ai_conf', '0')) || 0
  note.aiModel = decodeScalar(take('ai_model'))
  note.aiPromptRev = Number(take('ai_prompt_rev', '0')) || 0
  note.aiBasedOnRev = Number(take('ai_based_on_rev', '0')) || 0
  note.aiPoints = decodeJsonList(take('ai_points'))
  note.aiTodos = decodeJsonList(take('ai_todos'))
  note.aiDueHint = decodeScalar(take('ai_due_hint'))
  note.aiMergeHint = decodeScalar(take('ai_merge_hint'))
  note.aiFailReason = decodeScalar(take('ai_fail_reason'))

  note.pinned = decodeScalar(take('pinned')) === 'true'
  note.archived = decodeScalar(take('archived')) === 'true'
  note.deleted = decodeScalar(take('deleted'))
  note.attachments = decodeList(take('attachments')).slice(0, MAX_ATTACHMENTS)

  const delivered = parseJson(take('delivered'), [])
  note.delivered = Array.isArray(delivered) ? delivered.slice(0, MAX_DELIVERED) : []

  // 正文：原文段 + AI 段。AI 段从 `## AI 补全` 起的所有内容。
  const aiAt = rest.indexOf('## AI 补全')
  if (aiAt === -1) {
    note.text = rest.trim()
    note.aiBody = ''
  } else {
    note.text = rest.slice(0, aiAt).trim()
    note.aiBody = rest.slice(aiAt).trim()
  }

  return note
}

// ---------------------------------------------------------------------------
// 设置（与便签库同目录，一个 settings.json）
// ---------------------------------------------------------------------------

/** 设置的默认值。新增字段必须有默认值，否则老用户升级后读到 undefined。 */
export function defaultSettings() {
  return {
    /** 提示开关：关掉后不再计算（不是算完隐藏）。 */
    hints: {
      t1Duplicate: true,   // 重复/相似
      t2Due: true,         // 到期提醒
      t3Undelivered: true, // 待投递横幅
      t4Category: true,    // 归类告知
    },
    /** 允许的类别。AI 只能在其中选；用户可增删。 */
    categories: ['工作', '想法', '待办', '参考', '生活', '未分类'],
    /** 捕获浮层的快捷键说明（只用于展示，实际绑定在客户端）。 */
    shortcut: 'Alt+Space',
    /** 是否在保存后弹 T1 相似提示。 */
    confirmBeforeDeliver: true,
  }
}

/**
 * 读设置。文件不存在 / 损坏 / 字段缺失都回落到默认值 —— 设置坏了不该让插件起不来。
 */
export function readSettings(root) {
  const defaults = defaultSettings()
  const file = join(root, 'settings.json')
  if (!existsSync(file)) return defaults
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return defaults
  }
  const parsed = parseJson(raw, null)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults

  const hints = parsed.hints !== null && typeof parsed.hints === 'object' ? parsed.hints : {}
  const categories =
    Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories.map((item) => oneLine(item)).filter(Boolean)
      : defaults.categories

  return {
    hints: {
      t1Duplicate: hints.t1Duplicate !== false,
      t2Due: hints.t2Due !== false,
      t3Undelivered: hints.t3Undelivered !== false,
      t4Category: hints.t4Category !== false,
    },
    categories,
    shortcut: typeof parsed.shortcut === 'string' && parsed.shortcut !== '' ? parsed.shortcut : defaults.shortcut,
    confirmBeforeDeliver: parsed.confirmBeforeDeliver !== false,
  }
}

/** 写设置（合并到现有值之上）。原子写，坏文件不会让插件下次起不来。 */
export function writeSettings(root, patch) {
  const current = readSettings(root)
  const next = { ...current }
  if (patch !== null && typeof patch === 'object') {
    if (patch.hints !== undefined && patch.hints !== null && typeof patch.hints === 'object') {
      next.hints = { ...current.hints, ...patch.hints }
    }
    if (Array.isArray(patch.categories) && patch.categories.length > 0) {
      next.categories = patch.categories.map((item) => oneLine(item)).filter(Boolean).slice(0, 20)
    }
    if (typeof patch.shortcut === 'string' && patch.shortcut !== '') next.shortcut = patch.shortcut
    if (typeof patch.confirmBeforeDeliver === 'boolean') next.confirmBeforeDeliver = patch.confirmBeforeDeliver
  }
  ensureDirSync(root)
  writeFileAtomic(join(root, 'settings.json'), JSON.stringify(next, null, 2) + '\n')
  return next
}

function ensureDirSync(root) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
}

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------

/**
 * 建立一个便签库。
 * @param root - 库目录（`$DSH_HOME/stickynote`）。不存在会自动创建。
 */
export function createStore(root) {
  /** id → 文件名（只存文件名，正文按需读盘，避免几百条全驻内存）。 */
  const index = new Map()
  /** 目录是否已扫过。 */
  let scanned = false

  function ensureDir() {
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
  }

  /** 扫目录重建 id → 文件名索引。删掉 index 也不会丢数据，这是我们敢说「索引可删」的原因。 */
  function scan() {
    ensureDir()
    index.clear()
    let entries = []
    try {
      entries = readdirSync(root)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      const file = join(root, name)
      // 从文件名尾巴取 id：`2026-11-08T09-14-22-a3f1.md` → `a3f1`
      const stem = name.slice(0, -3)
      const dash = stem.lastIndexOf('-')
      const guess = dash === -1 ? stem : stem.slice(dash + 1)
      // 文件名可能被用户改过，所以以文件里的 id 为准；读不到就用文件名猜
      let id = guess
      try {
        const head = readFileSync(file, 'utf8').slice(0, 2048)
        const match = head.match(/^id:\s*(.+)$/m)
        if (match) id = decodeScalar(match[1]) || guess
      } catch {
        // 读不了就先用文件名，后面读会再报
      }
      index.set(id, name)
    }
    scanned = true
  }

  function ensureScanned() {
    if (!scanned) scan()
  }

  function pathOf(id) {
    ensureScanned()
    const name = index.get(id)
    return name === undefined ? null : join(root, name)
  }

  /** 读一条。不存在返回 null。 */
  function read(id) {
    const file = pathOf(id)
    if (file === null) return null
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    return parse(raw, id)
  }

  /**
   * 落盘。
   *
   * 已经在索引里的 id **复用原文件名**，绝不因为 created 解析异常而换名 ——
   * 换名会在磁盘上留下一个孤儿文件，用户看到的条数会比文件数少。
   */
  function persist(note) {
    ensureDir()
    ensureScanned()
    const existing = index.get(note.id)
    const name = existing !== undefined
      ? existing
      : fileStamp(parseWhen(note.created) || Date.now()) + '-' + note.id + '.md'
    writeFileAtomic(join(root, name), serialize(note))
    index.set(note.id, name)
    return note
  }

  /**
   * 新建一条。
   *
   * **无条件成功**：先落盘再广播，任何下游（AI / sink）都不参与这条路径。
   * 这是「按下保存 1.5 秒内完成」的技术保证（§2.5）。
   */
  function create(input) {
    ensureScanned()
    const now = Date.now()
    const note = blankNote()
    note.id = newId(now)
    note.rev = 1
    note.created = isoNow(now)
    note.updated = note.created

    const rawText = String(input?.text == null ? '' : input.text)
    note.text = rawText.length > MAX_TEXT ? rawText.slice(0, MAX_TEXT) : rawText.trim()

    const sourceValue = String(input?.source == null ? 'text' : input.source)
    note.source = SOURCES.has(sourceValue) ? sourceValue : 'text'

    note.tags = Array.isArray(input?.tags) ? input.tags.slice(0, MAX_TAGS).map(oneLine).filter(Boolean) : []
    note.attachments = Array.isArray(input?.attachments)
      ? input.attachments.slice(0, MAX_ATTACHMENTS).map(oneLine).filter(Boolean)
      : []

    // 用户显式指定类别 → 落 user 层，AI 之后不许改
    const wantedCategory = oneLine(input?.category)
    if (wantedCategory !== '') {
      note.category = wantedCategory
      note.categorySource = 'user'
    }

    // 有 llm 才有意义去整理；调用方传 false 表示「这次不整理」
    note.aiState = input?.skipAi === true ? 'skipped' : 'pending'
    note.aiBasedOnRev = 0

    return persist(note)
  }

  /**
   * 改一条。
   *
   * `rev` 每次 +1；改了原文则把 AI 结果标为过期（**不删旧结果**，§3.6），
   * 由调用方决定是否重新入队。
   */
  function update(id, patch) {
    const note = read(id)
    if (note === null) return null
    if (note.broken) return null

    const before = note.text
    const now = Date.now()

    if (patch?.text !== undefined) {
      const next = String(patch.text)
      note.text = next.length > MAX_TEXT ? next.slice(0, MAX_TEXT) : next.trim()
    }
    if (patch?.category !== undefined) {
      const next = oneLine(patch.category)
      if (next !== '') {
        note.category = next
        // 用户手改的类别永久生效 —— 这是「AI 归类可被纠正」的落点
        note.categorySource = 'user'
      }
    }
    if (patch?.tags !== undefined && Array.isArray(patch.tags)) {
      note.tags = patch.tags.slice(0, MAX_TAGS).map(oneLine).filter(Boolean)
    }
    if (patch?.pinned !== undefined) note.pinned = patch.pinned === true
    if (patch?.archived !== undefined) note.archived = patch.archived === true
    if (patch?.attachments !== undefined && Array.isArray(patch.attachments)) {
      note.attachments = patch.attachments.slice(0, MAX_ATTACHMENTS).map(oneLine).filter(Boolean)
    }

    note.rev += 1
    note.updated = isoNow(now)

    // 原文变了 → AI 结果过期。旧结果保留、打上「基于旧版本」的标记（UI 用 based < rev 判断）
    const textChanged = patch?.text !== undefined && note.text !== before
    if (textChanged && note.aiState === 'done') {
      note.aiState = 'pending'
      note.aiFailReason = ''
    }

    return persist(note)
  }

  /** 写入 AI 整理结果。旧结果被替换，但如果 `basedOnRev` 落后于当前 rev，UI 会标「基于旧版本」。 */
  function applyAi(id, result) {
    const note = read(id)
    if (note === null || note.broken) return null

    note.aiState = AI_STATES.has(result?.state) ? result.state : 'done'
    note.aiAt = isoNow(Date.now())
    note.aiTitle = oneLine(result?.title)
    note.aiConf = Number(result?.confidence) || 0
    note.aiModel = oneLine(result?.model)
    note.aiPromptRev = Number(result?.promptRev) || 0
    note.aiBasedOnRev = Number(result?.basedOnRev) || note.rev
    note.aiPoints = Array.isArray(result?.points) ? result.points.slice(0, 5).map(oneLine).filter(Boolean) : []
    note.aiTodos = Array.isArray(result?.todos) ? result.todos.slice(0, 10).map(oneLine).filter(Boolean) : []
    note.aiDueHint = oneLine(result?.dueHint)
    note.aiMergeHint = oneLine(result?.mergeHint)
    note.aiFailReason = oneLine(result?.failReason)

    // 类别：只有 AI 判出的、且用户没手改过，才落库
    const wanted = oneLine(result?.category)
    if (wanted !== '' && note.categorySource !== 'user') {
      note.category = wanted
      note.categorySource = result?.categorySource === 'rule' ? 'rule' : 'model'
    }

    note.rev += 1
    note.updated = isoNow(Date.now())

    // AI 段落重写（原文段永不动）
    const parts = []
    if (note.aiPoints.length > 0) {
      parts.push('## AI 补全', ...note.aiPoints.map((item) => `- ${item}`))
    }
    if (note.aiTodos.length > 0) {
      if (parts.length > 0) parts.push('')
      parts.push('## 抽出的待办', ...note.aiTodos.map((item) => `- [ ] ${item}`))
    }
    note.aiBody = parts.join('\n')

    return persist(note)
  }

  /**
   * 追加一条到 AI 补全区。
   *
   * 这是「回写」的底层操作：对话里产生的结论要回到卡片，让卡片长大。
   * **只追加、不重写** —— 直接操作 aiBody 字段，绕开 applyAi 的整体重写，
   * 否则旧的 AI 补全会被整体替换掉（那会丢内容）。
   */
  function appendAi(id, text) {
    const note = read(id)
    if (note === null || note.broken) return null
    const addition = oneLine(text)
    if (addition === '') return note

    const existing = note.aiBody || ''
    note.aiBody = existing === '' ? `## AI 补全\n- ${addition}` : `${existing}\n- ${addition}`
    note.rev += 1
    note.updated = isoNow(Date.now())
    return persist(note)
  }

  /** 记一次投递。 */
  function recordDelivery(id, record) {
    const note = read(id)
    if (note === null || note.broken) return null
    note.delivered.push({
      session: oneLine(record?.session),
      at: isoNow(Date.now()),
      mode: record?.mode === 'new' ? 'new' : 'current',
      form: record?.form === 'recall' ? 'recall' : 'draft',
      beforeAi: note.aiState !== 'done',
    })
    if (note.delivered.length > MAX_DELIVERED) {
      note.delivered = note.delivered.slice(-MAX_DELIVERED)
    }
    note.rev += 1
    note.updated = isoNow(Date.now())
    return persist(note)
  }

  /** 软删除。文件不动，最安全。 */
  function remove(id) {
    const note = read(id)
    if (note === null) return null
    note.deleted = isoNow(Date.now())
    note.rev += 1
    note.updated = note.deleted
    return persist(note)
  }

  /** 从回收站恢复。 */
  function restore(id) {
    const note = read(id)
    if (note === null) return null
    note.deleted = ''
    note.rev += 1
    note.updated = isoNow(Date.now())
    return persist(note)
  }

  /**
   * 彻底删除 —— 本文件里唯一真正 rm 的地方。
   *
   * 连附件一起删：只删 .md 会在 media/ 里留下永远没人引用的孤儿图。
   * 反过来说，**软删除（remove）不能删图** —— 那时用户还可能恢复。
   */
  function purge(id) {
    ensureScanned()
    const name = index.get(id)
    if (name === undefined) return false
    let note = null
    try {
      note = read(id)
    } catch {
      note = null
    }
    try {
      rmSync(join(root, name), { force: true })
    } catch {
      return false
    }
    if (note !== null && Array.isArray(note.attachments)) {
      for (const item of note.attachments) removeImage(root, item)
    }
    // 兜底：按文件名前缀扫 media 目录，删掉漏网孤儿图。
    // 正常情况下 attachments 已经覆盖；这一步只处理「进程崩溃在写图与写回之间」的残留，
    // 以及历史数据里图写了但没记录进便签的情况。前缀匹配 + safeMediaName 双重防护。
    try {
      const mediaDir = join(root, 'media')
      if (existsSync(mediaDir)) {
        for (const file of readdirSync(mediaDir)) {
          if (file.startsWith(id + '-')) removeImage(root, file)
        }
      }
    } catch {
      // 扫不到就算了，孤儿图不致命，不该让 purge 失败
    }
    index.delete(id)
    return true
  }

  /** 列表。默认不含已删除；`includeDeleted` 给回收站用。 */
  function list(options = {}) {
    ensureScanned()
    const out = []
    for (const [id] of index) {
      const note = read(id)
      if (note === null) continue

      // 删除与归档的分层：
      //   归档（archived=true）是「收起来但还在」，默认视图不显示，
      //   但**不算删除**，所以 includeDeleted 不该把它带回来；
      //   归档视图（includeArchived）才显示它。
      if (options.onlyDeleted === true) {
        if (note.deleted === '') continue
      } else if (!options.includeDeleted && note.deleted !== '') {
        continue
      }

      if (options.includeArchived !== true && note.archived === true && options.onlyDeleted !== true) {
        continue
      }

      out.push(note)
    }
    out.sort((a, b) => (parseWhen(b.created) || 0) - (parseWhen(a.created) || 0))
    return out
  }

  /**
   * 搜索。空库也要能秒回。
   *
   * 覆盖：原文、AI 标题、标签、类别 —— 用户记不住是哪一样（§6.4）。
   * 已删除的不返回（回收站里的不参与搜索，否则会检索到用户已经不要的东西）。
   */
  function search(query, options = {}) {
    const needle = String(query == null ? '' : query).trim().toLowerCase()
    if (needle === '') return list(options)
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 50
    const hits = []
    for (const note of list(options)) {
      const haystack = [note.text, note.aiTitle, note.category, note.tags.join(' ')].join(' ').toLowerCase()
      const at = haystack.indexOf(needle)
      if (at === -1) continue
      hits.push({ note, score: scoreOf(note, needle), at })
    }
    hits.sort((a, b) => b.score - a.score || (parseWhen(b.note.created) || 0) - (parseWhen(a.note.created) || 0))
    return hits.slice(0, limit).map((hit) => hit.note)
  }

  /** 相关度：命中词数 × 10 + 标题命中 5 + 时间衰减。三个场景共用一份分数（§5.7）。 */
  function scoreOf(note, needle) {
    const words = needle.split(/\s+/).filter(Boolean)
    const body = note.text.toLowerCase()
    let score = 0
    for (const word of words) {
      if (body.includes(word)) score += 10
      if (note.aiTitle.toLowerCase().includes(word)) score += 5
    }
    const age = Date.now() - (parseWhen(note.created) || Date.now())
    const day = 86400000
    if (age <= 7 * day) score += 3
    else if (age <= 30 * day) score += 1
    return score
  }

  /**
   * 与某条相似的其它便签。T1 重复提示用它。
   *
   * 阈值 0.55 是刻意的：宁可漏报，不要误报「重复」——
   * 用户看到「这跟 a3f1 是同一件事」结果不是，就不再信任这个提示了。
   */
  function similar(id, options = {}) {
    const target = read(id)
    if (target === null) return []
    const pool = list({ includeDeleted: false })
    return findSimilar(target, pool, { threshold: 0.55, limit: 3, ...options })
  }

  /**
   * 投递候选：一条便签出去时，顺手推荐几条相关的（§4.6 新开对话多选）。
   *
   * 阈值低到 0.25 —— 这里宁可多列，用户自己会挑；
   * 和 similar() 共用同一份分数算法，只是阈值不同。
   */
  function candidates(id, options = {}) {
    const target = read(id)
    if (target === null) return []
    const pool = list({ includeDeleted: false })
    return findSimilar(target, pool, { threshold: 0.25, limit: 5, ...options })
  }

  /** 目录自身（诊断 / 设置页显示用）。 */
  function describe() {
    ensureScanned()
    return { root, count: index.size }
  }

  return { create, read, update, applyAi, appendAi, recordDelivery, remove, restore, purge, list, search, similar, candidates, describe, scan }
}

// ---------------------------------------------------------------------------
// 附件（图片）
// ---------------------------------------------------------------------------
//
// 图片落在 `<root>/media/`，便签只在 frontmatter 的 `attachments` 里记**文件名**。
// 不记绝对路径：库目录被搬走（换机器、改配置）之后，相对文件名还能找回来。
//
// 命名：`<便签id>-<序号>.<ext>`。便签删了图还在（回收站阶段可能恢复），
// 只有 `purge` 才连图一起删 —— 删早了会让"恢复"变成一个坏掉的便签。

/** 允许的图片类型 → 扩展名。只收浏览器能直接显示的四种。 */
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 单张图片字节上限。手机截图通常 1-3MB，8MB 足够宽裕。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** 判断一个 mime 是否被接受。 */
export function isAllowedImage(mediaType) {
  return typeof mediaType === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_TYPES, mediaType)
}

/** mime → 扩展名。不认识的返回空串。 */
export function extOf(mediaType) {
  return IMAGE_TYPES[String(mediaType || '').toLowerCase()] || ''
}

/** 扩展名 → mime。用于回读时设 Content-Type。 */
const MIME_OF_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

export function mimeOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase()
  return MIME_OF_EXT[ext] || 'application/octet-stream'
}

/**
 * 写一张图到 media/。
 *
 * @param root - 库目录
 * @param noteId - 所属便签 id
 * @param index - 该便签内的序号（从 0 起）
 * @param mediaType - 图片 mime
 * @param bytes - 图片字节
 * @returns 文件名，或 null（类型/大小不合法）
 */
export function writeImage(root, noteId, index, mediaType, bytes) {
  const ext = extOf(mediaType)
  if (ext === '') return null
  if (bytes === null || bytes === undefined) return null
  const size = bytes.length !== undefined ? bytes.length : 0
  if (size === 0 || size > MAX_IMAGE_BYTES) return null

  const dir = join(root, 'media')
  ensureDirSync(dir)
  const name = `${noteId}-${String(index).padStart(2, '0')}.${ext}`
  writeFileAtomic(join(dir, name), bytes)
  return name
}

/** 读一张图。不存在返回 null。 */
export function readImage(root, name) {
  const safe = safeMediaName(name)
  if (safe === null) return null
  const file = join(root, 'media', safe)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

/**
 * 校验媒体文件名。
 *
 * **必须做这件事**：`file` 参数来自 HTTP 请求，不做校验就是任意文件读取。
 * 只接受 `media/` 下、无路径分隔符、无 `..`、扩展名在白名单内的名字。
 */
export function safeMediaName(name) {
  const text = String(name == null ? '' : name).trim()
  if (text === '') return null
  if (text.includes('/') || text.includes('\\') || text.includes('..')) return null
  if (text.startsWith('.')) return null
  const ext = text.split('.').pop().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(MIME_OF_EXT, ext) === false) return null
  return text
}

/** 删一张图（只在 purge 时调用）。 */
export function removeImage(root, name) {
  const safe = safeMediaName(name)
  if (safe === null) return false
  try {
    rmSync(join(root, 'media', safe), { force: true })
    return true
  } catch {
    return false
  }
}

/** 解析库目录：`$DSH_HOME/stickynote`，可用插件配置覆盖。 */
export function resolveRoot(configured) {
  const home = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  const value = String(configured == null ? '' : configured).trim()
  if (value === '') return join(home, 'stickynote')
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (value.startsWith('/')) return value
  return join(home, value)
}

export const internals = { parse, serialize, blankNote, newId, isoNow, MAX_TEXT }
