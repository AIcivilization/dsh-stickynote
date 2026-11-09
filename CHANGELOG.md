# Changelog

## 0.1.3（2026-11-09）

只加测试，不动行为：把「包名三处必须同名」钉成 9 条断言（`test/manifest.test.mjs`）。
发这一版是为了让 npm 上的产物和仓库 HEAD 完全一致 —— 0.1.2 的 tarball 里还是旧测试集。

总测试数 68 → **77**。

## 0.1.2（2026-11-09）

**修一个真 bug：改包名后插件装了但激活不了。**

```
stickynote (dsh-stickynote): failed to import:
  Cannot find package 'dsh-stickynote' imported from …/profiles/web/
```

包名从 `dsh-stickynote` 改成 `dsh-note` 时，漏了另外两处**也必须是包名**的地方：

| 位置 | 作用 | 漏了会怎样 |
|---|---|---|
| `cordis.patch.yml` 的 `name` | 宿主按它 import 这个包 | 找不到包，整条插件激活失败 |
| `lib/client.js` 的 `__ModuleLoader__.load({ id })` | 前端 bundle 的注册 id | 界面那半边挂不上 |

为什么本地一直没发现：之前用 `/path/to/dsh-stickynote` 目录装，包名和 patch 名**恰好相同**，
这个耦合被掩盖了；一改成从 npm 装（包名 `dsh-note`）就立刻炸。同时把服务端
`export const name`、API 前缀、日志标签一并统一到 `dsh-note`。

**数据目录没动**：仍然是 `$DSH_HOME/stickynote/`，改包名不该让用户的数据搬家。

收尾：`test/manifest.test.mjs` 就是为这个事故写的，改包名时它会当场喊。

## 0.1.1（2026-11-09）

npm 首发。代码与 0.1.0 完全一致，只是版本号必须往前挪一位：

`0.1.0` 用 `npm publish` 推的时候被 registry 收进了**暂存发布区**（staged publishing）——
因为带 Bypass 2FA 的 granular token 被判定为「没有 proof-of-presence」，npm 就把发布改成
「先暂存、等维护者用 2FA 批准」。本机 npm 10.9.9 不认识这套协议，所以既没法拿到 stage-id
去批准，`stage list` 也枚举不到那条记录，`0.1.0` 这个版本号就此被占死。

绕过方式：带一次性验证码发布（等于当场提供 proof-of-presence），不再进暂存区。
教训记在这：**发布环境的 npm 版本要跟着 registry 协议走**，CLI 太老会把版本号白白搭进去。

## 0.1.0（2026-11-09）

首版：AI 驱动的灵感入口。想到什么记下来，AI 分类分流，深的能聊成成品，结论能长回卡片。

### 已实现

**核心链路**
- 捕获：文字 / 语音（识别用宿主 speechController，采集自带），保存 0 延迟，AI 异步整理不挡路
- 三层归类：规则层（域名 + 关键词，零 token）→ 模型层 → 用户层（手改永久生效）
- AI 整理：起标题、归类、补要点、抽待办、认时间线索，`+AI` 角标，原文永不改写
- 投递：加到当前对话（草稿三选一保护）、开新对话（真的发出去，不是留草稿）
- 对话主题条：点「聊这张」绑卡片为主题，输入框上方显示「正在围绕这张卡聊」
- 回写闭环：聊完说「把结论存回卡片」，agent 调 `stickynote_update` 追加（只追加不覆盖）

**卡片命运**（分类决定主按钮）
- 想法 / 工作 → 💬 聊这张（深入聊成成品）
- 待办 → ⏰ 设个提醒
- 参考 → 🔗 找相关
- 生活 / 未分类 → 👁 看看（展示）

### 发布

- npm: `dsh plugin --profile web add dsh-note` 直接装
  （包名用 `dsh-note` 而非 `dsh-stickynote`：后者与生态里已有的 `dsh-sticky-note` 归一化同形，被 npm 相似名规则挡下）
- GitHub: https://github.com/AIcivilization/dsh-stickynote
- CI 跑 node 20 / 22 / 24：68 条测试 + 6 个模块语法检查 + 清单校验
- 零运行时依赖（Host 侧只用 `node:*` 内建，客户端只 `require('react')`，由宿主提供）

**基础设施**
- 扁平 Markdown 存储，一条一文件，创建后永不改名
- 软删除 + 回收站 + 归档 + 批量操作
- 搜索、相似度、多标签同步（SSE + 轮询）
- 图片附件（只存不读，默认不发模型）
- 导出 / 导入
- 设置页（状态、提示开关、类别管理）
- 虚拟滚动（>120 条）
- 5 个模型工具：capture / search / get / promote / update

### 修复过的真 bug（开发期）

1. 含逗号的句子被静默拆成两条 —— `points`/`todos` 改用 JSON 编码
2. 队列去重失效 —— 处理期间不放开去重位
3. 落盘可能产生孤儿文件 —— 复用索引里的原名
4. 相似度结构性漏报 —— 按「可比信号之和」归一化，而非固定分母
5. `store.set` 函数式分支不合并 —— 一次 refresh 抹掉全部 UI 状态
6. `writeFileAtomic` 硬塞 `'utf8'` 损坏二进制图片 —— 按内容类型选编码
7. 新会话投递曾判定「做不到」 —— 根因是拿输入框的位置错了（`input.for(actx)` 在会话作用域）
8. 归档语义缺失 —— `list()` 没排除 `archived`，归档后仍出现在默认视图
9. 域名规则太严 —— 「在 twitter 上看到」这种口语漏归类；长域名改裸匹配
10. 孤儿图 —— purge 只删 md 不删 media 里的图，加文件名前缀兜底

### 已知边界

- 让 AI 读图未做（需 attachment 服务签发 ImageAttachmentRef）
- 自动回写未做（当前靠用户说「存回卡片」）
- 悬浮球未做（用户决定先不做）
- T5–T12 提示未做（T5 实时版刻意推迟：相似度算法未经真实数据验证，做不准是负价值）
