/**
 * dsh-note — Host 半侧
 *
 * 只做三件事：
 *   1. 存：一条便签一个 Markdown 文件，落在 `$DSH_HOME/stickynote/`（见 store.js）。
 *   2. 通道：在 webServer 上挂 `/api/dsh-note/*` 同源 JSON 端点 + 一条 SSE 长连接，
 *      让多个标签页的图标与列表同步。
 *   3. 工具：注册 `stickynote_*` 模型工具，让「记一下这个」这类话真正落到便签里。
 *
 * 刻意不 import `@deepseek-ai/*`：插件装在 profile 里时，宿主对第三方包的 ESM
 * 解析钩子不保证可用；零依赖最稳（`dsh-plugin-sticky-wall` 走同一条路）。
 * 宿主能力一律用可选注入（`ctx.inject([...])`）拿，缺席就降级而不是崩。
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createQueue, DEFAULT_CATEGORIES, PROMPT_REV } from './ai.js'
import { detectDueHint, resolveDueAt } from './rules.js'
import { createStore, isAllowedImage, mimeOf, readImage, readSettings, resolveRoot, safeMediaName, writeImage, writeSettings } from './store.js'

export const name = 'dsh-note'

/** Host 硬依赖：HTTP 通道。没有它就只当纯工具插件用。 */
export const inject = ['webServer']

/** 版本号。设置页显示，出问题时用户可以直接报。 */
const VERSION = '0.1.0'

/** 端点前缀（Client 半侧同一常量）。 */
const API = '/api/dsh-note'

/**
 * 请求体上限。
 *
 * 捕获是短文本，但**图片上传走 base64 JSON**（见 /attach 的注释），
 * 8MB 的图 base64 后约 11MB，所以这里给到 16MB。
 */
const MAX_BODY = 16 * 1024 * 1024

/** 单条便签的图片上限（与 store 的 MAX_ATTACHMENTS 保持一致）。 */
const MAX_ATTACHMENTS = 8

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: String(message == null ? 'unknown' : message) })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const value = JSON.parse(text)
  return value !== null && typeof value === 'object' ? value : {}
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const cfg = config !== null && typeof config === 'object' ? config : {}
  const root = resolveRoot(cfg.storePath)
  const store = createStore(root)

  try {
    mkdirSync(join(root, 'media'), { recursive: true })
  } catch {
    // 建不出来会在第一次写入时报错，那时给用户看得懂的提示
  }

  // 启动即扫盘：索引可以随时删掉，重建不需要用户做任何事
  try {
    store.scan()
  } catch (error) {
    console.warn(`[dsh-note] 扫描 ${root} 失败：${error?.message || String(error)}`)
  }

  // ---- 变更广播（多标签同步） ----
  /** 所有挂着的 SSE 响应。 */
  const clients = new Set()

  function broadcast(payload) {
    const line = `event: note\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      try {
        res.write(line)
      } catch {
        clients.delete(res)
      }
    }
  }

  /** 每次变更都带上 id 与 rev，客户端按 rev 合并，旧数据不会盖新数据。 */
  function notify(op, note) {
    broadcast({ op, id: note?.id ?? '', rev: note?.rev ?? 0 })
  }

  // ---- AI 整理管线 ----
  /**
   * 模型选择：**纯跟随对话**。
   *
   * 不提供插件自己的模型配置，也不做"退到第一个可用模型"这类硬编码回退。
   * 理由：插件的整理是对话的附属动作，理应和对话用同一个模型；一旦插件
   * 私自换模型，用户会遇到"这张便签整理得更差"却找不到原因。
   *
   * `agentDefaultModel.currentSelection()` 就是对话当前的选择。它给不出东西
   * （未配置 / provider 未就绪）时返回 null，队列据此标 `skipped`，不猜。
   */
  function pickModel() {
    try {
      const adm = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
      if (adm === undefined || typeof adm.currentSelection !== 'function') return null
      const selection = adm.currentSelection()
      if (selection === null || typeof selection !== 'object') return null
      const provider = typeof selection.provider === 'string' ? selection.provider : ''
      const model = typeof selection.model === 'string' ? selection.model : ''
      if (provider === '' || model === '') return null
      return { provider, model }
    } catch {
      return null
    }
  }

  /**
   * 当前设置。
   *
   * **每次读都从磁盘重新读，不做内存缓存。**
   * 早期版本缓存了一份，结果是：用户手动删掉 settings.json（或外部改坏）之后，
   * 设置页仍然显示旧值 —— 内存和磁盘不一致，而设置页的全部价值就是"看到真实状态"。
   * 读一个小 JSON 的成本远低于一次网络往返，不值得为它做缓存。
   */
  function currentSettings() {
    return readSettings(root)
  }

  /** 队列实例。`llm` 缺席时是 null，此时便签永远是素贴。 */
  let queue = null

  ctx.inject(['llm'], (llmCtx) => {
    queue = createQueue({
      store,
      llm: llmCtx.llm,
      pickModel,
      categories: currentSettings().categories,
      onChange: (note) => notify('updated', note),
    })
    if (queue === null) {
      console.warn('[dsh-note] llm 不可用，AI 整理已停用（便签仍可正常记录与投递）')
      return
    }
    // 启动时把上次没跑完的接上：pending / running 全部重新入队
    const resumed = queue.recover()
    if (resumed > 0) console.log(`[dsh-note] 恢复 ${resumed} 条待整理`)
  })

  // ---- 同源校验 ----
  /**
   * 只接受本页面的请求。
   *
   * 不做这件事的后果很严重：任何网页都能往用户的便签库里写东西。
   * 没有 Origin 头的请求（同源 GET、curl）放行，因为它们不来自别的网站。
   */
  function rejectReason(req) {
    const origin = req.headers.origin
    if (origin === undefined || origin === '') return ''
    let host = ''
    try {
      host = new URL(String(origin)).host
    } catch {
      return '来源不合法'
    }
    if (host !== String(req.headers.host || '')) return '拒绝跨站请求'
    return ''
  }

  // ---- 路由 ----
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API,
        handler: async (req, res) => {
          const denied = rejectReason(req)
          if (denied !== '') return sendError(res, 403, denied)

          const url = String(req.url || '')
          const queryAt = url.indexOf('?')
          const path = queryAt === -1 ? url : url.slice(0, queryAt)
          const params = new URLSearchParams(queryAt === -1 ? '' : url.slice(queryAt + 1))
          const action = path.startsWith(API) ? path.slice(API.length) || '/' : '/'

          try {
            // ---- SSE：长连接，宿主契约明确允许挂住响应 ----
            if (action === '/events' && req.method === 'GET') {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
              })
              res.write(': connected\n\n')
              clients.add(res)
              const ping = setInterval(() => {
                try {
                  res.write(': ping\n\n')
                } catch {
                  clearInterval(ping)
                  clients.delete(res)
                }
              }, 25000)
              const close = () => {
                clearInterval(ping)
                clients.delete(res)
              }
              req.on('close', close)
              req.on('error', close)
              return
            }

            if (action === '/health' && req.method === 'GET') {
              return sendJson(res, 200, {
                ok: true,
                ...store.describe(),
                ai: queue === null ? 'off' : 'on',
                promptRev: PROMPT_REV,
                queued: queue === null ? 0 : queue.size(),
              })
            }

            if (action === '/list' && req.method === 'GET') {
              const since = Number(params.get('since'))
              // trash=1 只看回收站；archive=1 只看归档；都不带 = 默认视图（排除归档和删除）
              const notes = store.list({
                includeDeleted: params.get('trash') === '1',
                onlyDeleted: params.get('trash') === '1' ? true : undefined,
                includeArchived: params.get('archive') === '1' || params.get('trash') === '1',
              })
              const trimmed = notes.filter((note) => !Number.isFinite(since) || since <= 0 || note.rev > since)
              return sendJson(res, 200, { ok: true, notes: trimmed.map(slim), maxRev: maxRevOf(notes) })
            }

            if (action === '/search' && req.method === 'GET') {
              const notes = store.search(params.get('q') || '', { limit: Number(params.get('limit')) || 50 })
              return sendJson(res, 200, { ok: true, notes: notes.map(slim) })
            }

            if (action === '/get' && req.method === 'GET') {
              const note = store.read(params.get('id') || '')
              if (note === null) return sendError(res, 404, '便签不存在')
              return sendJson(res, 200, { ok: true, note })
            }

            if (action === '/capture' && req.method === 'POST') {
              const body = await readBody(req)
              const text = String(body.text == null ? '' : body.text).trim()
              if (text === '') return sendError(res, 400, '内容不能为空')
              // 先落盘，再广播 —— 广播不 await，任何下游挂了都不影响这次保存
              const note = store.create({
                text,
                source: body.source,
                category: body.category,
                tags: body.tags,
                skipAi: body.skipAi,
              })
              notify('created', note)
              // 入队放在广播之后：用户看到卡片就有了，AI 慢慢跑
              if (queue !== null && note.aiState === 'pending') queue.enqueue(note.id)
              // T1 重复提示：只提示，绝不自动合并（自动合并会丢数据）
              let similar = []
              try {
                similar = store.similar(note.id).map((hit) => ({
                  id: hit.note.id,
                  title: hit.note.aiTitle || firstLine(hit.note.text) || '（无标题）',
                  score: Math.round(hit.score * 100) / 100,
                }))
              } catch {
                similar = []
              }
              return sendJson(res, 200, { ok: true, note, similar })
            }

            if (action === '/update' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.update(String(body.id || ''), body.patch || {})
              if (note === null) return sendError(res, 404, '便签不存在或已损坏')
              notify('updated', note)
              if (queue !== null && note.aiState === 'pending') queue.enqueue(note.id)
              return sendJson(res, 200, { ok: true, note })
            }

            if (action === '/remove' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.remove(String(body.id || ''))
              if (note === null) return sendError(res, 404, '便签不存在')
              notify('updated', note)
              return sendJson(res, 200, { ok: true, note })
            }

            if (action === '/restore' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.restore(String(body.id || ''))
              if (note === null) return sendError(res, 404, '便签不存在')
              notify('updated', note)
              return sendJson(res, 200, { ok: true, note })
            }

            if (action === '/purge' && req.method === 'POST') {
              const body = await readBody(req)
              const id = String(body.id || '')
              const ok = store.purge(id)
              if (!ok) return sendError(res, 404, '便签不存在')
              notify('deleted', { id, rev: 0 })
              return sendJson(res, 200, { ok: true })
            }

            /*
             * 上传一张图片。
             *
             * 走 base64 JSON 而不是 multipart —— 我们没有第三方依赖，
             * 手写 multipart 解析器是纯亏（边界条件多、易错）。
             * 8MB 的图 base64 后约 11MB，请求体上限已经放宽到 16MB。
             *
             * 只存不读：图片**默认不发给模型**（设计文档 §12 的隐私约束）。
             */
            if (action === '/attach' && req.method === 'POST') {
              const body = await readBody(req)
              const noteId = String(body.noteId || '').trim()
              if (noteId === '') return sendError(res, 400, '缺少 noteId')

              const note = store.read(noteId)
              if (note === null) return sendError(res, 404, '便签不存在')
              if (note.attachments.length >= MAX_ATTACHMENTS) {
                return sendError(res, 400, `一张便签最多 ${MAX_ATTACHMENTS} 张图`)
              }

              const mediaType = String(body.mediaType || '').trim().toLowerCase()
              if (!isAllowedImage(mediaType)) {
                return sendError(res, 400, `不支持的图片类型 ${mediaType || '(空)'}，只收 png / jpeg / webp / gif`)
              }

              const base64 = String(body.data || '').trim()
              if (base64 === '') return sendError(res, 400, '图片数据是空的')

              let bytes = null
              try {
                bytes = Buffer.from(base64, 'base64')
              } catch {
                return sendError(res, 400, '图片数据不是合法 base64')
              }
              if (bytes.length === 0) return sendError(res, 400, '图片数据是空的')

              const name = writeImage(root, noteId, note.attachments.length, mediaType, bytes)
              if (name === null) return sendError(res, 400, '图片太大或格式不对')

              const updated = store.update(noteId, { attachments: [...note.attachments, name] })
              if (updated === null) {
                return sendError(res, 500, '写便签失败')
              }
              notify('updated', updated)
              return sendJson(res, 200, { ok: true, name, note: slim(updated) })
            }

            /*
             * 读一张图。
             *
             * `name` 来自 HTTP 查询参数，**必须过 safeMediaName** ——
             * 不做校验就是任意文件读取。函数里拒掉路径分隔符、`..`、
             * 隐藏文件和不在白名单的扩展名。
             */
            if (action === '/media' && req.method === 'GET') {
              const wanted = params.get('name') || ''
              const safe = safeMediaName(wanted)
              if (safe === null) return sendError(res, 400, '文件名不合法')
              const bytes = readImage(root, safe)
              if (bytes === null) return sendError(res, 404, '图片不存在')
              res.writeHead(200, {
                'Content-Type': mimeOf(safe),
                'Cache-Control': 'private, max-age=31536000, immutable',
                'Content-Length': bytes.length,
              })
              res.end(bytes)
              return
            }

            // 读设置 + 运行时状态。设置页的唯一直数据源。
            if (action === '/settings' && req.method === 'GET') {
              return sendJson(res, 200, {
                ok: true,
                settings: currentSettings(),
                runtime: {
                  root: root,
                  count: store.describe().count,
                  ai: queue === null ? 'off' : 'on',
                  queued: queue === null ? 0 : queue.size(),
                  running: queue === null ? false : queue.isRunning(),
                  promptRev: PROMPT_REV,
                  version: VERSION,
                },
              })
            }

            // 写设置。只接受白名单字段，不整对象覆盖。
            if (action === '/settings' && req.method === 'POST') {
              const body = await readBody(req)
              const next = writeSettings(root, body)
              return sendJson(res, 200, { ok: true, settings: next })
            }

            /*
             * 开一个新会话。
             *
             * 客户端拿不到 `startSession`（那是 sidebar 的注入回调，外壳私有面），
             * 所以由 Host 调 `sessionController.create()` 建，返回 id 给客户端，
             * 客户端再用 `sessions.scope(id)` 拿输入框把内容发进去。
             *
             * 这是参考 `dsh-vps-manager` 的做法：
             * 「替用户在对话里发一句」需要会话作用域的输入门面，而门面只能从
             * `sessions.scope(sessionId)` 拿 —— 所以必须先有一个真实会话。
             */
            if (action === '/session' && req.method === 'POST') {
              const controller = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
              if (controller === undefined || controller === null || typeof controller.create !== 'function') {
                return sendError(res, 503, '这个环境不支持新建会话')
              }

              const body = await readBody(req)
              const request = {}
              // cwd：优先请求里给的，其次插件配置的，最后交给 Host 默认
              if (body.cwd !== undefined && String(body.cwd).trim() !== '') request.cwd = String(body.cwd).trim()
              else if (cfg.cwd !== undefined && String(cfg.cwd).trim() !== '') request.cwd = String(cfg.cwd).trim()
              if (body.agentPreset !== undefined && String(body.agentPreset).trim() !== '') {
                request.agentPreset = String(body.agentPreset).trim()
              }

              try {
                const created = await controller.create(request)
                return sendJson(res, 200, {
                  ok: true,
                  sessionId: created && created.sessionId ? String(created.sessionId) : '',
                  agentPreset: created && created.agentPreset ? String(created.agentPreset) : '',
                })
              } catch (error) {
                return sendError(res, 500, `新建会话失败：${error?.message || String(error)}`)
              }
            }

            /*
             * T2 到期提醒。
             *
             * 只负责「建提醒」，「怎么提醒到人」交给 DSH：
             * `schedule` 到点会开一个会话发消息，用户的 notify 插件会接手推送。
             * 我们不做推送服务 —— 微信要企业号、Telegram 要 bot token，
             * 每个都是独立账号体系和独立失效风险，生态里已经有做得很好的插件。
             */
            if (action === '/remind' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.read(String(body.id || ''))
              if (note === null) return sendError(res, 404, '便签不存在')

              const schedule = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
              if (schedule === undefined || schedule === null || typeof schedule.create !== 'function') {
                return sendError(res, 503, '这个环境没有 schedule 服务，暂时不能建提醒')
              }

              // 时间来源，三级回落：
              //   ① 请求里显式给的（用户手选或手填）
              //   ② 便签上 AI 抽的 due_hint
              //   ③ **原文**——刚存下来时 AI 还没跑，aiDueHint 是空的，
              //      用户却已经想建提醒了。这一条是必须的，不是保险。
              const explicit = body.dueHint !== undefined && String(body.dueHint).trim() !== ''
                ? String(body.dueHint).trim()
                : ''
              const source = explicit !== '' ? explicit : note.aiDueHint !== '' ? note.aiDueHint : note.text
              const resolved = resolveDueAt(detectDueHintFor(source), Date.now())
              if (resolved === null) {
                const shown = explicit !== '' ? explicit : note.aiDueHint
                return sendError(
                  res,
                  400,
                  shown === ''
                    ? '这条便签里没有可识别的时间'
                    : `「${shown}」没有确切时间点，建不了提醒`,
                )
              }

              const title = note.aiTitle || String(note.text || '').split(/\r?\n/)[0].slice(0, 30) || '随手贴提醒'
              let created = null
              try {
                created = await schedule.create({
                  title: `随手贴 · ${title}`,
                  prompt: `提醒：${title}\n\n${note.text}\n\n（来自随手贴 ${note.id}，原定时间：${resolved.label}）`,
                  timing: { kind: 'at', at: resolved.at.toISOString() },
                })
              } catch (error) {
                return sendError(res, 500, `建提醒失败：${error?.message || String(error)}`)
              }

              return sendJson(res, 200, {
                ok: true,
                at: resolved.at.toISOString(),
                label: resolved.label,
                taskId: created && created.id ? String(created.id) : '',
              })
            }

            /*
             * 导出。
             *
             * 纯 Markdown 的优势是「能带走」，但用户不会自己 cp 目录。
             * 这里不做 zip（那是额外依赖），直接返回 JSON + 全部原文，
             * 由客户端拼成单个 .md 文件下载 —— 单文件在任何地方都能打开。
             */
            if (action === '/export' && req.method === 'GET') {
              const notes = store.list({ includeDeleted: params.get('trash') === '1' })
              return sendJson(res, 200, {
                ok: true,
                exportedAt: new Date().toISOString(),
                count: notes.length,
                notes,
              })
            }

            /*
             * 导入。
             *
             * 三种格式都吃：我们的 `/export` 产物、任意 `.md` 文件内容数组、
             * 以及带 frontmatter 的单条。导入**永远新建**（不覆盖同 id），
             * 因为覆盖会丢数据，而合并语义太复杂、容易猜错。
             */
            if (action === '/import' && req.method === 'POST') {
              const body = await readBody(req)
              const incoming = Array.isArray(body.notes)
                ? body.notes
                : typeof body.text === 'string'
                  ? [{ text: body.text }]
                  : []
              if (incoming.length === 0) return sendError(res, 400, '没有可导入的内容')

              const created = []
              const skipped = []
              for (const item of incoming) {
                const text = String(item?.text == null ? '' : item.text).trim()
                if (text === '') {
                  skipped.push({ reason: 'empty' })
                  continue
                }
                try {
                  const note = store.create({
                    text,
                    source: item.source,
                    category: item.category,
                    tags: item.tags,
                    skipAi: body.skipAi === true,
                  })
                  if (queue !== null && note.aiState === 'pending') queue.enqueue(note.id)
                  notify('created', note)
                  created.push(slim(note))
                } catch (error) {
                  skipped.push({ reason: error?.message || String(error) })
                }
              }
              return sendJson(res, 200, { ok: true, created: created.length, skipped: skipped.length, notes: created })
            }

            // 与某条相似的其它便签（T1 重复提示的按需查询）
            if (action === '/similar' && req.method === 'GET') {
              const hits = store.similar(params.get('id') || '')
              return sendJson(res, 200, {
                ok: true,
                hits: hits.map((hit) => ({
                  id: hit.note.id,
                  title: hit.note.aiTitle || firstLine(hit.note.text) || '（无标题）',
                  category: hit.note.category,
                  score: Math.round(hit.score * 100) / 100,
                })),
              })
            }

            // 投递候选：新开对话时一次带一组思路（§4.6）
            if (action === '/candidates' && req.method === 'GET') {
              const hits = store.candidates(params.get('id') || '', {
                limit: Number(params.get('limit')) || 5,
              })
              return sendJson(res, 200, {
                ok: true,
                hits: hits.map((hit) => ({
                  id: hit.note.id,
                  title: hit.note.aiTitle || firstLine(hit.note.text) || '（无标题）',
                  category: hit.note.category,
                  score: Math.round(hit.score * 100) / 100,
                  created: hit.note.created,
                })),
              })
            }

            // 重新整理一条（失败重试 / 用户点「重新整理」）
            if (action === '/retry' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.read(String(body.id || ''))
              if (note === null) return sendError(res, 404, '便签不存在')
              if (queue === null) return sendError(res, 503, 'AI 整理未启用')
              const next = store.update(note.id, {})
              if (next !== null) notify('updated', next)
              queue.enqueue(note.id)
              return sendJson(res, 200, { ok: true })
            }

            // 记一次投递。只记一笔，不改内容 —— 投递本身不该触发 AI 重跑。
            if (action === '/record' && req.method === 'POST') {
              const body = await readBody(req)
              const note = store.recordDelivery(String(body.id || ''), body)
              if (note === null) return sendError(res, 404, '便签不存在')
              notify('updated', note)
              return sendJson(res, 200, { ok: true, note: slim(note) })
            }

            // 把一条便签渲染成投递文本。渲染放 Host 侧，保证各端格式一致。
            if (action === '/render' && req.method === 'GET') {
              const note = store.read(params.get('id') || '')
              if (note === null) return sendError(res, 404, '便签不存在')
              return sendJson(res, 200, { ok: true, text: renderDelivery(note) })
            }

            return sendError(res, 404, `未知端点 ${action}`)
          } catch (error) {
            return sendError(res, 500, error?.message || String(error))
          }
        },
      }),
    )
  } else {
    console.warn('[dsh-note] 没有 webServer，UI 半侧将无法连上')
  }

  // ---- 模型工具：让 agent 自己也能记、能查 ----
  ctx.inject(['tools'], (toolCtx) => {
    for (const definition of createTools(store, notify)) {
      toolCtx.effect(() => toolCtx.tools.register(definition), `dsh-note: tool ${definition.name}`)
    }
  })

  console.log(`[dsh-note] 就绪：${root}（${store.describe().count} 条）`)
}

/** 从一段文字里认出时间线索。`rules.detectDueHint` 的薄包装。 */
function detectDueHintFor(text) {
  const raw = String(text == null ? '' : text).trim()
  if (raw === '') return null
  // 直接复用规则层的实现（它已在本模块外被 import 进来）
  return detectDueHint(raw)
}

// ---------------------------------------------------------------------------
// 序列化：给 UI 的瘦身版（不含全文，列表够用）
// ---------------------------------------------------------------------------

/** 列表用的精简字段。全文只在 `/get` 时取，几百条也不会一次搬一堆字。 */
function slim(note) {
  return {
    id: note.id,
    rev: note.rev,
    created: note.created,
    updated: note.updated,
    source: note.source,
    category: note.category,
    categorySource: note.categorySource,
    tags: note.tags,
    aiState: note.aiState,
    aiTitle: note.aiTitle,
    aiConf: note.aiConf,
    aiModel: note.aiModel,
    aiPromptRev: note.aiPromptRev,
    aiBasedOnRev: note.aiBasedOnRev,
    aiDueHint: note.aiDueHint,
    aiMergeHint: note.aiMergeHint,
    pinned: note.pinned,
    archived: note.archived,
    deleted: note.deleted,
    attachmentCount: note.attachments.length,
    deliveredCount: note.delivered.length,
    preview: String(note.text).replace(/\s+/g, ' ').slice(0, 120),
    broken: note.broken,
  }
}

function maxRevOf(notes) {
  let max = 0
  for (const note of notes) if (note.rev > max) max = note.rev
  return max
}

// ---------------------------------------------------------------------------
// 投递文本（Host 侧统一渲染，各端看到的完全一样）
// ---------------------------------------------------------------------------

/** 短日期：`11-08 09:14`。 */
function shortWhen(iso) {
  const ms = Date.parse(String(iso || ''))
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 一条便签 → 投递给对话的 Markdown。
 *
 * 带短 id 是刻意的：内容进了对话之后，agent 需要细节时能顺着 id 找回原条，
 * 投递因此是双向的，而不是单向倾倒（§4.3）。
 */
export function renderDelivery(note) {
  const title = note.aiTitle || firstLine(note.text) || '（无标题）'
  const when = shortWhen(note.created)
  const lines = []

  lines.push(`> **${title}**　\`随手贴 · ${note.id}${when ? ' · ' + when : ''}\``)
  lines.push('>')
  const body = String(note.text || '').trim()
  if (body !== '') {
    for (const line of body.split(/\r?\n/)) lines.push(`> ${line}`)
  }

  if (note.aiPoints.length > 0) {
    lines.push('')
    lines.push('- 要点：' + note.aiPoints.join('；'))
  }
  if (note.aiTodos.length > 0) {
    lines.push('- 待办：' + note.aiTodos.join('；'))
  }
  return lines.join('\n')
}

function firstLine(text) {
  const line = String(text || '').split(/\r?\n/).find((item) => item.trim() !== '')
  return line === undefined ? '' : line.trim().slice(0, 40)
}

// ---------------------------------------------------------------------------
// 模型工具
// ---------------------------------------------------------------------------

function createTools(store, notify) {
  return [
    {
      name: 'stickynote_capture',
      description: '把一句话记成随手贴（结构化整理可稍后由用户触发，也可由你直接记）。适合用户说「记一下」「帮我记住」的时候。',
      presentCall: (args) => ({
        card: 'generic',
        title: `记一条：${String(args?.text ?? '').slice(0, 40)}`,
        kind: 'edit',
        rawInput: args,
      }),
      parameters: {
        text: { type: 'string', required: true, description: '要记的内容，逐字保留用户原话' },
        category: { type: 'string', description: '指定类别，省略则由整理流程判断' },
      },
      run: ({ text, category }) => {
        const content = String(text == null ? '' : text).trim()
        if (content === '') throw new Error('内容不能为空')
        const note = store.create({ text: content, category })
        notify('created', note)
        return `已记下 [${note.id}]：${oneLineForTool(content)}`
      },
    },
    {
      name: 'stickynote_search',
      description: '在用户的手贴库里搜索。返回 id、标题、摘要与相关度，按相关度倒序。用户问「我之前是不是记过…」时用。',
      presentCall: (args) => ({ card: 'generic', title: `搜索随手贴：${args?.query ?? ''}`, rawInput: args }),
      parameters: {
        query: { type: 'string', required: true, description: '关键词' },
        limit: { type: 'number', description: '最多返回几条，默认 10' },
      },
      run: ({ query, limit }) => {
        const hits = store.search(String(query == null ? '' : query), { limit: Number(limit) || 10 })
        if (hits.length === 0) return `没有找到匹配「${query}」的便签。`
        return hits
          .map((note) => {
            const title = note.aiTitle || firstLine(note.text) || '（无标题）'
            const when = shortWhen(note.created)
            return `- [${note.id}] ${title}（${note.category}${when ? ' · ' + when : ''}）\n  ${oneLineForTool(note.text)}`
          })
          .join('\n')
      },
    },
    {
      name: 'stickynote_get',
      description: '取一条随手贴的完整内容（含 AI 补全与投递记录）。',
      presentCall: (args) => ({ card: 'generic', title: `读取随手贴 ${args?.id ?? ''}`, rawInput: args }),
      parameters: {
        id: { type: 'string', required: true, description: '便签 id' },
      },
      run: ({ id }) => {
        const note = store.read(String(id == null ? '' : id))
        if (note === null) throw new Error(`未找到便签 ${id}（可能已归档或彻底删除）`)
        return renderDelivery(note)
      },
    },
    {
      name: 'stickynote_promote',
      description: '把一条随手贴渲染成可直接投进对话的 Markdown（带 id 出处）。只产出文本，不会替你发消息。',
      presentCall: (args) => ({ card: 'generic', title: `投递随手贴 ${args?.id ?? ''}`, rawInput: args }),
      parameters: {
        id: { type: 'string', required: true, description: '便签 id' },
      },
      run: ({ id }) => {
        const note = store.read(String(id == null ? '' : id))
        if (note === null) throw new Error(`未找到便签 ${id}（可能已归档或彻底删除）`)
        return renderDelivery(note)
      },
    },
    {
      name: 'stickynote_update',
      description:
        '更新一条随手贴的正文或补全区。用户说「把结论存回卡片」「补到那张卡上」时用。只在用户明确要求时写，不擅自改。',
      presentCall: (args) => ({ card: 'generic', title: `更新随手贴 ${args?.id ?? ''}`, kind: 'edit', rawInput: args }),
      parameters: {
        id: { type: 'string', required: true, description: '便签 id' },
        text: { type: 'string', description: '新的原文（要改原文才给这个字段）' },
        appendAi: { type: 'string', description: '追加到 AI 补全区的内容（结论、要点、笔记）' },
        category: { type: 'string', description: '改类别（可选）' },
      },
      run: ({ id, text, appendAi, category }) => {
        const note = store.read(String(id == null ? '' : id))
        if (note === null) throw new Error(`未找到便签 ${id}（可能已归档或彻底删除）`)

        const patch = {}
        if (text !== undefined && String(text).trim() !== '') patch.text = String(text).trim()
        if (category !== undefined && String(category).trim() !== '') patch.category = String(category).trim()

        let updated = store.update(note.id, patch)
        if (updated === null) throw new Error(`更新失败：便签 ${id} 可能已损坏`)

        // 追加到 AI 补全区：只追加、不重写（store.appendAi 直接操作 aiBody）
        if (appendAi !== undefined && String(appendAi).trim() !== '') {
          updated = store.appendAi(note.id, String(appendAi).trim())
          if (updated === null) throw new Error(`追加失败：便签 ${id} 可能已损坏`)
        }

        notify('updated', updated)
        return `已更新 [${note.id}]：${oneLineForTool(updated.text)}`
      },
    },
  ]
}

/** 工具输出里的单行摘要。 */
function oneLineForTool(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}

export const internals = { renderDelivery, slim, createTools }
