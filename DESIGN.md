# dsh-stickynote · 设计文档 v3

> 中文名：**随手贴**
> 包名：`dsh-stickynote`
> 文档版本：**v3**（2026-11-08）

---

# 第一部分 · 需求来源（用户原话）

> 以下为项目全程用户原话，逐字保留（含笔误、语音输入错误、断句）。这是本设计的第一手依据：后面的所有判断都可以回到这里核对，也可以用来判断哪些是我的推断、哪些是用户的明确要求。

## 第 1 轮 · 初始需求

> 我想做一个由dsh的ai驱动的，即时贴，的dsh插件，功能主要是窗口或桌面有个按键，点击后语音和文字录入，然后存为即时贴，保存后ai自动整理、归类，还能补充完善。这个即时贴有+ai标识，看完加到dsh新开对话，也可加到当前对话。1、帮我看看有没有类似产品，2、气什么名字较好？dsh-tips？还是别的什么，帮我看看npm的占用

**提炼出的硬需求**：① 由 DSH 的 AI 驱动；② 窗口或桌面有按键；③ 语音 + 文字录入；④ 存为即时贴；⑤ 保存后 AI 自动整理、归类、补充完善；⑥ 有 `+AI` 标识；⑦ 可加到新开对话，也可加到当前对话。

## 第 2 轮 · 命名与存档界面

> 1.关于命名，虽然碎屑挺好，但主要要考虑用户搜索怎么最容易搜出来，用户找此类产品会搜什么，2.要有个存档便利贴的地方，展示的界面，做成传统的文件浏览器还是什么，也要考虑

**提炼**：命名要以**用户搜索行为**为第一标准（不是好听）；存档界面要慎重选择形态（文件浏览器是候选之一，不是默认）。

## 第 3 轮 · 出设计文档

> 出一个设计文档

## 第 4 轮 · 回头看缺口

> 很好，再回头看，我们的设计，和自由设计的比较，我们还需要有哪些必要功能

**提炼**：对照"完整自由设计"找必要功能缺口，不是对照竞品。

## 第 5 轮 · 出 v2

> 出v2

## 第 6 轮 · 竞品比较

> 我们目前设计要实现的功能，和目前竟品做个比较

## 第 7 轮 · 提出"用别人的底座"这个假设

> 再聊一轮，如果我们在denotes using中，加入语音和导出新会话呢

（"denotes using" 应为 "dsh-notes 使用中" 的语音输入误识别；指 `dsh-notes-plugin`）

**提炼**：试探性地问"能不能在成熟竞品上加我们要的两块"。这是**提问**，不是决定。

## 第 8 轮 · 留接口的想法

> 那就差异化，我们产品可以给notes-plugin留接口，也给别的插件比如记忆，数据库等留接口。我们产品，首先是第一入口

**提炼**：差异化 + 留接口 + **第一入口**这个定位。

## 第 9 轮 · 纠正我的过度解读 ⚠️

> 你理解错我的意思了，接口接别的插件，是我们可以，但不是必须，是有这个能力就行，你上面理解有点极端，我们仍旧是做ai驱动的便利贴。还能整理，提示，归类。能加到对话中或者新开对话。这才是我们的产品，然后，可以配合记忆插件等插件丰富我们的产品功能。

**这是全程最重要的一次纠正。** 三条：
1. 接口是**能力**，不是**必须**——"有这个能力就行"
2. 产品本体仍是 **AI 驱动的便利贴**：整理、**提示**、归类、加到对话/新开对话
3. 别的插件是**用来丰富我们的功能**，不是我们去当管道

## 第 10 轮 · 架构层面的关键洞察 ⚠️⚠️

> 其实，接到对话中，就等于接到记忆插件中了，我们要围绕 H这个产品的结构来我们的我们只是一个插件，是依托于DSH的，不能脱离谈论我们产品，同样要用AI也是依托DS h，当然，H的全部插件也都能为我所用。我们其他的插件提供一个入口，我们的插件是一个灵感的实现，也是修改一个问题的过程中的一个思路，继续。

**这是全程最重要的技术判断。** 四条：
1. **"接到对话中，就等于接到记忆插件中了"** —— 记忆插件的输入源就是会话回合，投递即接入，不需要对接代码
2. 我们只是一个插件，**依托 DSH**，不能脱离 DSH 谈论产品
3. AI 也依托 DSH（用 `ctx.llm`，不自带模型）
4. 产品本质：**灵感的实现**，**修改一个问题过程中的一个思路**

## 第 11 轮 · 本文档的要求

> 可以形成V3文档，但你要把我的原话。 这几轮对话中的原话。 放到。 最前面。 写一个来源。 这样的话。 能？ 更。 清晰的。 知道。 我想什么？

## 第 12 轮 · 提示要穷举再排序 ⚠️

> 第五你说到的三类提示，可以综合判断对一个来说，哪些是常规的提示，对于我们除了这三还需要我们开始可以考虑的丰富一些，然后逐渐把最必要的最上面

**提炼**：不要一开始就把提示锁死在三类。先穷举，再按必要程度排序，最必要的放最上面。

## 第 13 轮 · 提示的通道与入口形态 ⚠️⚠️

> 提示的方式其实是有多种的，其中一个是交给通信软件，比如微信书小飞机等等，另一个直接我们这个产品的上显示不同的颜色或者是闪烁，我们这个入口一定是有一个按键按键就可以新建一个，或者说是打开浏览所有的便利贴的卡片或者是新建便利贴的DS的桌面上比如说这个位置是在对话框的顶部或者就是左侧栏，如有提醒这个左侧栏的按键或者是顶部的按键就会闪烁按键闪烁，而是一个图标在闪烁，把这些写进V3吧

**这是对提示与入口的一次完整定义。** 四条：

1. **提示有两种通道**：① 交给通信软件（微信 / 小飞机 = Telegram 等）；② 在本产品上以**颜色或闪烁**呈现
2. **入口一定是一个按键**，按键有两种行为：**新建** 或 **打开浏览全部卡片**
3. **按键位置**：对话框顶部 **或** 左侧栏（两处都要有）
4. **闪烁的主体是图标本身**——"而是一个图标在闪烁"，不是整个按钮

（"微信书小飞机"应为"微信、小飞机"的语音误输入；"DS的桌面上"指 DSH 界面内）

---

# 第二部分 · 从原话到设计

## 0. 产品是什么（由原话直接推出）

把第 1、9、10、12、13 轮的原话放在一起，产品的定义是闭合的：

| 原话 | 推出 |
|---|---|
| "由dsh的ai驱动的" + "要用AI也是依托DS h" | AI 用 `ctx.llm`，不自带模型、不自带 key |
| "窗口或桌面有个按键，点击后语音和文字录入" | 入口是**按一下就录**，不是打开面板再操作 |
| "保存后ai自动整理、归类，还能补充完善" | AI 在**保存之后**跑（异步），不是录入时跑 |
| "这个即时贴有+ai标识" | 用户要能分辨哪条被 AI 处理过 |
| "看完加到dsh新开对话，也可加到当前对话" | 两个投递动作，都是一等公民 |
| "还能整理，提示，归类" | **提示**是独立功能，不是附属 |
| "我们只是一个插件，是依托于DSH的" | 不重造 DSH 已有的能力 |
| "我们是一个灵感的实现，也是修改一个问题的过程中的一个思路" | 便签不是知识，是**过程中的思路** |
| "提示的方式其实是有多种的…交给通信软件…或者在本产品上显示颜色或闪烁" | 提示分**三通道**，产品内视觉提示自己做 |
| "入口一定是有一个按键…新建一个，或者打开浏览所有的卡片" | 入口是**一个按键，两种行为**，不是"一个面板" |

### 一句话定位

> **灵感的入口：想到什么记下来，随时能扩展成一个成品。**

这不是"便签应用"。用户原话（第 10 轮 + 后续共识）把它定义成了三件事：

1. **灵感入口**：想到什么、拍张照、写两句心情，按一下就存住。
2. **AI 分类 = 分流器**：浅的（心情 / vlog / 备忘）留在墙上展示；深的（想做成 APP 的念头）点开聊成成品。两者不冲突，是两类不同命运的卡。
3. **成品边界**：DSH 的 `skill-office` + `present` 负责生成（docx / pptx / 原型 / 前端 demo）与交付；原生 App 打包不在这一版范围。

### 卡片命运（新）

分类不只是标签，它决定卡片的**命运**，命运是卡片的主按钮：

| 分类 | 命运 | 主按钮 | 终点 |
|---|---|---|---|
| 想法 / 工作 | **深入** | 💬 聊这张 | 新开对话 → 聊成成品 |
| 待办（或有时词） | **执行** | ⏰ 设个提醒 | 到点响 |
| 参考 | **调用** | 🔗 找相关 | 被引用 |
| 生活 / 未分类 | **展示** | 👁 看看 | 留在墙上 |

命运优先级：**待办 > 想法 > 参考 > 展示**。「生活」里有时间线索的，抬到「执行」。

### 成品的边界

「做成一个手机 app」在 DSH 这条链上能走到的最远是：**需求文档 → 原型/设计稿 → 可跑的前端 demo**。装到手机上的安装包生成不了，终点是「一个能演示、能继续交给专业工具做的东西」。

## 1. 三处必须纠正的设计（相对 v2）

### 纠正 1：投递不是第 5 章，是第 1 章

v2 把投递放在第 5 章，前面是数据模型、架构、AI 管线。这是因为 v2 把产品理解成"便签管理器 + 一个投递功能"。

按"修改一个问题过程中的一个思路"这个定位，**投递才是产品的完成态**。捕获和整理都是为投递服务的前置步骤。

所以 v3 的章节顺序是：**入口与捕获 → 整理 → 投递 → 提示 → 界面 → 数据**。

### 纠正 2：`systemPrompt` 注入要删掉

v2 设计了一个"让 agent 主动反查便签库"的功能，通过 `systemPrompt.section()` 每回合注入约 150 字。

**这个功能是多余的。** 理由见 §4.4，一句话：**投递之后内容就在会话里了，agent 本来就能搜到。** 对一个已经投递过的便签，注入是浪费 token 换一个已经存在的能力。

删掉之后省下的是：每回合 150 字、一套动态求值逻辑、一个"空库注入空串"的边界、以及一类"agent 乱搜便签"的失败模式。

### 纠正 3：接口从"架构"降为"能力"

v2 之后我一度把 `registerSink` 做成产品骨架（上一轮的错误），你已经纠正过。

v3 的处理：**接口存在，但只在附录里，40 行以内。** 产品章节完全不提。

判断标准很简单：**如果一个功能删掉之后产品还能用，它就是能力；删掉就不能用，它就是骨骼。** 接口是能力。

---

# 第三部分 · 产品设计

## 2. 捕获：0.3 秒完成，不等任何东西

### 2.1 入口：一个按键，两种行为

原话：**"我们这个入口一定是有一个按键，按键就可以新建一个，或者说是打开浏览所有的便利贴的卡片"**

所以入口不是一个面板，是**一个按键**，两种行为挂在不同的点击方式上：

```
┌──────────┐   单击  →  捕获浮层（新建，光标已在输入框）
│  ▢ 随手贴 │   双击  →  打开面板（浏览全部卡片）
└──────────┘   右键/长按 → 菜单：新建 / 浏览 / 未读 / 设置
```

**默认单击是"新建"，不是"浏览"。** 捕获是高频动作，浏览是低频动作；高频的必须最快。

### 2.2 三个落点，一套行为

原话：**"位置是在对话框的顶部或者就是左侧栏"**。三个落点，都是同一个组件、同一个 store、同一套行为：

| 落点 | 插槽 | 形态 | 场景 |
|---|---|---|---|
| **侧栏按键** | `sidebar.panellist` | 图标行（图标 + 标签） | 全局常驻，最显眼 |
| **对话顶部按钮** | `conversation.session.header.utilities` | 图标按钮 | 用户正在对话，手不用离开 |
| **悬浮球**（可选） | `shell.overlay` | 56px 圆球，可拖 | 面板关着、侧栏收窄时 |

侧栏与顶部**都有**，因为原话说的是"或者"，意思是两个位置都要能满足；哪一个最终常用，交给用户自己用出来。设置里可以关掉其中一个或两个，但**不能两个都关**（至少留一个入口）。

悬浮球默认**关闭**——三个入口同时存在会显得吵。它是给"侧栏收起来了 + 正在别处看东西"这种情况的备选。

### 2.3 捕获浮层

单击任何入口，立刻弹出（非模态，`Esc` 关）：

```
┌────────────────────────────────┐
│  按住说话  或  直接打字          │
│  ┌──────────────────────────┐  │
│  │ ▁▃▅▇▅▃▁  00:03            │  │
│  └──────────────────────────┘  │
│  [ 现在这里写的东西…          ] │
│  [📎]                [保存 ⌘↵] │
└────────────────────────────────┘
```

- 快捷键 `Alt+Space`（窗口内，见附录 D）——和"点按键"等价
- **语音和文字可混录**：先说话，转写结果落到输入框，用户接着改——最省事的路径
- `⌘↵` / `Ctrl+Enter` 保存，`Esc` 取消
- 保存后浮层立刻关，右下角 toast：「已收进随手贴 · 整理中　[查看] [撤销]」

**硬指标：从按下快捷键（或点按键）到保存完成 ≤ 1.5 秒**（不含语音识别等待）。这是唯一的性能验收线。

### 2.4 图标状态：颜色与闪烁

原话：**"如有提醒这个左侧栏的按键或者是顶部的按键就会闪烁，而是一个图标在闪烁"**

**闪烁的主体是图标本身**，不是按钮背景。这是关键区分——背景闪会干扰整行，图标闪只影响一个 glyph。

```
┌─────────────────┐          ┌─────────────────┐
│  ▢  随手贴       │  正常     │  ◈  随手贴  ●   │  有提醒
└─────────────────┘          └─────────────────┘
                                  ↑ 图标描边闪烁 + 角标点
```

五档状态（完整定义见 §5.2）：

| 状态 | 图标 | 角标 | 触发 |
|---|---|---|---|
| idle | 静止 | 无 | 一切正常 |
| new | 静止 | 灰点 + 数字 | 有未读便签 |
| attention | **缓慢脉冲**（2s） | 琥珀点 | 待投递 / 到期 / 相似 |
| urgent | **快闪**（0.8s）+ 轻微缩放 | 红点 | 到期已过 |
| busy | 内置旋转弧 | 无 | AI 正在整理 |

侧栏与顶部两个图标**联动**：任一入口的状态变化，两处同时反映，不会各闪各的。

### 2.5 保存路径不依赖任何东西

```js
async function capture(input) {
  const note = await store.write(input)   // ① 无条件落盘
  emit('stickynote/captured', note)        // ② 广播，不 await
  return note                              // ③ 立刻返回
}
```

顺序固定：**先落盘，再广播，且广播不 await**。

`llm` 没装？照存。`speechController` 没装？只能打字。任何 sink 挂了？用户感知不到。

### 2.6 语音不造轮子

宿主 `speechController`（`@deepseek-ai/dsh-experimental-api-speech-to-text`）提供完整链路：

```ts
catalog(): SpeechCatalog
follow(signal): AsyncIterable<SpeechCatalog>       // 就绪状态订阅
prepare(providerId, options)                       // 下载/加载模型
transcribe(request, signal): Promise<Transcript>
```

`Transcript`（`types.d.ts:102`）：

```ts
{ text: string; audioSeconds: number; inferenceSeconds: number }
```

**注意：这是一次性 `Promise`，不是流式。** 所以 UI 不能说"边说边出字"，只能说"识别中…"。这点必须写进交互，别许诺假的流式。

浏览器侧采集复用 `dsh-experimental-client-ui-voice-input` 导出的：

```ts
const rec = new Recording(onDispose, deviceId)
await rec.start(onError)                        // 采麦克风
rec.amplitude()                                 // 实时 RMS，画波形
const wav = await rec.stop(maxDurationSeconds)  // Uint8Array (PCM16 WAV)
audioBase64(wav)                                // → string，JSON 传输
```

`RecordingError.kind` 直接映射 UI 文案：
`'unavailable' | 'permission' | 'empty' | 'cancelled' | 'interrupted' | 'deviceMissing'`

**模型未就绪时**，浮层里就地放「准备语音识别」按钮，调 `speechController.prepare()`，不让用户跳出去配。

## 3. 整理：异步，跑在保存之后

### 3.1 状态机

```
        捕获
         │
         ▼
    ┌─────────┐  入队   ┌─────────┐  成功  ┌──────┐
    │ pending │────────▶│ running │───────▶│ done │
    └─────────┘         └────┬────┘        └──────┘
         ▲                   │ 失败×3
         │ 用户点「重试」      ▼
         └──────────────┌────────┐
                        │ failed │
                        └────────┘
```

用户看到的是：卡片**立刻**出现，标"整理中…"，1–5 秒后原地刷新成正式卡片，右上角出现 `+AI` 角标。

### 3.2 一次调用

```js
ctx.llm.stream({
  provider, model,
  purpose: 'stickynote-organize',   // 辅助调用，不进主对话上下文
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: raw }],
  temperature: 0.2,
  maxTokens: 800,
  signal,
})
```

`GenerateOptions.purpose` 原文注释：*"Provider-neutral classification for an auxiliary model call … Ordinary conversation requests leave it unset."* —— 正是给这种旁路调用准备的。**不建 session、不占对话上下文、不产生用户可见回合。**

### 3.3 输出契约

```json
{
  "title": "登录流程要拆成两步",
  "category": "工作",
  "tags": ["登录", "鉴权"],
  "points": ["两步之间要能回退"],
  "todos": ["问一下 X 现在的超时设置"],
  "due_hint": "明天下午",
  "merge_hint": "a3f1",
  "confidence": 0.86
}
```

- `category` 越出类别表 → 落 `未分类` + 记 `ai.failed_reason='category_out_of_set'`
- `due_hint` 只是**提示**，不自动建定时任务（§5.4）
- `merge_hint` 只提示重复，**绝不自动合并**（自动合并会丢数据）
- 解析失败重试 2 次（temperature 0.0），仍失败 → `ai.state='failed'`，原文完好

### 3.4 提示词（防幻觉是第一位）

```
你是便签整理员。用户随手说的一句话，你要把它变成一条结构化的便签。

规则：
1. 不改写原文，一个字都不能动。你只产出结构。
2. title 不超过 20 字，用用户自己的说法，不要造词。
3. category 只能从给定列表选一个：{categories}
4. points 是原文里没明说但显然成立的补充，1-3 条。宁少勿多，
   想不出来就返回空数组——填空比编造更糟糕。
5. todos 只抽原文里真的包含的行动项。原文没有就返回 []。
6. due_hint 只在原文明确提到时间时填。模糊的"以后"不算。没有就返回 null。
7. 如果这条和已有便签 {neighbors} 讲同一件事，填 merge_hint。
8. 只输出 JSON，不要 markdown 代码块。
```

第 4 条是闸门。AI "补充完善"最容易滑向编造，所以**宁空勿造**，并且 `## AI 补全` 在界面上是**独立折叠区，默认收起**——用户要看才看，不会误当原文。

### 3.5 归类：三层，先便宜后贵

不只是"叫模型判"：

```
① 规则层    URL 域名指纹 / 关键词表 / 标签共现 → 直接定类，0 token
                ↓ 判不出
② 模型层    llm 调用，带已有类别 + 邻居便签做上下文
                ↓ 用户改过
③ 用户层    category_source = 'user'，永久生效，AI 不再覆盖
```

三层都记在 `category_source: rule | model | user`。**用户手改过的类别 AI 永远不许动**——这条是信任的基础，用户改一次就该永久生效。

### 3.6 原文改了，旧结果怎么办

```
原文改成 rev=5，但 ai.based_on_rev=2
  ↓
UI 显示「AI 结果基于较早版本」+ 一个「重新整理」
  ↓
旧结果保留不删          ← 关键：不让用户看到"AI 补全突然没了"
  ↓
后台自动重跑，新结果到达时角标变回 +AI
```

**永不删除旧 AI 结果**，除非用户明确点「重新整理」并同意丢弃。默认行为是保留 + 标注过期。

## 4. 投递：产品的完成态

### 4.1 两条路径，语义不同

这是 v3 最重要的设计。同一个"投递"，有两种完全不同的技术路径和语义：

| | 路径 A：放进输入框 | 路径 B：直接送进会话 |
|---|---|---|
| API | `input.setDraft(text)` + 用户按发送 | `setDraft` → 等 → `submit('queue')` |
| 用户是否要按发送 | **要** | 不要 |
| agent 怎么理解 | 用户的新指令 | **召回的参考资料** |
| 标记 | 无 | `source: { kind:'plugin:dsh-stickynote', form:'recall' }` |
| 适合 | 想接着这条继续聊 | 正在改某个问题，这条是背景 |

**默认是 A**（用户可控，错了能改）。B 用于「新开对话投递」——那条路必须有会话才走得通。

#### 路径 B 的真实实现（参考 `dsh-vps-manager` 的已验证写法）

关键不是 `agents.send`，而是**会话作用域的输入门面**：

```js
const actx  = sessions.scope(sessionId)                    // 该会话的 client ctx
const input = actx.get('conversation').input.for(actx)     // 门面（root ctx 上拿不到）
input.setDraft(text)
// 输入框更新是异步的：必须等它真的收到，否则 submit 出去的是空的
for (let i = 0; i < 20 && !draftOf(sessionId); i++) await sleep(25)
input.submit('queue')
```

三个必须处理的细节：

1. **`input.for(actx)` 才有 `setDraft` / `submit`** —— 直接在 root ctx 上读 `conversation` 拿到的不是这个面。
2. **`setDraft` 之后草稿是异步落进编辑器的** —— 不等就 `submit`，发出去的是空消息。`vps-manager` 用 20×25ms 轮询，我们照做。
3. **输入框里有用户没发的话时不能动**（返回 `'draft'`），**同一句话已在队列里不重复排**（返回 `'queued'`）。

新开会话本身走 Host：客户端拿不到 `startSession`（sidebar 的注入回调），
所以 `POST /session` 由 Host 调 `sessionController.create()` 建，返回 id 给客户端。

### 4.2 草稿保护（会丢数据，必做）

`setDraft(text)` 的语义是**替换整个草稿**。用户输入框里正写着三百字方案，点了投递，内容全没了。

`InputState` 提供了可读字段（`conversation/contract/input.d.ts:273`）：

```ts
interface InputState {
  readonly draft: string        // 草稿文本
  readonly draftRev: number     // 单调 revision，span CAS 用
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting' | 'sending'
}
```

**投递前必须走这个判定**：

```
phase !== 'plain'
  → 禁用投递，提示「正在发送中」

draft.trim() === ''
  → setDraft(text)                          静默，最常见

draft 已包含本条 id（"a3f1"）
  → 什么都不做，toast「这条已经在输入框里了」

否则 → 三选一，默认「追加」：
   [ 追加到后面 ]  captureInsertion() → insertText(text, span)
   [ 替换掉 ]      setDraft(text)，明确写出「将覆盖 N 字」
   [ 取消 ]
```

默认**追加**不是替换。用户宁可多删，不可少存。

### 4.3 投递格式

不要直接倒原文。渲染成带出处的块：

```markdown
> **登录流程要拆成两步**　`随手贴 · a3f1 · 11-08 09:14`
>
> 原文：先把验证码那步拆出来，现在一次校验太麻烦了。

- 要点：两步之间要能回退
- 待办：问一下 X 现在的超时设置
```

带 `a3f1` 短 id，所以**投递是双向的**：内容进了对话，之后需要细节时能顺着 id 找回原条。

### 4.4 投递之后，DSH 自己会做的事（我们不写一行代码）

这是第 10 轮原话"接到对话中，就等于接到记忆插件中了"的技术含义。我核实了 `dsh-mnemon` 的实现：

```js
// lib/index.js:12815
this.agent.ctx.on("session/event", (session, event) => this.sessionEvent(session, event))

// :12984  sessionEvent()
if (event.type !== "turn/end") return
…
this.scheduleIdleReview(turn)      // 空闲 3 秒后 runIdleReview() 提炼
```

**记忆插件的全部输入源就是 `session/event` 的 `turn/end`。** 它不看文件系统、不扫剪贴板、不读别的插件的数据。

所以投递进去的内容，下一轮 `turn/end` 自动进入它的提炼范围。**零对接代码。**

同理，下面这些也全自动：

| 能力 | 谁做 | 怎么触发 |
|---|---|---|
| 记忆提炼 | `dsh-mnemon`（`idleReview`） | `turn/end` 事件 |
| 会话全文检索 | `dsh-session-query`（SQLite FTS5） | 内容进会话日志即入索引 |
| 会话标题 | `dsh-session-title` | 首条显著内容 |
| 上下文压缩 | `dsh-compaction` | 按需 |
| 审计 / 遥测 | 各订阅者 | `session/event` |

**结论**：产品边界到"内容进会话"为止。之后是 DSH 的地盘。

### 4.5 所以删掉 systemPrompt 注入

v2 设计了"每回合注入 150 字，告诉 agent 你有个便签库，记得查"。

按 §4.4，这功能是多余的：**已经投递的，agent 本来就能搜到；没投递的，用户自己也想不起来，注入了也没用。**

删掉省下：每回合 150 字 token、一套动态求值、一个空库边界、一类"agent 乱搜"的失败模式。

**唯一的损失**：用户从没投递过某条便签，却问"我之前是不是记过关于 X 的"。此时 agent 答"没有记录"。接受这个损失——因为让 agent 凭空去搜一个它不知道存在的库，收益远小于噪音。

### 4.6 投递前预览 + 候选选择

点投递**不立刻执行**，先展开预览：

```
┌─────────────────────────────────┐
│ 将投递到「当前对话」              │
│ ┌─────────────────────────────┐ │
│ │ > 登录流程要拆成两步         │ │
│ │ > 原文：先把验证码…          │ │
│ └─────────────────────────────┘ │
│ ⚠ 输入框里已有 312 字            │
│   [追加] [替换] [取消]           │
└─────────────────────────────────┘
```

**新开对话时给候选**（v3 新增）。用户点"新开对话"，先问带上哪些：

```
新开对话，带上哪些思路？
☑ 登录流程要拆成两步（三天前 · 工作）
☑ 缓存那层是不是该换了（上周 · 想法）
☐ 明天问 X 报价的事（昨天 · 待办）
```

候选由我们自己搜（同类、同标签、时间邻近），不靠 agent。这是"思路中转站"定位的落点——**一次带走一组相关的思路，而不是一条**。

### 4.7 投递记录

`delivered[]` 存 `session` / `at` / `mode` / `before_ai` / `form`。详情页渲染成可点链接，点击 `openResourceIn(sessionId, …)` 回到那个会话。

`before_ai: true` 表示投递时 AI 还没跑完（投的是原文）。这不算错误，是正常路径——**AI 永远不挡用户的路**。

## 5. 提示：通道与呈现

原话里的"提示"是独立功能，且用户明确了**两种通道**：交给通信软件（微信、小飞机等），或在本产品上以颜色/闪烁呈现。

这一章按「**先分通道，再排优先级**」组织，不是平铺十几条功能。

### 5.1 三个提示通道

| 通道 | 在哪看见 | 谁负责送达 | 适合什么 |
|---|---|---|---|
| **C1 产品内** | 侧栏图标 / 对话顶部按钮 / 卡片 | **我们自己**（DOM + CSS） | 用户已经在 DSH 里时的一切提示 |
| **C2 系统级** | 操作系统通知中心 | 调 `schedule` 或用户的 `dsh-notify-me` | 用户离开了 DSH，但事情不能误 |
| **C3 通信软件** | 微信 / Telegram（小飞机）/ 飞书 / Bark 等 | 用户的推送插件 | 用户完全不在电脑前 |

**C1 必须我们自己做**——这是原话明确要的"按键闪烁"。C2/C3 一律委托，理由见 §5.4。

### 5.2 提示的两种视觉：颜色与闪烁

原话：**"如有提醒这个左侧栏的按键或者是顶部的按键就会闪烁，而是一个图标在闪烁"**

**关键区分**（原话里"而是一个图标在闪烁"就是在强调这一点）：闪烁的是**图标本身**，不是整个按钮的背景。

```
┌─────────────────┐          ┌─────────────────┐
│  ▢  随手贴       │  正常     │  ◈  随手贴  ●   │  有提醒
└─────────────────┘          └─────────────────┘
                                  ↑ 图标描边闪烁 + 角标点
```

#### 五档视觉状态

| 状态 | 图标表现 | 角标 | 触发条件 |
|---|---|---|---|
| **idle** | 静止，常规色 | 无 | 一切正常 |
| **new** | 静止，常规色 | 灰点（数字） | 有未读便签 |
| **attention** | **图标描边缓慢脉冲**（2s 周期，透明度 0.4↔1） | 琥珀点 | 有待投递 / 到期 / 相似提示 |
| **urgent** | **图标描边快闪**（0.8s 周期）+ 轻微缩放 | 红点 | 到期时间已过 |
| **busy** | 图标内一个小旋转弧 | 无 | AI 正在整理（批量时） |

**颜色语义**（跟着 DSH 主题变量，不自造色板）：

```css
/* 灰：只是有新东西，不重要 */
--sn-badge-idle: var(--dsw-alias-label-secondary);
/* 琥珀：有事要做，但不急 */
--sn-badge-attention: var(--dsw-alias-warning, #d69e2e);
/* 红：已经过期了 */
--sn-badge-urgent: var(--dsw-alias-danger, #e53e3e);
```

#### 闪烁的硬约束

```
- 只在 attention / urgent 两档闪
- 同一时刻只有一个闪烁源（侧栏与顶部按钮联动，不是各闪各的）
- 用户打开面板 → 立刻转 idle，不再闪
- prefers-reduced-motion: reduce → 完全禁用动画，只留角标颜色
- 页面不可见（document.hidden）→ 暂停动画，省电
```

最后两条是**必做**，不是优化。前者是无障碍底线，后者是笔记本电池的礼貌。

#### 实现方式

侧栏图标由 `sidebar.panellist` 插槽渲染，owner props 只有 `size` 和 `active` 两个字段（`sidebar/contract/slots.d.ts:101`），**没有角标位**——所以图标、描边脉冲、角标全部由我们自己的组件画在内部。对话顶部按钮走 `conversation.session.header.utilities`，**同一个组件、同一个 store**，所以两处永远联动。

代码骨架与插槽注册见附录 A.3。

### 5.3 提示清单（14 类，按必要程度排）

#### 第一梯队 · 做了就有明显价值（M2–M3）

| # | 提示 | 通道 | 强度 | 触发 |
|---|---|---|---|---|
| **T1** | **重复/相似** —— "这张可能和 a3f1 讲的是同一件事" | C1 内联 | 卡片一行 | 保存时 |
| **T2** | **到期提醒** —— `due_hint` → "⏰ 设个提醒 →" | C2 + C3 | 系统通知 / 推送 | 定时 |
| **T3** | **待投递** —— "12 条整理好了，还没用过" | C1 横幅 + 角标 | 面板顶部 | 打开面板 |
| **T4** | **归类告知** —— "我归到了『工作』，不对点一下改" | C1 内联 | 卡片一行 | AI 完成 |

**为什么是这四个**：T3 决定用户会不会用起来（转化漏斗）；T2 是唯一"不提示会误事"的；T1 是唯一能当场纠正 AI 归类的机会；T4 是建立 AI 信任的最便宜方式。

#### 第二梯队 · 有价值但要看数据（M4–M5）

| # | 提示 | 通道 | 强度 | 触发 | 风险 |
|---|---|---|---|---|---|
| **T5** | **会话中相关** —— 正在聊的事，你上周记过 | C1 静默 | 侧栏图标转 attention | 会话进行中 | 猜错就是噪音 |
| **T6** | **停滞** —— "这条放了 3 周了，还要吗" | C1 内联 | 卡片一行 | 打开面板 | 变成 nagging |
| **T7** | **待办汇总** —— "7 条待办散在便签里" | C1 横幅 | 面板顶部 | 打开面板 | 低 |
| **T8** | **补全** —— "要不要补上是哪个接口" | C1 内联 | 卡片一行 | AI 完成 | 显得啰嗦 |

#### 第三梯队 · 可以做，但不是现在（M6+）

| # | 提示 | 通道 | 强度 | 风险 |
|---|---|---|---|---|
| **T9** | **会话结束** —— "这轮聊得好，要记一条吗" | C1 toast | 右下角 | 每轮弹就烦死，必须限频 |
| **T10** | **关联会话** —— 会话 B 也在聊这个 | C1 静默 | 角标 | 关联错误率高 |
| **T11** | **输入预感知** —— 打字时提示"你记过类似的" | C1 内联 | 输入框下 | 打字时弹东西最烦人 |
| **T12** | **周报** —— "这周记 8 条，3 条已用" | C1 静默 | 面板 | 价值取决于用户是否在意 |

#### 不建议做

| # | 提示 | 为什么不做 |
|---|---|---|
| T13 | 催促（"你 3 天没记了"） | 制造焦虑，捕获类产品最忌讳 |
| T14 | 社交（"别人都在记"） | 与产品气质完全不符 |

### 5.4 T2 的实现：C2/C3 全部委托

`due_hint` 抽出后，卡片上出现「⏰ 设个提醒 →」，点击才创建：

```js
await ctx.schedule.create({
  title: note.title,
  prompt: `提醒：${note.title}\n（来自随手贴 ${note.id}）`,
  timing: { kind: 'at', at: { … } },
})
```

**我们只负责"设了这个提醒"，不负责"怎么提醒到人"。** 送达链路交给：

| 用户装了什么 | 走哪条通道 |
|---|---|
| 只装了我们 | `schedule` 到点时开一个新会话（C1：侧栏闪 + 一个 toast） |
| 装了 `dsh-notify-me`（w4836） | 系统通知 / 标题标记 / 提示音，支持 bark、feishu、serverchan、webhook 四类外部推送 |
| 装了微信 / Telegram 通道插件 | 直接推到手机 |
| 都不装 | 到点时侧栏图标转 urgent（红点 + 快闪），用户自己看到 |

我核实过 `dsh-notify-me@1.17.0` 的通道清单（`lib/client.js`）：`bark`(9)、`feishu`(8)、`serverchan`(6)、`webhook`(17)。它自己也是委托式设计，不做推送服务本身。

**为什么不自建推送**：微信要企业号/服务号审核，Telegram 要 Bot token，飞书要自建应用——每一个都是独立的账号体系、独立的合规成本、独立的失效风险。而生态里已经有专门做这件事的插件，并且做得比我们好。**我们做"什么时候该提醒"，让它们做"怎么提醒到人"。**

### 5.5 强度分级（硬约束）

14 类如果都做成弹窗，产品就废了。分级是硬约束，不是建议：

| 级别 | 形态 | 允许用于 | 频率上限 |
|---|---|---|---|
| **L0 静默** | 只有角标颜色 | T5, T10, T12 | 不限 |
| **L1 内联** | 卡片上多一行 | T1, T4, T6, T8, T11 | 不限 |
| **L2 横幅** | 面板顶部一条 | T3, T7 | 每次打开 ≤ 1 条 |
| **L3 toast** | 右下角飘一下 | T9 | **每天 ≤ 2 次** |
| **L4 外发** | 系统通知 / 微信 / TG | T2 | 按提醒本身 |

**口诀：越打断的，越少，越准。**

L3 以上必须有全局限流。没有限流的提示系统，用户第一周就会全部关掉——而关掉之后，连 T2 都不会再送达。

### 5.6 T5 的降级先试水

T5（会话中相关提示）听起来最酷，但我建议**最后做**。

因为它做不准就是负价值，而做准需要前面的数据积累。有个安全的试水方式：

**先做"投递候选推荐"**（§4.6 已有）：用户点投递时，候选列表里已经排好了相关的。

- 原版 T5：会话进行中主动冒出来（危险）
- 降级版：用户本来就在做这个动作，候选里排前面（安全）

**两者用同一个相似度算法。** 降级版没有任何噪音风险，跑一段时间看候选的采纳率——采纳率高说明算法靠谱，那时再做实时版。

### 5.7 相似度算法（T1 / T5 / 投递候选共用）

```
score = 标签交集 × 3
      + 类别相同 × 1
      + 正文词重叠（去停用词后 Jaccard）× 2
      + 时间邻近（7 天内 +1）
超过阈值 → 提示
```

上千条以内纯内存算，几十毫秒。同一份分数同时服务三个场景，**不各写一套**——否则用户会遇到"投递时候选里没有，保存时却说重复"这种自相矛盾。

### 5.8 关闭策略

每一个提示类型都必须能被单独关掉，且**关掉后不再消耗任何计算**（不是算出来再隐藏）。

设置页一个表格：

```
提示              开关    通道
重复/相似          ✅    内联
到期提醒           ✅    系统通知 + 微信
待投递             ✅    角标
归类告知           ☐    内联          ← 用户已关
…
```

默认全开，只有 T9（会话结束提示）默认关闭——它最容易被嫌烦。

## 6. 界面

### 6.1 为什么不是文件浏览器

**① 便签没有"路径"这个心智模型。** 文件树前提是**按位置记忆**。便签是**按内容和时间记忆**的（"上周那个关于登录的想法"）。文件树逼用户回忆一个他从未记过的东西。

**② AI 归类与路径稳定天然冲突。** 文件树整个体验建立在路径不动上。而核心卖点是 AI **持续重排**。今天这条在 `想法/`，明天 AI 觉得属于 `产品/`，连夜搬家——用户第二天点老位置，空了。这是产品级 bug。

**③ 元数据是多维的，树只能表达一维。** 时间、类别、标签、来源（🎤/⌨️/🖼）、AI 状态、投递状态——六维。树一次只能表达"在哪"。

磁盘仍是扁平的，只是界面不呈现路径。详情页给一个「在文件管理器中显示」的小按钮，留后门。

### 6.2 三区布局

```
┌────────────────┬──────────────────────────────┬──────────────────┐
│ 🔍 搜索…        │ [全部] [+AI] [待投递] [语音]  │ 详情              │
├────────────────┼──────────────────────────────┼──────────────────┤
│ 收件箱 (3)      │ ┌──────────────────────────┐ │ 登录流程要拆成两步 │
│ 工作  12        │ │ 登录流程要拆成两步   +AI │ │ ──────────────── │
│ 想法   8        │ │ 先把验证码那步拆出来…    │ │ 原文（可编辑）     │
│ 待办   5        │ │ 工作 · 今天 09:14 · 🎤   │ │                  │
│ 参考   3        │ │ [加到当前对话] [新开对话] │ │ ──────────────── │
│ 未分类 1        │ └──────────────────────────┘ │ ▸ AI 补全（收起） │
│                │ ┌──────────────────────────┐ │ ▸ 抽出的待办      │
│ ──────────────  │ │ 明天问 X 报价的事    +AI │ │ ⏰ 设个提醒 →     │
│ 投递记录        │ │ 待办 · 昨天 18:02 · ⌨️   │ │ ──────────────── │
│ 回收站 (2)      │ │ [加到当前对话] [新开对话] │ │ 投递记录          │
│ 归档            │ │ ⏰ 设个提醒 →            │ │ 已进 session-8158 │
│                │ └──────────────────────────┘ │                  │
└────────────────┴──────────────────────────────┴──────────────────┘
```

**左：软分类树**
- 结构由 AI 归出来，可折叠、带计数
- **用户不能手动建目录**，只能改某条的类别 / 加标签——因为 AI 会持续重排，让人手建目录就是骗他
- 固定五项：`收件箱`（pending）/ `投递记录` / `回收站` / `归档` / `待投递`
- 搜索框在左上角，因为它同时过滤左树和中间流

**中：时间流卡片（不是表格、不是列表行）**
便签是短、视觉、可扫的。卡片必须携带：
- `+AI` 角标（`ai.state === 'done'` 才有，素贴没有，这是产品灵魂）
- 类别 chip + 时间 + 来源图标（🎤 / ⌨️ / 🖼）
- **两个投递按钮直接长在卡片上**——主路径动作，不该藏进详情页
- `due_hint` 存在时多一行「⏰ 设个提醒 →」

**右：详情**
原文可编辑（改了 → 新 `rev` + AI 结果标过期）+ AI 补全（默认折叠）+ 投递记录。`sidebar.right` 约 300px，所以右侧是窄版；点「展开」进主面板三区。

### 6.3 回收站

- **不自动清理，不设 TTL**。撞上"AI 重分类"场景，用户可能一个月后才发现某条不见
- `彻底删除` 二次确认，写清不可恢复
- 回收站里的便签**不参与搜索、不参与相关提示**

### 6.4 搜索

便签天然攒到几十上百条，**没搜索等于没存**。

索引里存 `terms`（原文 + 标题归一化副本），内存 `includes`：

```js
notes.filter(n => !n.deleted && n.terms.includes(q.toLowerCase()))
```

覆盖**原文、AI 标题、标签、类别**——用户记不住是哪一样。上千条之后再做分块 + 全文索引。

### 6.5 空状态

第一次打开什么都没有。放一条示例便签（带 `+AI`，内容是"试试点「加到当前对话」，这条会出现在输入框里"），点击可投递试一下。成本 10 行，收益是用户第一次就知道怎么用。

---

# 第四部分 · 数据与工程

## 7. 数据模型

### 7.1 磁盘布局：扁平，永不因 AI 搬家

```
~/.dsh/stickynote/
├── index.json                          # 派生索引，可随时删除重建
├── 2026-11-08T09-14-22-a3f1.md         # 一条一文件
├── 2026-11-08T11-02-07-9c4e.md
└── media/
    └── a3f1-01.png                     # 附件
```

文件名 = `ISO时间戳-短id`，**创建后永不改名、永不移动**。好处：可 git、可被 `dsh-tool-fs` 读写、可外挂 Obsidian、**AI 重分类只改文件头字段，不触碰路径**。

### 7.2 文件格式

```markdown
---
id: a3f1
rev: 7
created: 2026-11-08T09:14:22+08:00
updated: 2026-11-08T09:20:02+08:00
source: voice | text | image
category: 工作
category_source: rule | model | user
tags: [登录, 鉴权流程]
ai:
  state: done | pending | running | failed | skipped
  at: 2026-11-08T09:14:31+08:00
  title: 登录流程要拆成两步
  category_conf: 0.86
  model: deepseek-v4
  prompt_rev: 3
  based_on_rev: 2
pinned: false
archived: false
deleted: null
attachments:
  - media/a3f1-01.png
delivered:
  - session: session-8158…
    at: 2026-11-08T09:20:02+08:00
    mode: current | new
    form: draft | recall
    before_ai: false
---

原文（用户说的 / 打的那句话，逐字保留，永不改写）

---

## AI 补全
- 要点一

## 抽出的待办
- [ ] 把验证码那步拆出来
```

**四条铁律**：

1. **`原文` 区永不被 AI 改写。** AI 输出全在 `## AI 补全` 之后。上面是用户说的，下面是 AI 的，边界绝对清晰。
2. **`ai.state` 是唯一真相。** `+AI` 角标 = `ai.state === 'done'`。不做假。
3. **`rev` 单调递增，每次写 +1。** 多标签同步和冲突合并的唯一依据。
4. **`ai.based_on_rev` 记录 AI 结果对应的原文版本**，用于过期标注。

### 7.3 为什么不用 SQLite / 单个 JSON

- 单 JSON：条数一多每次全量落盘，且用户无法单独编辑一条
- SQLite：查询强，但用户不能 `cat` 一条便签、不能 git diff，agent 也读不了。与生态"纯文本可审计"取向相反
- 文件 + 索引缓存：最简、最稳、最开放

`index.json` 结构（约 200B/条）：

```json
{ "version": 3, "notes": [
  { "id":"a3f1","rev":7,"created":"…","category":"工作","category_source":"model",
    "ai":"done","title":"…","source":"voice","deleted":null,"archived":false,
    "pinned":false,"terms":"登录流程要拆成两步 先把验证码…" }
]}
```

## 8. 架构

```
┌──────────────────────────────────────────────────────────┐
│  Client（浏览器，零构建，window.__ModuleLoader__）          │
│  ├── shell.overlay          悬浮球 / 捕获浮层              │
│  ├── sidebar.panellist      侧栏图标 → 主面板              │
│  ├── main (key=stickynote)  三区大界面                     │
│  └── sidebar.right.pane.tab 详情页（priority: extension）  │
│      ↕ SSE + fetch                                        │
└────────────────────────┬─────────────────────────────────┘
                         │ /api/dsh-stickynote/*
┌────────────────────────┴─────────────────────────────────┐
│  Host（Node，零第三方依赖，只 import node: 内置）           │
│  ├── 存储层   ~/.dsh/stickynote/*.md + 原子写 + rev 递增   │
│  ├── 变更广播 SSE /events（多标签同步）                     │
│  ├── AI 管线  队列 → llm.stream → 回写 frontmatter         │
│  ├── 语音桥   speechController.transcribe                  │
│  └── 模型工具 stickynote_capture / _search / _get / _promote│
└──────────────────────────────────────────────────────────┘
```

Host 侧**刻意不 import `@deepseek-ai/*`**——插件装在 profile 里时，宿主对第三方包的 ESM 解析钩子不保证可用。`dsh-plugin-sticky-wall` 全文只用 `node:fs` / `node:path` / `node:os`，这是被验证过的稳妥做法。

宿主能力一律通过**可选注入**拿（附录 B）。

### 8.1 客户端挂载点（都核对过 face 定义）

| 落点 | 插槽 | 证据 |
|---|---|---|
| 侧栏 + 主面板 | `sidebar.panellist`（list，id=主面板 key）→ `main`（keyed，key 同名） | `dsh-client-ui-sidebar/contract/slots.d.ts:47` |
| 详情页 | `sidebar.right.pane.tab` + `.title` | `sidebar-right/contract/slots.d.ts:53` |
| 悬浮球 | `shell.overlay`（list，root scope） | `dsh-client-ui-layout/index.d.ts:96` |
| 设置页 | `settings.section` + `.icon` | `settings/contract/slots.d.ts:73` |

`shell.overlay` 的关键约束（原文）：

> **The layer itself is click-through — entries opt back into pointer events** — so an occupant never blocks the app underneath.

即 orb 必须自己加 `pointer-events: auto`，否则永远点不到。

## 9. 多端同步

用户开两个标签页是常态。A 页存了一条，B 页看不见——用户会认为"刚记的丢了"。

### 9.1 主方案 SSE

`WebRoute.handler` 契约原文（`host-webserver/index.d.ts:41`）：

> **Owns the full response lifecycle (may hold the response open, e.g. SSE).**

```js
ctx.webServer.register({
  kind: 'exact',
  path: '/api/dsh-stickynote/events',
  handler: (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    clients.add(res)
    req.on('close', () => clients.delete(res))
  },
})
```

事件：`event: note` / `data: {"op":"created|updated|deleted","id":"a3f1","rev":7}`

客户端**按 `rev` 合并**：本地 `rev >= 事件 rev` 就忽略，防旧数据覆盖新数据。

### 9.2 兜底轮询

SSE 断开时（代理、休眠、移动网络）降级成 3 秒轮询 `GET /list?since=<maxRev>`。恢复后切回 SSE。

### 9.3 同源校验

`Origin` host 必须与 `req.headers.host` 一致，拒绝跨站。**必须做**——否则任何网页都能往用户便签库里写东西。

## 10. 模型工具

| 工具 | 作用 | 主要消费者 |
|---|---|---|
| `stickynote_capture(text, category?)` | agent 自己记一条 | agent |
| `stickynote_search(query, category?, limit?)` | 带相关度的全文搜 | **投递候选** / agent |
| `stickynote_get(id)` | 取全文 | agent |
| `stickynote_promote(id, target)` | 投递到当前/新会话 | agent |

`stickynote_search` 的主消费者变了：v2 里它是"给 agent 反查便签库"的，v3 里它的**主要用途是我们自己的投递候选选择**（§4.6）。agent 仍然可以调，但那是次要用途——因为投递过的内容它已经能通过会话检索找到。

相关度打分（简单够用）：

```
score = 命中词数 × 10
      + (标题命中 ? 5 : 0)
      + 时间衰减（7 天内 +3，30 天内 +1，更早 0）
```

按分数倒序，同分按时间倒序。**不返回已删除的。**

工具错误必须是人话：`未找到便签 a3f1（可能已归档或删除）`

## 11. 删除与撤销

捕获类产品是**拇指动作**，误触率高。记错了、记重复了、手滑删了——都要能收回。

| 机制 | 设计 |
|---|---|
| **软删除** | `deleted: <timestamp>`，文件不动（最安全）。不 `rm` |
| **刚存完的撤销** | toast 里「撤销」，5 秒内可撤。撤销 = 删掉刚建的那条 |
| **回收站** | 左树固定项，可恢复 / 彻底删除 / 清空。**无 TTL** |
| **归档 vs 删除** | 归档是"收起来但还在"，删除是"不要了"。语义不同，都要有 |
| **批量** | 多选 → 批量归档 / 删除。M6 |

## 12. 错误与边界

| 场景 | 行为 |
|---|---|
| `llm` 未注入 | 便签永远素贴，不显示 `+AI`，设置页明说"AI 整理未启用" |
| AI 调用失败 | 重试 2 次（temperature 0），仍失败 → `ai.state='failed'`，卡片角上小「重试」 |
| AI 输出非 JSON | 同上，不污染原文 |
| `speechController` 未注入 | 只剩文字录入，语音键置灰并提示去装 `voice-input-bundle` |
| 语音模型未就绪 | 浮层内就地 `prepare`，不跳出去配 |
| 录音超时 | 宿主 `maxDurationSeconds` 截断，不报错 |
| 磁盘写失败 | 捕获浮层**不关**，抛可读错误，内容不丢 |
| 并发写同一文件 | 单进程内存态 + `writeFileAtomic`（tmp + rename），不产生半截文件 |
| 索引损坏 | 删除 `index.json` 自动重建，用户无感 |
| 便签被外部删除 | 索引对不上时静默移除该条 + toast 一次，不报错 |
| frontmatter 被手改坏 | 解析失败 → 该条进「损坏」分类，原文按纯文本呈现，**不丢内容** |
| 搜索无结果 | 空状态 + 「要新建一条吗？」 |
| 投递时 `phase !== 'plain'` | 禁用按钮，提示「正在发送中」 |

**隐私**：默认**不保存原始音频**（`media/*.wav` 需手动开）。文本全在本机 `~/.dsh/`。AI 整理会把原文发给模型——**设置页第一次开启时必须明写这句**，不藏在文档里。图片同理：**默认不发给模型**，只有用户显式说"帮我看这张图"才发那一张。

## 13. 不做清单

| 功能 | 竞品有 | 判断 | 理由 |
|---|---|---|---|
| **定时提醒** | `dsh-sticky-notes` | **不做，改为接 `schedule`** | DSH 已有 `schedule` 和 `dsh-mishu`，再做是第三处 |
| **密码保护** | `dsh-sticky-notes` | **不做** | 便签本机明文，加密一半没意义 |
| **无限画布** | `dsh-noteboard` | **不做** | 与"抓一下就走"相反。画布是"停留"的产品 |
| **文件树** | `dsh-client-ui-notes` | **不做** | AI 重排 vs 路径稳定（§6.1） |
| **Markdown 左编右渲** | `dsh-client-ui-notes` | **不做** | 便签是一句话，不是文档编辑器 |
| **多种纸色 / 纹理** | `dsh-plugin-sticky-wall` | **不做** | 视觉糖，挤占信息密度 |
| **自己的模型选择器** | — | **不做** | 跟随 DSH 当前模型，设置可覆盖 |
| **云端同步** | — | **不做（v1）** | 纯文本 + git 就是同步方案 |
| **`systemPrompt` 注入反查** | `dsh-notes-plugin` | **不做**（v3 删） | 投递后 agent 天然能搜到（§4.5） |
| **后台常驻 cron 派发** | `dsh-notes-plugin` | **不做** | 与 `schedule` 重复；我们是捕获器不是调度器 |
| **向量检索** | `dsh-notes-plugin` | **不做（v1）** | 上千条以内 `includes` 足够 |

## 13.5 实现状态（2026-11-08）

**M1–M5 的主要功能已经写完并跑通**，6900 行零依赖代码，不是纸面设计。

| 文件 | 行数 | 内容 |
|---|---|---|
| `lib/store.js` | 793 | 扁平 Markdown 存储、frontmatter 子集编解码、rev 递增、软删除、搜索、相似/候选、**设置读写** |
| `lib/index.js` | 554 | HTTP 端点（12 个）、SSE、同源校验、4 个模型工具、投递文本渲染 |
| `lib/ai.js` | 343 | 整理队列（串行/去重/重启恢复）、提示词、JSON 抠取、结果规整 |
| `lib/rules.js` | 490 | 规则层归类、中英分词、相似度、时间线索识别 + **绝对时间解析** |
| `lib/client.js` | 2453 | 零构建 CJS 工厂、两个入口、五档图标、捕获浮层（含自带采集）、三区面板、T1 提示、投递候选、草稿三选一、导出、**设置页**、设提醒 |
| `lib/voice.js` | 519 | 语音能力探测、provider 阶段判定、**自带麦克风采集**（getUserMedia → MediaRecorder → 16k 重采样 → PCM16 WAV）、错误映射 |

### 已验证的行为（都有测试脚本）

| 项 | 结果 |
|---|---|
| 捕获延迟 | **10ms**（AI 不挡路，远低于 1.5s 的验收线） |
| 含逗号句子往返 | ✅ 曾静默拆成两条，改 JSON 编码后修复 |
| frontmatter 损坏 | ✅ 降级为纯文本，内容不丢 |
| 回收站视图 | ✅ 默认/trash 两个视图正确互斥 |
| 队列去重 | ✅ 处理期间重复 enqueue 被吃掉 |
| 重启恢复 | ✅ `pending`/`running` 重新入队 |
| 三级降级 | ✅ 无 llm → 素贴；无模型 → skipped；解析失败 → failed 且原文完好 |
| 规则层归类 | ✅ 6/6 正确，且能压过模型的错误判断 |
| T1 相似提示 | ✅ 真实实例命中 0.6~0.71，无关条目 0 |
| 跨站防护 | ✅ 异源 Origin → 403 |
| 真实 DSH 实例 | ✅ 装配、加载、端点、落盘全部通过 |
| 投递四分支 | ✅ 空草稿直放 / 发送中拒绝 / 已在框内跳过 / 有草稿弹三选一 |
| 语音四态 | ✅ ready / unprepared / downloading / loading 判定正确 |
| 导出导入 | ✅ 导出 9 条、导入新建不覆盖（id 全不同）、空条目跳过不报错 |
| WAV 编码 | ✅ 逐字节正确（44+16000×2）、RIFF/WAVE/fmt/data 头正确、16k 单声道 PCM16、削顶保护 |
| 录音链路 | ✅ 模拟浏览器里跑通 麦克风 → MediaRecorder → 重采样 → WAV → base64 |
| 采集失败路径 | ✅ 权限拒绝/无设备/无 mediaDevices/无 MediaRecorder/空录音 五种全部正确映射 |
| 客户端加载 | ✅ `dsh-stickynote/client.js` 在 boot manifest 里，bundle 88690 字节可取回 |
| 设置读写 | ✅ 单字段改不影响其他、持久化、删文件回落默认、坏文件不崩 |
| 时间解析 | ✅ 13 个用例全对（含"今天上午在 11 点说→顺延明天"的边界） |
| T2 建提醒 | ✅ 真实环境拿到 `taskId`（`schedule-04e13c65-…`），时间算成 `2026-11-10T15:00:00Z` |
| 新会话投递 | ✅ 真实环境建出 `session-39fee329-…`（磁盘上 `session.v4.jsonl.zstd` 已落），客户端 `setDraft`→等→`submit('queue')` 全通 |
| 图片往返 | ✅ 真实环境上传 1×1 PNG 并读回，`file` 识别为 `PNG image data, 1 x 1` |
| 图片安全 | ✅ 5 种路径穿越全部 400；svg/空/超大全部拒绝；二进制往返逐字节一致 |
| 归档语义 | ✅ 默认视图排除归档、归档视图含归档、搜索/相似排除归档、回收站独立 |
| 批量操作 | ✅ 勾选/全选/清空、批量归档/取消归档、批量软删除、一条失败不影响其余 |
| 虚拟滚动 | ✅ 5000 条只渲染 21 张，滚动到任意位置窗口正确覆盖；<120 条不虚拟化 |
| 卡片命运 | ✅ 8 个用例全对：想法/灵感/工作→深入、待办→执行、参考→调用、生活/未分类→展示、有时词→执行 |
| 对话主题条 | ✅ 绑定/解绑/渲染，挂在 `conversation.input.dock`（输入框上方全宽） |
| 回写闭环 | ✅ `stickynote_update` 工具 + `store.appendAi`：只追加不重写，旧补全保留，原文不动 |

### 开发中发现并修正的七个真 bug

1. **含逗号的句子被静默拆成两条** —— `points`/`todos` 改用 JSON 编码，不再用逗号列表
2. **队列去重失效** —— `queued.delete` 移到 `finally`，处理期间重复入队被吃掉
3. **落盘可能产生孤儿文件** —— `persist` 复用索引里的原名，不再按 created 重算
4. **相似度结构性漏报** —— 固定分母 12 时，两条"都还没整理"的便签最高只能得 0.67，阈值 0.55 反而要求正文相似度 0.80。改成按"可比信号之和"归一化
5. **`store.set` 函数式分支不合并** —— 一次 `refresh()` 会把 query/filter/selectedId 全部抹掉，表现为"搜索一下就重置了筛选"。改成两种形态都合并
6. **`writeFileAtomic` 硬塞 `'utf8'`** —— 文本没问题，二进制（图片）会被解码再编码，图直接损坏。改成按内容类型选编码
7. **新会话投递曾判定"做不到"** —— 实际根因是拿输入框的位置错了：`input.for(actx)` 在**会话作用域**里，不在 root ctx 上。参考 `dsh-vps-manager` 后修正

### 两个刻意的技术取舍

**模型选择：纯跟随对话，不设插件配置。**
用户明确要求"插件模型默认跟随对话，不用单独设，不用写死"。所以 `pickModel()` 只有一条路：读 `agentDefaultModel.currentSelection()`，拿不到就返回 null（标 `skipped`，不猜）。

> 实测发现：当前环境 `agentDefaultModel` 给出 `workbuddy / deepseek-v4.1-flash`，但 `pi-ai` 报 `has no configured model`——五个 provider 的 `listModels()` 全部返回空。这是宿主 provider 命名冲突（`pi-ai` 抢注了 `workbuddy`），**不是插件的 bug**。插件按设计标 `skipped`，等宿主 provider 就绪后自动恢复。

**语音：识别用宿主的，采集自己写。**
不是不想复用。实测确认了三条事实：
1. `dsh-experimental-client-ui-voice-input` 的客户端 bundle 只导出 `apply` / `inject`，`Recording` 是模块内部的私有类，不在导出面上；
2. 平台种子表 `__DSH_BOOT__.staticModules` 只有 `react` / `jsx-runtime` / `react-dom` / `cordis` / `zod` / `react-virtual` / `client-store` / `ui-slots` / `ui-primitives` / `dockkit` 十个，没有 voice-input 的采集模块；
3. 插件路径下的相对文件（`./voice.js`）不参与 ModuleLoader 解析。

所以采集按宿主的实现移植进 `client.js`：`getUserMedia` → `MediaRecorder` → `decodeAudioData` → `OfflineAudioContext` 重采样到 16k 单声道 → PCM16 WAV。**算法与宿主的逐行一致，产物格式相同**，`transcribe` 分不出来。
识别仍然只调 `speechController.transcribe()`，这是 DSH 的能力，一个字没改。

**相似度归一化：按"可比信号之和"，不是固定分母。**
捕获那一刻新便签还没有标签和类别（AI 还没跑）。若固定除以 12，一条完全一样的旧便签最多得 8/12 = 0.67，阈值 0.55 就要求正文相似度达 0.80——**结构性地漏掉真重复**。按实际可比的信号归一化后，两条"都还没整理"的便签也能公平比较（0.71 命中）。

### 尚未做（M6 及之后）

- 悬浮球（`shell.overlay`）
- 让 AI 读图（需要 `attachment` 服务签发 `ImageAttachmentRef`，当前只存不读）
- 「聊这张」→ 对话主题条的**自动**回写（当前靠用户说「把结论存回卡片」，agent 调 `stickynote_update` 手动回写；自动提炼对话结论是下一步）
- 第二/三梯队提示（T5–T12，其中 T5 实时版被刻意推迟——见 §5.6「做不准是负价值」）


## 14. 里程碑

| # | 内容 | 验收 |
|---|---|---|
| **M1** | 存储层（`rev`/`deleted`/`category_source`）+ HTTP 端点 + 同源校验 + SSE + **侧栏图标（单击新建 / 双击浏览 / 四档状态视觉）** + 主面板三区 + 文字录入 + 搜索 | 能存能读能改能删，重启不丢，两标签页同步；**点图标 1.5 秒内能记一条** |
| **M2** | 异步 AI 管线 + `+AI` 角标 + 三层归类 + `based_on_rev` 过期标注 + **T1 重复提示 + T3 待投递（横幅 + 角标）** | 存完 0 延迟出卡片，5 秒内原地刷新；相似条目能当场提示 |
| **M3** | 投递路径 A（草稿三选一保护）+ 预览 + 投递记录 + 回跳 + 回收站/撤销/导出 | 输入框有字时不静默覆盖；误删可恢复 |
| **M4** | **对话顶部按钮** + 悬浮球 + 窗口内热键 + 语音 + **T2 到期提醒（含 `schedule` 委托）** | **按快捷键到保存 ≤ 1.5 秒**；到期能推到系统通知 / 微信 |
| **M5** | 投递路径 B（`form:'recall'` 直送）+ 新开会话（多选候选）+ 4 个模型工具 + 设置页（含提示开关表）+ 图片 + **T4 归类告知** | 能一次带一组思路开新会话 |
| **M6** | 筛选、归档、批量、虚拟滚动、**T5–T8 第二梯队提示** | — |
| **M7** | **T9–T12 第三梯队**（会话结束 / 关联会话 / 输入预感知 / 周报） | 每个都要有限流证据才上线 |

**M1–M3 是能用的最小闭环**（入口 + 捕获 + AI + 投递当前对话 + 不丢数据）。M4 之后才是完整体验。

**提示的排期原则**：第一梯队（T1–T4）分散在 M2–M5，因为它们是产品必要件；第二梯队进 M6，因为要看数据；第三梯队进 M7，且**每个都必须先证明准确率再上线**（T5 的降级试水方式见 §5.6）。

## 15. 待定的两个决定

**① AI 同步还是异步？**
异步（本文按异步写）。代价是要处理"存完立刻投递时 AI 未完成"（§4.1），处理方式是投原文 + `before_ai: true`。若改同步，捕获要等 2–4 秒，直接摧毁核心体验。

**② 详情放右侧栏还是主面板？**
两者都有、共享 store（`dsh-audiobook`、`dsh-tingdong` 都是这个双形态）。右侧栏窄版只放原文 + 投递按钮，主面板放完整信息。只做一个的话做右侧栏——用户更常在会话旁边看它。

## 16. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| **与 `sticky-wall` / `quicknote` 定位重叠** | 市场里被当成重复品 | 描述首句写"投递进对话 + AI 整理"，差异摆第一行 |
| **`dsh-notes-plugin` 是最强竞争者**（w511，17.9k 行，有 AI 分类 + 派发 + 注入） | 被直接比较 | 它是"会话→笔记→注入会话"，我们是"头→便签→对话"，方向相反。守住四条独占线：语音捕获 / 投递新会话 / `+AI` 角标 / SSE 实时 |
| 转写不是流式 | 说完要等，体感差 | UI 明确"识别中"，不假装逐字出字 |
| SenseVoice 首次要下模型 | 语音第一体验差 | 浮层内就地 `prepare` |
| AI 归类漂移 | 类别树越来越乱 | 提示词注入已有类别 + 邻居；设置里「重新整理全部」 |
| 便签上千条后索引慢 | 打开变卡 | 索引 200B/条；`terms` 内存 filter 到千条；**列表已做定高虚拟滚动（>120 条启用）** |
| SSE 被反代掐断 | 多标签不同步 | 3 秒轮询兜底（§9.2） |
| **投递走 `form:'recall'` 时用户不知情** | 内容自己进了会话，用户困惑 | 路径 B 默认关闭；每次投递前预览；投递记录可回跳 |

---

# 附录

## 附录 A · 已核实的 API

全部从 `@deepseek-ai/dsh` **0.2.2-rc.1** 的 `.d.ts` 与已发布插件源码实读，非推测。

### A.1 客户端挂载

```js
slots.inject('sidebar.panellist', () => slots.register({
  name: 'sidebar.panellist', id: 'stickynote', order: 20, label: '随手贴',
}, SidebarIcon))

slots.inject('main', () => slots.register({ name: 'main', key: 'stickynote' }, MainPanel))
```

`sidebar.panellist` face 注释（`contract/slots.d.ts:44`）：

> Global panel icons. Each list id addresses the matching main panel; the sidebar owns the button and resolves its label from list metadata.

### A.2 右侧栏详情页

```js
ctx.sidebarRight.registerTabType({ kind: 'stickynote-detail', priority: 'extension', … })
ctx.sidebarRight.openTab('stickynote-detail', { … })
```

`tab-registry.d.ts` 原文：

> `extension` — a type from outside the product, and the highest: a type that declares nothing outranks every viewer shipped here, exactly as in VS Code.

### A.3 三个入口落点

侧栏图标见 A.1。另外两个落点：

```js
// 对话顶部按钮（session scope，与侧栏共用同一组件 + store）
slots.inject('conversation.session.header.utilities', () => slots.register({
  name: 'conversation.session.header.utilities', id: 'stickynote-header', order: 50,
}, HeaderIcon))

// 悬浮球（可选，默认关）
slots.inject('shell.overlay', () => slots.register({
  name: 'shell.overlay', id: 'stickynote-orb', order: 100,
}, CaptureOrb))
```

`conversation.session.header.utilities` 的 face 注释（`contract/slots.d.ts:259`）：

> Right-aligned Session utilities in ascending order.

**两个图标为什么能联动**：它们读同一个客户端 store（订阅 SSE），不是各自去 fetch。组件本身无状态，状态在 store 里，所以侧栏闪的时候顶部一定在闪。

**`shell.overlay` 必须给 orb 加 `pointer-events: auto`**（`layout/index.d.ts:96`：layer is click-through，entries opt back into pointer events）。

**角标要自己在图标组件内画**：`SidebarPanelIconOwnerProps` 只有 `size` 和 `active` 两个字段（`sidebar/contract/slots.d.ts:101`），没有角标位。所以：

```jsx
function SidebarIcon({ size, active }) {
  const { level, count } = useStickynoteAlertState()   // 自己的 store
  return (
    <span className={`sn-icon sn-icon--${level}`} style={{ width: size, height: size }}>
      <StickyGlyph />                                  {/* 描边脉冲走 CSS @keyframes */}
      {count > 0 && <span className="sn-badge">{count}</span>}
    </span>
  )
}
```

**动画必须尊重 `prefers-reduced-motion: reduce`**（禁用动画，只留角标颜色），并在 `document.hidden` 时暂停——前者是无障碍底线，后者是笔记本电池的礼貌。

### A.4 LLM 旁路调用

```js
ctx.llm.stream({
  provider, model,
  purpose: 'stickynote-organize',
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: raw }],
  temperature: 0.2, maxTokens: 800, signal,
})   // → AsyncIterable<StreamChunk>
```

`GenerateOptions`（`dsh-llm/types.d.ts:538`）。`purpose` 原文：*"Provider-neutral classification for an auxiliary model call … Ordinary conversation requests leave it unset."*

### A.5 语音

```js
// Host
ctx.speechController.catalog() / follow(signal) / prepare(id, opts)
ctx.speechController.transcribe(request, signal)   // → Promise<Transcript>
ctx.speechController.configure(patch)

// Browser（dsh-experimental-client-ui-voice-input/client/audio）
const rec = new Recording(onDispose, deviceId)
await rec.start(onError); rec.amplitude(); await rec.stop(maxDurationSeconds)
```

`Transcript = { text, audioSeconds, inferenceSeconds }`——**一次性返回，非流式**。

### A.6 投递

```js
// 路径 A
input.setDraft(text) / input.insertText(text, span) / input.captureInsertion() / input.submit()

// InputState（conversation/contract/input.d.ts:273）—— 草稿保护的依据
{ draft: string; draftRev: number; phase: 'plain' | … }

// 路径 B（form:'recall' 语义，照抄 dsh-notes-plugin 的实现）
const msg = {
  id: 'stickynote-' + …,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin:dsh-stickynote', form: 'recall' },
}
ctx.agents.get(sid).send(msg, 'next-turn', true)

// 新会话
const { agent } = await apiSessionController.createSession({ cwd, agentPreset, reusable: () => false })
inputResolver.requestDraftInitialization(binding, { prompt, whenDraftExists: 'replace' })
  // → 'applied' | 'preserved' | 'blocked'
```

### A.7 记忆插件为什么自动接管（核对结论）

`dsh-mnemon@0.5.42` 的 `lib/index.js`：

```js
// :12815
this.agent.ctx.on("session/event", (session, event) => this.sessionEvent(session, event))
// :12984 sessionEvent()
if (event.type !== "turn/end") return
…
this.scheduleIdleReview(turn)          // idleReviewMs 默认 30s，空闲后 runIdleReview()
// :13348 读历史
const query = this.ctx.get("sessionQuery"); log = await query.readSession(id)
```

**结论**：记忆插件的唯一输入源是会话事件流。投递进会话 = 自动进入提炼范围。零对接代码。

### A.8 提醒（软依赖）

```js
await ctx.schedule.create({
  title, prompt,
  timing: { kind: 'at', at: {…} },   // after/every/daily/weekly/cron/rrule 亦可
})
```

`ScheduleCreateRequest`（`dsh-schedule/types.d.ts:419`）、`ScheduleTiming`（`:279`）。

### A.9 HTTP 长连接（SSE 依据）

```ts
interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
register(route: WebRoute | WebResourceRoute): () => void
```

### A.10 模型工具

```js
ctx.inject(['tools'], (toolCtx) => {
  toolCtx.tools.register({
    name: 'stickynote_capture',
    description: '把一句话记成随手贴（自动 AI 整理，可投递进对话）。',
    presentCall: (args) => ({ card: 'generic', title: `记一条：${args?.text ?? ''}`, kind: 'edit', rawInput: args }),
    parameters: {
      text: { type: 'string', required: true, description: '要记的内容' },
      category: { type: 'string', description: '指定类别，省略由 AI 判断' },
    },
    run: async ({ text, category }) => { … },
  })
})
```

与 `dsh-plugin-sticky-wall` 的 5 个 `sticky_wall_*` 完全同构，已被验证。

## 附录 B · 依赖注入矩阵

| 服务 | 类型 | 缺席时降级 |
|---|---|---|
| `webServer` | **硬依赖** | 插件不启动 |
| `tools` | 软 | 无模型工具，UI 全功能不受影响 |
| `llm` | 软 | 便签永远素贴，无 `+AI` |
| `speechController` | 软 | 只剩文字录入 |
| `agents` | 软 | 不能走路径 B（`form:'recall'`），路径 A 不受影响 |
| `schedule` | 软 | 不显示「设个提醒」 |
| `slots` | 软 | UI 半侧不注册，Host 侧照常 |

Host 侧不 import 任何 `@deepseek-ai/*`，只用 `node:fs` / `node:path` / `node:os`。理由（`sticky-wall` 头注释）：

> 这里刻意不 import `@deepseek-ai/*`，只用 Node 内置模块 —— 插件装在 profile 里时宿主解析第三方包的 ESM 钩子不保证可用，零依赖最稳。

## 附录 C · 扩展点（能力，非骨骼）

> 这一节是**能力余量**，不是产品架构。删掉整节，产品依然完整。
> 判断依据：**删掉还能用 = 能力；删掉不能用 = 骨骼。** 接口是能力，所以在附录里。

### C.1 一个注册点

```js
ctx.provide('stickynoteSink', {
  /** 注册一个出口。返回 disposer，fiber 卸载自动摘除。 */
  register(name, sink) { … },
  list() { … },
})
```

### C.2 sink 的形状

```js
{
  label: '存入 dsh-notes',
  capabilities: ['text', 'ai'],     // 声明能接什么，不能接的就不发
  async store(note) { … },          // 必需
  async update(note) { … },         // 可选：AI 回填 / 用户编辑
  async remove(id) { … },           // 可选：删除 / 归档
}
```

只实现 `store` 就是单向导出；全实现就是双向同步。

### C.3 触发方式：先落盘，再广播，不 await

```js
const note = await store.write(input)     // ① 无条件成功
ctx.emit('stickynote/captured', note)      // ② 同步广播，不 await
return note                                // ③ 立刻返回
```

`emit` 的语义（`cordis/events.d.ts`）：*"`emit` runs synchronous listeners without awaiting them"*。sink 挂了用户完全感知不到。

### C.4 原则

| 原则 | 理由 |
|---|---|
| **我们只发事件，不主动适配别人** | 别人改 API，我们不跟着发版 |
| **我们的库永远是权威** | 卸载我们不丢数据 |
| **不做 sink 的 UI** | 设置页只列名字 + 开关，点进去是别人自己的页面 |
| **不做 sink 之间的格式转换** | 一旦做转换就变成数据管道，责任无限扩大 |
| **不保证 sink 可用** | 失败只记 `ok:false`，不重试、不弹窗 |

### C.5 官方示范

包里放一个 30 行的 `examples/sink-local-dir.js`（写到一个本地目录）。理由很简单：**接口有没有人用，取决于有没有人能照着抄。**

## 附录 D · 需求边界：热键能做到哪

原话是"**窗口或桌面有个按键**"。诚实拆开：

| 档位 | 可行性 | 依据 |
|---|---|---|
| **窗口内热键**（DSH 有焦点时） | ✅ 现在就能做 | `client-shortcuts/config.d.ts:1` 原文：`/** Window-local timing accepted by the Host and browser keyboard service. */` |
| **系统级全局热键**（任何应用里） | ❌ 纯 web 做不到 | 官方包列表无桌面外壳（无 `dsh-desktop`、无 electron/tauri 依赖）。`runtime: 'desktop'` 只是快捷键协议预留的 profile 值 |

**结论**：M4 只承诺**窗口内热键**（`Alt+Space`），设置页写明"切到其他应用时不可用"。

**替代方案**（今天就能用的外挂）：系统级热键指向
`curl -X POST http://127.0.0.1:3080/api/dsh-stickynote/capture -d '{"text":"…"}'`

真要做全局热键，前提是有桌面外壳，那时用 `globalShortcut`。**不写进 M4 验收。**

## 附录 E · 尚未验证、实现时要先做的四件事

1. **`ctx.sidebarRight.registerTabType` 的确切签名**——`tab-registry.d.ts` 只描述了语义（glob / canOpen / priority / title / guide），没读到完整字段表。M1 第一步读完它，或照抄 `dsh-client-ui-sidebar-files`（官方同款）。

2. **frontmatter 手写子集解析**——Host 零依赖意味着 YAML 要自己解析（只支持我们写的子集，不接受任意 YAML）。畸形内容按纯文本降级（§12），不丢内容。

3. **`shell.overlay` 内 React 的 `pointer-events` 与拖动**——浮层 click-through，orb 要 opt-in。拖动避开与主界面滚动冲突，`dsh-plugin-vrmpet3d`、`dsh-cet-vocab` 有可参考实现。

4. **`agents.get(sid).send(msg,'next-turn',true)` 的 `source.form:'recall'` 是否对所有模型生效**——`dsh-notes-plugin` 用了这个语义，但它依赖 `SessionFormat v4`（注释原话："v3 起 `kind:'plugin'` 是已退役写法，落盘会抛 `SessionFormatError`"）。要在 0.2.2-rc.1 上实测一次再定 M5 的实现方式。

## 附录 F · v3 变更清单

| # | 变更 | 类型 | 位置 |
|---|---|---|---|
| 1 | **用户原话全文放到最前，逐字保留**，作为第一手依据 | 新增 | 第一部分 |
| 2 | 产品定义改为「灵感的实现 / 问题过程中的一个思路」，不是"便签管理器" | **重新定位** | §0 |
| 3 | 章节顺序改为 捕获 → 整理 → 投递 → 提示 → 界面 → 数据 | 重排 | 全文 |
| 4 | 投递分成两条路径：A 放进输入框 / B `form:'recall'` 直送 | **新增核心** | §4.1 |
| 5 | 补 `form: 'recall'` 的语义与实现（照抄 notes-plugin 的已验证写法） | 新增 | §4.1 / A.6 |
| 6 | **删除 `systemPrompt` 注入反查**（投递后 agent 天然能搜到） | **删除** | §4.5 |
| 7 | 新增"投递之后 DSH 自动做的事"一节，附 `dsh-mnemon` 源码核对 | **新增核心** | §4.4 |
| 8 | 归类改三层：规则 → 模型 → 用户（`category_source`），用户层永久生效 | 新增 | §3.5 / §7.2 |
| 9 | 提示独立成章；**14 类穷举 + 按必要程度分四梯队** | 新增 | §5.3 |
| 10 | 新开对话改为**多选候选**，一次带一组思路 | 新增 | §4.6 |
| 11 | `stickynote_search` 主消费者改为"投递候选选择"，agent 调用降为次要 | 重新定位 | §10 |
| 12 | 接口从架构降为附录，40 行以内，附"能力 vs 骨骼"判据 | **降级** | 附录 C |
| 13 | 不做清单加三条：`systemPrompt` 注入、后台 cron、向量检索 | 扩充 | §13 |
| 14 | 风险表加：`dsh-notes-plugin` 是最强竞争者 + 四条独占线 | 新增 | §16 |
| 15 | 附录 E 加第 4 条（`form:'recall'` 需实测） | 扩充 | 附录 E |
| 16 | 图片默认不发模型（隐私约束）写进 §12 | 新增 | §12 |
| 17 | **提示的三个通道**（C1 产品内 / C2 系统级 / C3 通信软件），C2/C3 全部委托生态 | **新增核心** | §5.1 |
| 18 | **入口改"一个按键两种行为"**：单击新建 / 双击浏览 / 右键菜单 | **新增核心** | §2.1 |
| 19 | **三个落点**（侧栏 + 对话顶部 + 悬浮球），共用组件与 store，不能两个都关 | 新增 | §2.2 / A.3 |
| 20 | **图标四档视觉**（idle/new/attention/urgent + busy）：图标描边脉冲而非按钮背景闪 | **新增核心** | §2.4 / §5.2 |
| 21 | 视觉硬约束：`prefers-reduced-motion` 禁用动画、`document.hidden` 暂停、同一时刻只一个闪烁源 | 新增 | §5.2 |
| 22 | 强度分级表（L0 静默 / L1 内联 / L2 横幅 / L3 toast / L4 外发）与限流上限 | **硬约束** | §5.5 |
| 23 | **T2 不自己做推送**，核实 `dsh-notify-me@1.17.0` 的通道（bark/feishu/serverchan/webhook）后委托 | 新增 | §5.4 |
| 24 | 相似度算法统一（T1 / T5 / 投递候选共用一份分数，不各写一套） | 新增 | §5.7 |
| 25 | 每个提示类型可单独关闭，且关掉后不再消耗计算 | 新增 | §5.8 |
| 26 | 里程碑扩到 M7，提示按梯队分散排期 | 调整 | §14 |
| 27 | 原话补入第 12、13 轮（提示穷举要求 + 通道与入口定义） | 新增 | 第一部分 |

---

*文档版本 v3 · 2026-11-08 · 所有插槽名、API 签名均从 `@deepseek-ai/dsh` 0.2.2-rc.1 的 `.d.ts` 与已发布插件源码（`dsh-plugin-sticky-wall@1.8.0`、`dsh-notes-plugin@0.6.5`、`dsh-mnemon@0.5.42`、`dsh-quicknote@0.1.1`、`@chance722/dsh-inbox@0.2.15` 等）实读，非推测。命名数据取自本机 `~/.dsh/dsh-pick/catalog.json`（5567 个包，数据日 2026-11-05）与 `dshmarket/client.js` 的真实搜索算法。*

*第一部分为用户原话，逐字保留，未做任何修饰。*
