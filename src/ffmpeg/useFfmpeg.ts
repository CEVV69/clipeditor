import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { ref } from 'vue'
import {
  buildFfmpegArgs,
  buildImageFfmpegArgs,
  buildFrameExtractArgs,
  type EditSettings,
  type ImageEditSettings,
} from './commandBuilder'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

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
    const exitCode = await ffmpeg.exec(args)

    // Un exitCode distinto de cero significa que el procesamiento falló
    // (filtro inválido, archivo no soportado, etc.); si seguimos de largo,
    // "output.mp4" queda vacío o incompleto y el video resultante ni
    // siquiera se puede reproducir, sin ningún aviso del porqué.
    if (exitCode !== 0) {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
      const lastLines = logLines.value.slice(-5).join(' | ')
      throw new Error(`El procesamiento falló (código ${exitCode}): ${lastLines}`)
    }

    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    // readFile puede devolver un Uint8Array respaldado por SharedArrayBuffer,
    // que TS no deja pasar directo a BlobPart; copiarlo a un buffer normal
    // evita el error de tipos sin cambiar los bytes.
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'video/mp4' })
  }

  async function runImageEdit(file: File, settings: ImageEditSettings): Promise<Blob> {
    await load()

    const rawExtension = (file.name.includes('.') ? file.name.split('.').pop() : 'png') ?? 'png'
    const extension = rawExtension.toLowerCase() in IMAGE_MIME ? rawExtension.toLowerCase() : 'png'
    const inputName = `input.${extension}`
    const outputName = `output.${extension}`

    progress.value = 0
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    const args = buildImageFfmpegArgs(inputName, outputName, settings)
    const exitCode = await ffmpeg.exec(args)

    if (exitCode !== 0) {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
      const lastLines = logLines.value.slice(-5).join(' | ')
      throw new Error(`El procesamiento falló (código ${exitCode}): ${lastLines}`)
    }

    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: IMAGE_MIME[extension] })
  }

  // El punto exacto que pide el usuario a veces no tiene un fotograma propio
  // ahí (sobre todo pegado al final del video: el último fotograma real
  // puede quedar antes de la duración reportada por el contenedor, por una
  // tasa de cuadros variable o metadata de duración poco precisa). Si
  // ffmpeg no encuentra nada en ese instante, se reintenta un poco antes,
  // cada vez más atrás, antes de darlo por fallado.
  const EXTRACT_RETRY_STEPS = [0, 0.15, 0.4, 0.8, 1.5]

  async function runExtractFrame(file: File, timestamp: number): Promise<Blob> {
    await load()

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
    const inputName = `input.${extension}`
    const outputName = 'frame.png'

    progress.value = 0
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    // Además de un exitCode distinto de cero, "exec" puede directamente
    // lanzar una excepción (en vez de devolver un código) cuando el punto
    // pedido cae fuera de lo que el archivo realmente tiene — ambos casos
    // cuentan como "este intento falló, probar el siguiente margen".
    let data: Awaited<ReturnType<typeof ffmpeg.readFile>> | null = null
    let lastError: unknown = null
    for (const back of EXTRACT_RETRY_STEPS) {
      const t = Math.max(0, timestamp - back)
      const args = buildFrameExtractArgs(inputName, outputName, t)
      try {
        const exitCode = await ffmpeg.exec(args)
        if (exitCode === 0) {
          data = await ffmpeg.readFile(outputName)
          await ffmpeg.deleteFile(outputName).catch(() => {})
          break
        }
        lastError = new Error(`código ${exitCode}`)
      } catch (err) {
        lastError = err
      }
      await ffmpeg.deleteFile(outputName).catch(() => {})
    }

    await ffmpeg.deleteFile(inputName).catch(() => {})

    if (!data) {
      const lastLines = logLines.value.slice(-5).join(' | ')
      throw new Error(`No se pudo capturar el fotograma (${String(lastError)}): ${lastLines}`)
    }

    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'image/png' })
  }

  return { loaded, loading, progress, logLines, load, runEdit, runImageEdit, runExtractFrame }
}
