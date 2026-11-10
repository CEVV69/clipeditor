import { ref, shallowRef } from 'vue'
import { useFfmpeg } from '../ffmpeg/useFfmpeg'

export type ScreenRecordState = 'idle' | 'recording' | 'fixing' | 'done' | 'error'

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
  const { progress: fixProgress, runFixContainer } = useFfmpeg()

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
        // Sin esto, Chrome aplica de regalo el procesamiento pensado para un
        // micrófono (cancelación de eco, control automático de ganancia,
        // reducción de ruido) al audio de pantalla/pestaña capturado —
        // reportado por el usuario como "se escucha bien 5 segundos y
        // después baja de volumen sin razón": es el control automático de
        // ganancia "calibrándose" sobre un audio que no es una voz de
        // micrófono. Pidiendo estas tres en `false` se graba el audio tal
        // cual, sin ese procesamiento de más.
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
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

    mr.onstop = async () => {
      stopTimer()
      stream?.getTracks().forEach((t) => t.stop())
      stream = null

      if (chunks.length === 0) {
        errorMessage.value = 'No se alcanzó a grabar nada, intenta de nuevo.'
        state.value = 'error'
        return
      }

      const rawFile = new File(chunks, 'grabacion-pantalla.webm', { type: mimeType || 'video/webm' })

      // El .webm que entrega "MediaRecorder" trae problemas reales para
      // editar después (duración ausente en la cabecera, fotogramas clave
      // muy espaciados que rompen el recorte/reproducción cerca del inicio)
      // — se convierte a .mp4 (h264/aac) antes de entregarlo. Ver la nota
      // completa en `buildFixContainerArgs`, en commandBuilder.ts.
      state.value = 'fixing'
      try {
        const fixedBlob = await runFixContainer(rawFile)
        resultFile.value = new File([fixedBlob], 'grabacion-pantalla.mp4', { type: fixedBlob.type })
      } catch {
        // Si la conversión falla por algún motivo, mejor entregar el
        // archivo crudo (puede que igual se reproduzca bien en algunos
        // casos) que dejar al usuario sin nada.
        resultFile.value = rawFile
      }
      state.value = 'done'
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

  return { state, errorMessage, elapsedSeconds, resultFile, fixProgress, startRecording, stopRecording, reset }
}
