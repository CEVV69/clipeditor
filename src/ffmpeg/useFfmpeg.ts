import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { ref } from 'vue'
import { buildFfmpegArgs, type EditSettings } from './commandBuilder'

// Mismo paquete que usa 123apps por debajo: FFmpeg compilado a WebAssembly,
// corriendo dentro de un Web Worker para no congelar la interfaz. El video
// nunca sale del navegador del usuario.
const CORE_VERSION = '0.12.6'
// El build "esm" es el que carga @ffmpeg/ffmpeg dentro de su propio Worker
// con import() dinámico; el build "umd" (pensado para <script> clásico) da
// "failed to import ffmpeg-core.js" si se usa aquí.
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`

export function useFfmpeg() {
  const ffmpeg = new FFmpeg()
  const loaded = ref(false)
  const loading = ref(false)
  const progress = ref(0)
  const logLines = ref<string[]>([])

  ffmpeg.on('log', ({ message }) => {
    logLines.value.push(message)
    if (logLines.value.length > 200) logLines.value.shift()
  })
  ffmpeg.on('progress', ({ progress: p }) => {
    progress.value = Math.min(1, Math.max(0, p))
  })

  async function load() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function runEdit(file: File, settings: EditSettings): Promise<Blob> {
    await load()

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
    const inputName = `input.${extension}`
    const outputName = 'output.mp4'

    progress.value = 0
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    const args = buildFfmpegArgs(inputName, outputName, settings)
    await ffmpeg.exec(args)

    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    // readFile puede devolver un Uint8Array respaldado por SharedArrayBuffer,
    // que TS no deja pasar directo a BlobPart; copiarlo a un buffer normal
    // evita el error de tipos sin cambiar los bytes.
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'video/mp4' })
  }

  return { loaded, loading, progress, logLines, load, runEdit }
}
