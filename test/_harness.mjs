/**
 * 极简测试骨架。
 *
 * 不引入任何测试框架：这个插件的硬约束是「零第三方依赖」，
 * 测试也不该例外。Node 自带的 assert 够用。
 */
import assert from 'node:assert/strict'

const cases = []
let current = ''

/** 开始一个用例组。 */
export function describe(name, fn) {
  current = name
  fn()
  current = ''
}

/** 断言相等。 */
export function eq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label ?? `${current}: 值不符`)
}

/** 断言为真。 */
export function ok(value, label) {
  assert.ok(value, label ?? `${current}: 期望为真，实际 ${JSON.stringify(value)}`)
}

/** 断言为假。 */
export function no(value, label) {
  assert.ok(!value, label ?? `${current}: 期望为假，实际 ${JSON.stringify(value)}`)
}

/** 记录一个用例。 */
export function it(name, fn) {
  cases.push({ group: current, name, fn })
}

/** 跑所有用例，失败时打印并以非零码退出。 */
export async function run() {
  let passed = 0
  const failures = []
  for (const item of cases) {
    try {
      await item.fn()
      passed += 1
    } catch (error) {
      failures.push({ ...item, error })
    }
  }
  const groups = [...new Set(cases.map((c) => c.group))]
  for (const group of groups) {
    const inGroup = cases.filter((c) => c.group === group)
    const bad = failures.filter((f) => f.group === group)
    console.log(`${bad.length === 0 ? '✅' : '❌'} ${group}  (${inGroup.length - bad.length}/${inGroup.length})`)
    for (const f of bad) {
      console.log(`   ✗ ${f.name}`)
      console.log(`     ${String(f.error.message).split('\n')[0]}`)
    }
  }
  console.log(`\n${passed}/${cases.length} 通过`)
  if (failures.length > 0) process.exitCode = 1
}
