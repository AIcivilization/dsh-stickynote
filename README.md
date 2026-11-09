# dsh-stickynote · 随手贴

[![ci](https://github.com/AIcivilization/dsh-stickynote/actions/workflows/ci.yml/badge.svg)](https://github.com/AIcivilization/dsh-stickynote/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![dsh](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.5-4B6EF5)](#安装)
[![tests](https://img.shields.io/badge/tests-68%20passing-brightgreen)](#开发)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](#依赖)

> 灵感的入口：想到什么记下来，随时能扩展成一个成品。

DeepSeek Harness 插件。侧栏单击打开主界面，顶部按钮 / `Alt+Space` 新建。保存后 AI 异步整理成标题、
归类、补全要点、抽出待办；每条带 `+AI` 角标；一键投递到当前对话或新开对话。

**它是分流的入口，不是又一本笔记。** 记下来只是第一步 —— AI 把每条卡分到「展示 / 深入 / 执行 / 参考」
四条路之一，该收着的收着，该展开成成品的当场就能进对话。卡片命运由分类决定，不靠用户自己维护文件夹。

设计文档见 [DESIGN.md](./DESIGN.md)（含用户原话存档与全部技术决策依据）。

## 为什么叫这个

命名按「用户搜索怎么最容易搜出来」定，不按好看定。`stickynote` 是主词，`便签 / 笔记 / 即时贴 / 速记 / 备忘 / 灵感`
全部落在 `keywords` 与 `description` 里，中文搜、英文搜、搜产品名、搜品类，都能命中同一个包。

## 现在能做什么

- 侧栏按键 / 对话顶部按钮（悬浮球在 M4）
- 捕获浮层：`Alt+Space` 打开，`⌘↵` 保存，`Esc` 取消
- **语音录入**：捕获浮层里一个按钮，说完转成文字落进输入框，可继续改
  （识别用宿主的 `speechController`；采集自带 —— 宿主的 `Recording` 是私有类，不对外导出）
- 异步 AI 整理：起标题、三层归类（规则 → 模型 → 用户）、补要点、抽待办、认时间线索
- `+AI` 角标：只有真跑过 AI 的才有；原文改动过会标「旧」
- 三区面板：软分类树 / 卡片流 / 详情
- 搜索（原文 + 标题 + 标签 + 类别）
- 回收站（软删除，无 TTL，可恢复）
- 归档（收起来但还在；默认视图排除，归档视图查看，可一键取消归档）
- 批量多选：勾选/全选，批量归档、取消归档、移入回收站，一条失败不影响其余
- 虚拟滚动：超过 120 条只渲染可视窗口，5000 条也不卡
- T1 重复提示：保存时发现相似条目会提示，**只提示不自动合并**
- 投递候选：新开对话前列出相关思路，多选一起带走
- **开新对话并发送**：真的开一个新会话，把内容作为第一条消息发进去（不是留草稿）
- 投递前先看草稿：**有空草稿直放 / 发送中拒绝 / 已在框内跳过 / 有草稿弹三选一**（默认「追加」）
- 导出全部为单个 `.md` 文件
- **卡片命运**：分类决定主按钮 —— 想法/工作「聊这张」、待办「设个提醒」、参考「找相关」、生活「看看」
- **对话主题条**：点「聊这张」开新对话并绑这张卡为主题，输入框上方显示「正在围绕这张卡聊」，可关闭
- **回写闭环**：聊完说「把结论存回卡片」，agent 调 `stickynote_update` 把结论追加进卡片（只追加不覆盖）
- **设个提醒**：认出「明天下午」「下周三」「月底前」这类时间，一键交给 `schedule`
- **设置页**：看状态（数据目录、条数、AI 开关、队列）、开关四类提示、增删类别
- **图片**：捕获浮层里直接粘贴截图或拖进来，图片存本地 `media/`，卡片与详情显示缩略图
- **导入**：设置页「导入」，收 `.md` / `.txt`，永远新建不覆盖
- 4 个模型工具：`stickynote_capture` / `_search` / `_get` / `_promote`
- 多标签同步（SSE + 轮询兜底）

## 数据在哪

```
~/.dsh/stickynote/
├── 2026-11-08T09-14-22-a3f1.md    # 一条一文件，创建后永不改名
├── 2026-11-08T11-02-07-9c4e.md
└── media/
```

纯 Markdown + frontmatter，可 git、可 grep、可外挂 Obsidian。
**卸载插件数据不丢**，只是没有界面。

## 安装

```bash
dsh plugin --profile web add /path/to/dsh-stickynote
```

然后在 profile 的 `package.json` 里把 `dsh-stickynote` 加进 `dsh.profile.bundles`。

## 依赖

`webServer` 是硬依赖。其余全部可选，缺了只降级不崩：

| 服务 | 缺了会怎样 |
|---|---|
| `llm` | 便签永远素贴，没有 `+AI` |
| `speechController` | 只能打字（语音在 M4） |
| `agents` | 投递新会话降级为复制到剪贴板 |
| `schedule` | 不显示「设个提醒」 |
| `slots` | UI 半侧不注册，Host 侧照常 |

**AI 整理跟随对话当前模型**，插件不单独配置、不写死。

## 已知边界

- 「开新对话」走 Host 的 `sessionController.create()`，因为客户端拿不到 `startSession`；
  建好后用会话作用域的输入门面 `sessions.scope(id) → conversation.input.for(actx)` 把内容发进去
- 语音**识别**需要宿主装了 `voice-input-bundle`，且 provider 的 `preparation.phase === 'ready'`；否则按钮会显示「准备语音」就地下载
- 语音**采集**是本插件自带的（`getUserMedia` → `MediaRecorder` → 16k 重采样 → PCM16 WAV），不依赖宿主导出采集类
- 转写是**一次性返回**（`transcribe` 是 Promise 不是流），所以 UI 只说「识别中…」，不做边听边出字
- 提醒只负责「建」，不负责「送」—— 到点由 `schedule` 开会话，推送交给 `dsh-notify-me` 这类插件
- 「有空」「改天」这类没有确定时间的词**故意不解析** —— 猜错时间比不提醒更糟
- 图片**只存不读** —— 默认不发给模型（隐私优先）；要让 AI 看图需要接 `attachment` 服务
- 悬浮球、第二/三梯队提示都还没做

## 开发

```bash
git clone https://github.com/AIcivilization/dsh-stickynote.git
cd dsh-stickynote
npm run check     # 6 个模块逐个 node --check
npm test          # 68 条，全绿才算数
```

零依赖是硬约束：没有 `npm install` 这一步，测试只用 `node:assert`。
加依赖就等于把这个插件从「装上就能用」变成「装之前先修依赖」。

### 目录

```
lib/
├── index.js    │ Host 侧：23 个 HTTP 端点、5 个模型工具、SSE、投递渲染
├── client.js   │ 客户端：5 个 slot、三区面板、虚拟滚动、捕获浮层、语音
├── store.js    │ 单一 Markdown 落盘、frontmatter 编解码、搜索、软删、图片
├── rules.js    │ 无模型也能分类：领域词、关键词、CJK 2-gram 相似度
└── voice.js    │ 语音：探测宿主能力、自采集（16k 单声道 PCM16 WAV）
test/           │ 68 条，node:test 都不用，自带极简 harness
```

`DESIGN.md` 是决策依据，不是营销文档 —— 里面存了每一轮的用户原话，
以及被推翻的方案和推翻它的原因。改行为之前先看它。

## 贡献

开 issue 说清楚「你想记什么、现在卡在哪」，比提 PR 有用。
界面相关的改动请顺手截图，因为这东西的验收标准就是「一眼看懂」。

## License

[MIT](./LICENSE)
