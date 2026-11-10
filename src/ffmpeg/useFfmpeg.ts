import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { ref } from 'vue'
import {
  buildFfmpegArgs,
  buildImageFfmpegArgs,
  buildFrameExtractArgs,
  buildAudioExtractArgs,
  buildMergeArgs,
  buildGlitchVideoOnlyArgs,
  buildMergeAudioOnlyArgs,
  buildMuxArgs,
  computeMergeOutputDuration,
  type EditSettings,
  type ImageEditSettings,
  type TransitionType,
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
// Núcleo multi-hilo: usa varios núcleos del procesador en vez de uno solo,
// bastante más rápido — pero el navegador solo lo deja funcionar en una
// página "cross-origin isolated" (cabeceras COOP/COEP, activadas acá vía el
// service worker propio, `src/sw.js` — GitHub Pages no permite ponerlas
// directo). Si por lo que sea esa condición no se cumple (navegador viejo,
// primera visita antes de que el service worker tome control, etc.), cae
// solo al núcleo de un hilo de siempre — nunca deja de funcionar, solo más
// lento en ese caso.
const CORE_BASE_MT = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`

export function useFfmpeg() {
  const ffmpeg = new FFmpeg()
  const loaded = ref(false)
  const loading = ref(false)
  const progress = ref(0)
  const logLines = ref<string[]>([])
  // "Unir videos" calcula su propio progreso (ver runMerge) porque el que
  // reporta ffmpeg.wasm no es confiable con un filtro tan complejo — esta
  // bandera evita que el evento nativo lo pise mientras tanto.
  let useNativeProgress = true

  ffmpeg.on('log', ({ message }) => {
    logLines.value.push(message)
    if (logLines.value.length > 200) logLines.value.shift()
  })
  ffmpeg.on('progress', ({ progress: p }) => {
    if (!useNativeProgress) return
    progress.value = Math.min(1, Math.max(0, p))
  })

  // "Unir videos" (runMerge) NUNCA pide el núcleo multi-hilo — probado
  // directo (2026-11-09): con un filtro "-filter_complex" de varios clips
  // (concat o cualquier transición, el problema no era "Glitch" en
  // particular) el núcleo multi-hilo se cuelga en seco apenas arranca,
  // sin avisar error ni seguir avanzando — confirmado con 2 Y con 5 clips,
  // ambos casos se trabaron igual. La edición de un solo archivo (sin
  // "-filter_complex" con varios "-i") sí funciona bien y rápido con el
  // núcleo multi-hilo — se deja así hasta que se entienda la causa real.
  async function load(preferMultiThread = true) {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      if (preferMultiThread && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${CORE_BASE_MT}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${CORE_BASE_MT}/ffmpeg-core.wasm`, 'application/wasm'),
            workerURL: await toBlobURL(`${CORE_BASE_MT}/ffmpeg-core.worker.js`, 'text/javascript'),
          })
          loaded.value = true
          return
        } catch {
          // Algo falló cargando el núcleo multi-hilo (ej. el navegador
          // anunció "cross-origin isolated" pero el archivo .worker.js no
          // cargó) — seguir con el de un hilo en vez de dejar la app sin
          // poder editar nada.
        }
      }
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
      const lastLines = logLines.value.slice(-60).join('\n')
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
      const lastLines = logLines.value.slice(-60).join('\n')
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
      const lastLines = logLines.value.slice(-60).join('\n')
      throw new Error(`No se pudo capturar el fotograma (${String(lastError)}): ${lastLines}`)
    }

    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'image/png' })
  }

  async function runExtractAudio(file: File): Promise<Blob> {
    await load()

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
    const inputName = `input.${extension}`
    const outputName = 'audio.mp3'

    progress.value = 0
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    const args = buildAudioExtractArgs(inputName, outputName)
    const exitCode = await ffmpeg.exec(args)

    if (exitCode !== 0) {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
      // La causa más común de que esto falle es que el video no tenga
      // ninguna pista de audio (grabaciones de pantalla mudas, etc.) — "-vn"
      // sin audio que sacar no tiene nada que escribir y ffmpeg sale con
      // error en vez de generar un mp3 vacío.
      throw new Error('Este archivo no tiene pista de audio, o no se pudo extraer.')
    }

    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})

    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'audio/mpeg' })
  }

  async function runMerge(
    clips: { file: File; trimStart: number; trimEnd: number; hasAudio: boolean }[],
    targetWidth: number,
    targetHeight: number,
    music: File | null,
    musicVolume: number,
    transition: TransitionType = 'none',
  ): Promise<Blob> {
    await load(false)
    progress.value = 0

    const inputNames: string[] = []
    for (let i = 0; i < clips.length; i++) {
      const rawExt = clips[i].file.name.includes('.') ? clips[i].file.name.split('.').pop() : 'mp4'
      const name = `clip${i}.${rawExt}`
      await ffmpeg.writeFile(name, await fetchFile(clips[i].file))
      inputNames.push(name)
    }

    let musicName: string | null = null
    if (music) {
      const rawExt = music.name.includes('.') ? music.name.split('.').pop() : 'mp3'
      musicName = `music.${rawExt}`
      await ffmpeg.writeFile(musicName, await fetchFile(music))
    }

    const mergeClips = clips.map((c, i) => ({
      inputName: inputNames[i],
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      hasAudio: c.hasAudio,
    }))
    const outputName = 'merged.mp4'

    // El "progress" que reporta ffmpeg.wasm no es confiable en un filtro tan
    // complejo como este (varios clips + transición) — llega a 100% mucho
    // antes de que la codificación realmente termine, confirmado probando
    // con 5 clips reales (2026-11-09): el progreso marcaba "listo" mientras
    // ffmpeg seguía codificando varios minutos más, dejando al usuario
    // pensando que la app se quedó pegada. En su lugar, se calcula el
    // progreso real leyendo "time=HH:MM:SS.cc" de las últimas líneas del
    // log de ffmpeg contra la duración real esperada del video final.
    const expectedDuration = computeMergeOutputDuration(clips, transition)
    const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/
    useNativeProgress = false
    function watchProgress(min: number, max: number) {
      return window.setInterval(() => {
        for (let i = logLines.value.length - 1; i >= Math.max(0, logLines.value.length - 5); i--) {
          const match = TIME_RE.exec(logLines.value[i])
          if (match) {
            const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
            if (expectedDuration > 0) {
              progress.value = Math.min(max, min + (max - min) * (seconds / expectedDuration))
            }
            break
          }
        }
      }, 400)
    }

    const cleanupNames = [...inputNames]
    if (musicName) cleanupNames.push(musicName)
    const cleanup = async () => {
      for (const name of cleanupNames) await ffmpeg.deleteFile(name).catch(() => {})
    }

    try {
      // "Glitch" arma el video (pesado, con docenas de ramas de crop/overlay)
      // y el audio (liviano, el mismo cruce que usan las otras transiciones)
      // en DOS pasadas de ffmpeg separadas en vez de una sola, y las mezcla
      // al final con una tercera pasada rápida ("-c copy", sin recodificar).
      // Arreglo a un bug real (2026-11-10): mezclando los dos filtros en un
      // solo paso, el audio de algunos clips se perdía (el video del filtro
      // de "Glitch" competía por recursos con el audio del mismo clip) — ver
      // la nota completa en `buildGlitchVideoOnlyArgs`, en commandBuilder.ts.
      if (transition === 'glitch') {
        const videoOnlyName = 'merged_video.mp4'
        const audioOnlyName = 'merged_audio.m4a'
        cleanupNames.push(videoOnlyName, audioOnlyName, outputName)

        const videoArgs = buildGlitchVideoOnlyArgs(mergeClips, targetWidth, targetHeight, videoOnlyName)
        let timer = watchProgress(0, 0.85)
        let exitCode: number
        try {
          exitCode = await ffmpeg.exec(videoArgs)
        } finally {
          window.clearInterval(timer)
        }
        if (exitCode !== 0) {
          const lastLines = logLines.value.slice(-60).join('\n')
          throw new Error(`No se pudo unir los videos (código ${exitCode}): ${lastLines}`)
        }

        const audioArgs = buildMergeAudioOnlyArgs(mergeClips, musicName, musicVolume, audioOnlyName)
        timer = watchProgress(0.85, 0.97)
        try {
          exitCode = await ffmpeg.exec(audioArgs)
        } finally {
          window.clearInterval(timer)
        }
        if (exitCode !== 0) {
          const lastLines = logLines.value.slice(-60).join('\n')
          throw new Error(`No se pudo unir los videos (código ${exitCode}): ${lastLines}`)
        }

        progress.value = 0.98
        const muxArgs = buildMuxArgs(videoOnlyName, audioOnlyName, outputName)
        exitCode = await ffmpeg.exec(muxArgs)
        if (exitCode !== 0) {
          const lastLines = logLines.value.slice(-60).join('\n')
          throw new Error(`No se pudo unir los videos (código ${exitCode}): ${lastLines}`)
        }
      } else {
        cleanupNames.push(outputName)
        const args = buildMergeArgs(mergeClips, targetWidth, targetHeight, musicName, musicVolume, outputName, transition)
        const timer = watchProgress(0, 0.99)
        let exitCode: number
        try {
          exitCode = await ffmpeg.exec(args)
        } finally {
          window.clearInterval(timer)
        }
        if (exitCode !== 0) {
          const lastLines = logLines.value.slice(-60).join('\n')
          throw new Error(`No se pudo unir los videos (código ${exitCode}): ${lastLines}`)
        }
      }
    } catch (err) {
      await cleanup()
      useNativeProgress = true
      throw err
    }

    const data = await ffmpeg.readFile(outputName)
    await cleanup()
    useNativeProgress = true
    progress.value = 1

    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data
    return new Blob([bytes], { type: 'video/mp4' })
  }

  return { loaded, loading, progress, logLines, load, runEdit, runImageEdit, runExtractFrame, runExtractAudio, runMerge }
}
