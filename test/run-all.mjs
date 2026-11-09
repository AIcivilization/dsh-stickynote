/** 跑所有测试文件。用法：node test/run-all.mjs */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const files = ['store.test.mjs', 'rules.test.mjs', 'ai.test.mjs', 'http.test.mjs', 'client.test.mjs']

let failed = 0
for (const f of files) {
  console.log(`\n━━ ${f} ━━`)
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed += 1
}
console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 个文件失败`}`)
process.exit(failed === 0 ? 0 : 1)
