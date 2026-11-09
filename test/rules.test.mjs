/** 规则层：归类、分词、相似度、时间解析。 */
import { classifyByRule, tokenize, jaccard, bodyScore, similarity, findSimilar, detectDueHint, resolveDueAt } from '../lib/rules.js'
import { describe, it, eq, ok, no, run } from './_harness.mjs'

describe('规则层 · 归类', () => {
  it('域名指纹', () => {
    eq(classifyByRule('https://github.com/foo/bar 这个库不错').category, '参考')
    eq(classifyByRule('在 twitter.com 上看到的').category, '想法')
  })

  it('关键词表', () => {
    eq(classifyByRule('记得明天交报告').category, '待办')
    eq(classifyByRule('接口要重构，先排查 bug').category, '工作')
    eq(classifyByRule('周末去买菜').category, '生活')
    eq(classifyByRule('拍了一张照片写两句心情').category, '生活')
  })

  it('判不出时返回 null，交给模型', () => {
    eq(classifyByRule('随便一句话没有特征'), null)
  })
})

describe('规则层 · 相似度', () => {
  it('省略式改写仍判为相似', () => {
    const a = tokenize('登录流程要拆成两步，先把验证码那步拆出来')
    const b = tokenize('登录流程拆两步，验证码先拆出来')
    ok(bodyScore(a, b) > 0.6, '正文相似度应大于 0.6')
  })

  it('无关内容判为不相似', () => {
    const a = tokenize('登录流程要拆成两步')
    const b = tokenize('周末去买菜顺便取快递')
    ok(similarity({ id:'a', text:'登录流程要拆成两步', tags:[], category:'未分类', created:'2026-11-09' },
                   { id:'b', text:'周末去买菜顺便取快递', tags:[], category:'未分类', created:'2026-11-09' }) < 0.2)
  })

  it('自己和自己不算相似', () => {
    const n = { id:'x', text:'abc', tags:[], category:'未分类', created:'2026-11-09' }
    eq(similarity(n, n), 0)
  })
})

describe('规则层 · 时间解析', () => {
  const NOW = new Date(2026, 10, 9, 14, 30).getTime()
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`

  it('明天下午 → 明天 15:00', () => {
    const r = resolveDueAt(detectDueHint('明天下午交报告'), NOW)
    eq(fmt(r.at), '2026-11-10 15:00')
  })

  it('下周三 → 下周', () => {
    const r = resolveDueAt(detectDueHint('下周三之前搞定'), NOW)
    eq(fmt(r.at), '2026-11-18 09:00')
  })

  it('月底 → 本月最后一天', () => {
    const r = resolveDueAt(detectDueHint('月底前要上线'), NOW)
    eq(fmt(r.at), '2026-11-30 09:00')
  })

  it('模糊时间词不建提醒', () => {
    eq(resolveDueAt(detectDueHint('有空的时候看看'), NOW), null)
    eq(resolveDueAt(detectDueHint('尽快'), NOW), null)
  })

  it('今天上午在 11 点说 → 顺延明天', () => {
    const r = resolveDueAt(detectDueHint('今天上午'), new Date(2026,10,9,11,0).getTime())
    eq(fmt(r.at), '2026-11-10 08:00')
  })
})

await run()
