import { ref, shallowRef } from 'vue'
import { loadYouTubeIframeApi } from './loadIframeApi'

export type ImportState = 'idle' | 'loading' | 'ready' | 'recording' | 'done' | 'error'

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

  function finishRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  async function load(element: HTMLElement, videoId: string): Promise<void> {
    destroyPlayer()
    state.value = 'loading'
    errorMessage.value = ''
    resultFile.value = null

    const YTApi = await loadYouTubeIframeApi()

    return new Promise((resolve) => {
      player = new YTApi.Player(element, {
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
          },
        },
      })
    })
  }

  async function startRecording() {
    if (!player) return
    errorMessage.value = ''

    let capturedStream: MediaStream
    try {
      capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as Record<string, unknown>),
      } as DisplayMediaStreamOptions)
    } catch {
      errorMessage.value = 'No se compartió ninguna pestaña ni ventana, no se pudo grabar.'
      state.value = 'error'
      return
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

    mr.start()
    state.value = 'recording'
    player.playVideo()

    progressTimer = window.setInterval(() => {
      currentTime.value = player?.getCurrentTime() ?? 0
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
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    recorder = null
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
