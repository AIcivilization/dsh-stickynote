/** 存储层：frontmatter 编解码、rev、软删除、归档、搜索、图片、设置。 */
import { mkdtempSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, readSettings, writeSettings, writeImage, readImage, safeMediaName, isAllowedImage } from '../lib/store.js'
import { describe, it, eq, ok, no, run } from './_harness.mjs'

/** 每个用例独立的临时库，避免状态串。 */
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'sn-store-'))
  return { dir, store: createStore(dir) }
}

/** 按 id 找某条便签的磁盘文件。 */
function fileOf(dir, id) {
  return readdirSync(dir).find((f) => f.endsWith(`${id}.md`))
}

describe('存储 · 创建与读取', () => {
  it('创建后有 id、rev=1、原文完整', () => {
    const { store } = fresh()
    const n = store.create({ text: '  登录流程要拆成两步  ' })
    ok(n.id !== '', '有 id')
    eq(n.rev, 1, 'rev 从 1 开始')
    eq(n.text, '登录流程要拆成两步', '原文去掉首尾空白')
    eq(n.aiState, 'pending', '默认待整理')
  })

  it('用户指定类别时落 user 层，AI 不再覆盖', () => {
    const { store } = fresh()
    const n = store.create({ text: 'x', category: '产品' })
    eq(n.categorySource, 'user')
    const after = store.applyAi(n.id, { state: 'done', category: '工作' })
    eq(after.category, '产品', 'AI 不能改用户指定的类')
    eq(after.categorySource, 'user')
  })
})

describe('存储 · 含逗号的句子不被拆开', () => {
  it('points 往返后仍是一条', () => {
    const { store } = fresh()
    const n = store.create({ text: 'a' })
    store.applyAi(n.id, { state: 'done', points: ['两步之间要能回退，而且要能取消'], basedOnRev: 1 })
    const back = store.read(n.id)
    eq(back.aiPoints.length, 1, '没有被逗号拆开')
    eq(back.aiPoints[0], '两步之间要能回退，而且要能取消')
  })

  it('todos 同样保真', () => {
    const { store } = fresh()
    const n = store.create({ text: 'b' })
    store.applyAi(n.id, { state: 'done', todos: ['问一下 X，然后再确认超时'], basedOnRev: 1 })
    eq(store.read(n.id).aiTodos.length, 1)
  })
})

describe('存储 · 损坏降级不丢内容', () => {
  it('frontmatter 坏了仍能读到正文', () => {
    const { dir, store } = fresh()
    const n = store.create({ text: '会被改坏' })
    const file = fileOf(dir, n.id)
    ok(file !== undefined, '找到文件')
    writeFileSync(join(dir, file), '---\n: : : 乱码\n\n这是一段没有正确 frontmatter 的内容')
    const back = store.read(n.id)
    eq(back.broken, true, '标记为损坏')
    ok(back.text.includes('内容'), '正文没丢')
  })
})

describe('存储 · 删除与归档', () => {
  it('软删除只打标记，文件还在', () => {
    const { dir, store } = fresh()
    const n = store.create({ text: '要删的' })
    store.remove(n.id)
    ok(fileOf(dir, n.id) !== undefined, '文件还在，可恢复')
    eq(store.list().length, 0, '默认视图不含它')
    eq(store.list({ onlyDeleted: true }).length, 1, '回收站里有')
  })

  it('归档默认排除、归档视图包含、搜索排除', () => {
    const { store } = fresh()
    const n = store.create({ text: '要归档的独特内容' })
    store.update(n.id, { archived: true })
    eq(store.list().some((x) => x.id === n.id), false, '默认视图排除')
    eq(store.list({ includeArchived: true }).some((x) => x.id === n.id), true, '归档视图包含')
    eq(store.search('独特内容').some((x) => x.id === n.id), false, '搜索排除')
  })

  it('彻底删除连附件一起删', () => {
    const { dir, store } = fresh()
    const n = store.create({ text: '带图的' })
    const name = writeImage(dir, n.id, 0, 'image/png', Buffer.from([1, 2, 3]))
    // 走正确流程：图写回便签的 attachments（等价 /attach 端点）
    store.update(n.id, { attachments: [name] })
    ok(existsSync(join(dir, 'media', name)), '图存在')
    store.remove(n.id)
    ok(existsSync(join(dir, 'media', name)), '软删除不删图')
    store.purge(n.id)
    no(existsSync(join(dir, 'media', name)), '彻底删除删图')
    no(fileOf(dir, n.id) !== undefined, 'md 文件也删了')
  })
})

describe('存储 · 图片安全', () => {
  it('只收四种图片类型', () => {
    ok(isAllowedImage('image/png'))
    ok(isAllowedImage('image/jpeg'))
    no(isAllowedImage('image/svg+xml'))
    no(isAllowedImage('text/plain'))
  })

  it('路径穿越全部拒绝', () => {
    for (const bad of ['../etc/passwd', '../../.ssh/id_rsa', 'media/x.png', 'a/b.png', '.hidden.png', 'x.txt', '']) {
      eq(safeMediaName(bad), null, `应拒绝 ${bad}`)
    }
    eq(safeMediaName('ok.png'), 'ok.png')
  })

  it('二进制往返逐字节一致', () => {
    const { dir } = fresh()
    const bytes = Buffer.alloc(1024)
    for (let i = 0; i < 1024; i += 1) bytes[i] = i % 256
    const name = writeImage(dir, 'img01', 0, 'image/png', bytes)
    eq(Buffer.compare(bytes, readImage(dir, name)), 0, '字节完全一致')
  })
})

describe('存储 · 设置', () => {
  it('默认全开', () => {
    const { dir } = fresh()
    const s = readSettings(dir)
    eq(s.hints.t1Duplicate, true)
    eq(s.confirmBeforeDeliver, true)
  })

  it('改一个开关不影响其他', () => {
    const { dir } = fresh()
    const next = writeSettings(dir, { hints: { t1Duplicate: false } })
    eq(next.hints.t1Duplicate, false)
    eq(next.hints.t3Undelivered, true, '其他开关没被动')
  })

  it('文件损坏时回落默认值，不崩', () => {
    const { dir } = fresh()
    writeFileSync(join(dir, 'settings.json'), '{这不是 JSON')
    eq(readSettings(dir).hints.t1Duplicate, true)
  })
})

await run()
