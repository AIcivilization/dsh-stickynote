/**
 * dsh-note — 本地整理规则（Host 半侧，**不花 token**）
 *
 * 三件事，都发生在调模型之前或代替调模型：
 *
 *   1. 规则层归类：URL 域名指纹 / 关键词表 → 直接定类。
 *      代价为零、延迟为零，且永远不会归错（只会归不出）。
 *      归不出才交给模型 —— 这就是「先便宜后贵」。
 *
 *   2. 相似度：T1 重复提示、T5 相关提示、投递候选排名，**三个场景共用一份分数**。
 *      共用是关键：否则用户会遇到「投递时候选里没有，保存时却说重复」这种自相矛盾。
 *
 *   3. 时间线索：从自然语言里认出「明天下午」「下周三」「月底前」。
 *      只做到能排序能提示的程度，**不解析成精确时间点** ——
 *      解析错了会让提醒在错的时间响，比不提醒更糟。
 */

// ---------------------------------------------------------------------------
// 规则层归类
// ---------------------------------------------------------------------------

/**
 * 域名指纹表。命中就把便签归到对应类别。
 *
 * 只收「看一眼域名就知道是什么」的那些 —— 宁可漏，不可错。
 */
const DOMAIN_RULES = [
  // 长词（独特，裸匹配安全）：「github」「twitter」这类词几乎只可能指那个站，
  // 中文用户口语里常省略 .com，所以后缀可省；前面也不要求分隔符。
  { category: '参考', test: /(?:github|gitlab|gitee|bitbucket|stackoverflow|stackexchange|segmentfault)\b/i },
  { category: '参考', test: /(?:arxiv|springer)\b/i },
  { category: '想法', test: /(?:twitter|weibo|mastodon|threads)\b/i },
  { category: '待办', test: /(?:linear|jira|trello|asana|notion)\b/i },
  // 短词：必须带 .后缀，否则「x」「docs」「dev」「api」会在普通词里误匹配
  { category: '参考', test: /(?:^|\/\/|[\.\s])(?:docs|developer|dev|api)\.[a-z0-9-]+\.(?:com|io|org)\b/i },
  { category: '想法', test: /(?:^|\/\/|[\.\s])x\.(?:com|social|app)\b/i },
]

/**
 * 关键词表。按「出现这些词几乎必然是这个类别」设计，不是词袋分类器。
 *
 * 顺序有意义：越靠前越具体，先匹配先赢。
 */
const KEYWORD_RULES = [
  { category: '待办', test: /(?:待办|TODO|to-?do|记得|别忘了|要做|待办事项|ddl|deadline|截止)/i },
  { category: '参考', test: /(?:参考|文档|链接|文章|paper|论文|教程|手册|spec|规范)/i },
  { category: '想法', test: /(?:想法|灵感|点子|idea|也许|或许|要不要|是不是该|如果|假如)/i },
  { category: '工作', test: /(?:需求|上线|发布|部署|接口|重构|排查|bug|修复|评审|排期|会议|客户)/i },
  { category: '生活', test: /(?:买|吃|做菜|菜谱|旅行|旅游|体检|挂号|快递|缴费|物业|房租|心情|照片|拍照|vlog|视频|日记|打卡|记录生活)/i },
]

/**
 * 规则层归类。
 *
 * @param text - 原文
 * @returns `{ category, reason }` 或 null（归不出，交给模型）
 */
export function classifyByRule(text) {
  const raw = String(text == null ? '' : text).trim()
  if (raw === '') return null

  for (const rule of DOMAIN_RULES) {
    const match = raw.match(rule.test)
    if (match !== null) {
      return { category: rule.category, reason: 'domain:' + match[0].replace(/^\/+/, '') }
    }
  }

  for (const rule of KEYWORD_RULES) {
    const match = raw.match(rule.test)
    if (match !== null) {
      return { category: rule.category, reason: 'keyword:' + match[0] }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// 分词：中英文都要能用，不引入任何词库
// ---------------------------------------------------------------------------

/** 中文停用词：几乎每条便签都会出现，不区分任何东西。 */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '就', '也', '都', '而', '及', '与', '着', '或',
  '一个', '这个', '那个', '我们', '你们', '他们', '什么', '怎么', '因为', '所以',
  '但是', '如果', '可以', '应该', '需要', '没有', '不是', '就是', '还是', '这样',
  '那样', '一下', '现在', '然后', '而且', '并且', '不过', '只是', '已经',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'or',
  'in', 'on', 'at', 'for', 'with', 'this', 'that', 'it', 'as', 'by', 'from',
])

/**
 * 极简分词。
 *
 * 中文按「二元组」切（不引词库，2-gram 对短文本的相似度够用），
 * 英文按空白与标点切。这不是正经分词，是**相似度计算用的特征提取**。
 */
export function tokenize(text) {
  const raw = String(text == null ? '' : text).toLowerCase()
  const tokens = new Set()

  // 英文/数字词
  for (const word of raw.match(/[a-z][a-z0-9_+#.-]{1,}/g) || []) {
    if (word.length >= 2 && !STOPWORDS.has(word)) tokens.add(word)
  }

  // 中文：连续汉字段内做 2-gram
  for (const run of raw.match(/[\u4e00-\u9fa5]+/g) || []) {
    if (run.length === 1) {
      if (!STOPWORDS.has(run)) tokens.add(run)
      continue
    }
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (!STOPWORDS.has(gram)) tokens.add(gram)
    }
  }

  return tokens
}

/** 两个 token 集合的 Jaccard 相似度（对称，看两边整体重合度）。 */
export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  const shared = sharedCount(a, b)
  return shared / (a.size + b.size - shared)
}

/** 重叠系数：共享部分占**较短那条**的比例。 */
export function overlapCoefficient(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  return sharedCount(a, b) / Math.min(a.size, b.size)
}

function sharedCount(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const item of small) if (large.has(item)) shared += 1
  return shared
}

/**
 * 正文相似度：**两者取大**。
 *
 * 为什么不能只用 Jaccard：中文 2-gram 对省略式改写极不敏感。
 * 「登录流程**要拆成**两步」与「登录流程**拆**两步」人看是同一件事，
 * Jaccard 只有 0.29 —— 因为短的那条整个是长那条的子集，多出来的 gram 把分母拉大了。
 *
 * 重叠系数对这种「一条包含另一条」的情形是准的（0.67），
 * 而它对「两条都很长但只有一小段重合」偏乐观，Jaccard 那时更准。
 * 取两者最大值，正好覆盖两种情形。
 */
export function bodyScore(a, b) {
  return Math.max(jaccard(a, b), overlapCoefficient(a, b))
}

// ---------------------------------------------------------------------------
// 相似度：三个场景共用这一份分数
// ---------------------------------------------------------------------------

const DAY = 86400000

/**
 * 两条便签的相似度。
 *
 * 四个信号加权：
 *   标签交集   × 3   —— 用户自己打的标签最可信
 *   正文相似度 × 7   —— Jaccard 与重叠系数取大（见 bodyScore）
 *   类别相同   + 1  —— 弱信号，只做加成
 *   时间邻近   + 1  —— 7 天内
 *
 * **分母是"可比权重之和"，不是固定的 12。**
 * 这一条很关键：捕获那一刻，新便签还没有标签、没有类别（AI 还没跑），
 * 如果固定除以 12，一条完全一样的旧便签最多也只能得 8/12 = 0.67，
 * 阈值 0.55 就要求正文相似度达到 0.80 —— 结构性地漏掉真重复。
 * 按实际可比的信号归一化，两条"都还没整理"的便签也能公平比较。
 *
 * 阈值在调用方定：T1 用 0.55（宁可漏，不要误报重复），
 * 投递候选用 0.25（宁可多列，用户自己会挑）。
 *
 * @param a - 便签（含 text / tags / category / created）
 * @param b - 便签
 * @returns 0~1 之间的分数
 */
export function similarity(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return 0
  if (a.id === b.id) return 0

  let score = 0
  /** 这一次比较里**真正可比**的权重之和。见下面的注释。 */
  let applicable = 0

  // 标签交集 —— 只有两边都打过标签才可比
  const tagsA = new Set(Array.isArray(a.tags) ? a.tags : [])
  const tagsB = new Set(Array.isArray(b.tags) ? b.tags : [])
  if (tagsA.size > 0 && tagsB.size > 0) {
    applicable += 3
    let shared = 0
    for (const tag of tagsA) if (tagsB.has(tag)) shared += 1
    score += Math.min(1, shared / Math.min(tagsA.size, tagsB.size)) * 3
  }

  // 正文相似度（Jaccard 与重叠系数取大，见 bodyScore 的注释）—— 永远可比
  applicable += 7
  const body = bodyScore(tokenize(a.text), tokenize(b.text))
  score += body * 7

  // 类别加成 —— 只有两边都归过类才可比
  const hasCategory = (note) => typeof note.category === 'string' && note.category !== '' && note.category !== '未分类'
  if (hasCategory(a) && hasCategory(b)) {
    applicable += 1
    if (a.category === b.category) score += 1
  }

  // 时间邻近 —— 只有两边都有可解析的时间才可比
  const ta = Date.parse(String(a.created || ''))
  const tb = Date.parse(String(b.created || ''))
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    applicable += 1
    if (Math.abs(ta - tb) <= 7 * DAY) score += 1
  }

  if (applicable === 0) return 0
  return Math.max(0, Math.min(1, score / applicable))
}

/**
 * 找出与目标最相似的若干条。
 *
 * @param target - 目标便签
 * @param pool - 候选池（已排除已删除）
 * @param options.limit - 最多返回几条，默认 3
 * @param options.threshold - 最低分，默认 0.25
 * @returns `[{ note, score }]`，按分数倒序
 */
export function findSimilar(target, pool, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 3
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.25
  if (!Array.isArray(pool) || pool.length === 0) return []

  const hits = []
  for (const note of pool) {
    if (note === null || note === undefined) continue
    if (note.id === target.id) continue
    if (note.deleted !== '') continue
    if (note.archived === true) continue
    const score = similarity(target, note)
    if (score >= threshold) hits.push({ note, score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

// ---------------------------------------------------------------------------
// 时间线索
// ---------------------------------------------------------------------------

/** 相对日的锚点词。值是天数偏移。 */
const DAY_WORDS = [
  { test: /前天/, offset: -2 },
  { test: /昨天|昨日/, offset: -1 },
  { test: /今天|今日|今晚|今早/, offset: 0 },
  { test: /明天|明日|明早|明晚/, offset: 1 },
  { test: /后天/, offset: 2 },
  { test: /大后天/, offset: 3 },
]

/** 时刻词。只用来排「早上/下午」的先后，不构造精确时间。 */
const TIME_WORDS = /(早上|上午|中午|下午|傍晚|晚上|夜里|凌晨)/

/**
 * 从原文里认出时间线索。
 *
 * **刻意不解析成精确时间点。** 只回一个粗粒度的 `{ kind, days, label }`：
 *   kind = 'day'   相对某天（days 是偏移）
 *   kind = 'week'  下周/本周几
 *   kind = 'month' 月底/月初
 *   kind = 'raw'   认出了有时词但没有结构（"有空的时候"）
 *
 * 解析错了会让提醒在错的时间响，比不提醒更糟。所以这里只做到「能排序、能提示」。
 *
 * @param text - 原文
 * @returns 线索对象或 null
 */
export function detectDueHint(text) {
  const raw = String(text == null ? '' : text).trim()
  if (raw === '') return null

  // 明确日期：2026-11-15 / 11月15日 / 11/15
  const isoDate = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (isoDate !== null) {
    return { kind: 'date', label: `${isoDate[1]}-${pad(isoDate[2])}-${pad(isoDate[3])}`, raw: isoDate[0] }
  }
  const cnDate = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (cnDate !== null) {
    return { kind: 'date', label: `${cnDate[1]}月${cnDate[2]}日`, raw: cnDate[0] }
  }

  // 相对日
  for (const word of DAY_WORDS) {
    const match = raw.match(word.test)
    if (match !== null) {
      const time = raw.match(TIME_WORDS)
      const suffix = time === null ? '' : time[1]
      return { kind: 'day', days: word.offset, label: match[0] + suffix, raw: match[0] + suffix }
    }
  }

  // 下周几 / 这周几
  const week = raw.match(/(下下|下|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/)
  if (week !== null) {
    return { kind: 'week', weekOffset: week[1] === '下下' ? 2 : week[1] === '下' ? 1 : 0, weekday: week[2], label: week[0].trim(), raw: week[0].trim() }
  }

  // 月底 / 月初 / 月内
  const month = raw.match(/(这个?月|下个?月)?\s*(月底|月末|月初|月中)/)
  if (month !== null) {
    return { kind: 'month', which: month[2], monthOffset: month[1] && month[1].startsWith('下') ? 1 : 0, label: month[0].trim(), raw: month[0].trim() }
  }

  // 只有泛泛的时词
  const vague = raw.match(/(过几[天日]|有空|改天|回头|之后|以后|尽快|马上|稍后)/)
  if (vague !== null) {
    return { kind: 'raw', label: vague[0], raw: vague[0] }
  }

  return null
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * 把 `detectDueHint` 的粗线索算成一个**绝对时间点**。
 *
 * 用途只有一个：给 `schedule` 建提醒。所以规则是**宁可算不出，不要算错** ——
 * 算错了会让提醒在错的时间响，比不提醒更糟。
 *
 * 认不出的（`kind: 'raw'`，比如"有空的时候"）一律返回 null。
 *
 * @param hint - `detectDueHint` 的返回值
 * @param now - 基准时间（毫秒），默认当前
 * @returns `{ at: Date, label: string }` 或 null
 */
export function resolveDueAt(hint, now) {
  if (hint === null || hint === undefined || typeof hint !== 'object') return null
  const base = new Date(Number.isFinite(now) ? now : Date.now())

  /** 默认提醒时刻：上午 9 点（用户没指定时间时的合理默认，不是猜得很细）。 */
  const DEFAULT_HOUR = 9

  /** 从一个日期 + 时刻词拼出 Date。 */
  function withTimeOfDay(date, rawLabel) {
    const text = String(rawLabel || '')
    let hour = DEFAULT_HOUR
    if (/凌晨/.test(text)) hour = 5
    else if (/早上|明早|今早|上午/.test(text)) hour = 8
    else if (/中午/.test(text)) hour = 12
    else if (/下午/.test(text)) hour = 15
    else if (/傍晚/.test(text)) hour = 18
    else if (/晚上|明晚|今晚/.test(text)) hour = 20
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0)
    return result
  }

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  const label = hint.label || ''

  // 明确日期
  if (hint.kind === 'date') {
    const text = String(hint.raw || hint.label || '')
    // 2026-11-15
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (iso !== null) {
      const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), DEFAULT_HOUR, 0, 0, 0)
      return Number.isFinite(date.getTime()) ? { at: date, label: `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}` } : null
    }
    // 11月15日
    const cn = text.match(/^(\d{1,2})月(\d{1,2})日$/)
    if (cn !== null) {
      const month = Number(cn[1])
      const day = Number(cn[2])
      if (month < 1 || month > 12 || day < 1 || day > 31) return null
      // 没写年份：取今年；已过去的就顺延到明年
      let year = base.getFullYear()
      let date = new Date(year, month - 1, day, DEFAULT_HOUR, 0, 0, 0)
      if (date.getTime() < base.getTime()) {
        year += 1
        date = new Date(year, month - 1, day, DEFAULT_HOUR, 0, 0, 0)
      }
      return { at: date, label: `${month}月${day}日` }
    }
    return null
  }

  // 相对日
  if (hint.kind === 'day') {
    const days = Number(hint.days)
    if (!Number.isFinite(days)) return null
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
    const at = withTimeOfDay(target, label)
    // 当天的时刻若已过，往后推一天（"今天下午"在晚上看到时，提醒明天下午）
    if (at.getTime() <= base.getTime() && days >= 0) {
      const next = new Date(at.getTime() + 86400000)
      return { at: next, label }
    }
    return { at, label }
  }

  // 下周几 / 这周几
  if (hint.kind === 'week') {
    const table = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 }
    const weekday = table[String(hint.weekday)]
    if (weekday === undefined) return null
    const weekOffset = Number(hint.weekOffset) || 0

    // 本周的周一
    const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate())
    const shift = (monday.getDay() + 6) % 7 // 周一=0 … 周日=6
    monday.setDate(monday.getDate() - shift + weekOffset * 7)

    // 目标星期几相对周一的天数（周日是 6）
    const offset = weekday === 0 ? 6 : weekday - 1
    const target = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)
    const at = withTimeOfDay(target, label)
    if (at.getTime() <= base.getTime()) return null // 已过去就不提醒
    return { at, label }
  }

  // 月底 / 月初 / 月中
  if (hint.kind === 'month') {
    const monthOffset = Number(hint.monthOffset) || 0
    const year = base.getFullYear()
    const month = base.getMonth() + monthOffset
    const which = hint.which

    if (which === '月底' || which === '月末') {
      const lastDay = new Date(year, month + 1, 0).getDate()
      const at = new Date(year, month, lastDay, DEFAULT_HOUR, 0, 0, 0)
      if (at.getTime() <= base.getTime()) return null
      return { at, label: `${month + 1}月月底` }
    }
    if (which === '月初') {
      const at = new Date(year, month, 1, DEFAULT_HOUR, 0, 0, 0)
      const target = at.getTime() <= base.getTime() ? new Date(year, month + 1, 1, DEFAULT_HOUR, 0, 0, 0) : at
      return { at: target, label: `${target.getMonth() + 1}月月初` }
    }
    if (which === '月中') {
      const at = new Date(year, month, 15, DEFAULT_HOUR, 0, 0, 0)
      if (at.getTime() <= base.getTime()) return null
      return { at, label: `${month + 1}月月中` }
    }
    return null
  }

  // raw（"有空""改天""尽快"）：**故意不解析** —— 这些词没有确定时间，
  // 猜一个时间点比不提醒更糟。
  return null
}

export const internals = { DOMAIN_RULES, KEYWORD_RULES, STOPWORDS }
