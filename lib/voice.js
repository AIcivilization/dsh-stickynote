/**
 * dsh-stickynote — 语音（Client 半侧）
 *
 * 分工：
 *   - **识别**：用宿主的 `speechController.transcribe()` —— 这是 DSH 的能力，不碰。
 *   - **采集**：自己实现。不是不想复用，是**复用不了**：
 *     `dsh-experimental-client-ui-voice-input` 的客户端 bundle 只导出
 *     `apply` / `inject`，`Recording` 类是模块内部的私有类，没有出现在导出面上；
 *     平台种子表（`__DSH_BOOT__.staticModules`）也只有 react / cordis / zod /
 *     client-store / ui-slots / ui-primitives / dockkit 这几个，
 *     没有 voice-input 的采集模块。
 *     所以按它的实现移植一份：getUserMedia → MediaRecorder → decodeAudioData →
 *     OfflineAudioContext 重采样到 16k 单声道 → PCM16 WAV。
 *     算法与宿主的逐行一致，产物也是同一个格式，`transcribe` 分不出来。
 *
 * **最重要的约束：`transcribe` 返回的是一个 Promise，不是流式。**
 * `Transcript = { text, audioSeconds, inferenceSeconds }` —— 一次性给全文。
 * 所以 UI 只能说「识别中…」，不能假装边说边出字。这一点写死在这里，
 * 免得以后有人按流式去改界面。
 *
 * 降级：`speechController` 不存在、或没有任何 provider 就绪时，
 * 捕获浮层里语音键置灰，`reason` 说明为什么，并给一个就地「准备」按钮。
 */

/** 录音的软上限（秒）。超过就自动停，不等宿主截断。 */
const SOFT_LIMIT_SECONDS = 60

/** 电平采样间隔（毫秒）。够画一条不卡顿的波形。 */
const LEVEL_INTERVAL = 60

/** 波形保留的点数。 */
const LEVEL_POINTS = 48

/**
 * 探一个可用的语音 provider。
 *
 * 只有 `preparation.phase === 'ready'` 才算真能用 —— `unprepared` /
 * `downloading` / `loading` 都还不能转写，硬调用会抛。
 *
 * @param controller - `speechController`
 * @returns `{ providerId, language, ready, phase, needsPrepare, providerName }` 或 null
 */
export function inspectSpeech(controller) {
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

  // 优先用用户选的那个；它不在列表里就退到第一个
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
    // 只有这两种状态值得让用户点「准备」；downloading 是在等，不该再点
    needsPrepare: phase === 'unprepared' || phase === 'failed' || phase === 'cancelled',
    maxDurationSeconds: Number(catalog.maxDurationSeconds) || SOFT_LIMIT_SECONDS,
    providers: providers.map((item) => ({
      id: item.id,
      name: item.name || item.id,
      phase: item.preparation && item.preparation.phase ? item.preparation.phase : 'unprepared',
    })),
  }
}

/** 让一个 provider 开始准备（下载/加载模型）。 */
export function prepareSpeech(controller, providerId) {
  if (controller === undefined || controller === null) return false
  if (typeof controller.prepare !== 'function') return false
  try {
    controller.prepare(providerId, undefined)
    return true
  } catch {
    return false
  }
}

/**
 * 从 `RecordingError.kind` 映射到人话。
 *
 * 宿主给的 kind 是稳定的枚举，文案由我们负责 —— 这样 UI 不需要认识那个枚举。
 */
export function recordingErrorText(kind) {
  switch (kind) {
    case 'unavailable':
      return '这个环境不支持录音'
    case 'permission':
      return '没有麦克风权限，请在浏览器里允许后重试'
    case 'empty':
      return '没录到声音'
    case 'cancelled':
      return '已取消'
    case 'interrupted':
      return '录音被打断了'
    case 'deviceMissing':
      return '找不到麦克风设备'
    default:
      return '录音失败'
  }
}

/**
 * 建一个录音会话。
 *
 * 调用方（捕获浮层）负责把电平画出来、把结果塞进输入框。
 * 这里只管「开始 / 停止 / 取消 / 电平 / 转写」这条线。
 *
 * @param options.controller - `speechController`
 * @param options.speech - `inspectSpeech()` 的结果
 * @param options.onLevel - 电平回调（0~1），传入数组快照
 * @param options.onError - 错误回调，参数是人话文案
 * @returns 会话对象，或 null（语音不可用）
 */
export function createVoiceSession(options) {
  const controller = options && options.controller
  const speech = options && options.speech
  const onLevel = typeof (options && options.onLevel) === 'function' ? options.onLevel : () => {}
  const onError = typeof (options && options.onError) === 'function' ? options.onError : () => {}

  if (controller === undefined || controller === null) return null
  if (speech === undefined || speech === null || speech.ready !== true) return null
  if (typeof controller.transcribe !== 'function') return null

  /** 电平采样定时器。 */
  let levelTimer = null
  /** 软上限定时器。 */
  let limitTimer = null
  /** 电平历史。 */
  let levels = []
  /** 是否正在录。 */
  let recording = false
  /** 取消标记：取消后不转写。 */
  let cancelled = false
  /** 底层的 Recording 实例（由调用方注入构造器，见 attachRecorder）。 */
  let recorder = null
  /** 停止后拿到的 WAV。 */
  let wav = null

  function stopTimers() {
    if (levelTimer !== null) {
      clearInterval(levelTimer)
      levelTimer = null
    }
    if (limitTimer !== null) {
      clearTimeout(limitTimer)
      limitTimer = null
    }
  }

  /**
   * 绑定一个已经是「录音中」的 Recording。
   *
   * 采集本身由调用方做（它才知道 `Recording` 构造器从哪 require），
   * 这里接管电平采样与软上限。
   */
  function attachRecorder(instance) {
    recorder = instance
    recording = true
    cancelled = false
    levels = []

    levelTimer = setInterval(() => {
      if (!recording || recorder === null) return
      let value = 0
      try {
        value = Number(recorder.amplitude()) || 0
      } catch {
        value = 0
      }
      levels.push(Math.max(0, Math.min(1, value)))
      if (levels.length > LEVEL_POINTS) levels = levels.slice(-LEVEL_POINTS)
      try {
        onLevel(levels.slice())
      } catch {
        /* 画波形失败不该打断录音 */
      }
    }, LEVEL_INTERVAL)

    const cap = Math.min(Number(speech.maxDurationSeconds) || SOFT_LIMIT_SECONDS, SOFT_LIMIT_SECONDS)
    limitTimer = setTimeout(() => {
      // 到点自动停，当作正常结束（不是错误）
      void finish()
    }, cap * 1000)
  }

  /** 停止录音并转写。返回转写文本，失败返回空串。 */
  async function finish() {
    if (!recording || recorder === null) return ''
    recording = false
    stopTimers()

    try {
      wav = await recorder.stop(speech.maxDurationSeconds || SOFT_LIMIT_SECONDS)
    } catch (error) {
      onError(recordingErrorText(error && error.kind ? error.kind : 'unknown'))
      return ''
    }

    if (cancelled) return ''
    if (wav === null || wav === undefined || (wav.length !== undefined && wav.length === 0)) {
      onError(recordingErrorText('empty'))
      return ''
    }

    try {
      const base64 = toBase64(wav)
      const transcript = await controller.transcribe(
        { audioBase64: base64, providerId: speech.providerId, language: speech.language },
        new AbortController().signal,
      )
      const text = transcript !== null && transcript !== undefined && typeof transcript.text === 'string' ? transcript.text : ''
      return text.trim()
    } catch (error) {
      const message = error && error.message ? String(error.message) : ''
      onError(message !== '' ? `识别失败：${message}` : '识别失败')
      return ''
    }
  }

  /** 取消：不转写，直接丢弃。 */
  function cancel() {
    cancelled = true
    recording = false
    stopTimers()
    if (recorder !== null) {
      try {
        void recorder.stop(speech.maxDurationSeconds || SOFT_LIMIT_SECONDS)
      } catch {
        /* 丢弃即可 */
      }
    }
  }

  return {
    attachRecorder,
    finish,
    cancel,
    isRecording: () => recording,
    levels: () => levels.slice(),
  }
}

/**
 * Uint8Array → base64。
 *
 * 不依赖 Buffer（浏览器里没有），也不依赖宿主导出的 `audioBase64` ——
 * 那个函数在平台种子表里不保证可 require，自己写 6 行更稳。
 */
export function toBase64(bytes) {
  if (bytes === null || bytes === undefined) return ''
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk))
  }
  if (typeof btoa === 'function') return btoa(binary)
  // Node 测试环境
  if (typeof Buffer !== 'undefined') return Buffer.from(view).toString('base64')
  return ''
}

// ---------------------------------------------------------------------------
// 采集：浏览器麦克风 → 16k 单声道 PCM16 WAV
// ---------------------------------------------------------------------------
//
// 移植自 `dsh-experimental-client-ui-voice-input` 的 Recording / encodeWave。
// 参数与顺序逐行一致，产物格式相同 —— 保证 `transcribe` 收到的和宿主自己录的一样。

/** 录音采样率。宿主固定 16k，不要改（改了 transcribe 会拒）。 */
const TARGET_RATE = 16000

/** 采集侧的失败类型，值与宿主的 RecordingError.kind 对齐。 */
export class CaptureError extends Error {
  constructor(kind) {
    super(kind)
    this.name = 'CaptureError'
    this.kind = kind
  }
}

/**
 * 把单声道 float 样本编码成 16k PCM16 WAV。
 * @param samples - -1~1 的样本
 * @returns WAV 字节
 */
export function encodeWave(samples) {
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
  view.setUint16(20, 1, true)          // PCM
  view.setUint16(22, 1, true)          // 单声道
  view.setUint32(24, TARGET_RATE, true)
  view.setUint32(28, TARGET_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)         // 16 bit
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
 * 生命周期与宿主的 Recording 一致：`start()` 开始，`stop(max)` 收尾并返回 WAV，
 * `dispose()` 无论如何都要释放（麦克风是独占资源）。
 */
export class Capture {
  constructor() {
    this.stream = null
    this.recorder = null
    this.context = null
    this.analyser = null
    this.samples = new Float32Array(256)
    this.chunks = []
    this.lifetime = typeof AbortController === 'function' ? new AbortController() : null
    this.disposal = null
    /** 中断回调。 */
    this.onError = null
  }

  /** 拿麦克风并起电平分析。 */
  async preview(onError) {
    this.onError = typeof onError === 'function' ? onError : null
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (devices === undefined || devices === null) throw new CaptureError('unavailable')

    let stream
    try {
      stream = await devices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch (error) {
      if (typeof DOMException === 'function' && error instanceof DOMException) {
        if (error.name === 'NotAllowedError') throw new CaptureError('permission')
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new CaptureError('deviceMissing')
      }
      throw error
    }

    if (this.lifetime !== null && this.lifetime.signal.aborted) {
      for (const track of stream.getTracks()) track.stop()
      throw new CaptureError('cancelled')
    }

    this.stream = stream
    try {
      this.context = new AudioContext()
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = this.samples.length
      this.context.createMediaStreamSource(stream).connect(this.analyser)
      for (const track of stream.getTracks()) {
        track.addEventListener(
          'ended',
          () => this.interrupted(),
          this.lifetime === null ? undefined : { signal: this.lifetime.signal },
        )
      }
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  /** 开始录音。 */
  async start(onError) {
    if (typeof MediaRecorder === 'undefined') throw new CaptureError('unavailable')
    await this.preview(onError)
    if (this.lifetime !== null && this.lifetime.signal.aborted) throw new CaptureError('cancelled')
    try {
      this.recorder = new MediaRecorder(this.stream)
      this.recorder.ondataavailable = (event) => {
        if (!(this.lifetime !== null && this.lifetime.signal.aborted) && event.data.size > 0) {
          this.chunks.push(event.data)
        }
      }
      this.recorder.onerror = () => this.interrupted()
      this.recorder.start()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  /** 设备被拔掉 / 录音器报错。 */
  interrupted() {
    if (this.lifetime !== null && this.lifetime.signal.aborted) return
    void this.dispose()
    if (this.onError !== null) {
      try {
        this.onError(new CaptureError('interrupted'))
      } catch {
        /* 回调失败不该影响释放 */
      }
    }
  }

  /** 当前电平（RMS）。 */
  amplitude() {
    if (this.analyser === null || this.analyser === undefined) return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    return Math.sqrt(sum / this.samples.length)
  }

  /**
   * 收尾并重采样。
   * @param maxDurationSeconds - 截断到宿主的时长上限
   * @returns WAV 字节
   */
  async stop(maxDurationSeconds) {
    const recorder = this.recorder
    const context = this.context
    if (recorder === null || context === null || recorder.state !== 'recording') {
      await this.dispose()
      throw new CaptureError('empty')
    }
    try {
      await new Promise((resolve, reject) => {
        recorder.onstop = () => resolve()
        recorder.onerror = () => reject(new CaptureError('empty'))
        recorder.stop()
      })
      if (this.stream !== null) for (const track of this.stream.getTracks()) track.stop()
      if (this.lifetime !== null) this.lifetime.signal.throwIfAborted()

      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      if (blob.size === 0) throw new CaptureError('empty')

      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      if (this.lifetime !== null) this.lifetime.signal.throwIfAborted()

      const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * TARGET_RATE))
      const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const resampled = await offline.startRendering()
      if (this.lifetime !== null) this.lifetime.signal.throwIfAborted()

      return encodeWave(resampled.getChannelData(0))
    } finally {
      await this.dispose()
    }
  }

  /** 释放。麦克风是独占资源，无论成功失败都要走到这里。 */
  dispose() {
    if (this.disposal === null) {
      this.disposal = this.release()
    }
    return this.disposal
  }

  async release() {
    if (this.lifetime !== null && !this.lifetime.signal.aborted) {
      try {
        this.lifetime.abort(new CaptureError('cancelled'))
      } catch {
        /* 已 abort 过 */
      }
    }
    if (this.recorder !== null && this.recorder.state === 'recording') {
      try {
        this.recorder.stop()
      } catch {
        /* 已停 */
      }
    }
    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) track.stop()
    }
    this.stream = null
    const context = this.context
    this.context = null
    this.analyser = null
    this.chunks = []
    if (context !== null && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        /* 关不掉也不影响下一轮 */
      }
    }
  }
}

export const internals = { SOFT_LIMIT_SECONDS, LEVEL_POINTS, TARGET_RATE }
