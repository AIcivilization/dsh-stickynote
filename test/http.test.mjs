/** Host HTTP 端点：捕获、列表、搜索、渲染、删除、导入导出、图片、提醒、建会话。 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply } from '../lib/index.js'
import { describe, it, eq, ok, no, run } from './_harness.mjs'

/** 起一个带 Host 插件的 HTTP 服务，返回请求 helper。 */
async function boot(dshHome, extraServices = {}) {
  process.env.DSH_HOME = dshHome
  const routes = []
  const ctx = {
    webServer: { register(r) { routes.push(r); return () => {} } },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: (names, cb) => {
      if (names.includes('tools')) cb({ tools: { register() { return () => {} } }, effect: (f) => f() })
      if (names.includes('llm')) cb({ llm: { stream: () => (async function* () {})() } })
    },
    get: (name) => extraServices[name],
    logger: { log(){}, warn(){}, error(){}, info(){} },
  }
  apply(ctx, {})
  const server = createServer((q, s) => routes[0].handler(q, s))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const host = `127.0.0.1:${port}`
  const base = `http://127.0.0.1:${port}/api/dsh-note`
  const post = async (p, b) => {
    const r = await fetch(base + p, { method:'POST', headers:{ 'Content-Type':'application/json', host }, body: JSON.stringify(b) })
    return { s: r.status, j: await r.json() }
  }
  const get = async (p) => {
    const r = await fetch(base + p, { headers:{ host } })
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('image')) return { s: r.status, j: Buffer.from(await r.arrayBuffer()), ct }
    return { s: r.status, j: await r.json() }
  }
  return { server, post, get }
}

describe('HTTP · 基本流程', () => {
  it('捕获 → 列表 → 获取 → 渲染', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post, get } = await boot(dshHome)
    const c = await post('/capture', { text: '登录流程拆两步' })
    eq(c.s, 200)
    ok(c.j.note.id !== '')
    eq((await get('/list')).j.notes.length, 1)
    eq((await get('/get?id=' + c.j.note.id)).j.note.text, '登录流程拆两步')
    const r = (await get('/render?id=' + c.j.note.id)).j.text
    ok(r.includes('登录流程拆两步'), '渲染含原文')
    ok(r.includes(c.j.note.id), '渲染含 id 出处')
    server.close()
  })

  it('空内容 400', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post } = await boot(dshHome)
    eq((await post('/capture', { text: '  ' })).s, 400)
    server.close()
  })

  it('跨站 Origin 403', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server } = await boot(dshHome)
    const port = server.address().port
    const r = await fetch(`http://127.0.0.1:${port}/api/dsh-note/capture`, {
      method:'POST', headers:{ 'Content-Type':'application/json', host:`127.0.0.1:${port}`, origin:'http://evil.example' }, body:'{"text":"x"}'
    })
    eq(r.status, 403)
    server.close()
  })

  it('未知端点 404', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, get } = await boot(dshHome)
    eq((await get('/nope')).s, 404)
    server.close()
  })
})

describe('HTTP · 图片', () => {
  it('上传真 PNG 并逐字节读回', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post, get } = await boot(dshHome)
    const c = await post('/capture', { text: '截图' })
    const bytes = Buffer.alloc(2048)
    for (let i = 0; i < 2048; i += 1) bytes[i] = i % 256
    const r1 = await post('/attach', { noteId: c.j.note.id, mediaType:'image/png', data: bytes.toString('base64') })
    eq(r1.s, 200)
    const r2 = await get('/media?name=' + r1.j.name)
    eq(r2.s, 200)
    eq(Buffer.compare(bytes, r2.j), 0, '字节一致')
    eq(r2.ct, 'image/png')
    server.close()
  })

  it('路径穿越全拒绝', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, get } = await boot(dshHome)
    for (const bad of ['../etc/passwd', '.env', 'x.txt']) {
      eq((await get('/media?name=' + encodeURIComponent(bad))).s, 400)
    }
    server.close()
  })

  it('svg 拒绝', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post } = await boot(dshHome)
    const c = await post('/capture', { text: 'x' })
    const r = await post('/attach', { noteId: c.j.note.id, mediaType:'image/svg+xml', data:'PHN2Zy8+' })
    eq(r.s, 400)
    server.close()
  })
})

describe('HTTP · 导入导出', () => {
  it('导出所有字段齐全', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post, get } = await boot(dshHome)
    await post('/capture', { text: '第一条' })
    await post('/capture', { text: '第二条' })
    const r = await get('/export')
    eq(r.j.count, 2)
    ok(['id','text','created','aiState'].every((k) => k in r.j.notes[0]))
    server.close()
  })

  it('导入永远新建不覆盖', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post, get } = await boot(dshHome)
    await post('/capture', { text: '原有' })
    const backup = await get('/export')
    const r = await post('/import', { notes: backup.j.notes })
    eq(r.j.created, 1)
    eq((await get('/list')).j.notes.length, 2, '原有 + 导入')
    server.close()
  })
})

describe('HTTP · 提醒与建会话', () => {
  it('建会话（sessionController 存在）', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post } = await boot(dshHome, {
      sessionController: { create: async () => ({ sessionId: 'session-new', agentPreset: 'standard' }) },
    })
    const r = await post('/session', {})
    eq(r.s, 200)
    eq(r.j.sessionId, 'session-new')
    server.close()
  })

  it('建会话（controller 缺席）503', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post } = await boot(dshHome, {})
    eq((await post('/session', {})).s, 503)
    server.close()
  })

  it('提醒：有 schedule 时建成功', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const created = []
    const { server, post } = await boot(dshHome, {
      schedule: { create: async (r) => { created.push(r); return { id: 'task-1' } } },
    })
    const c = await post('/capture', { text: '明天下午交报告' })
    const r = await post('/remind', { id: c.j.note.id })
    eq(r.s, 200)
    eq(r.j.label, '明天下午')
    eq(created.length, 1)
    server.close()
  })

  it('提醒：无时间 400', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'sn-http-'))
    const { server, post } = await boot(dshHome, { schedule: { create: async () => ({ id: 'x' }) } })
    const c = await post('/capture', { text: '随便想想' })
    eq((await post('/remind', { id: c.j.note.id })).s, 400)
    server.close()
  })
})

await run()
