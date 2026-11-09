/** 客户端纯逻辑：命运映射、图标状态、图片 dataURL、base64、虚拟滚动常量。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, eq, ok, no, run } from './_harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientCode = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** 加载 client.js，返回它的 exports.internals。 */
function loadClient() {
  let loaded = null
  const win = {
    __ModuleLoader__: { load(s) { loaded = s } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    location: { search: '' },
  }
  const doc = {
    querySelector: () => null,
    createElement: () => ({ dataset:{}, style:{}, textContent:'', appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){} }),
    head: { appendChild(){} }, body: { appendChild(){}, removeChild(){} },
  }
  const React = {
    createElement: (t,p,...c)=>({type:t,props:p,children:c}),
    useCallback: f=>f, useState: v=>[v,()=>{}], useEffect: ()=>{},
    useMemo: f=>f(), useRef: v=>({current:v}), useSyncExternalStore: (s,g)=>g(),
  }
  const requireShim = (n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  }
  const args = { win, doc, requireShim, loaded }
  // 用 new Function 执行，注入最小浏览器环境
  const fn = new Function('window', 'require', 'document', clientCode)
  fn(win, requireShim, doc)
  return loaded.factory(requireShim).internals
}

describe('客户端 · 命运映射', () => {
  const { fateOf } = loadClient()
  const mk = (o) => ({ category:'未分类', aiDueHint:'', ...o })

  it('想法/灵感/工作 → 深入', () => {
    eq(fateOf(mk({ category:'想法' })).fate, 'deepen')
    eq(fateOf(mk({ category:'灵感' })).fate, 'deepen')
    eq(fateOf(mk({ category:'工作' })).fate, 'deepen')
  })

  it('待办 → 执行', () => {
    eq(fateOf(mk({ category:'待办' })).fate, 'execute')
  })

  it('参考 → 调用', () => {
    eq(fateOf(mk({ category:'参考' })).fate, 'reference')
  })

  it('生活/未分类 → 展示', () => {
    eq(fateOf(mk({ category:'生活' })).fate, 'show')
    eq(fateOf(mk({ category:'未分类' })).fate, 'show')
  })

  it('有时词 → 执行（优先级最高）', () => {
    eq(fateOf(mk({ category:'生活', aiDueHint:'明天下午' })).fate, 'execute')
  })
})

describe('客户端 · 图标状态', () => {
  const { alertStateOf } = loadClient()
  const base = { deleted:'', archived:false, deliveredCount:0, aiState:'pending', aiDueHint:'' }

  it('空库 idle', () => {
    eq(alertStateOf({ notes:{} }).level, 'idle')
  })

  it('整理中 busy', () => {
    eq(alertStateOf({ notes:{ a:{ ...base } } }).level, 'busy')
  })

  it('整理好未投递 → attention + 计数', () => {
    const r = alertStateOf({ notes:{ a:{ ...base, aiState:'done' }, b:{ ...base, aiState:'done' } } })
    eq(r.level, 'attention')
    eq(r.count, 2)
  })

  it('已投递的不计数', () => {
    const r = alertStateOf({ notes:{ a:{ ...base, aiState:'done', deliveredCount:1 } } })
    eq(r.level, 'idle')
    eq(r.count, 0)
  })

  it('删除/归档的不参与', () => {
    const r = alertStateOf({ notes:{
      a:{ ...base, deleted:'2026-11-09' },
      b:{ ...base, archived:true },
      c:{ ...base, aiState:'done' },
    } })
    eq(r.count, 1, '只有 c 计数')
  })
})

describe('客户端 · 图片工具', () => {
  const { splitDataUrl, mediaUrl, toBase64 } = loadClient()

  it('splitDataUrl 正常', () => {
    const r = splitDataUrl('data:image/png;base64,AAAA')
    eq(r.mediaType, 'image/png')
    eq(r.base64, 'AAAA')
  })

  it('splitDataUrl 拒绝非图片', () => {
    eq(splitDataUrl('data:image/svg+xml;base64,AAAA'), null)
    eq(splitDataUrl('http://x/a.png'), null)
  })

  it('mediaUrl 编码文件名', () => {
    ok(mediaUrl('a b.png').includes('a%20b.png'))
  })

  it('toBase64 往返', () => {
    const b = new Uint8Array([0, 1, 2, 250, 255])
    // 用 Node 的 Buffer 验证 base64 正确性
    const expected = Buffer.from(b).toString('base64')
    eq(toBase64(b), expected)
  })
})

describe('客户端 · 虚拟滚动常量', () => {
  const { CARD_ROW_HEIGHT, VIRTUAL_THRESHOLD } = loadClient()

  it('常量合理', () => {
    ok(CARD_ROW_HEIGHT > 100, '卡片高度足够容纳内容')
    ok(VIRTUAL_THRESHOLD > 50, '少于阈值不虚拟化')
  })
})

await run()
