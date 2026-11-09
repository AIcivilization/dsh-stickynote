/** AI 管线：提示词、JSON 抠取、结果清洗、队列。 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { buildPrompt, extractJson, normalizeResult, createQueue, PROMPT_REV } from '../lib/ai.js'
import { describe, it, eq, ok, no, run } from './_harness.mjs'

describe('AI · JSON 抠取', () => {
  it('裸 JSON', () => {
    eq(extractJson('{"title":"a"}').title, 'a')
  })
  it('带 markdown 围栏', () => {
    eq(extractJson('```json\n{"title":"b"}\n```').title, 'b')
  })
  it('带前言后语', () => {
    eq(extractJson('前置说明\n{"title":"c"}\n后缀').title, 'c')
  })
  it('完全不是 JSON 返回 null', () => {
    eq(extractJson('完全不是 JSON'), null)
    eq(extractJson(''), null)
  })
})

describe('AI · 结果清洗', () => {
  it('正常结果', () => {
    const r = normalizeResult({ title:'登录流程拆两步', category:'工作', points:['能回退'], confidence:0.86 }, { rev:3 })
    eq(r.state, 'done')
    eq(r.category, '工作')
    eq(r.points.length, 1)
  })

  it('类别越界落未分类', () => {
    const r = normalizeResult({ title:'x', category:'不存在的类' }, { rev:1 })
    eq(r.category, '未分类')
    eq(r.failReason, 'category_out_of_set')
  })

  it('脏数据清洗', () => {
    const r = normalizeResult({ title:123, tags:'notarray', points:['a','',null,'b'], confidence:'abc' }, { rev:1 })
    eq(r.title, '123')
    eq(r.tags.length, 0)
    eq(r.points.length, 2)
    eq(r.confidence, 0)
  })

  it('解析失败返回 failed', () => {
    const r = normalizeResult(null, { rev:2 })
    eq(r.state, 'failed')
    eq(r.failReason, 'unparseable')
  })
})

describe('AI · 队列', () => {
  const mkLlm = (behavior) => ({
    stream(request) {
      return (async function* () {
        const out = behavior(request)
        if (out === null) { yield { type:'finish', reason:{ kind:'error', failure:{ message:'boom' } } }; return }
        yield { type:'text-delta', text: out }
        yield { type:'finish', reason:{ kind:'stop' } }
      })()
    }
  })

  it('正常整理，原文不动', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    const store = createStore(dir)
    const q = createQueue({
      store,
      llm: mkLlm(() => '{"title":"登录拆两步","category":"工作","points":["能回退"],"confidence":0.9}'),
      pickModel: () => ({ provider:'p', model:'m' }),
    })
    const n = store.create({ text: '登录流程要拆成两步' })
    q.enqueue(n.id)
    await q.whenIdle()
    const back = store.read(n.id)
    eq(back.aiState, 'done')
    eq(back.text, '登录流程要拆成两步', '原文不动')
    eq(back.aiTitle, '登录拆两步')
  })

  it('解析失败三次后 failed，原文完好', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    const store = createStore(dir)
    const q = createQueue({
      store,
      llm: mkLlm(() => '这不是 JSON'),
      pickModel: () => ({ provider:'p', model:'m' }),
    })
    const n = store.create({ text: '第二条' })
    q.enqueue(n.id)
    await q.whenIdle()
    eq(store.read(n.id).aiState, 'failed')
    eq(store.read(n.id).text, '第二条', '原文完好')
  })

  it('无模型 → skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    const store = createStore(dir)
    const q = createQueue({ store, llm: mkLlm(() => '{}'), pickModel: () => null })
    const n = store.create({ text: '第三条' })
    q.enqueue(n.id)
    await q.whenIdle()
    eq(store.read(n.id).aiState, 'skipped')
  })

  it('llm 缺席 → createQueue 返回 null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    eq(createQueue({ store: createStore(dir), llm: undefined }), null)
  })

  it('同一条连点三次只跑一次', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    const store = createStore(dir)
    let calls = 0
    const q = createQueue({
      store,
      llm: mkLlm(() => { calls += 1; return '{"title":"t","category":"工作"}' }),
      pickModel: () => ({ provider:'p', model:'m' }),
    })
    const n = store.create({ text: '第五条' })
    q.enqueue(n.id); q.enqueue(n.id); q.enqueue(n.id)
    await q.whenIdle()
    eq(calls, 1, '只调用一次')
  })

  it('规则层归类比模型优先级高', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sn-ai-'))
    const store = createStore(dir)
    const q = createQueue({
      store,
      llm: mkLlm(() => '{"title":"t","category":"想法","points":[],"confidence":0.7}'),
      pickModel: () => ({ provider:'p', model:'m' }),
    })
    const n = store.create({ text: '记得明天交报告' })  // 规则层会归「待办」
    q.enqueue(n.id)
    await q.whenIdle()
    eq(store.read(n.id).category, '待办', '规则层压过模型')
    eq(store.read(n.id).categorySource, 'rule')
  })
})

describe('AI · 提示词', () => {
  it('含类别与邻居', () => {
    const p = buildPrompt(['工作','想法'], [{id:'a3f1', title:'登录流程'}])
    ok(p.includes('工作、想法'), '含类别')
    ok(p.includes('[a3f1]'), '含邻居')
    ok(p.includes('填空比编造更糟糕'), '含防幻觉条款')
  })
})

await run()
