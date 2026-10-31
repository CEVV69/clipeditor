import { ref, shallowRef } from 'vue'
import { loadYouTubeIframeApi } from './loadIframeApi'

export type ImportState = 'idle' | 'loading' | 'ready' | 'recording' | 'done' | 'error'
export type RecordingQuality = '1080p' | '4k'

const ERROR_MESSAGES: Record<number, string> = {
  2: 'Ese link no parece válido.',
  5: 'YouTube no pudo reproducir este video en este navegador.',
  100: 'No se encontró ese video — puede haber sido eliminado o ser privado.',
  101: 'Quien subió este video desactivó la opción de incrustarlo en otros sitios. Ábrelo directo en youtube.com.',
  150: 'Quien subió este video desactivó la opción de incrustarlo en otros sitios. Ábrelo directo en youtube.com.',
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (window.MediaRecorder?.isTypeSupported(candidate)) return candidate
  }
  return ''
}

export function useYoutubeImport() {
  const state = ref<ImportState>('idle')
  const errorMessage = ref('')
  const title = ref('')
  const duration = ref(0)
  const currentTime = ref(0)
  const resultFile = shallowRef<File | null>(null)

  let player: YT.Player | null = null
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let progressTimer: number | null = null
  let containerEl: HTMLElement | null = null
  let onPlayingOnce: (() => void) | null = null
  // Si se pidió un tramo (no todo el video), tope en segundos donde la
  // grabación se detiene sola — null cuando se grabó desde "Grabar" sin
  // elegir tramo, o ya se usó y hay que dejar de chequearlo.
  let autoStopAt: number | null = null

  function stopProgressTimer() {
    if (progressTimer !== null) {
      window.clearInterval(progressTimer)
      progressTimer = null
    }
  }

  function destroyPlayer() {
    stopProgressTimer()
    player?.destroy()
    player = null
  }

  // Esc (o cualquier salida de pantalla completa) durante la grabación se
  // trata como "Detener y usar" — no hay un botón visible encima del video
  // en pantalla completa para hacerlo de otra forma.
  function onFullscreenChange() {
    if (!document.fullscreenElement && state.value === 'recording') {
      stopRecording()
    }
  }

  async function exitFullscreenIfActive() {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        // No hay nada más que hacer si el navegador no la deja cerrar.
      }
    }
  }

  // Usa el mismo evento oficial del reproductor (onStateChange) que ya
  // detecta de forma confiable cuándo el video termina, en vez de preguntar
  // el estado a cada rato — así se sabe de verdad cuándo arrancó.
  function waitForPlaying(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        onPlayingOnce = null
        resolve()
      }
      onPlayingOnce = finish
      window.setTimeout(finish, timeoutMs)
    })
  }

  function finishRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  // `mountEl` es reemplazado por YouTube con su propio <iframe> — por eso
  // la pantalla completa se pide sobre `wrapperEl`, que nunca se toca y
  // sigue conteniendo ese iframe como hijo.
  async function load(mountEl: HTMLElement, wrapperEl: HTMLElement, videoId: string): Promise<void> {
    destroyPlayer()
    containerEl = wrapperEl
    state.value = 'loading'
    errorMessage.value = ''
    resultFile.value = null

    const YTApi = await loadYouTubeIframeApi()

    return new Promise((resolve) => {
      player = new YTApi.Player(mountEl, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
        },
        events: {
          onReady: (e) => {
            duration.value = e.target.getDuration()
            try {
              title.value = e.target.getVideoData().title ?? ''
            } catch {
              title.value = ''
            }
            state.value = 'ready'
            resolve()
          },
          onError: (e) => {
            errorMessage.value = ERROR_MESSAGES[e.data] ?? 'No se pudo cargar ese video.'
            state.value = 'error'
            resolve()
          },
          onStateChange: (e) => {
            if (e.data === YTApi.PlayerState.ENDED) finishRecording()
            if (e.data === YTApi.PlayerState.PLAYING) onPlayingOnce?.()
          },
        },
      })
    })
  }

  async function startRecording(
    useFullscreen: boolean,
    quality: RecordingQuality = '1080p',
    startTime = 0,
    endTime: number | null = null,
  ) {
    if (!player) return
    errorMessage.value = ''
    autoStopAt = endTime !== null && endTime > startTime ? endTime : null

    // Sin tope, graba al tamaño físico real de la pantalla (2x-3x más
    // píxeles que 1080p en una pantalla Retina) y sin límite de cuadros por
    // segundo — luego cualquier edición recodifica ese archivo con un solo
    // hilo (ver GOTCHAS.md) y se vuelve brutalmente lento. Por eso 1080p es
    // la opción por defecto; "4k" queda disponible para quien lo pida a
    // propósito, sabiendo que la edición después será más lenta.
    const videoConstraints =
      quality === '4k'
        ? true
        : { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } }

    let capturedStream: MediaStream
    try {
      capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: true,
        ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as Record<string, unknown>),
      } as DisplayMediaStreamOptions)
    } catch {
      errorMessage.value = 'No se compartió ninguna pestaña ni ventana, no se pudo grabar.'
      state.value = 'error'
      return
    }

    // Pedirla recién ahora (y no antes de elegir qué compartir) evita que
    // el navegador la cancele sola al mostrar el diálogo del sistema
    // encima de una página en pantalla completa.
    if (useFullscreen && containerEl) {
      try {
        await containerEl.requestFullscreen()
      } catch {
        // Si la rechaza, se sigue igual sin pantalla completa.
      }
    }

    stream = capturedStream

    const mimeType = pickMimeType()
    const chunks: Blob[] = []
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

    mr.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data)
    }

    mr.onstop = () => {
      stopProgressTimer()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      exitFullscreenIfActive()
      stream?.getTracks().forEach((t) => t.stop())
      stream = null

      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
        resultFile.value = new File([blob], 'youtube-import.webm', { type: blob.type })
        state.value = 'done'
      } else {
        errorMessage.value = 'No se alcanzó a grabar nada, intenta de nuevo.'
        state.value = 'error'
      }
    }

    recorder = mr

    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (mr.state !== 'inactive') mr.stop()
    })
    document.addEventListener('fullscreenchange', onFullscreenChange)

    // Si se eligió un tramo, saltar a su inicio ANTES de reproducir — así
    // no se grava ni un segundo de lo que queda antes del minuto pedido.
    if (startTime > 0) {
      player.seekTo(startTime, true)
    }

    // Arranca la reproducción y espera a que de verdad empiece antes de
    // grabar — si no, el primer instante muestra la miniatura/título
    // pausado de YouTube en vez del video.
    player.playVideo()
    await waitForPlaying()

    mr.start()
    state.value = 'recording'

    progressTimer = window.setInterval(() => {
      const t = player?.getCurrentTime() ?? 0
      currentTime.value = t
      // Grabación con tramo: se detiene sola al llegar al fin pedido, igual
      // que si el video hubiese terminado ahí.
      if (autoStopAt !== null && t >= autoStopAt) {
        autoStopAt = null
        player?.pauseVideo()
        finishRecording()
      }
    }, 500)
  }

  // Detener a mano guarda lo grabado hasta ese momento, igual que cuando el
  // video termina solo — no se bota nada.
  function stopRecording() {
    player?.pauseVideo()
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  // Antes de empezar a grabar sí tiene sentido un cancelar que bote todo:
  // vuelve a la pantalla inicial sin dejar nada a medias.
  function cancelReady() {
    reset()
  }

  function reset() {
    destroyPlayer()
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    exitFullscreenIfActive()
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    recorder = null
    containerEl = null
    onPlayingOnce = null
    autoStopAt = null
    state.value = 'idle'
    errorMessage.value = ''
    title.value = ''
    duration.value = 0
    currentTime.value = 0
    resultFile.value = null
  }

  return {
    state,
    errorMessage,
    title,
    duration,
    currentTime,
    resultFile,
    load,
    startRecording,
    stopRecording,
    cancelReady,
    reset,
  }
}
