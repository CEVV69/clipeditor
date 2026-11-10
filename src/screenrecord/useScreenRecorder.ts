import { ref, shallowRef } from 'vue'

export type ScreenRecordState = 'idle' | 'recording' | 'done' | 'error'

// Independiente de "Importar de YouTube" (`useYoutubeImport.ts`) a propósito
// — ese otro está hecho a la medida de un reproductor embebido (play/pause,
// buscar tiempo, pantalla completa sobre el video) y es riesgoso de tocar.
// Esto es mucho más simple: compartir pantalla/ventana/pestaña y grabar tal
// cual, sin reproductor de por medio.
const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (window.MediaRecorder?.isTypeSupported(candidate)) return candidate
  }
  return ''
}

export function useScreenRecorder() {
  const state = ref<ScreenRecordState>('idle')
  const errorMessage = ref('')
  const elapsedSeconds = ref(0)
  const resultFile = shallowRef<File | null>(null)

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let timer: number | null = null
  let startedAt = 0

  function stopTimer() {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  async function startRecording() {
    errorMessage.value = ''
    resultFile.value = null

    let capturedStream: MediaStream
    try {
      capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 30 } },
        audio: true,
      })
    } catch {
      // El usuario cerró el diálogo del sistema sin elegir nada, o lo
      // bloqueó el navegador — no es un error real, se queda tal cual
      // estaba (sin pasar a "error") para poder intentar de nuevo.
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
      stopTimer()
      stream?.getTracks().forEach((t) => t.stop())
      stream = null

      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
        resultFile.value = new File([blob], 'grabacion-pantalla.webm', { type: blob.type })
        state.value = 'done'
      } else {
        errorMessage.value = 'No se alcanzó a grabar nada, intenta de nuevo.'
        state.value = 'error'
      }
    }

    recorder = mr

    // Si el usuario cierra la ventana/pestaña compartida (o aprieta "Dejar
    // de compartir" en el aviso del navegador) en vez de usar el botón
    // propio, se guarda igual lo grabado hasta ese momento.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (mr.state !== 'inactive') mr.stop()
    })

    mr.start()
    state.value = 'recording'
    startedAt = Date.now()
    elapsedSeconds.value = 0
    timer = window.setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
    }, 500)
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  function reset() {
    stopTimer()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    recorder = null
    state.value = 'idle'
    errorMessage.value = ''
    elapsedSeconds.value = 0
    resultFile.value = null
  }

  return { state, errorMessage, elapsedSeconds, resultFile, startRecording, stopRecording, reset }
}
