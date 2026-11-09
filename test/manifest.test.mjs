// 清单一致性：包名、bundle patch、客户端 bundle id 三处必须同名。
//
// 这条测试是一次真实事故逼出来的（0.1.0 → 0.1.2）：
// package.json 的 name 改成 dsh-note 之后，cordis.patch.yml 里 patch 行的 `name`
// 和 lib/client.js 里 `__ModuleLoader__.load({ id })` 还是旧包名。
// 本地用目录路径装的时候两者恰好同名，跑得好好的；一改成从 npm 装，
// 宿主启动就报 `Cannot find package 'dsh-stickynote'`，整条插件激活失败。
// 所以把「三处同名」钉成断言，改包名时它会立刻喊。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, eq, ok, run } from './_harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

/** 从 cordis.patch.yml 里取 patch 行的 name（就是被 import 的包名）。 */
function patchName(yaml) {
  const m = yaml.match(/^\s*-\s*id:\s*\S+\s*\n\s*name:\s*(\S+)\s*$/m)
  return m ? m[1] : null
}

/** 从客户端 bundle 头部取 `__ModuleLoader__.load({ id })`。 */
function clientBundleId(source) {
  const m = source.match(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

describe('清单 · 包名三处一致', () => {
  const pkg = JSON.parse(read('package.json'))

  it('package.json 有 name 和合法版本', () => {
    eq(typeof pkg.name, 'string')
    ok(pkg.name.length > 0)
    ok(/^\d+\.\d+\.\d+/.test(pkg.version), `版本不像 semver：${pkg.version}`)
  })

  it('cordis.patch.yml 的 patch name 等于包名', () => {
    const name = patchName(read('cordis.patch.yml'))
    ok(name !== null, 'cordis.patch.yml 里找不到 patch 行的 name')
    eq(name, pkg.name)
  })

  it('客户端 bundle id 等于包名', () => {
    const id = clientBundleId(read('lib/client.js'))
    ok(id !== null, 'lib/client.js 里找不到 __ModuleLoader__.load 的 id')
    eq(id, pkg.name)
  })

  it('服务端导出的 name 等于包名', () => {
    const m = read('lib/index.js').match(/export const name = '([^']+)'/)
    ok(m !== null, 'lib/index.js 里找不到 export const name')
    eq(m[1], pkg.name)
  })
})

describe('清单 · dsh 字段', () => {
  const pkg = JSON.parse(read('package.json'))

  it('manifestVersion 为 1', () => {
    eq(pkg.dsh.manifestVersion, 1)
  })

  it('声明了 engines.dsh', () => {
    ok(typeof pkg.dsh.engines.dsh === 'string' && pkg.dsh.engines.dsh.length > 0)
  })

  it('bundle.patch 指向真实存在的文件', () => {
    const p = pkg.dsh.bundle.patch
    ok(p.startsWith('./'), '路径应相对包根')
    ok(read(p.replace('./', '')).length > 0)
  })

  it('客户端平台为 web', () => {
    eq(pkg.dsh.client.platform, 'web')
  })

  it('files 覆盖 lib 与 patch，且不夹带 node_modules', () => {
    const f = pkg.files
    ok(f.some((x) => x.startsWith('lib')), 'files 必须包含 lib')
    ok(f.includes(pkg.dsh.bundle.patch.replace('./', '')), 'files 必须包含 bundle patch')
    ok(!f.some((x) => x.includes('node_modules')), 'files 不该包含 node_modules')
  })
})

await run()
