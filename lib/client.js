/**
 * dsh-stickynote — Client 半侧
 *
 * 零构建：手写 CJS 工厂，由 `window.__ModuleLoader__` 注入。
 * 只 require('react')。平台种子表（`__DSH_BOOT__.staticModules`）虽有
 * react / react-dom / cordis / zod / react-virtual / client-store / ui-slots /
 * ui-primitives / dockkit，但除 react 外都不是我们能依赖的稳定面 ——
 * 其余全部通过 `ctx.inject([...])` 拿运行时服务，不 import 任何 `@deepseek-ai/*`。
 * （0.2.2-rc.1 的 node_modules 里根本没有 dsh-client-ui-slots / dsh-client-store，
 * 它们只作为 devDependencies 参与构建期类型检查。）
 *
 * 三个落点，一套行为：
 *   sidebar.panellist                    侧栏按键（单击新建 / 双击浏览）
 *   conversation.session.header.utilities 对话顶部按钮（同组件同 store）
 *   shell.overlay                        悬浮球（默认关）
 *   main (key=stickynote)                主面板三区
 */

window.__ModuleLoader__.load({
  id: 'dsh-stickynote',
  factory: (require) => {
    'use strict'

    const React = require('react')
    const exports = {}

    exports.name = 'dsh-stickynote'

    /** 主面板 key，同时是 sidebar.panellist 的 id。 */
    const PANEL_ID = 'stickynote'
    /** Host 端点前缀（与 lib/index.js 的 API 常量一致）。 */
    const API = '/api/dsh-stickynote'
    /** 样式标签归属，模块系统按 data-plugin 回收插件样式。 */
    const PACKAGE = 'dsh-stickynote'
    const STYLE_ID = 'dsh-stickynote/styles'

    // =======================================================================
    // 语音（采集自带 + 识别用宿主）
    // =======================================================================
    //
    // 两件事分得很清：
    //   - **识别**用宿主的 `speechController.transcribe()`，这是 DSH 的能力，不碰。
    //   - **采集**自己实现。不是不想复用 —— 是复用不了：
    //     `dsh-experimental-client-ui-voice-input` 的客户端 bundle 只导出
    //     `apply` / `inject`，`Recording` 是模块内部的私有类；
    //     平台种子表（`__DSH_BOOT__.staticModules`）也只有
    //     react / jsx-runtime / react-dom / cordis / zod / react-virtual /
    //     client-store / ui-slots / ui-primitives / dockkit ——
    //     没有 voice-input 的采集模块可 require。
    //     所以按它的实现移植一份（getUserMedia → MediaRecorder → decodeAudioData →
    //     OfflineAudioContext 重采样 16k 单声道 → PCM16 WAV），产物格式与宿主一致。
    //
    // 为什么不 require('./voice.js')：ModuleLoader 的工厂只保证种子表里的模块，
    // 插件内的相对路径模块不参与解析。所以这份实现要内联在 client 里，
    // `lib/voice.js` 是同一套逻辑的可测试版本（给 Host 与单测用）。

    /**
     * 探一个可用的语音 provider。
     *
     * 只有 `preparation.phase === 'ready'` 才算真能用 —— unprepared / downloading /
     * loading 都还不能转写，硬调用会抛。
     */
    function inspectSpeech(controller) {
      if (controller === undefined || controller === null) return null
      if (typeof controller.catalog !== 'function') return null
      let catalog = null
      try {
        catalog = controller.catalog()
      } catch {
        return null
      }
      if (catalog === null || typeof catalog !== 'object') return null
      const providers = Array.isArray(catalog.providers) ? catalog.providers : []
      const selection = catalog.selection !== null && typeof catalog.selection === 'object' ? catalog.selection : {}
      const preferred = typeof selection.providerId === 'string' ? selection.providerId : ''
      let chosen = providers.find((item) => item && item.id === preferred)
      if (chosen === undefined) chosen = providers[0]
      if (chosen === undefined || chosen === null) return null
      const phase = chosen.preparation && chosen.preparation.phase ? chosen.preparation.phase : 'unprepared'
      return {
        providerId: chosen.id,
        providerName: chosen.name || chosen.id,
        language: typeof selection.language === 'string' && selection.language !== '' ? selection.language : 'zh',
        phase,
        ready: phase === 'ready',
        needsPrepare: phase === 'unprepared' || phase === 'failed' || phase === 'cancelled',
        maxDurationSeconds: Number(catalog.maxDurationSeconds) || 60,
      }
    }

    /** `RecordingError.kind` → 人话。 */
    function recordingErrorText(kind) {
      switch (kind) {
        case 'unavailable': return '这个环境不支持录音'
        case 'permission': return '没有麦克风权限，请在浏览器里允许后重试'
        case 'empty': return '没录到声音'
        case 'cancelled': return '已取消'
        case 'interrupted': return '录音被打断了'
        case 'deviceMissing': return '找不到麦克风设备'
        default: return '录音失败'
      }
    }

    /** Uint8Array → base64。不依赖 Buffer，也不依赖宿主导出的 helper。 */
    function toBase64(bytes) {
      if (bytes === null || bytes === undefined) return ''
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < view.length; i += chunk) {
        binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk))
      }
      if (typeof btoa === 'function') return btoa(binary)
      return ''
    }

    /** 目标采样率。宿主固定 16k，改了 transcribe 会拒。 */
    const TARGET_RATE = 16000

    /** 采集失败，`kind` 与宿主的 RecordingError.kind 对齐。 */
    function CaptureError(kind) {
      const error = new Error(kind)
      error.name = 'CaptureError'
      error.kind = kind
      return error
    }

    /**
     * 单声道 float 样本 → 16k PCM16 WAV。
     * 逐行对齐宿主的 encodeWave，保证产物格式一致。
     */
    function encodeWave(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(bytes.buffer)
      const text = (at, value) => {
        for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i)
      }
      text(0, 'RIFF')
      view.setUint32(4, bytes.length - 8, true)
      text(8, 'WAVE')
      text(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, TARGET_RATE, true)
      view.setUint32(28, TARGET_RATE * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      text(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    /**
     * 一次麦克风采集。
     *
     * `start()` 开始，`stop(max)` 收尾返回 WAV，`dispose()` 释放。
     * 麦克风是独占资源，释放必须走到 —— `stop` 的 finally 里就调了。
     */
    function Capture() {
      const state = {
        stream: null,
        recorder: null,
        context: null,
        analyser: null,
        samples: new Float32Array(256),
        chunks: [],
        lifetime: typeof AbortController === 'function' ? new AbortController() : null,
        disposal: null,
        onError: null,
      }

      async function preview(onError) {
        state.onError = typeof onError === 'function' ? onError : null
        const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
        if (devices === undefined || devices === null) throw CaptureError('unavailable')

        let stream
        try {
          stream = await devices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          })
        } catch (error) {
          if (typeof DOMException === 'function' && error instanceof DOMException) {
            if (error.name === 'NotAllowedError') throw CaptureError('permission')
            if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
              throw CaptureError('deviceMissing')
            }
          }
          throw error
        }

        if (state.lifetime !== null && state.lifetime.signal.aborted) {
          for (const track of stream.getTracks()) track.stop()
          throw CaptureError('cancelled')
        }

        state.stream = stream
        try {
          state.context = new AudioContext()
          state.analyser = state.context.createAnalyser()
          state.analyser.fftSize = state.samples.length
          state.context.createMediaStreamSource(stream).connect(state.analyser)
          for (const track of stream.getTracks()) {
            track.addEventListener(
              'ended',
              () => interrupted(),
              state.lifetime === null ? undefined : { signal: state.lifetime.signal },
            )
          }
        } catch (error) {
          await dispose()
          throw error
        }
      }

      async function start(onError) {
        if (typeof MediaRecorder === 'undefined') throw CaptureError('unavailable')
        await preview(onError)
        if (state.lifetime !== null && state.lifetime.signal.aborted) throw CaptureError('cancelled')
        try {
          state.recorder = new MediaRecorder(state.stream)
          state.recorder.ondataavailable = (event) => {
            if (!(state.lifetime !== null && state.lifetime.signal.aborted) && event.data.size > 0) {
              state.chunks.push(event.data)
            }
          }
          state.recorder.onerror = () => interrupted()
          state.recorder.start()
        } catch (error) {
          await dispose()
          throw error
        }
      }

      function interrupted() {
        if (state.lifetime !== null && state.lifetime.signal.aborted) return
        void dispose()
        if (state.onError !== null) {
          try {
            state.onError(CaptureError('interrupted'))
          } catch {
            /* 回调失败不影响释放 */
          }
        }
      }

      function amplitude() {
        if (state.analyser === null || state.analyser === undefined) return 0
        state.analyser.getFloatTimeDomainData(state.samples)
        let sum = 0
        for (const sample of state.samples) sum += sample * sample
        return Math.sqrt(sum / state.samples.length)
      }

      async function stop(maxDurationSeconds) {
        const recorder = state.recorder
        const context = state.context
        if (recorder === null || context === null || recorder.state !== 'recording') {
          await dispose()
          throw CaptureError('empty')
        }
        try {
          await new Promise((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = () => reject(CaptureError('empty'))
            recorder.stop()
          })
          if (state.stream !== null) for (const track of state.stream.getTracks()) track.stop()
          if (state.lifetime !== null) state.lifetime.signal.throwIfAborted()

          const blob = new Blob(state.chunks, { type: recorder.mimeType })
          if (blob.size === 0) throw CaptureError('empty')

          const decoded = await context.decodeAudioData(await blob.arrayBuffer())
          if (state.lifetime !== null) state.lifetime.signal.throwIfAborted()

          const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * TARGET_RATE))
          const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
          const source = offline.createBufferSource()
          source.buffer = decoded
          source.connect(offline.destination)
          source.start()
          const resampled = await offline.startRendering()
          if (state.lifetime !== null) state.lifetime.signal.throwIfAborted()

          return encodeWave(resampled.getChannelData(0))
        } finally {
          await dispose()
        }
      }

      function dispose() {
        if (state.disposal === null) state.disposal = release()
        return state.disposal
      }

      async function release() {
        if (state.lifetime !== null && !state.lifetime.signal.aborted) {
          try {
            state.lifetime.abort(CaptureError('cancelled'))
          } catch {
            /* 已 abort */
          }
        }
        if (state.recorder !== null && state.recorder.state === 'recording') {
          try {
            state.recorder.stop()
          } catch {
            /* 已停 */
          }
        }
        if (state.stream !== null) for (const track of state.stream.getTracks()) track.stop()
        state.stream = null
        const context = state.context
        state.context = null
        state.analyser = null
        state.chunks = []
        if (context !== null && context.state !== 'closed') {
          try {
            await context.close()
          } catch {
            /* 关不掉不影响下一轮 */
          }
        }
      }

      return { start, stop, dispose, amplitude, preview }
    }

    // -----------------------------------------------------------------------
    // 图片
    // -----------------------------------------------------------------------

    /** 允许的图片类型。与 Host 侧的白名单逐项一致。 */
    const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

    /** 读一个 File 成 dataURL。 */
    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读不到这个文件'))
        reader.readAsDataURL(file)
      })
    }

    /** dataURL → `{ mediaType, base64 }`。不是图片就返回 null。 */
    function splitDataUrl(dataUrl) {
      const text = String(dataUrl || '')
      const at = text.indexOf(',')
      if (!text.startsWith('data:') || at === -1) return null
      const header = text.slice(5, at)
      const mediaType = header.split(';')[0].toLowerCase()
      if (Object.prototype.hasOwnProperty.call(IMAGE_TYPES, mediaType) === false) return null
      return { mediaType, base64: text.slice(at + 1) }
    }

    /** 把一个 File 加进待上传列表。类型不对就明说，不静默丢。 */
    async function addImageFile(file) {
      if (file === null || file === undefined) return
      const mediaType = String(file.type || '').toLowerCase()
      if (Object.prototype.hasOwnProperty.call(IMAGE_TYPES, mediaType) === false) {
        notify(`只收 png / jpeg / webp / gif，这个是 ${mediaType || '未知类型'}`)
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        notify('图片超过 8MB，换一张小点的')
        return
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        if (dataUrl === '') return
        store.set((state) => ({
          pendingImages: [
            ...state.pendingImages,
            { id: `img-${Date.now()}-${state.pendingImages.length}`, mediaType, dataUrl, name: file.name || '' },
          ].slice(0, 8),
        }))
      } catch (failure) {
        notify(failure.message || '读图失败')
      }
    }

    /** 把待上传的图传到某条便签上。返回成功张数。 */
    async function uploadPendingImages(noteId) {
      const images = store.get().pendingImages
      if (images.length === 0) return 0
      let ok = 0
      for (const image of images) {
        try {
          await call('/attach', {
            method: 'POST',
            body: { noteId, mediaType: image.mediaType, data: splitDataUrl(image.dataUrl).base64 },
          })
          ok += 1
        } catch (failure) {
          notify(`一张图没传上去：${failure.message || failure}`)
        }
      }
      store.set({ pendingImages: [] })
      return ok
    }

    /** 拼出可访问的图片 URL（带 token，因为端点在同源下需要鉴权）。 */
    function mediaUrl(name) {
      const base = `${API}/media?name=${encodeURIComponent(name)}`
      try {
        // 从当前页面 URL 里带出 token：端点走的是同一套鉴权
        const params = new URLSearchParams(window.location.search)
        const token = params.get('token')
        if (token) return `${base}&token=${encodeURIComponent(token)}`
      } catch {
        /* 取不到就不带，同源已登录的会话照样能读 */
      }
      return base
    }

    /** 视觉状态的序号，越小越安静。图标渲染时取所有来源里最大的一档。 */
    const LEVELS = ['idle', 'new', 'attention', 'urgent', 'busy']
    const levelRank = (level) => {
      const at = LEVELS.indexOf(level)
      return at === -1 ? 0 : at
    }

    // =======================================================================
    // 状态：一份 store，三个入口共用
    // =======================================================================

    /**
     * 极简外部 store：`subscribe` / `getSnapshot`，配 `React.useSyncExternalStore`。
     * 不用任何第三方状态库 —— 平台只保证 react 可用。
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        /**
         * 合并式更新。
         *
         * **两种形态都必须合并，不能只合并对象那种。**
         * 早期实现里函数式分支直接拿返回值当新 state，于是一次
         * `store.set(s => ({ notes }))` 会把 query / filter / selectedId 全部抹掉 ——
         * 表现为「搜索一下就重置了筛选」。函数式分支返回的也是**补丁**，不是整个 state。
         */
        set(next) {
          const patch = typeof next === 'function' ? next(state) : next
          if (patch === null || patch === undefined) return
          const merged = { ...state, ...patch }
          if (merged === state) return
          state = merged
          for (const fn of listeners) {
            try {
              fn()
            } catch {
              /* 单个订阅者出错不该影响别人 */
            }
          }
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
    }

    /** 全局单例：图标、面板、浮层读的是同一个它。 */
    const store = createStore({
      /** id → 精简便签（列表用）。 */
      notes: {},
      /** 载入状态。 */
      phase: 'idle', // idle | loading | ready | error
      /** 最近一次错误，面板顶部显示。 */
      error: '',
      /** 搜索词。 */
      query: '',
      /** 当前筛选：all | ai | undelivered | voice | trash */
      filter: 'all',
      /** 选中的便签 id（详情用）。 */
      selectedId: '',
      /** 捕获浮层是否打开。 */
      captureOpen: false,
      /** SSE 是否连着（决定图标是否需要显示离线态）。 */
      live: false,
      /** 服务端已知的最大 rev，用于增量拉取。 */
      maxRev: 0,
      /** AI 正在跑的条数（图标转 busy 用）。 */
      aiRunning: 0,
      /** 刚存完那条的相似提示（T1）。存的是 { id, title, score }[]。 */
      similar: [],
      /** 相似提示挂在哪条便签上（关闭后不再显示）。 */
      similarFor: '',
      /** 投递候选面板：打开的源便签 id（空串 = 关闭）。 */
      deliverFor: '',
      /** 候选列表。 */
      deliverCandidates: [],
      /** 已勾选的候选 id。 */
      deliverPicked: [],
      /** 草稿冲突：投递时输入框已有内容。`{ noteId, text, draftLength }` 或 null。 */
      draftConflict: null,
      /** 语音：是否正在录。 */
      voiceRecording: false,
      /** 语音：电平历史（0~1 的数组），画波形用。 */
      voiceLevels: [],
      /** 语音：识别中。 */
      voiceTranscribing: false,
      /** 语音：不可用时的说明（空串 = 可用）。 */
      voiceBlocked: '',
      /** 语音：provider 的当前阶段（unprepared / downloading / ready…）。 */
      voicePhase: '',
      /** 提示开关（来自 Host 设置，默认全开）。 */
      hints: { t1Duplicate: true, t2Due: true, t3Undelivered: true, t4Category: true },
      /** 完整设置（含 confirmBeforeDeliver 等）。 */
      settings: null,
      /** 归档视图的独立列表。与主 notes 分开，避免「看归档把主列表清空」。 */
      archivedNotes: {},
      /** 批量选择集合（多选模式的勾选 id）。空 Set 时进入多选模式。 */
      selected: new Set(),
      /** 是否处于多选模式（有勾选即进入；手动点「多选」也进入）。 */
      selecting: false,
      /** 当前对话绑定的卡（C 模型的主题条）。null = 没绑定。存精简便签。 */
      activeCard: null,
      /** 捕获浮层里待上传的图片：`{ id, mediaType, dataUrl, name }[]`。 */
      pendingImages: [],
    })

    function useStore(selector) {
      const read = React.useCallback(() => {
        const snapshot = store.get()
        return selector === undefined ? snapshot : selector(snapshot)
      }, [selector])
      return React.useSyncExternalStore(store.subscribe, read, read)
    }

    // =======================================================================
    // 与 Host 通信
    // =======================================================================

    async function call(path, options) {
      const init = options === undefined ? {} : { ...options }
      if (init.body !== undefined && typeof init.body !== 'string') {
        init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
        init.body = JSON.stringify(init.body)
      }
      const response = await fetch(API + path, { cache: 'no-store', ...init })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok === false) {
        const reason = payload !== null && payload.error ? payload.error : `HTTP ${response.status}`
        throw new Error(reason)
      }
      return payload
    }

    /** 拉全量（或增量）。`since` 有效时只回 rev 更大的那些。 */
    async function refresh(options) {
      const since = options && options.since ? options.since : 0
      const trash = options && options.trash ? '1' : '0'
      const archive = options && options.archive ? '1' : '0'
      store.set({ phase: store.get().phase === 'ready' ? 'ready' : 'loading' })
      try {
        const data = await call(`/list?since=${since}&trash=${trash}&archive=${archive}`)
        store.set((state) => {
          if (archive === '1') {
            // 归档是独立视图，存到 archivedNotes，绝不污染主列表
            const archivedNotes = { ...state.archivedNotes }
            for (const note of data.notes) archivedNotes[note.id] = note
            return { archivedNotes, phase: 'ready', error: '' }
          }
          const notes = { ...state.notes }
          for (const note of data.notes) notes[note.id] = note
          // 回收站是另一个视图：只换掉已删除的那些，不动在用的
          if (trash === '1') {
            for (const id of Object.keys(notes)) if (notes[id].deleted === '') delete notes[id]
          }
          return { notes, phase: 'ready', error: '', maxRev: Math.max(state.maxRev, data.maxRev || 0) }
        })
      } catch (error) {
        store.set({ phase: 'error', error: error.message || String(error) })
      }
    }

    /** 拉一条全文（详情用）。列表里只有 preview。 */
    async function fetchNote(id) {
      const data = await call(`/get?id=${encodeURIComponent(id)}`)
      return data.note
    }

    /** 保存一条。先关浮层再写盘 —— 用户按下保存后不该等任何东西。 */
    async function capture(input) {
      const data = await call('/capture', { method: 'POST', body: input })
      const similar = Array.isArray(data.similar) ? data.similar : []

      // 图先随捕获一起提交（noteId 有了才能传）。传图失败不影响文字已保存。
      if (store.get().pendingImages.length > 0) {
        try {
          await uploadPendingImages(data.note.id)
          const refreshed = await call(`/get?id=${encodeURIComponent(data.note.id)}`)
          data.note = refreshed.note
        } catch {
          /* 文字已经存好了，图失败只是少几张图 */
        }
      }
      store.set((state) => ({
        notes: { ...state.notes, [data.note.id]: slimNote(data.note) },
        // T1 只提示、不自动合并：把相似条目挂出来，用户自己决定
        similar,
        similarFor: similar.length > 0 ? data.note.id : '',
      }))
      return data.note
    }

    /** 当前设置（store 里的副本，由 loadSettings 拉取）。 */
    function contextSettings() {
      return store.get().settings || { confirmBeforeDeliver: true }
    }

    /** 拉设置（提示开关等）。失败就保持默认，不影响其他功能。 */
    async function loadSettings() {
      try {
        const data = await call('/settings')
        if (data && data.settings) {
          store.set({ hints: data.settings.hints || store.get().hints, settings: data.settings })
        }
      } catch {
        /* 读不到设置就用默认值，不该挡住任何功能 */
      }
    }

    /** 拉投递候选（新开对话时一次带一组思路）。 */
    async function loadCandidates(id) {
      store.set({ deliverFor: id, deliverCandidates: [], deliverPicked: [] })
      try {
        const data = await call(`/candidates?id=${encodeURIComponent(id)}&limit=5`)
        const hits = Array.isArray(data.hits) ? data.hits : []
        store.set((state) => ({
          deliverCandidates: hits,
          // 默认全不选：用户自己挑，不替他决定
          deliverPicked: [],
        }))
      } catch {
        store.set({ deliverCandidates: [] })
      }
    }

    /**
     * 导出全部为单个 Markdown 文件并触发下载。
     *
     * 为什么是单文件而不是 zip：用户的目的是「带走」，单个 .md 在任何编辑器、
     * 任何笔记软件里都能直接打开；zip 还得先解压，多一步就少一半人会做。
     */
    async function exportAll() {
      try {
        const data = await call('/export')
        const notes = Array.isArray(data.notes) ? data.notes : []
        if (notes.length === 0) {
          notify('还没有便签可导出')
          return
        }

        const parts = [`# 随手贴导出 · ${new Date().toLocaleString()}\n`, `共 ${notes.length} 条\n`]
        for (const note of notes) {
          const title = note.aiTitle || String(note.text || '').split(/\r?\n/)[0].slice(0, 40) || '（无标题）'
          parts.push('\n---\n')
          parts.push(`## ${title}\n`)
          parts.push(
            `> ${note.category} · ${note.created}${note.aiState === 'done' ? ' · +AI' : ''}\n`,
          )
          parts.push(note.text)
          if (Array.isArray(note.aiPoints) && note.aiPoints.length > 0) {
            parts.push('\n**AI 补全**')
            for (const item of note.aiPoints) parts.push(`- ${item}`)
          }
          if (Array.isArray(note.aiTodos) && note.aiTodos.length > 0) {
            parts.push('\n**待办**')
            for (const item of note.aiTodos) parts.push(`- [ ] ${item}`)
          }
        }

        const blob = new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `stickynote-${new Date().toISOString().slice(0, 10)}.md`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        setTimeout(() => URL.revokeObjectURL(url), 5000)

        notify(`已导出 ${notes.length} 条`)
      } catch (error) {
        notify(`导出失败：${error && error.message ? error.message : String(error)}`)
      }
    }

    /**
     * 导入。
     *
     * 只收两种：
     *   ① 我们导出的 `.md`（有 frontmatter，按 `id` 跳过已存在）
     *   ② 纯文本（一段一条，或者整个文件是一条）
     *
     * 导入**永远新建**（不覆盖同 id）—— 覆盖会丢数据，合并语义又太容易猜错。
     * 结果用一句话说清楚：进了几条、跳过几条。
     */
    async function importNotes() {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown,.txt,.json'
      input.onchange = async () => {
        const file = input.files && input.files[0]
        if (file === null || file === undefined) return
        let text = ''
        try {
          text = await file.text()
        } catch {
          notify('读不到这个文件')
          return
        }
        if (text.trim() === '') {
          notify('文件是空的')
          return
        }

        let result
        try {
          result = await call('/import', { method: 'POST', body: { text: text } })
        } catch (failure) {
          notify(`导入失败：${failure.message || failure}`)
          return
        }
        await refresh()
        const skipped = result.skipped !== undefined ? result.skipped : 0
        notify(
          skipped > 0
            ? `导入完成：新增 ${result.created} 条，跳过 ${skipped} 条（空内容）`
            : `导入完成：新增 ${result.created} 条`,
        )
      }
      input.click()
    }

    // -----------------------------------------------------------------------
    // 批量操作
    // -----------------------------------------------------------------------

    /** 切换一条的勾选状态。 */
    function toggleSelect(id) {
      store.set((state) => {
        const selected = new Set(state.selected)
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        return { selected, selecting: selected.size > 0 }
      })
    }

    /** 全选当前可见列表（传 visible 数组）。 */
    function selectAll(visible) {
      store.set((state) => {
        const selected = new Set(visible.map((note) => note.id))
        return { selected, selecting: selected.size > 0 }
      })
    }

    /** 清空选择。 */
    function clearSelection() {
      store.set({ selected: new Set(), selecting: false })
    }

    /**
     * 批量归档 / 取消归档 / 删除。
     *
     * 逐条串行调用 `/update`，失败也继续下一条，最后一次性刷新 + 报告。
     * 不搞「半途而废」：一条失败不该让剩下的都不动。
     */
    async function batchUpdate(ids, patch, actionLabel) {
      if (ids.length === 0) return
      let ok = 0
      let fail = 0
      for (const id of ids) {
        try {
          await call('/update', { method: 'POST', body: { id, patch } })
          ok += 1
        } catch {
          fail += 1
        }
      }
      clearSelection()
      await refresh()
      notify(`${actionLabel}：成功 ${ok} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`)
    }

    /**
     * 批量软删除（进回收站）。
     *
     * 软删除不是彻底删 —— 进回收站，可恢复。批量删除必须逐个调用 `/remove`，
     * 因为它会写 `deleted` 时间戳、rev+1、广播 SSE，不能简单 update。
     */
    async function batchRemove(ids) {
      if (ids.length === 0) return
      let ok = 0
      let fail = 0
      for (const id of ids) {
        try {
          await call('/remove', { method: 'POST', body: { id } })
          ok += 1
        } catch {
          fail += 1
        }
      }
      clearSelection()
      await refresh()
      notify(`已移入回收站：${ok} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`)
    }

    function slimNote(note) {
      return {
        id: note.id,
        rev: note.rev,
        created: note.created,
        updated: note.updated,
        source: note.source,
        category: note.category,
        categorySource: note.categorySource,
        tags: note.tags || [],
        aiState: note.aiState,
        aiTitle: note.aiTitle || '',
        aiConf: note.aiConf || 0,
        aiModel: note.aiModel || '',
        aiBasedOnRev: note.aiBasedOnRev || 0,
        aiDueHint: note.aiDueHint || '',
        aiMergeHint: note.aiMergeHint || '',
        pinned: !!note.pinned,
        archived: !!note.archived,
        deleted: note.deleted || '',
        attachmentCount: (note.attachments || []).length,
        deliveredCount: (note.delivered || []).length,
        preview: String(note.text || '').replace(/\s+/g, ' ').slice(0, 120),
        broken: !!note.broken,
      }
    }

    // =======================================================================
    // SSE：多标签同步
    // =======================================================================

    let eventSource = null
    let pollTimer = null

    function startLive() {
      if (eventSource !== null) return
      try {
        eventSource = new EventSource(API + '/events')
      } catch {
        eventSource = null
        startPolling()
        return
      }
      eventSource.addEventListener('note', (event) => {
        let payload = null
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        if (payload === null) return
        const current = store.get().notes[payload.id]
        // rev 守卫：旧数据不许盖新数据
        if (current !== undefined && payload.op !== 'deleted' && current.rev >= payload.rev) return
        if (payload.op === 'deleted') {
          store.set((state) => {
            const notes = { ...state.notes }
            delete notes[payload.id]
            return { notes }
          })
          return
        }
        // 只拿到 id / rev，不值得猜内容 —— 直接增量拉
        refresh({ since: Math.max(0, payload.rev - 1) })
      })
      eventSource.addEventListener('open', () => store.set({ live: true }))
      eventSource.addEventListener('error', () => {
        store.set({ live: false })
        // EventSource 会自己重连；同时挂一条轮询兜底，防止反代把长连接掐死
        startPolling()
      })
    }

    function startPolling() {
      if (pollTimer !== null) return
      pollTimer = setInterval(() => {
        const state = store.get()
        if (state.live) {
          clearInterval(pollTimer)
          pollTimer = null
          return
        }
        refresh({ since: state.maxRev })
      }, 5000)
    }

    // =======================================================================
    // 图标状态：五档
    // =======================================================================

    /**
     * 汇总出一个视觉档位。
     *
     * 多个来源同时成立时取**最高的那一档**（urgent > attention > busy > new > idle），
     * 保证「有急事」不会被「有新东西」压下去。
     */
    function alertStateOf(state) {
      const list = Object.values(state.notes)
      let level = 'idle'
      let count = 0

      const bump = (next) => {
        if (levelRank(next) > levelRank(level)) level = next
      }

      for (const note of list) {
        if (note.deleted !== '') continue
        if (note.archived) continue

        if (note.aiState === 'pending' || note.aiState === 'running') {
          bump('busy')
          continue
        }

        // 整理好了但还没用过 —— 这是产品的转化漏斗，也是唯一值得提醒的日常状态
        if (note.aiState === 'done' && note.deliveredCount === 0) {
          count += 1
          bump('attention')
        }
      }

      // 已知简化：`due_hint` 是自然语言（"明天下午"），还没有解析成绝对时间，
      // 所以这里不按"已过期"抬到 urgent。等 §5.4 T2 的提醒落地时再接上。
      return { level, count }
    }

    // =======================================================================
    // 样式
    // =======================================================================

    const CSS = `
.sn-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0}
.sn-icon svg{display:block;overflow:visible}
.sn-icon .sn-glyph{stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;transition:opacity .25s ease}
.sn-badge{position:absolute;top:-3px;right:-4px;min-width:8px;height:8px;padding:0 2px;border-radius:6px;font-size:9px;line-height:8px;font-weight:600;color:#fff;background:var(--dsw-alias-label-secondary,#8a8f98);box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#fff);box-sizing:content-box;text-align:center}
.sn-icon--new .sn-badge{background:var(--dsw-alias-label-secondary,#8a8f98)}
.sn-icon--attention .sn-badge{background:#d69e2e}
.sn-icon--urgent .sn-badge{background:#e53e3e}
.sn-icon--attention .sn-glyph{animation:sn-pulse 2s ease-in-out infinite}
.sn-icon--urgent .sn-glyph{animation:sn-flash .8s ease-in-out infinite}
.sn-icon--busy .sn-glyph{opacity:.55}
@keyframes sn-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes sn-flash{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.06)}}
@media (prefers-reduced-motion: reduce){.sn-icon--attention .sn-glyph,.sn-icon--urgent .sn-glyph{animation:none}}
.sn-icon--attention .sn-glyph,.sn-icon--urgent .sn-glyph{will-change:opacity}

/* 捕获浮层 */
.sn-scrim{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;background:rgba(0,0,0,.32);backdrop-filter:blur(2px)}
.sn-cap{width:min(560px,92vw);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;font-size:13px;box-sizing:border-box}
.sn-cap-head{display:flex;align-items:center;gap:8px;padding:12px 14px 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-cap textarea{display:block;width:100%;box-sizing:border-box;border:0;outline:none;resize:none;padding:8px 14px 12px;font:inherit;font-size:14px;line-height:1.6;background:transparent;color:inherit;min-height:88px;max-height:40vh}
.sn-cap-foot{display:flex;align-items:center;gap:8px;padding:8px 12px 12px;justify-content:flex-end}
.sn-btn{border:1px solid var(--dsw-alias-border-l2,#d7dae0);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}
.sn-btn:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sn-btn--primary{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:transparent;color:#fff}
.sn-btn--primary:hover{filter:brightness(.95)}
.sn-hint{margin-right:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}

/* 主面板 */
.sn-root{display:flex;width:100%;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-size:13px}
.sn-col{display:flex;flex-direction:column;min-height:0;min-width:0}
.sn-col--left{width:180px;flex:0 0 auto;border-right:1px solid var(--dsw-alias-border-l2,#e5e7eb);padding:10px 8px;gap:2px;overflow:auto}
.sn-col--mid{flex:1 1 auto;border-right:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.sn-col--right{width:280px;flex:0 0 auto;padding:12px;overflow:auto}
.sn-search{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.sn-search input{flex:1 1 auto;border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;background:transparent;color:inherit;outline:none}
.sn-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex-wrap:wrap}
.sn-tab{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
.sn-tab--on{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#111);border-color:var(--dsw-alias-border-l2,#e5e7eb)}
.sn-list{flex:1 1 auto;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.sn-batchbar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 6%,transparent);flex-wrap:wrap}
.sn-batch-count{font-size:11.5px;font-weight:600;margin-right:2px}
.sn-act--danger{color:#e53e3e;border-color:color-mix(in srgb,#e53e3e 40%,transparent)}
.sn-act--danger:hover{background:color-mix(in srgb,#e53e3e 8%,transparent);border-color:#e53e3e}
.sn-card--selecting{cursor:pointer}
.sn-card-check{flex:0 0 auto;margin:0}
.sn-cat{display:flex;align-items:center;justify-content:space-between;gap:6px;border:0;background:transparent;color:inherit;border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;cursor:pointer;text-align:left}
.sn-cat:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sn-cat--on{background:var(--dsw-alias-bg-layer-2,#f3f4f6);font-weight:600}
.sn-cat-count{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-variant-numeric:tabular-nums}
.sn-cat-sep{height:1px;margin:6px 4px;background:var(--dsw-alias-border-l2,#e5e7eb)}

/* 卡片 */
.sn-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.sn-card:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6)}
.sn-card--on{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent)}
.sn-card-head{display:flex;align-items:center;gap:6px}
.sn-card-title{flex:1 1 auto;font-weight:600;font-size:13px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sn-ai{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.02em;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 12%,transparent);color:var(--dsw-alias-brand-primary,#3b82f6)}
.sn-ai--stale{background:color-mix(in srgb,#d69e2e 16%,transparent);color:#b7791f}
.sn-ai--busy{background:color-mix(in srgb,var(--dsw-alias-label-secondary,#6b7280) 14%,transparent);color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-card-text{margin-top:4px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#4b5563);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sn-meta{margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-chip{padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sn-chip--action{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);cursor:pointer;color:inherit;font:inherit;font-size:11px;background:transparent}
.sn-chip--category{border:1px dashed var(--dsw-alias-border-l2,#e5e7eb);cursor:pointer;color:inherit;font:inherit;font-size:11px;background:transparent}
.sn-chip--category:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6);color:var(--dsw-alias-brand-primary,#3b82f6)}
.sn-chip--action:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6);color:var(--dsw-alias-brand-primary,#3b82f6)}
.sn-actions{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
.sn-act{border:1px solid var(--dsw-alias-border-l2,#d7dae0);background:transparent;color:inherit;border-radius:7px;padding:3px 9px;font:inherit;font-size:11px;cursor:pointer}
.sn-act:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sn-act--primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#3b82f6);color:#fff}
.sn-act--primary:hover{filter:brightness(.95)}
/* 命运主按钮：按命运类型着色 */
.sn-act--fate{font-weight:600;flex:1 1 auto;text-align:center}
.sn-act--fate-deepen{border-color:transparent;background:var(--dsw-alias-brand-primary,#3b82f6);color:#fff}
.sn-act--fate-deepen:hover{filter:brightness(.95)}
.sn-act--fate-execute{border-color:color-mix(in srgb,#d69e2e 50%,transparent);background:color-mix(in srgb,#d69e2e 12%,transparent);color:#b7791f}
.sn-act--fate-execute:hover{border-color:#d69e2e}
.sn-act--fate-reference{border-color:color-mix(in srgb,#8b5cf6 50%,transparent);background:color-mix(in srgb,#8b5cf6 12%,transparent);color:#6d28d9}
.sn-act--fate-reference:hover{border-color:#8b5cf6}
.sn-act--fate-show{border-color:var(--dsw-alias-border-l2,#d7dae0);background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:inherit}
.sn-act--fate-show:hover{filter:brightness(.97)}

/* 详情 */
.sn-detail-title{font-size:13px;font-weight:600;margin:0 0 8px}
.sn-detail-sec{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.sn-detail-sec h4{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);letter-spacing:.02em}
.sn-detail textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:8px;padding:8px;font:inherit;font-size:12px;line-height:1.6;background:transparent;color:inherit;resize:vertical;min-height:90px;outline:none}
.sn-list-plain{margin:0;padding-left:16px;font-size:12px;line-height:1.7}
/* 语音 */
.sn-voice-btn{display:inline-flex;align-items:center;gap:5px;margin-left:auto;border:1px solid var(--dsw-alias-border-l2,#d7dae0);background:transparent;color:inherit;border-radius:999px;padding:3px 10px;font:inherit;font-size:11px;cursor:pointer}
.sn-voice-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.sn-voice-btn:disabled{opacity:.5;cursor:default}
.sn-voice-btn--on{border-color:#e53e3e;color:#e53e3e}
.sn-voice-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}
.sn-voice-btn--on .sn-voice-dot{animation:sn-rec 1s ease-in-out infinite}
@keyframes sn-rec{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.sn-voice-btn--on .sn-voice-dot{animation:none}}
.sn-wave{display:flex;align-items:flex-end;gap:2px;height:26px;padding:0 14px 6px;overflow:hidden}
.sn-wave-bar{flex:1 1 auto;min-width:2px;max-width:6px;border-radius:2px;background:var(--dsw-alias-brand-primary,#3b82f6);opacity:.75;transition:height .06s linear}
/* 设置页 */
.sn-settings{max-width:640px;padding:4px 2px 24px;font-size:13px}
.sn-set-h{margin:18px 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);letter-spacing:.02em}
.sn-set-h:first-child{margin-top:4px}
.sn-set-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fff)}
.sn-set-row{display:flex;gap:9px;align-items:flex-start;padding:7px 0;cursor:pointer}
.sn-set-row input{margin-top:2px;flex:0 0 auto}
.sn-set-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.sn-set-label{font-size:12.5px}
.sn-set-hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-set-info{display:flex;gap:12px;padding:4px 0;font-size:12px;align-items:baseline}
.sn-set-info-k{flex:0 0 74px;color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-set-info-v{flex:1 1 auto;min-width:0;word-break:break-all}
.sn-set-note{padding:6px 0;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary,#6b7280)}
.sn-set-actions{display:flex;gap:8px;align-items:center;padding-top:8px;flex-wrap:wrap}
.sn-set-input{flex:1 1 auto;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:7px;padding:4px 8px;font:inherit;font-size:12px;background:transparent;color:inherit;outline:none}
.sn-set-tags{display:flex;gap:6px;flex-wrap:wrap;padding:6px 0}
.sn-set-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);font-size:11.5px}
.sn-set-tag-x{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;font-size:13px;line-height:1;padding:0 1px}
.sn-set-tag-x:hover{color:#e53e3e}
/* 图片 */
.sn-shots{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px 4px}
.sn-shots--view{padding:4px 0}
.sn-shot{position:relative;display:inline-block;width:56px;height:56px;border-radius:6px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex:0 0 auto}
.sn-shots--view .sn-shot{width:72px;height:72px;cursor:zoom-in}
.sn-shot img{width:100%;height:100%;object-fit:cover;display:block}
.sn-shot-x{position:absolute;top:0;right:0;border:0;background:rgba(0,0,0,.55);color:#fff;width:16px;height:16px;line-height:1;font-size:12px;cursor:pointer;padding:0;border-radius:0 0 0 6px}
.sn-shot-x:hover{background:#e53e3e}
/* 对话主题条 */
.sn-topic{display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 3px rgba(0,0,0,.05)}
.sn-topic-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary,#3b82f6);margin-top:5px}
.sn-topic-body{flex:1 1 auto;min-width:0}
.sn-topic-title{font-size:13px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sn-topic-meta{display:flex;align-items:center;gap:6px;margin-top:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);flex-wrap:wrap}
.sn-topic-hint{font-style:italic}
.sn-topic-close{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
.sn-topic-close:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:#e53e3e}
.sn-empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.8}
.sn-banner{margin:8px 10px 0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 8%,transparent);font-size:12px;display:flex;align-items:center;gap:8px}
.sn-banner-close{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
`

    function installStyles() {
      if (typeof document === 'undefined') return
      const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (existing !== null) {
        existing.dataset.plugin = PACKAGE
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = PACKAGE
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // =======================================================================
    // 图标（三个入口共用同一个组件体）
    // =======================================================================

    /** 便签纸 glyph：折角的一页纸。描边走 currentColor，动画靠 CSS。 */
    function Glyph({ size }) {
      return React.createElement(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false },
        React.createElement('path', {
          className: 'sn-glyph',
          d: 'M5 3.5h9.5L19 8v12.5H5z M14.5 3.5V8H19',
        }),
        React.createElement('path', { className: 'sn-glyph', d: 'M8 12.5h8 M8 16h5' }),
      )
    }

    /**
     * 侧栏图标。
     *
     * `sidebar.panellist` 的 owner props 只有 `size` 和 `active`，没有角标位，
     * 所以状态视觉全部画在我们自己的 wrapper 里。
     */
    function SidebarIcon(props) {
      const size = props && props.size ? props.size : 16
      const alert = useStore(alertStateOf)
      return React.createElement(
        'span',
        { className: `sn-icon sn-icon--${alert.level}` },
        React.createElement(Glyph, { size }),
        alert.count > 0
          ? React.createElement('span', { className: 'sn-badge' }, alert.count > 99 ? '99' : String(alert.count))
          : null,
      )
    }

    /** 对话顶部按钮：同一个组件体，只是外面套一层可点按钮。 */
    function HeaderButton() {
      const alert = useStore(alertStateOf)
      return React.createElement(
        'button',
        {
          type: 'button',
          className: `sn-icon sn-icon--${alert.level}`,
          title: '随手贴：单击新建，双击浏览',
          'aria-label': '打开随手贴',
          style: {
            border: 0,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
          },
          onClick: (event) => {
            event.preventDefault()
            openCapture()
          },
          onDoubleClick: (event) => {
            event.preventDefault()
            openPanel()
          },
        },
        React.createElement(Glyph, { size: 16 }),
        alert.count > 0
          ? React.createElement('span', { className: 'sn-badge' }, alert.count > 99 ? '99' : String(alert.count))
          : null,
      )
    }

    // =======================================================================
    // 打开面板 / 打开捕获
    // =======================================================================

    /** 客户端 ctx，apply 时记下来，供服务查找。 */
    let clientCtx = null

    /**
     * 读一个可选客户端服务。
     *
     * Cordis 对未在 inject 里声明的服务直接取属性会抛，而 `ctx.get(name)` 返回 undefined，
     * 所以先走 get 再回退属性访问（quicknote 也是这么处理的）。
     */
    function service(name) {
      if (clientCtx === null) return undefined
      try {
        const resolved = typeof clientCtx.get === 'function' ? clientCtx.get(name) : undefined
        if (resolved !== undefined) return resolved
      } catch {
        /* 未声明的服务会抛，继续走回退 */
      }
      try {
        return clientCtx[name]
      } catch {
        return undefined
      }
    }

    /** 打开主面板（浏览全部）。`layout.selectPanel` 是 sticky-wall 验证过的路径。 */
    function openPanel() {
      const layout = service('layout')
      if (layout && typeof layout.selectPanel === 'function') {
        try {
          layout.selectPanel(PANEL_ID)
          return
        } catch {
          /* 回退到下一条 */
        }
      }
      // 没有 layout 服务时，至少把浮层打开，让用户有地方去
      store.set({ captureOpen: false, selectedId: store.get().selectedId })
    }

    /** 打开捕获浮层。 */
    function openCapture() {
      store.set({ captureOpen: true })
    }

    // =======================================================================
    // 捕获浮层
    // =======================================================================

    function CaptureDialog() {
      const open = useStore((state) => state.captureOpen)
      const recording = useStore((state) => state.voiceRecording)
      const transcribing = useStore((state) => state.voiceTranscribing)
      const levels = useStore((state) => state.voiceLevels)
      const blocked = useStore((state) => state.voiceBlocked)
      const phase = useStore((state) => state.voicePhase)
      const pending = useStore((state) => state.pendingImages)

      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const areaRef = React.useRef(null)
      /** 当前录音会话（不进 store，它是有生命周期的对象）。 */
      const sessionRef = React.useRef(null)
      /** 打开时探一次的语音能力。 */
      const speechRef = React.useRef(null)

      const close = React.useCallback(() => store.set({ captureOpen: false }), [])

      // 每次打开：清空、聚焦、探语音
      React.useEffect(() => {
        if (!open) {
          // 关掉时把还在录的录音取消掉，避免麦克风一直开着
          if (sessionRef.current !== null) {
            try {
              sessionRef.current.cancel()
            } catch {
              /* 丢弃即可 */
            }
            sessionRef.current = null
          }
          store.set({ voiceRecording: false, voiceLevels: [], voiceTranscribing: false })
          return
        }

        setText('')
        setError('')
        setBusy(false)
        store.set({ pendingImages: [] })

        const controller = service('speechController')
        const speech = inspectSpeech(controller)
        speechRef.current = speech

        if (controller === undefined || controller === null) {
          store.set({ voiceBlocked: '没装语音输入（voice-input-bundle）', voicePhase: '' })
        } else if (speech === null) {
          store.set({ voiceBlocked: '没有可用的语音识别器', voicePhase: '' })
        } else if (speech.ready) {
          store.set({ voiceBlocked: '', voicePhase: speech.phase })
        } else {
          store.set({
            voiceBlocked:
              speech.phase === 'downloading' || speech.phase === 'loading' || speech.phase === 'checking'
                ? '语音模型准备中…'
                : '语音模型还没准备好',
            voicePhase: speech.phase,
          })
        }

        const timer = setTimeout(() => {
          if (areaRef.current !== null) areaRef.current.focus()
        }, 30)
        return () => clearTimeout(timer)
      }, [open])

      const save = React.useCallback(async () => {
        const value = text.trim()
        if (value === '' || busy) return
        if (sessionRef.current !== null) {
          try {
            sessionRef.current.cancel()
          } catch {
            /* 忽略 */
          }
          sessionRef.current = null
        }
        setBusy(true)
        setError('')
        // 先关浮层再等写盘：用户按下保存后不该盯着一个转圈
        close()
        try {
          await capture({ text: value, source: 'text' })
        } catch (failure) {
          // 写失败就把内容还给用户，绝不静默丢掉
          store.set({ captureOpen: true })
          setText(value)
          setError(failure.message || String(failure))
        } finally {
          setBusy(false)
        }
      }, [text, busy, close])

      /** 开始录音。 */
      const startRecording = React.useCallback(async () => {
        const controller = service('speechController')
        const speech = inspectSpeech(controller)

        if (speech === null || !speech.ready) {
          // 就地准备，把用户留在浮层里
          if (controller !== undefined && controller !== null && speech !== null && speech.needsPrepare) {
            try {
              controller.prepare(speech.providerId, undefined)
              store.set({ voiceBlocked: '正在准备语音模型…', voicePhase: 'loading' })
            } catch {
              store.set({ voiceBlocked: '准备语音模型失败' })
            }
          }
          return
        }

        try {
          const instance = Capture()
          await instance.start((failure) => {
            store.set({ voiceBlocked: recordingErrorText(failure && failure.kind ? failure.kind : 'unknown') })
            store.set({ voiceRecording: false })
          })

          store.set({ voiceRecording: true, voiceLevels: [], voiceBlocked: '' })

          // 电平采样 + 软上限（与 lib/voice.js 同一套规则）
          let collected = []
          const levelTimer = setInterval(() => {
            let value = 0
            try {
              value = Number(instance.amplitude()) || 0
            } catch {
              value = 0
            }
            collected = [...collected, Math.max(0, Math.min(1, value))].slice(-48)
            store.set({ voiceLevels: collected })
          }, 60)

          const cap = Math.min(Number(speech.maxDurationSeconds) || 60, 60)
          const limitTimer = setTimeout(() => {
            void stopRecording()
          }, cap * 1000)

          sessionRef.current = {
            instance,
            cancel() {
              clearInterval(levelTimer)
              clearTimeout(limitTimer)
              try {
                void instance.stop(speech.maxDurationSeconds || 60)
              } catch {
                /* 丢弃 */
              }
            },
            async stop() {
              clearInterval(levelTimer)
              clearTimeout(limitTimer)
              return instance.stop(speech.maxDurationSeconds || 60)
            },
          }
        } catch (failure) {
          store.set({
            voiceRecording: false,
            voiceBlocked: recordingErrorText(failure && failure.kind ? failure.kind : 'unknown'),
          })
        }
      }, [])

      /** 停止录音并转写，结果追加进输入框（用户可继续改）。 */
      const stopRecording = React.useCallback(async () => {
        const session = sessionRef.current
        const controller = service('speechController')
        const speech = inspectSpeech(controller)
        store.set({ voiceRecording: false })

        if (session === null || speech === null) return

        store.set({ voiceTranscribing: true })
        try {
          const wav = await session.stop()
          sessionRef.current = null

          if (wav === undefined || wav === null || (wav.length !== undefined && wav.length === 0)) {
            store.set({ voiceBlocked: recordingErrorText('empty') })
            return
          }

          const transcript = await controller.transcribe(
            { audioBase64: toBase64(wav), providerId: speech.providerId, language: speech.language },
            new AbortController().signal,
          )
          const said = transcript && typeof transcript.text === 'string' ? transcript.text.trim() : ''

          if (said === '') {
            store.set({ voiceBlocked: '没听清，再说一次？' })
            return
          }

          // 语音结果落进输入框，用户接着改 —— 这是最省事的路径
          setText((current) => (current.trim() === '' ? said : `${current.replace(/\s+$/, '')} ${said}`))
          store.set({ voiceBlocked: '' })
        } catch (failure) {
          store.set({ voiceBlocked: failure && failure.message ? `识别失败：${failure.message}` : '识别失败' })
        } finally {
          store.set({ voiceTranscribing: false })
        }
      }, [])

      const onKeyDown = React.useCallback(
        (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            save()
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        },
        [save, close],
      )

      if (!open) return null

      const voiceDisabled = transcribing || busy
      const voiceLabel = recording
        ? '停止'
        : transcribing
          ? '识别中…'
          : blocked !== '' && phase !== '' && (phase === 'unprepared' || phase === 'failed')
            ? '准备语音'
            : '按住说话'

      const onVoiceClick = () => {
        if (voiceDisabled) return
        if (recording) {
          void stopRecording()
          return
        }
        void startRecording()
      }

      return React.createElement(
        'div',
        {
          className: 'sn-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        React.createElement(
          'div',
          { className: 'sn-cap', role: 'dialog', 'aria-label': '新建随手贴' },
          React.createElement(
            'div',
            { className: 'sn-cap-head' },
            React.createElement('span', null, '记一条'),
            React.createElement(
              'button',
              {
                type: 'button',
                className: `sn-voice-btn${recording ? ' sn-voice-btn--on' : ''}`,
                onClick: onVoiceClick,
                disabled: voiceDisabled,
                title: blocked !== '' ? blocked : '说话转成文字',
              },
              React.createElement('span', { className: 'sn-voice-dot' }),
              voiceLabel,
            ),
          ),

          // 波形：只有录音/识别时占位，平时不占空间
          recording || transcribing
            ? React.createElement(
                'div',
                { className: 'sn-wave' },
                ...(levels.length === 0 ? [0.1, 0.1, 0.1] : levels.slice(-32)).map((value, index) =>
                  React.createElement('span', {
                    key: index,
                    className: 'sn-wave-bar',
                    style: { height: `${Math.max(6, Math.round(value * 100))}%` },
                  }),
                ),
              )
            : null,

          // 待上传的图片缩略图
          pending.length > 0
            ? React.createElement(
                'div',
                { className: 'sn-shots' },
                ...pending.map((image) =>
                  React.createElement(
                    'span',
                    { key: image.id, className: 'sn-shot' },
                    React.createElement('img', { src: image.dataUrl, alt: image.name || '待上传图片' }),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'sn-shot-x',
                        title: '移掉这张',
                        onClick: () =>
                          store.set((state) => ({ pendingImages: state.pendingImages.filter((item) => item.id !== image.id) })),
                      },
                      '×',
                    ),
                  ),
                ),
              )
            : null,

          React.createElement('textarea', {
            ref: areaRef,
            value: text,
            placeholder: transcribing ? '正在识别…' : '现在想到的…（⌘↵ 保存，Esc 取消，可直接粘贴截图）',
            onChange: (event) => setText(event.target.value),
            onKeyDown,
            onPaste: (event) => {
              // 粘贴截图：剪贴板里的图片文件
              const items = event.clipboardData ? event.clipboardData.items : null
              if (items === null || items === undefined) return
              const files = []
              for (const item of items) {
                if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
                  const file = item.getAsFile()
                  if (file !== null) files.push(file)
                }
              }
              if (files.length === 0) return
              event.preventDefault()
              for (const file of files) void addImageFile(file)
            },
            onDrop: (event) => {
              const files = event.dataTransfer ? event.dataTransfer.files : null
              if (files === null || files === undefined || files.length === 0) return
              event.preventDefault()
              for (const file of files) {
                if (String(file.type || '').startsWith('image/')) void addImageFile(file)
              }
            },
            onDragOver: (event) => {
              event.preventDefault()
            },
          }),

          blocked !== ''
            ? React.createElement(
                'div',
                { style: { padding: '0 14px 8px', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
                blocked,
              )
            : null,

          error !== ''
            ? React.createElement(
                'div',
                { style: { padding: '0 14px 8px', fontSize: 11, color: '#e53e3e' } },
                error,
              )
            : null,

          React.createElement(
            'div',
            { className: 'sn-cap-foot' },
            React.createElement('span', { className: 'sn-hint' }, busy ? '保存中…' : `${text.length} 字`),
            React.createElement('button', { type: 'button', className: 'sn-btn', onClick: close }, '取消'),
            React.createElement(
              'button',
              { type: 'button', className: 'sn-btn sn-btn--primary', onClick: save, disabled: busy || text.trim() === '' },
              '保存',
            ),
          ),
        ),
      )
    }

    // =======================================================================
    // T1 相似提示条
    // =======================================================================

    /**
     * 保存后发现相似条目时弹一条。
     *
     * **只提示，绝不自动合并** —— 自动合并会丢数据，且用户会觉得系统在替他做主。
     * 「看看」跳到那条的详情，「知道了」关掉。
     */
    function SimilarBar() {
      const similar = useStore((state) => state.similar)
      const forId = useStore((state) => state.similarFor)
      const hints = useHints()
      if (hints.t1Duplicate === false) return null
      if (similar.length === 0 || forId === '') return null

      const first = similar[0]
      return React.createElement(
        'div',
        { className: 'sn-banner', style: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 24, zIndex: 70, width: 'min(560px, 92vw)', boxShadow: '0 10px 30px rgba(0,0,0,.18)' } },
        React.createElement('span', null, `这张可能和「${first.title}」讲的是同一件事`),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'sn-act',
            onClick: () => {
              store.set({ selectedId: first.id, similar: [], similarFor: '' })
              openPanel()
            },
          },
          '看看',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'sn-banner-close',
            onClick: () => store.set({ similar: [], similarFor: '' }),
            'aria-label': '关闭',
          },
          '×',
        ),
      )
    }

    // =======================================================================
    // 投递候选（新开对话：一次带一组思路）
    // =======================================================================

    /**
     * 点「新开对话」先出这个：列出相关条目让用户勾。
     *
     * 默认全不选 —— 不替用户决定带什么，但把相关的排到眼前。
     * 这是「一次带走一组思路」的落点（设计文档 §4.6）。
     */
    function DeliverDialog() {
      const forId = useStore((state) => state.deliverFor)
      const candidates = useStore((state) => state.deliverCandidates)
      const picked = useStore((state) => state.deliverPicked)

      if (forId === '') return null

      const close = () => store.set({ deliverFor: '', deliverCandidates: [], deliverPicked: [] })

      const toggle = (id) => {
        store.set((state) => {
          const has = state.deliverPicked.indexOf(id) !== -1
          return {
            deliverPicked: has
              ? state.deliverPicked.filter((item) => item !== id)
              : [...state.deliverPicked, id],
          }
        })
      }

      const go = async () => {
        close()
        await deliverToNew(forId, picked)
      }

      return React.createElement(
        'div',
        { className: 'sn-scrim', onMouseDown: (event) => { if (event.target === event.currentTarget) close() } },
        React.createElement(
          'div',
          { className: 'sn-cap', role: 'dialog', 'aria-label': '新开对话' },
          React.createElement(
            'div',
            { className: 'sn-cap-head' },
            '新开对话，要一起带上哪些思路？',
          ),
          React.createElement(
            'div',
            { style: { padding: '0 14px 4px', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
            '会开一个新会话，并把这些内容作为第一条消息发进去。',
          ),
          candidates.length === 0
            ? React.createElement('div', { className: 'sn-empty', style: { padding: '12px 14px' } }, '没有找到相关条目，只带这一条')
            : React.createElement(
                'div',
                { style: { padding: '4px 14px 8px', maxHeight: '40vh', overflow: 'auto' } },
                ...candidates.map((item) =>
                  React.createElement(
                    'label',
                    {
                      key: item.id,
                      style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer', fontSize: 12 },
                    },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: picked.indexOf(item.id) !== -1,
                      onChange: () => toggle(item.id),
                      style: { marginTop: 2 },
                    }),
                    React.createElement(
                      'span',
                      null,
                      React.createElement('span', { style: { fontWeight: 500 } }, item.title),
                      React.createElement(
                        'span',
                        { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)', marginLeft: 6 } },
                        item.category,
                      ),
                    ),
                  ),
                ),
              ),
          React.createElement(
            'div',
            { className: 'sn-cap-foot' },
            React.createElement('span', { className: 'sn-hint' }, picked.length > 0 ? `连这一条共 ${picked.length + 1} 条` : '只带这一条'),
            React.createElement('button', { type: 'button', className: 'sn-btn', onClick: close }, '取消'),
            React.createElement(
              'button',
              { type: 'button', className: 'sn-btn sn-btn--primary', onClick: go },
              picked.length > 0 ? `开新对话并发送 ${picked.length + 1} 条` : '开新对话并发送',
            ),
          ),
        ),
      )
    }

    // =======================================================================
    // 草稿冲突：三选一
    // =======================================================================

    /**
     * 输入框已经有内容时，投递必须先问。
     *
     * 这不是「多一步确认」的啰嗦 —— `setDraft` 会把用户正在写的三百字
     * 直接抹掉，且没有 undo。**默认按钮是「追加」，不是「替换」**：
     * 用户宁可事后多删，不可事前少存。
     */
    function DraftConflictDialog() {
      const conflict = useStore((state) => state.draftConflict)
      if (conflict === null) return null

      const close = () => store.set({ draftConflict: null })

      const commit = (mode) => {
        const sessionId = onScreenSession()
        const shell = composerOf(sessionId)
        if (shell === undefined) {
          notify('输入框不见了，这次没投进去')
          close()
          return
        }
        close()
        // 用一个最小 note 壳，只为了拿到 id 记投递
        applyDraft(shell, conflict.text, { id: conflict.noteId }, sessionId, mode)
      }

      return React.createElement(
        'div',
        { className: 'sn-scrim', onMouseDown: (event) => { if (event.target === event.currentTarget) close() } },
        React.createElement(
          'div',
          { className: 'sn-cap', role: 'dialog', 'aria-label': '投递到输入框' },
          React.createElement('div', { className: 'sn-cap-head' }, '输入框里已经有内容'),
          React.createElement(
            'div',
            { style: { padding: '4px 14px 6px', fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary,#4b5563)' } },
            `输入框里已有 ${conflict.draftLength} 字。要追加到末尾，还是整段替换掉？`,
            React.createElement('br'),
            React.createElement(
              'span',
              { style: { fontSize: 11, color: '#b7791f' } },
              '替换会丢掉你正在写的内容，且无法撤销。',
            ),
          ),
          React.createElement(
            'div',
            { style: { margin: '2px 14px 10px', maxHeight: '24vh', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
            conflict.text,
          ),
          React.createElement(
            'div',
            { className: 'sn-cap-foot' },
            React.createElement('button', { type: 'button', className: 'sn-btn', onClick: close }, '取消'),
            React.createElement(
              'button',
              { type: 'button', className: 'sn-btn', onClick: () => commit('replace') },
              '替换掉',
            ),
            React.createElement(
              'button',
              { type: 'button', className: 'sn-btn sn-btn--primary', onClick: () => commit('append') },
              '追加到后面',
            ),
          ),
        ),
      )
    }

    // =======================================================================
    // 设置页
    // =======================================================================
    //
    // 存在的理由：**插件出问题时用户只能翻日志。**
    // 这个页面把「数据在哪、AI 开没开、队列堵没堵、哪些提示开着」一次摆出来，
    // 后面所有排查都从这里开始，不用再问"你 store 路径是什么"。

    /** 设置页内的单行开关。 */
    function SettingRow({ label, hint, checked, onChange, disabled }) {
      return React.createElement(
        'label',
        { className: 'sn-set-row', style: { opacity: disabled ? 0.5 : 1 } },
        React.createElement('input', {
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        React.createElement(
          'span',
          { className: 'sn-set-text' },
          React.createElement('span', { className: 'sn-set-label' }, label),
          hint !== undefined && hint !== ''
            ? React.createElement('span', { className: 'sn-set-hint' }, hint)
            : null,
        ),
      )
    }

    /** 只读的一行键值。 */
    function SettingInfo({ label, value, mono }) {
      return React.createElement(
        'div',
        { className: 'sn-set-info' },
        React.createElement('span', { className: 'sn-set-info-k' }, label),
        React.createElement(
          'span',
          { className: 'sn-set-info-v', style: mono ? { fontFamily: 'ui-monospace, monospace', fontSize: 11 } : undefined },
          value,
        ),
      )
    }

    /**
     * 设置页。
     *
     * 挂在 `settings.section`（root scope 的 list 插槽），
     * 注册时 `id` / `order` / `label` 由 register 的选项给，组件只拿 `close`。
     */
    function SettingsPanel() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [newCategory, setNewCategory] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          const data = await call('/settings')
          setState(data)
          setError('')
        } catch (failure) {
          setError(failure.message || String(failure))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const save = React.useCallback(
        async (patch) => {
          setSaving(true)
          try {
            const data = await call('/settings', { method: 'POST', body: patch })
            // 用服务端返回的完整值覆盖本地，避免本地拼错
            setState((current) => (current === null ? current : { ...current, settings: data.settings }))
            setError('')
          } catch (failure) {
            setError(failure.message || String(failure))
          } finally {
            setSaving(false)
          }
        },
        [],
      )

      if (state === null) {
        return React.createElement(
          'div',
          { className: 'sn-settings' },
          React.createElement('div', { className: 'sn-empty' }, error !== '' ? `读不到设置：${error}` : '读取中…'),
          React.createElement('button', { type: 'button', className: 'sn-act', onClick: load }, '重试'),
        )
      }

      const { settings, runtime } = state
      const aiOff = runtime.ai === 'off'

      return React.createElement(
        'div',
        { className: 'sn-settings' },

        // ---- 运行时状态：排查从这里开始 ----
        React.createElement('h3', { className: 'sn-set-h' }, '状态'),
        React.createElement(
          'div',
          { className: 'sn-set-card' },
          React.createElement(SettingInfo, { label: '版本', value: runtime.version || '—' }),
          React.createElement(SettingInfo, { label: '数据目录', value: runtime.root, mono: true }),
          React.createElement(SettingInfo, { label: '便签条数', value: String(runtime.count) }),
          React.createElement(
            'div',
            { className: 'sn-set-info' },
            React.createElement('span', { className: 'sn-set-info-k' }, 'AI 整理'),
            React.createElement(
              'span',
              { className: 'sn-set-info-v' },
              aiOff
                ? React.createElement('span', { style: { color: '#b7791f' } }, '未启用（llm 服务不可用）')
                : React.createElement(
                    'span',
                    null,
                    '已启用',
                    runtime.running ? ' · 正在整理' : '',
                    runtime.queued > 0 ? ` · 队列 ${runtime.queued}` : ' · 队列空',
                  ),
            ),
          ),
          aiOff
            ? React.createElement(
                'div',
                { className: 'sn-set-note' },
                '没有 llm 服务时便签仍然能记、能搜、能投递，只是不会被整理，也没有 +AI 角标。',
              )
            : null,
          React.createElement(
            'div',
            { className: 'sn-set-actions' },
            React.createElement('button', { type: 'button', className: 'sn-act', onClick: load, disabled: saving }, '刷新状态'),
          ),
        ),

        // ---- 提示开关 ----
        React.createElement('h3', { className: 'sn-set-h' }, '提示'),
        React.createElement(
          'div',
          { className: 'sn-set-card' },
          React.createElement(SettingRow, {
            label: '重复/相似提示',
            hint: '保存时发现相似条目会提示。只提示，不会自动合并。',
            checked: settings.hints.t1Duplicate,
            disabled: saving,
            onChange: (value) => save({ hints: { t1Duplicate: value } }),
          }),
          React.createElement(SettingRow, {
            label: '到期提醒',
            hint: 'AI 识别出时间线索时，在卡片上显示 ⏰ 标签。',
            checked: settings.hints.t2Due,
            disabled: saving,
            onChange: (value) => save({ hints: { t2Due: value } }),
          }),
          React.createElement(SettingRow, {
            label: '待投递横幅',
            hint: '面板顶部显示「N 条整理好了，还没用过」。',
            checked: settings.hints.t3Undelivered,
            disabled: saving,
            onChange: (value) => save({ hints: { t3Undelivered: value } }),
          }),
          React.createElement(SettingRow, {
            label: '归类告知',
            hint: 'AI 归完类后，在卡片上标出它归到了哪一类。',
            checked: settings.hints.t4Category,
            disabled: saving,
            onChange: (value) => save({ hints: { t4Category: value } }),
          }),
        ),

        // ---- 投递 ----
        React.createElement('h3', { className: 'sn-set-h' }, '投递'),
        React.createElement(
          'div',
          { className: 'sn-set-card' },
          React.createElement(SettingRow, {
            label: '输入框有内容时先确认',
            hint: '关掉后投递会直接追加到输入框末尾，不再弹出选择。',
            checked: settings.confirmBeforeDeliver,
            disabled: saving,
            onChange: (value) => save({ confirmBeforeDeliver: value }),
          }),
        ),

        // ---- 类别 ----
        React.createElement('h3', { className: 'sn-set-h' }, '类别'),
        React.createElement(
          'div',
          { className: 'sn-set-card' },
          React.createElement(
            'div',
            { className: 'sn-set-note' },
            'AI 归类时只能在这些类别里选。你自己改过的类别，AI 不会再覆盖。',
          ),
          React.createElement(
            'div',
            { className: 'sn-set-tags' },
            ...(settings.categories || []).map((name) =>
              React.createElement(
                'span',
                { key: name, className: 'sn-set-tag' },
                name,
                name === '未分类'
                  ? null
                  : React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'sn-set-tag-x',
                        title: '删除这个类别',
                        disabled: saving,
                        onClick: () => {
                          const next = settings.categories.filter((item) => item !== name)
                          if (next.length === 0) return
                          save({ categories: next })
                        },
                      },
                      '×',
                    ),
              ),
            ),
          ),
          React.createElement(
            'div',
            { className: 'sn-set-actions' },
            React.createElement('input', {
              className: 'sn-set-input',
              value: newCategory,
              placeholder: '新类别…',
              disabled: saving,
              onChange: (event) => setNewCategory(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                const name = newCategory.trim()
                if (name === '' || settings.categories.indexOf(name) !== -1) return
                save({ categories: [...settings.categories, name] })
                setNewCategory('')
              },
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'sn-act',
                disabled: saving || newCategory.trim() === '',
                onClick: () => {
                  const name = newCategory.trim()
                  if (name === '' || settings.categories.indexOf(name) !== -1) return
                  save({ categories: [...settings.categories, name] })
                  setNewCategory('')
                },
              },
              '添加',
            ),
          ),
        ),

        // ---- 数据 ----
        React.createElement('h3', { className: 'sn-set-h' }, '数据'),
        React.createElement(
          'div',
          { className: 'sn-set-card' },
          React.createElement(
            'div',
            { className: 'sn-set-note' },
            '便签全部是本地 Markdown 文件，一条一个，可以直接用编辑器打开、用 git 管理。卸载本插件不会删掉它们。',
          ),
          React.createElement(
            'div',
            { className: 'sn-set-actions' },
            React.createElement('button', { type: 'button', className: 'sn-act', onClick: exportAll }, '导出全部'),
          ),
        ),

        error !== ''
          ? React.createElement('div', { className: 'sn-set-note', style: { color: '#e53e3e' } }, error)
          : null,
      )
    }

    // =======================================================================
    // 主面板
    // =======================================================================

    /** 筛选谓词。 */
    function matchFilter(note, filter) {
      if (filter === 'trash') return note.deleted !== ''
      if (note.deleted !== '') return false
      if (filter === 'archived') return note.archived === true
      if (note.archived === true) return false
      if (filter === 'ai') return note.aiState === 'done'
      if (filter === 'undelivered') return note.deliveredCount === 0
      if (filter === 'voice') return note.source === 'voice'
      return true
    }

    /** 相对时间，够用就好。 */
    function relativeTime(iso) {
      const ms = Date.parse(String(iso || ''))
      if (!Number.isFinite(ms)) return ''
      const diff = Date.now() - ms
      const minute = 60000
      const hour = 3600000
      const day = 86400000
      if (diff < minute) return '刚刚'
      if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
      if (diff < day) return `${Math.floor(diff / hour)} 小时前`
      if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
      const date = new Date(ms)
      return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`
    }

    const SOURCE_ICON = { text: '⌨️', voice: '🎤', image: '🖼' }

    /** 提示开关。设置页改了要能立刻反映，所以放进 store。 */
    function useHints() {
      return useStore((state) => state.hints)
    }

    // -----------------------------------------------------------------------
    // 虚拟滚动
    // -----------------------------------------------------------------------
    //
    // 为什么手写而不是用 `@tanstack/react-virtual`：
    // 它确实在平台种子表里，但那是「今天有、明天可能换」的非稳定面，
    // 和语音采集里不依赖宿主导出的 `Recording` 是同一套判断。
    //
    // 这里只做定高窗口 —— 卡片高度基本固定（图片缩略图在详情页，卡片只显示
    // `🖼 N` 标记），所以不用测量每张卡的高度，复杂度降到最低。

    /** 估算的单张卡片高度（含 gap）。估大一点没关系，overscan 会兜住。 */
    const CARD_ROW_HEIGHT = 148
    /** 上下各多渲染几张，快速滚动时不露白。 */
    const OVERSCAN = 8
    /** 超过这个条数才启用虚拟化；以下直接全渲染（省掉窗口逻辑的开销）。 */
    const VIRTUAL_THRESHOLD = 120

    /**
     * 定高虚拟列表。
     *
     * @param items - 要渲染的数组
     * @param render - (item, index) => React 元素
     */
    function VirtualList({ items, render }) {
      const containerRef = React.useRef(null)
      const [scrollTop, setScrollTop] = React.useState(0)
      const [viewport, setViewport] = React.useState(0)

      React.useEffect(() => {
        const el = containerRef.current
        if (el === null) return undefined
        const measure = () => {
          setScrollTop(el.scrollTop)
          setViewport(el.clientHeight)
        }
        measure()
        let ticking = false
        const onScroll = () => {
          if (ticking) return
          ticking = true
          requestAnimationFrame(() => {
            setScrollTop(el.scrollTop)
            ticking = false
          })
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        // 尺寸变化（窗口缩放、侧栏伸缩）时重测
        const observer =
          typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (observer !== null) observer.observe(el)
        return () => {
          el.removeEventListener('scroll', onScroll)
          if (observer !== null) observer.disconnect()
        }
      }, [])

      const total = items.length

      // 不到阈值就全渲染，不折腾窗口
      if (total < VIRTUAL_THRESHOLD) {
        return React.createElement(
          'div',
          { className: 'sn-list', ref: containerRef },
          items.map((item, index) => render(item, index)),
        )
      }

      const start = Math.max(0, Math.floor(scrollTop / CARD_ROW_HEIGHT) - OVERSCAN)
      const visibleCount = Math.ceil(viewport / CARD_ROW_HEIGHT) + OVERSCAN * 2
      const end = Math.min(total, start + visibleCount)

      const slice = items.slice(start, end)
      const totalHeight = total * CARD_ROW_HEIGHT
      const topPad = start * CARD_ROW_HEIGHT

      return React.createElement(
        'div',
        { className: 'sn-list', ref: containerRef },
        React.createElement(
          'div',
          { style: { position: 'relative', height: totalHeight } },
          React.createElement(
            'div',
            { style: { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${topPad}px)` } },
            slice.map((item, index) => render(item, start + index)),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // 卡片命运：分类决定这张卡「往哪走」
    // -----------------------------------------------------------------------
    //
    // 产品定位（用户原话第 10 轮 + 后续共识）：
    //   灵感进来，AI 分类分流 —— 浅的展示、深的深入、待办的执行。
    // 卡片的「命运」是它的主按钮，不是藏在角落的次要动作。
    //
    // 命运优先级：待办 > 想法 > 参考 > 其余（展示/备忘）。

    /**
     * 判断一张卡的命运与主按钮。
     *
     * @returns { fate, label, icon, action }
     *   fate: 'deepen'（深入聊成成品）| 'execute'（设提醒）| 'reference'（找相关）| 'show'（展示/浏览）
     */
    function fateOf(note) {
      const category = String(note.category || '')
      const hasDue = note.aiDueHint !== '' && note.aiDueHint !== null && note.aiDueHint !== undefined

      // 待办：有明确时间线索 → 执行（设提醒）
      if (category === '待办' || hasDue) {
        return { fate: 'execute', label: '设个提醒', icon: '⏰' }
      }

      // 想法 / 灵感：深入（点开聊成成品）
      if (category === '想法' || category === '灵感') {
        return { fate: 'deepen', label: '聊这张', icon: '💬' }
      }

      // 参考：调用（找相关）
      if (category === '参考') {
        return { fate: 'reference', label: '找相关', icon: '🔗' }
      }

      // 其余（工作/生活/未分类）：默认展示，但工作偏深入
      if (category === '工作') {
        return { fate: 'deepen', label: '聊这张', icon: '💬' }
      }

      return { fate: 'show', label: '看看', icon: '👁' }
    }

    /** 主按钮的点击动作。 */
    function fateAction(note, fate) {
      if (fate === 'deepen') {
        // 深入 = 单卡开新对话（C 模型结论：单卡专注，不弹多选）
        // 直接 deliverToNew(id, [])，内容作为第一条消息发进去
        void deliverToNew(note.id, [])
        return
      }
      if (fate === 'execute') {
        void makeReminder(note.id, '')
        return
      }
      if (fate === 'reference') {
        // 找相关 = 打开详情，让用户在候选里挑
        store.set({ selectedId: note.id })
        return
      }
      // show：打开详情
      store.set({ selectedId: note.id })
    }

    // -----------------------------------------------------------------------
    // 对话主题条（C 模型：单卡专注）
    // -----------------------------------------------------------------------
    //
    // 「聊这张」不是简单地把内容塞进对话，而是**把卡片绑定成当前对话的主题**：
    //   - 卡片内容作为第一条消息发进去（对话能聊它）
    //   - 主题条浮在输入框上方，显示「正在聊这张卡」+ 关闭按钮
    //   - 关闭主题条 = 回到普通对话（卡片本身不受影响）
    //
    // 主题条不是消息，也不是投递 —— 它是「这段对话在围绕哪张卡」的可见标记。

    /** 把一张卡绑成当前对话的主题。 */
    async function bindCardAsTopic(noteId) {
      try {
        const data = await call(`/get?id=${encodeURIComponent(noteId)}`)
        const note = data.note
        if (note === undefined || note === null) {
          notify('这张卡不见了')
          return
        }
        store.set({ activeCard: note })
        // 同时把内容发进去（开新会话的语义已经在 deliverToNew 里处理；
        // 这里只负责「已有会话内绑定」——但当前入口是「聊这张」= 开新会话，
        // 所以 bindCardAsTopic 主要给「在已有会话里点卡片」的场景用）
      } catch (failure) {
        notify(failure.message || '绑定失败')
      }
    }

    /** 解绑当前主题。 */
    function unbindTopic() {
      store.set({ activeCard: null })
    }

    /**
     * 对话主题条组件。
     *
     * 挂在 `conversation.input.dock`（输入框上方，全宽）。
     * 没绑定卡片时不渲染任何东西。
     */
    function TopicBar() {
      const activeCard = useStore((state) => state.activeCard)
      if (activeCard === null || activeCard === undefined) return null

      const title = activeCard.aiTitle || String(activeCard.text || '').split(/\r?\n/)[0].slice(0, 40) || '（无标题）'
      const fate = fateOf(activeCard)

      return React.createElement(
        'div',
        { className: 'sn-topic' },
        React.createElement('span', { className: 'sn-topic-dot', 'aria-hidden': true }),
        React.createElement(
          'div',
          { className: 'sn-topic-body' },
          React.createElement('div', { className: 'sn-topic-title' }, title),
          React.createElement(
            'div',
            { className: 'sn-topic-meta' },
            React.createElement('span', { className: 'sn-chip' }, activeCard.category),
            activeCard.aiState === 'done'
              ? React.createElement('span', { className: 'sn-ai' }, '+AI')
              : null,
            activeCard.attachmentCount > 0
              ? React.createElement('span', null, `🖼 ${activeCard.attachmentCount}`)
              : null,
            React.createElement('span', { className: 'sn-topic-hint' }, `${fate.icon} 正在围绕这张卡聊 · 聊完说「把结论存回卡片」即可回写`),
          ),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'sn-topic-close',
            title: '结束围绕这张卡的对话',
            'aria-label': '结束主题',
            onClick: unbindTopic,
          },
          '×',
        ),
      )
    }

    function NoteCard({ note, selected, selecting, checked, onToggle }) {
      const hints = useHints()
      const aiBadge =
        note.aiState === 'done'
          ? note.aiBasedOnRev > 0 && note.aiBasedOnRev < note.rev
            ? { text: '+AI 旧', kind: 'stale' }
            : { text: '+AI', kind: 'ok' }
          : note.aiState === 'pending' || note.aiState === 'running'
            ? { text: '整理中', kind: 'busy' }
            : note.aiState === 'failed'
              ? { text: '整理失败', kind: 'stale' }
              : null

      const title = note.aiTitle !== '' ? note.aiTitle : note.preview !== '' ? note.preview.slice(0, 36) : '（空便签）'

      return React.createElement(
        'div',
        {
          className: `sn-card${selected ? ' sn-card--on' : ''}${selecting ? ' sn-card--selecting' : ''}`,
          onClick: () => {
            if (selecting) onToggle()
            else store.set({ selectedId: note.id })
          },
        },
        selecting
          ? React.createElement('input', {
              type: 'checkbox',
              className: 'sn-card-check',
              checked: checked === true,
              onClick: (event) => event.stopPropagation(),
              onChange: () => onToggle(),
            })
          : null,
        React.createElement(
          'div',
          { className: 'sn-card-head' },
          React.createElement('span', { className: 'sn-card-title' }, title),
          aiBadge === null
            ? null
            : React.createElement(
                'span',
                { className: `sn-ai${aiBadge.kind === 'ok' ? '' : ' sn-ai--' + aiBadge.kind}` },
                aiBadge.text,
              ),
        ),
        React.createElement('div', { className: 'sn-card-text' }, note.preview || '（没有内容）'),
        React.createElement(
          'div',
          { className: 'sn-meta' },
          hints.t4Category !== false && note.aiState === 'done'
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'sn-chip sn-chip--category',
                  title:
                    note.categorySource === 'user'
                      ? '你自己归的类，AI 不会再改'
                      : note.categorySource === 'rule'
                        ? '规则层自动归的类，点一下可改'
                        : 'AI 归的类，点一下可改',
                  onClick: (event) => {
                    event.stopPropagation()
                    store.set({ selectedId: note.id })
                  },
                },
                `${note.categorySource === 'user' ? '✎ ' : ''}${note.category}`,
              )
            : React.createElement('span', { className: 'sn-chip' }, note.category),
          React.createElement('span', null, relativeTime(note.created)),
          React.createElement('span', null, SOURCE_ICON[note.source] || '⌨️'),
          note.attachmentCount > 0 ? React.createElement('span', null, `🖼 ${note.attachmentCount}`) : null,
          note.deliveredCount > 0 ? React.createElement('span', null, `已投 ${note.deliveredCount}`) : null,
          note.aiDueHint !== '' && hints.t2Due !== false
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'sn-chip sn-chip--action',
                  title: '按这个时间建一个提醒',
                  onClick: (event) => {
                    event.stopPropagation()
                    void makeReminder(note.id, '')
                  },
                },
                `⏰ ${note.aiDueHint} · 设提醒`,
              )
            : null,
        ),
        note.deleted === ''
          ? (() => {
              const fate = fateOf(note)
              return React.createElement(
                'div',
                { className: 'sn-actions' },
                // 命运主按钮：一眼可见这张卡往哪走
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: `sn-act sn-act--fate sn-act--fate-${fate.fate}`,
                    onClick: (event) => {
                      event.stopPropagation()
                      fateAction(note, fate.fate)
                    },
                  },
                  `${fate.icon} ${fate.label}`,
                ),
                // 次要动作：收成一行小按钮
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: (event) => {
                      event.stopPropagation()
                      deliverToCurrent(note)
                    },
                  },
                  '加到当前对话',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: async (event) => {
                      event.stopPropagation()
                      await call('/update', {
                        method: 'POST',
                        body: { id: note.id, patch: { archived: !note.archived } },
                      })
                      await refresh()
                    },
                  },
                  note.archived ? '取消归档' : '归档',
                ),
              )
            })()
          : React.createElement(
              'div',
              { className: 'sn-actions' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'sn-act',
                  onClick: async (event) => {
                    event.stopPropagation()
                    await call('/restore', { method: 'POST', body: { id: note.id } })
                    await refresh()
                  },
                },
                '恢复',
              ),
            ),
      )
    }

    function DetailPane({ id }) {
      const [note, setNote] = React.useState(null)
      const [text, setText] = React.useState('')
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        if (id === '') {
          setNote(null)
          return
        }
        let alive = true
        fetchNote(id)
          .then((full) => {
            if (!alive) return
            setNote(full)
            setText(full.text || '')
          })
          .catch(() => {
            if (alive) setNote(null)
          })
        return () => {
          alive = false
        }
      }, [id])

      if (id === '' || note === null) {
        return React.createElement('div', { className: 'sn-empty' }, '选一条看详情')
      }

      const stale = note.aiState === 'done' && note.aiBasedOnRev > 0 && note.aiBasedOnRev < note.rev

      const save = async () => {
        if (saving || text === note.text) return
        setSaving(true)
        try {
          await call('/update', { method: 'POST', body: { id: note.id, patch: { text } } })
          const full = await fetchNote(note.id)
          setNote(full)
          setText(full.text || '')
          await refresh()
        } finally {
          setSaving(false)
        }
      }

      return React.createElement(
        'div',
        { className: 'sn-detail' },
        React.createElement('h3', { className: 'sn-detail-title' }, note.aiTitle || '（无标题）'),
        React.createElement(
          'div',
          { className: 'sn-meta' },
          React.createElement('span', { className: 'sn-chip' }, note.category),
          React.createElement('span', null, relativeTime(note.created)),
          React.createElement('span', null, `rev ${note.rev}`),
        ),

        note.attachments !== undefined && note.attachments.length > 0
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, `图片（${note.attachments.length}）`),
              React.createElement(
                'div',
                { className: 'sn-shots sn-shots--view' },
                ...note.attachments.map((name) =>
                  React.createElement(
                    'a',
                    {
                      key: name,
                      className: 'sn-shot',
                      href: mediaUrl(name),
                      target: '_blank',
                      rel: 'noreferrer',
                      title: '新窗口打开原图',
                    },
                    React.createElement('img', { src: mediaUrl(name), alt: name, loading: 'lazy' }),
                  ),
                ),
              ),
              React.createElement(
                'div',
                { className: 'sn-set-note' },
                '图片只存本地，默认不会发给模型。',
              ),
            )
          : null,

        React.createElement(
          'div',
          { className: 'sn-detail-sec' },
          React.createElement('h4', null, '原文（改了会重新整理）'),
          React.createElement('textarea', {
            value: text,
            onChange: (event) => setText(event.target.value),
            onBlur: save,
          }),
        ),

        note.aiPoints !== undefined && note.aiPoints.length > 0
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, stale ? 'AI 补全（基于旧版本）' : 'AI 补全'),
              React.createElement(
                'ul',
                { className: 'sn-list-plain' },
                note.aiPoints.map((item, index) => React.createElement('li', { key: index }, item)),
              ),
            )
          : null,

        note.aiTodos !== undefined && note.aiTodos.length > 0
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, '抽出的待办'),
              React.createElement(
                'ul',
                { className: 'sn-list-plain' },
                note.aiTodos.map((item, index) => React.createElement('li', { key: index }, `☐ ${item}`)),
              ),
            )
          : null,

        note.aiDueHint !== ''
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, '时间线索'),
              React.createElement(
                'div',
                { style: { fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                React.createElement('span', null, '⏰ ' + note.aiDueHint),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act sn-act--primary',
                    onClick: () => void makeReminder(note.id, ''),
                  },
                  '设个提醒',
                ),
              ),
            )
          : null,

        note.aiDueHint === ''
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, '提醒'),
              React.createElement(
                'div',
                { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.6 } },
                '没从原文里认出时间。可以手填一个，例如「明天下午」「下周三」「11月20日」。',
              ),
              React.createElement(
                'div',
                { className: 'sn-set-actions' },
                React.createElement('input', {
                  className: 'sn-set-input',
                  placeholder: '明天下午',
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter') return
                    const value = event.target.value.trim()
                    if (value === '') return
                    void makeReminder(note.id, value)
                  },
                }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: (event) => {
                      const input = event.currentTarget.previousSibling
                      const value = input && input.value ? String(input.value).trim() : ''
                      if (value === '') return
                      void makeReminder(note.id, value)
                    },
                  },
                  '设提醒',
                ),
              ),
            )
          : null,

        note.delivered !== undefined && note.delivered.length > 0
          ? React.createElement(
              'div',
              { className: 'sn-detail-sec' },
              React.createElement('h4', null, '投递记录'),
              React.createElement(
                'ul',
                { className: 'sn-list-plain' },
                note.delivered.map((item, index) =>
                  React.createElement(
                    'li',
                    { key: index },
                    `${relativeTime(item.at)} → ${item.mode === 'new' ? '新会话' : '当前会话'}${item.beforeAi ? '（AI 未完成时投递）' : ''}`,
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function Panel() {
      const hints = useHints()
      const notes = useStore((state) => state.notes)
      const query = useStore((state) => state.query)
      const filter = useStore((state) => state.filter)
      const selectedId = useStore((state) => state.selectedId)
      const selectedSet = useStore((state) => state.selected)
      const selecting = useStore((state) => state.selecting)
      const phase = useStore((state) => state.phase)
      const error = useStore((state) => state.error)
      const bannerHidden = React.useRef(false)

      // 面板挂载即拉一次；随后靠 SSE 增量
      React.useEffect(() => {
        void refresh()
        void loadSettings()
      }, [])

      const archivedMap = useStore((state) => state.archivedNotes)
      const all = React.useMemo(
        () => (filter === 'archived' ? Object.values(archivedMap) : Object.values(notes)),
        [notes, archivedMap, filter],
      )

      const counts = React.useMemo(() => {
        const map = new Map()
        let undelivered = 0
        let trash = 0
        let pending = 0
        let archived = 0
        for (const note of all) {
          if (note.deleted !== '') {
            trash += 1
            continue
          }
          if (note.archived) {
            archived += 1
            continue
          }
          map.set(note.category, (map.get(note.category) || 0) + 1)
          if (note.deliveredCount === 0 && note.aiState === 'done') undelivered += 1
          if (note.aiState === 'pending' || note.aiState === 'running') pending += 1
        }
        return { categories: [...map.entries()].sort((a, b) => b[1] - a[1]), undelivered, trash, pending, archived }
      }, [all])

      const visible = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return all
          .filter((note) => matchFilter(note, filter))
          .filter((note) => {
            if (needle === '') return true
            const hay = `${note.preview} ${note.aiTitle} ${note.category} ${note.tags.join(' ')}`.toLowerCase()
            return hay.includes(needle)
          })
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            return (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0)
          })
      }, [all, query, filter])

      return React.createElement(
        'div',
        { className: 'sn-root' },
        // ---- 左：软分类树 ----
        React.createElement(
          'div',
          { className: 'sn-col sn-col--left' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: `sn-cat${filter === 'undelivered' ? ' sn-cat--on' : ''}`,
              onClick: () => store.set({ filter: 'undelivered' }),
            },
            React.createElement('span', null, '待投递'),
            React.createElement('span', { className: 'sn-cat-count' }, String(counts.undelivered)),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `sn-cat${filter === 'all' ? ' sn-cat--on' : ''}`,
              onClick: () => store.set({ filter: 'all' }),
            },
            React.createElement('span', null, '收件箱'),
            React.createElement('span', { className: 'sn-cat-count' }, String(all.filter((n) => n.deleted === '').length)),
          ),
          React.createElement('div', { className: 'sn-cat-sep' }),
          ...counts.categories.map(([name, count]) =>
            React.createElement(
              'button',
              {
                key: name,
                type: 'button',
                className: 'sn-cat',
                onClick: () => store.set({ filter: 'all', query: name }),
              },
              React.createElement('span', null, name),
              React.createElement('span', { className: 'sn-cat-count' }, String(count)),
            ),
          ),
          React.createElement('div', { className: 'sn-cat-sep' }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `sn-cat${filter === 'archived' ? ' sn-cat--on' : ''}`,
              onClick: () => {
              store.set({ filter: 'archived' })
              void refresh({ archive: true })
            },
            },
            React.createElement('span', null, '归档'),
            React.createElement('span', { className: 'sn-cat-count' }, String(counts.archived)),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `sn-cat${filter === 'trash' ? ' sn-cat--on' : ''}`,
              onClick: () => store.set({ filter: 'trash' }),
            },
            React.createElement('span', null, '回收站'),
            React.createElement('span', { className: 'sn-cat-count' }, String(counts.trash)),
          ),
          React.createElement('div', { className: 'sn-cat-sep' }),
          React.createElement(
            'button',
            { type: 'button', className: 'sn-cat', onClick: exportAll },
            React.createElement('span', null, '导出全部'),
          ),
        ),

        // ---- 中：搜索 + 筛选 + 卡片流 ----
        React.createElement(
          'div',
          { className: 'sn-col sn-col--mid' },
          React.createElement(
            'div',
            { className: 'sn-search' },
            React.createElement('input', {
              value: query,
              placeholder: '搜索便签…',
              onChange: (event) => store.set({ query: event.target.value }),
            }),
          ),
          React.createElement(
            'div',
            { className: 'sn-tabs' },
            ...[
              ['all', '全部'],
              ['ai', '+AI'],
              ['undelivered', '待投递'],
              ['voice', '语音'],
              ['archived', '归档'],
            ].map(([key, label]) =>
              React.createElement(
                'button',
                {
                  key,
                  type: 'button',
                  className: `sn-tab${filter === key ? ' sn-tab--on' : ''}`,
                  onClick: () => store.set({ filter: key }),
                },
                label,
              ),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: `sn-tab${selecting ? ' sn-tab--on' : ''}`,
                onClick: () => {
                  if (selecting) clearSelection()
                  else store.set({ selecting: true })
                },
              },
              selecting ? '退出多选' : '多选',
            ),
          ),

          // 批量操作工具栏：只在多选模式出现
          selecting
            ? React.createElement(
                'div',
                { className: 'sn-batchbar' },
                React.createElement('span', { className: 'sn-batch-count' }, `已选 ${selectedSet.size} 条`),
                React.createElement(
                  'button',
                  { type: 'button', className: 'sn-act', onClick: () => selectAll(visible) },
                  '全选',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: () => batchUpdate([...selectedSet], { archived: true }, '归档'),
                  },
                  '归档',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: () => batchUpdate([...selectedSet], { archived: false }, '取消归档'),
                  },
                  '取消归档',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act sn-act--danger',
                    onClick: () => {
                      const ids = [...selectedSet]
                      if (ids.length > 0) void batchRemove(ids)
                    },
                  },
                  '删除',
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'sn-act', onClick: clearSelection },
                  '取消',
                ),
              )
            : null,

          // 待投递横幅：产品的转化漏斗，只在真有东西时出现（§5.3 T3）
          counts.undelivered > 0 && hints.t3Undelivered !== false && !bannerHidden.current
            ? React.createElement(
                'div',
                { className: 'sn-banner' },
                React.createElement('span', null, `${counts.undelivered} 条整理好了，还没用过`),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-act',
                    onClick: () => store.set({ filter: 'undelivered' }),
                  },
                  '看看',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'sn-banner-close',
                    onClick: () => {
                      bannerHidden.current = true
                      store.set({})
                    },
                    'aria-label': '关闭',
                  },
                  '×',
                ),
              )
            : null,

          phase === 'error'
            ? React.createElement('div', { className: 'sn-banner' }, `连不上服务：${error}`)
            : null,

          visible.length === 0
            ? React.createElement(
                'div',
                { className: 'sn-list' },
                React.createElement(
                  'div',
                  { className: 'sn-empty' },
                  filter === 'trash' ? '回收站是空的' : '还没有便签',
                  React.createElement('br'),
                  React.createElement(
                    'button',
                    { type: 'button', className: 'sn-act sn-act--primary', onClick: openCapture, style: { marginTop: 10 } },
                    '记第一条',
                  ),
                ),
              )
            : React.createElement(VirtualList, {
                items: visible,
                render: (note) =>
                  React.createElement(NoteCard, {
                    key: note.id,
                    note,
                    selected: note.id === selectedId,
                    selecting,
                    checked: selectedSet.has(note.id),
                    onToggle: () => toggleSelect(note.id),
                  }),
              }),
        ),

        // ---- 右：详情 ----
        React.createElement(
          'div',
          { className: 'sn-col sn-col--right' },
          React.createElement(DetailPane, { id: selectedId }),
        ),

        // T1 相似提示与投递候选，挂在这里跟着面板一起渲染
        React.createElement(SimilarBar, null),
        React.createElement(DeliverDialog, null),
        React.createElement(DraftConflictDialog, null),
      )
    }

    // =======================================================================
    // 投递
    // =======================================================================

    // -----------------------------------------------------------------------
    // composer 门面
    // -----------------------------------------------------------------------
    //
    // 拿法参考 dsh-vps-manager 的实测路径（它已经跑通）：
    //
    //     const actx = sessions.scope(sessionId)        // 该会话的 client 作用域 ctx
    //     const input = actx.get('conversation').input.for(actx)
    //     input.setDraft(text) → 等它真的收到 → input.submit()
    //
    // 关键点：`input.for(actx)` 拿到的门面才有 `setDraft` / `submit`；
    // 直接在 root ctx 上读 `conversation` 拿到的不是这个面。
    // `sessions.scope` 没在类型里声明，是运行时接口，所以每一层都要 try。

    /** 会话作用域缓存：sessionId → actx。scope 对象可以复用，不必每次重建。 */
    const scopeCache = new Map()

    /**
     * 取某个会话的 client 作用域。
     * @returns actx 或 null
     */
    function scopeOf(sessionId) {
      if (sessionId === undefined || sessionId === '') return null
      const cached = scopeCache.get(sessionId)
      if (cached !== undefined) return cached
      try {
        const sessions = service('sessions')
        if (sessions === undefined || sessions === null) return null
        if (typeof sessions.scope !== 'function') return null
        const actx = sessions.scope(sessionId)
        if (actx === undefined || actx === null) return null
        scopeCache.set(sessionId, actx)
        return actx
      } catch {
        return null
      }
    }

    /**
     * 取某个会话的 composer 输入门面。
     *
     * 返回的对象至少有 `setDraft(text)`。
     * @returns 门面或 null
     */
    function composerOf(sessionId) {
      const actx = scopeOf(sessionId)
      if (actx === null) return null
      try {
        const conversation = typeof actx.get === 'function' ? actx.get('conversation') : actx.conversation
        const input = conversation !== null && conversation !== undefined ? conversation.input : undefined
        if (input === undefined || input === null) return null
        if (typeof input.for !== 'function') return null
        const facade = input.for(actx)
        if (facade === null || facade === undefined) return null
        if (typeof facade.setDraft !== 'function') return null
        return facade
      } catch {
        return null
      }
    }

    /** 草稿文本。读不到就当空串（宁可按空处理，也不猜用户写了什么）。 */
    function draftOf(sessionId) {
      const facade = composerOf(sessionId)
      if (facade === null) return ''
      try {
        if (facade.state && typeof facade.state.getSnapshot === 'function') {
          const snapshot = facade.state.getSnapshot()
          return String((snapshot && snapshot.draft) || '')
        }
      } catch {
        /* 往下走 */
      }
      return ''
    }

    /** 这个会话里排着队、还没轮到的消息（只取文字）。防重复发送。 */
    function queuedTexts(sessionId) {
      const facade = composerOf(sessionId)
      if (facade === null) return []
      try {
        const snapshot = facade.state && typeof facade.state.getSnapshot === 'function' ? facade.state.getSnapshot() : null
        const queue = snapshot && Array.isArray(snapshot.queue) ? snapshot.queue : []
        return queue
          .map((item) =>
            Array.isArray(item && item.content)
              ? item.content
                  .filter((block) => block && block.type === 'text')
                  .map((block) => String(block.text || ''))
                  .join('')
                  .trim()
              : '',
          )
          .filter(Boolean)
      } catch {
        return []
      }
    }

    /** 当前屏幕上的会话 id。 */
    function onScreenSession() {
      try {
        const sidebarRight = service('sidebarRight')
        if (sidebarRight && sidebarRight.mounted) {
          const mounted = sidebarRight.mounted.getSnapshot()
          if (typeof mounted === 'string' && mounted !== '') return mounted
        }
      } catch {
        /* 服务缺席就往下找 */
      }
      try {
        const sessions = service('sessions')
        const list = sessions && sessions.list ? sessions.list.getSnapshot() : undefined
        const byId = list && list.byId ? list.byId : {}
        for (const key of Object.keys(byId)) return key
      } catch {
        /* 找不到就返回空串 */
      }
      return ''
    }

    /**
     * 往某个会话发一条消息（**不是在输入框里留草稿，是真的发出去**）。
     *
     * 这是「新开对话投递」的核心 —— 参考 dsh-vps-manager 已经跑通的写法：
     * `setDraft` 之后输入框更新是**异步**的，必须等它真的收到这句话再 `submit`，
     * 否则发出去的是空的。vps-manager 用 20×25ms 轮询，这里照做。
     *
     * @returns 'sent' 发出去了 / 'draft' 输入框有未发的话，没动 / 'queued' 已经排过 / 'none' 拿不到门面
     */
    async function sendToSession(sessionId, text) {
      const facade = composerOf(sessionId)
      if (facade === null) return 'none'

      // 输入框里有用户没发的话 → 不动它。硬塞进去会把用户正在写的东西顶掉。
      if (draftOf(sessionId) !== '') return 'draft'

      // 同一句话已经排过队就不再排 —— AI 忙着时连点几下会留下一串重复消息
      const trimmed = text.trim()
      if (trimmed !== '' && queuedTexts(sessionId).indexOf(trimmed) !== -1) return 'queued'

      try {
        facade.setDraft(text)
      } catch {
        return 'none'
      }

      // 等输入框真的收到这句话（最长 500ms）
      for (let i = 0; i < 20; i += 1) {
        if (draftOf(sessionId) !== '') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (draftOf(sessionId) === '') {
        try {
          if (typeof facade.focus === 'function') facade.focus()
        } catch {
          /* 聚焦失败不致命 */
        }
        return 'none'
      }

      try {
        if (typeof facade.submit === 'function') {
          // vps-manager 传 'queue'，声明层写的是无参。两种都试，前者能中就更好（不打断进行中的回合）。
          try {
            facade.submit('queue')
          } catch {
            facade.submit()
          }
          return 'sent'
        }
      } catch {
        return 'none'
      }
      return 'none'
    }

    /**
     * 投递到当前对话。
     *
     * 走「放进输入框」这条路（路径 A），并且**必须先看草稿状态**。
     * `setDraft` 的语义是替换整个草稿 —— 直接调用等于清空用户正在写的东西。
     *
     * 判定顺序（设计文档 §4.2 的四分支）。
     */
    async function deliverToCurrent(note) {
      const rendered = await call(`/render?id=${encodeURIComponent(note.id)}`)
      const text = rendered.text

      const sessionId = onScreenSession()
      const facade = composerOf(sessionId)

      // ① 拿不到输入框
      if (facade === null) {
        let copied = false
        try {
          await navigator.clipboard.writeText(text)
          copied = true
        } catch {
          copied = false
        }
        notify(copied ? '拿不到输入框，已复制到剪贴板，按 ⌘V 粘进去' : '拿不到输入框，复制也失败了')
        return
      }

      let snapshot = null
      try {
        snapshot = facade.state && typeof facade.state.getSnapshot === 'function' ? facade.state.getSnapshot() : null
      } catch {
        snapshot = null
      }

      // ② 正在提交
      const phase = snapshot && snapshot.phase ? snapshot.phase : 'plain'
      if (phase !== 'plain') {
        notify('输入框正在发送中，稍后再投')
        return
      }

      const draft = String((snapshot && snapshot.draft) || '')

      // ③ 草稿为空：无脑放进，不需要问
      if (draft.trim() === '') {
        applyDraft(facade, text, note, sessionId)
        return
      }

      // ④ 已经在里面
      if (draft.indexOf(note.id) !== -1) {
        notify('这条已经在输入框里了')
        return
      }

      // ⑤ 有草稿：问用户。**默认是追加**，用户宁可多删，不可少存。
      //    `confirmBeforeDeliver` 关掉时直接追加。
      if (contextSettings().confirmBeforeDeliver === false) {
        applyDraft(facade, text, note, sessionId)
        return
      }
      store.set({
        draftConflict: {
          noteId: note.id,
          text,
          draftLength: draft.length,
        },
      })
    }

    /**
     * 真正写进草稿。
     *
     * @param shell - composer 门面
     * @param text - 渲染好的投递文本
     * @param note - 只需要 `id`（记投递用）
     * @param sessionId - 目标会话
     * @param mode - 'append'（默认）或 'replace'
     */
    function applyDraft(shell, text, note, sessionId, mode) {
      const how = mode === 'replace' ? 'replace' : 'append'
      let next = text

      if (how === 'append') {
        let current = ''
        try {
          const snapshot = shell.state.getSnapshot()
          current = String((snapshot && snapshot.draft) || '')
        } catch {
          current = ''
        }
        next = current.trim() === '' ? text : `${current.replace(/\s+$/, '')}\n\n${text}`
      }

      try {
        shell.setDraft(next)
      } catch (error) {
        notify(`投递失败：${error && error.message ? error.message : String(error)}`)
        return
      }

      // 写入成功后一定清掉冲突状态，避免对话框残留（含空草稿那条静默路径）
      store.set({ draftConflict: null })

      void call('/record', {
        method: 'POST',
        body: { id: note.id, session: sessionId, mode: 'current', form: 'draft' },
      })
        .then(() => refresh())
        .catch(() => {})

      notify(how === 'replace' ? '已替换输入框内容' : '已追加到输入框末尾')
    }

    /**
     * 投递到新会话。
     *
     * 分两步，都能单独失败：
     *   ① 开一个新会话（走 Host 端点，因为客户端拿不到 `startSession`）
     *   ② 把内容**真的发进去**（`sendToSession`，不是留草稿）
     *
     * 参考 dsh-vps-manager 的实测路径：`setDraft` → 等输入框收到 → `submit`。
     * 关键差别是我们还要先有会话，所以多一步。
     */
    async function deliverToNew(id, extraIds) {
      const ids = [id, ...(Array.isArray(extraIds) ? extraIds : [])]

      // 渲染所有要带走的条目
      const parts = []
      for (const item of ids) {
        try {
          const rendered = await call(`/render?id=${encodeURIComponent(item)}`)
          parts.push(rendered.text)
        } catch {
          /* 单条渲染失败不拖垮整批 */
        }
      }
      if (parts.length === 0) {
        notify('没有可投递的内容')
        return
      }
      const text = parts.join('\n\n---\n\n')

      // ① 建会话
      let sessionId = ''
      try {
        const created = await call('/session', { method: 'POST', body: {} })
        sessionId = String(created.sessionId || '')
      } catch (failure) {
        // 建不出来就退回剪贴板，明说原因 —— 不假装成功
        let copied = false
        try {
          await navigator.clipboard.writeText(text)
          copied = true
        } catch {
          copied = false
        }
        notify(
          copied
            ? `开不了新会话（${failure.message || failure}）· 已复制 ${parts.length} 条到剪贴板`
            : `开不了新会话，复制也失败了`,
        )
        return
      }

      if (sessionId === '') {
        notify('开了会话但拿不到 id，投递取消')
        return
      }

      // ② 等内容真的发出去。新会话的门面可能要等一小会儿才就绪。
      let result = 'none'
      for (let attempt = 0; attempt < 12; attempt += 1) {
        result = await sendToSession(sessionId, text)
        if (result === 'sent' || result === 'queued') break
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      if (result === 'sent' || result === 'queued') {
        for (const item of ids) {
          try {
            await call('/record', { method: 'POST', body: { id: item, session: sessionId, mode: 'new', form: 'draft' } })
          } catch {
            /* 记录失败不影响用户 */
          }
        }
        // C 模型：开新对话深入 = 绑定这张卡为主题（单卡专注）
        if (ids.length === 1) {
          try {
            const data = await call(`/get?id=${encodeURIComponent(ids[0])}`)
            if (data.note !== undefined && data.note !== null) store.set({ activeCard: data.note })
          } catch {
            /* 绑定失败不影响已完成的投递 */
          }
        }
        await refresh()
        notify(ids.length === 1 ? '已开新对话，围绕这张卡聊' : `已开新对话并投递 ${parts.length} 条`)
        return
      }

      // ③ 会话开了但发不进去：把内容给到剪贴板，并告诉用户会话已经开好了
      let copied = false
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {
        copied = false
      }
      notify(
        copied
          ? '新对话已开好，但拿不到它的输入框 · 内容已复制，粘进去即可'
          : '新对话已开好，但内容复制失败，请到详情页手动复制',
      )
    }

    /**
     * 建一个提醒。
     *
     * 只发请求，不做本地计时 —— 到点怎么提醒是 DSH 的事（`schedule` 会开会话，
     * 用户的 notify 插件负责推到手机）。我们连 `setTimeout` 都不需要。
     *
     * @param id - 便签 id
     * @param dueHint - 用户手填的时间（空串 = 用便签上的或原文里的）
     */
    async function makeReminder(id, dueHint) {
      try {
        const data = await call('/remind', { method: 'POST', body: { id, dueHint } })
        notify(`提醒已设：${data.label}`)
      } catch (failure) {
        notify(failure && failure.message ? failure.message : '设提醒失败')
      }
    }

    /** 轻提示。没有全局 toast 就先 console，绝不阻塞。 */
    function notify(message) {
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('dsh-stickynote:toast', { detail: { message } }))
        }
      } catch {
        /* 事件派发失败不该影响主流程 */
      }
      console.log(`[dsh-stickynote] ${message}`)
    }

    // =======================================================================
    // 快捷键：Alt+Space 等价于点按键（窗口内，见设计文档附录 D）
    // =======================================================================

    function installShortcut() {
      if (typeof window === 'undefined') return () => {}
      const onKeyDown = (event) => {
        if (event.altKey && (event.code === 'Space' || event.key === ' ')) {
          event.preventDefault()
          openCapture()
        }
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }

    // =======================================================================
    // 注册
    // =======================================================================

    function registerUi(scope) {
      const slots =
        scope === null || scope === undefined
          ? undefined
          : scope.slots !== undefined
            ? scope.slots
            : typeof scope.get === 'function'
              ? scope.get('slots')
              : undefined

      if (slots === undefined || slots === null) {
        console.error('[dsh-stickynote] 缺少 slots 服务，UI 半侧不注册')
        return
      }

      // 侧栏按键：单击新建（默认），双击浏览
      slots.inject('sidebar.panellist', () =>
        slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 21,
            label: '随手贴',
          },
          function SidebarEntry(props) {
            // 侧栏行的点击由外壳负责切面板；这里只负责图标视觉
            return React.createElement(SidebarIcon, props)
          },
        ),
      )

      // 主面板
      slots.inject('main', () =>
        slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          Panel,
        ),
      )

      // 对话顶部按钮
      slots.inject('conversation.session.header.utilities', () =>
        slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'stickynote-header',
            order: 60,
          },
          HeaderButton,
        ),
      )

      // 对话主题条：输入框上方、全宽（C 模型）
      slots.inject('conversation.input.dock', () =>
        slots.register(
          {
            name: 'conversation.input.dock',
            id: 'stickynote-topic',
            order: 50,
          },
          TopicBar,
        ),
      )

      // 设置页：root scope 的 list 插槽，id / order / label 走注册选项
      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'stickynote-settings',
            order: 40,
            label: '随手贴',
          },
          SettingsPanel,
        ),
      )

      startLive()
      void refresh()
      void loadSettings()
    }

    exports.apply = function apply(ctx) {
      clientCtx = ctx
      installStyles()

      // 快捷键是即时的，不依赖 slots
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => installShortcut(), 'dsh-stickynote: Alt+Space')
      } else {
        installShortcut()
      }

      if (typeof ctx.inject === 'function') {
        ctx.inject(['slots'], registerUi)
        return
      }
      registerUi(ctx)
    }

    exports.internals = {
      store, capture, refresh, alertStateOf, slimNote, deliverToCurrent, exportAll,
      loadCandidates, applyDraft, composerOf, inspectSpeech, toBase64,
      Capture, encodeWave, recordingErrorText, TARGET_RATE, SettingsPanel, makeReminder,
      sendToSession, deliverToNew, scopeOf, draftOf, queuedTexts, onScreenSession,
      addImageFile, uploadPendingImages, splitDataUrl, mediaUrl, readFileAsDataUrl, importNotes,
      toggleSelect, selectAll, clearSelection, batchUpdate, batchRemove,
      VirtualList, CARD_ROW_HEIGHT, VIRTUAL_THRESHOLD, fateOf, fateAction,
      TopicBar, bindCardAsTopic, unbindTopic,
    }

    return exports
  },
})
