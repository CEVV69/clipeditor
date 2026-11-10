// Construye los argumentos de ffmpeg a partir de la edición elegida en la UI,
// igual a como lo hace el editor de 123apps: un solo paso de ffmpeg que
// recorta, ajusta volumen/velocidad y tapa hasta 3 logos si se pidió.

/**
 * Tope de bitrate para la salida — sin esto, `libx264` con CRF por defecto
 * puede disparar el peso (y el tiempo) del archivo final muchísimo más allá
 * de lo razonable en video con mucho detalle/movimiento (una grabación de
 * pantalla, texto en movimiento, etc.): confirmado con una prueba real
 * (2026-11-09) donde "Unir videos" con 5 clips de prueba de 1080p/90s —
 * fuente a 6 Mbps — terminó codificando a MÁS DE 16 Mbps, a 0.82x tiempo
 * real (más lento que reproducirlo), con la salida creciendo sin freno.
 * Estos topes (`-maxrate`/`-bufsize`, el doble como buffer VBV estándar)
 * mantienen el archivo final en un tamaño/tiempo predecible sin tocar la
 * calidad visible en el caso normal (solo entran en juego cuando el
 * contenido es tan complejo que el CRF por sí solo se dispara).
 */
function bitrateCapArgs(width: number, height: number): string[] {
  const area = width * height
  let maxrateMbps: number
  if (area <= 1280 * 720) maxrateMbps = 5
  else if (area <= 1920 * 1080) maxrateMbps = 8
  else if (area <= 2560 * 1440) maxrateMbps = 14
  else maxrateMbps = 20
  return ['-maxrate', `${maxrateMbps}M`, '-bufsize', `${maxrateMbps * 2}M`]
}

export interface LogoRegion {
  /** Coordenadas y tamaño en píxeles reales del video (no de la pantalla). */
  x: number
  y: number
  width: number
  height: number
}

/** Igual forma que LogoRegion: el rectángulo que se conserva al recortar. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface EditSettings {
  /** Segundo de inicio del recorte. */
  trimStart: number
  /** Segundo de fin del recorte. */
  trimEnd: number
  /** 1 = volumen original, 0 = mudo, 2 = el doble, etc. */
  volume: number
  /** 1 = velocidad original, 0.5 = mitad, 2 = el doble. */
  speed: number
  /** Zonas a tapar, hasta 3; vacío si no se marcó ninguna. */
  logoRegions: LogoRegion[]
  /** Resolución real del video, para no dejar que ninguna zona se pase del borde. */
  frameWidth: number
  frameHeight: number
  /** Recorte de proporción/encuadre, o null si se exporta el fotograma completo. */
  cropRect: CropRect | null
  /** Giro en sentido horario, en grados. */
  rotation: 0 | 90 | 180 | 270
  flipHorizontal: boolean
  flipVertical: boolean
}

/**
 * ffmpeg solo acepta atempo entre 0.5 y 2.0 por filtro, así que una
 * velocidad fuera de ese rango hay que encadenarla en varios pasos.
 */
function buildAtempoChain(speed: number): string[] {
  if (speed <= 0) return []
  const filters: string[] = []
  let remaining = speed
  while (remaining < 0.5 || remaining > 2.0) {
    const step = remaining > 2.0 ? 2.0 : 0.5
    filters.push(`atempo=${step}`)
    remaining = remaining / step
  }
  filters.push(`atempo=${remaining.toFixed(4)}`)
  return filters
}

/**
 * Tapa cada zona en tres pasos:
 * 1. "delogo" interpola el contenido de la zona a partir de los píxeles del
 *    borde, fotograma a fotograma — no es una reconstrucción inteligente del
 *    fondo (eso requeriría un modelo de IA, inviable 100% en el navegador),
 *    pero sí se recalcula en cada fotograma, así que sigue en algo los
 *    cambios del video en vez de quedar fija.
 * 2. Un anillo alrededor de la zona, un poco más grande que lo marcado, se
 *    desenfoca suave.
 * 3. La zona marcada en sí se desenfoca fuerte, encima del anillo.
 * El resultado de encadenar un desenfoque suave y otro fuerte es que la
 * transición hacia el video sin tocar queda en dos saltos pequeños en vez de
 * uno solo y brusco — se nota bastante menos el "parche" que con un único
 * desenfoque de borde recto. No hay forma de desvanecer el borde
 * gradualmente píxel a píxel sin mezclar transparencias (eso exige filtros
 * de alfa que este núcleo de ffmpeg no tiene garantizado, y ya falló una vez
 * con algo tan simple como el parámetro "band" de delogo), así que esto es
 * lo más fino que da sin arriesgar que la exportación vuelva a romperse.
 * Devuelve el fragmento de filtro y la etiqueta de su salida final, o null
 * si no hay ninguna zona marcada.
 */
function buildLogoFilter(
  regions: LogoRegion[],
  frameWidth: number,
  frameHeight: number,
): { chain: string; outputLabel: string } | null {
  if (regions.length === 0) return null

  // El filtro que tapa cada zona exige que quede estrictamente dentro del
  // fotograma: si toca el borde exacto (x+w == frameWidth, por ejemplo) lo
  // rechaza igual que si se pasara, con "Logo area is outside of the frame"
  // y aborta todo el procesamiento. MARGIN deja siempre un par de píxeles
  // de aire en cada borde para que ni ese caso límite ni un redondeo
  // posterior lo hagan fallar.
  const MARGIN = 2
  const PAD = 14 // ancho del anillo de transición alrededor de cada zona

  const boxes = regions.map((r) => {
    // Redondear x/y y ancho/alto por separado puede sumar hasta 1px más que
    // el borde real del video (ej. x=575.5→576 y width=64.5→65 ya suman
    // 641 sobre un cuadro de 640), así que los bordes derecho/inferior se
    // redondean como tales (no width/height sueltos) antes de acotarlos.
    const x = Math.max(MARGIN, Math.round(r.x))
    const y = Math.max(MARGIN, Math.round(r.y))
    const right = Math.min(frameWidth - MARGIN, Math.round(r.x + r.width))
    const bottom = Math.min(frameHeight - MARGIN, Math.round(r.y + r.height))
    const inner = { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }

    const outerX = Math.max(MARGIN, inner.x - PAD)
    const outerY = Math.max(MARGIN, inner.y - PAD)
    const outerRight = Math.min(frameWidth - MARGIN, right + PAD)
    const outerBottom = Math.min(frameHeight - MARGIN, bottom + PAD)
    const outer = { x: outerX, y: outerY, w: Math.max(0, outerRight - outerX), h: Math.max(0, outerBottom - outerY) }

    return { inner, outer }
  }).filter((b) => b.inner.w > 0 && b.inner.h > 0)

  if (boxes.length === 0) return null

  // "band" no está disponible en el delogo compilado en este núcleo de
  // ffmpeg (lo rechaza con "Option 'band' not found" y aborta todo el
  // filtro), así que solo se usan x/y/w/h.
  const delogoChain = boxes.map(({ inner: b }) => `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`).join(',')

  let chain = `${delogoChain}[lg0]`
  let currentLabel = 'lg0'
  boxes.forEach(({ inner, outer }, i) => {
    const ringOut = `ring${i}`
    chain += `;[${currentLabel}]split[bgr${i}][fgr${i}]`
    chain += `;[fgr${i}]crop=${outer.w}:${outer.h}:${outer.x}:${outer.y},gblur=sigma=3[blurr${i}]`
    chain += `;[bgr${i}][blurr${i}]overlay=${outer.x}:${outer.y}[${ringOut}]`

    const out = `lgout${i}`
    chain += `;[${ringOut}]split[bgc${i}][fgc${i}]`
    chain += `;[fgc${i}]crop=${inner.w}:${inner.h}:${inner.x}:${inner.y},gblur=sigma=6[blurc${i}]`
    chain += `;[bgc${i}][blurc${i}]overlay=${inner.x}:${inner.y}[${out}]`
    currentLabel = out
  })

  return { chain, outputLabel: currentLabel }
}

/**
 * El recorte se aplica sobre el fotograma original, igual que las zonas de
 * logo — por eso va DESPUÉS del logo en la cadena (que calcula sus propias
 * coordenadas en ese mismo espacio) y nunca antes, para no tener que
 * recalcular las zonas de logo en el espacio ya recortado.
 */
function buildCropFilter(
  crop: CropRect | null,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!crop) return null
  const x = Math.max(0, Math.round(crop.x))
  const y = Math.max(0, Math.round(crop.y))
  const right = Math.min(frameWidth, Math.round(crop.x + crop.width))
  const bottom = Math.min(frameHeight, Math.round(crop.y + crop.height))
  const w = right - x
  const h = bottom - y
  if (w < 2 || h < 2) return null
  // El fotograma completo es "no recortar nada": aplicar crop igual solo
  // recodificaría sin ningún cambio visible.
  if (x === 0 && y === 0 && w === frameWidth && h === frameHeight) return null
  return { x, y, w, h }
}

/**
 * Va siempre al final de la cadena de filtros — gira/voltea el resultado ya
 * recortado y sin logos, así que no hace falta tocar ninguna coordenada de
 * las otras herramientas (que siguen calculándose sobre el fotograma
 * original, sin girar).
 */
function buildOrientationFilterExpr(
  rotation: 0 | 90 | 180 | 270,
  flipHorizontal: boolean,
  flipVertical: boolean,
): string | null {
  const steps: string[] = []
  if (rotation === 90) steps.push('transpose=1')
  else if (rotation === 180) steps.push('transpose=1', 'transpose=1')
  else if (rotation === 270) steps.push('transpose=2')
  if (flipHorizontal) steps.push('hflip')
  if (flipVertical) steps.push('vflip')
  return steps.length > 0 ? steps.join(',') : null
}

function appendFilter(
  videoFilter: string,
  currentLabel: string | null,
  expr: string,
  outLabel: string,
): { videoFilter: string; currentLabel: string | null } {
  if (currentLabel) {
    return { videoFilter: `${videoFilter};[${currentLabel}]${expr}[${outLabel}]`, currentLabel: outLabel }
  }
  // Sin una etiqueta previa (ej. solo un crop simple, sin logo), la cadena
  // sigue siendo lineal — se puede encadenar con comas sin necesidad de
  // nombrar los nodos, igual que ya hacía "speed" en buildFfmpegArgs.
  if (videoFilter) {
    return { videoFilter: `${videoFilter},${expr}`, currentLabel: null }
  }
  return { videoFilter: expr, currentLabel: null }
}

export interface ImageEditSettings {
  logoRegions: LogoRegion[]
  frameWidth: number
  frameHeight: number
  cropRect: CropRect | null
  rotation: 0 | 90 | 180 | 270
  flipHorizontal: boolean
  flipVertical: boolean
}

/**
 * Mismos filtros de logo y recorte que el video, aplicados a una sola
 * imagen (ffmpeg la trata como un "video" de un solo fotograma) — sin
 * recorte por tiempo ni filtros de audio, que no tienen sentido acá.
 */
export function buildImageFfmpegArgs(
  inputName: string,
  outputName: string,
  settings: ImageEditSettings,
): string[] {
  const { logoRegions, frameWidth, frameHeight, cropRect, rotation, flipHorizontal, flipVertical } = settings
  const logo = buildLogoFilter(logoRegions, frameWidth, frameHeight)
  const crop = buildCropFilter(cropRect, frameWidth, frameHeight)
  const orientationExpr = buildOrientationFilterExpr(rotation, flipHorizontal, flipVertical)

  let videoFilter = ''
  let currentLabel: string | null = null

  if (logo) {
    videoFilter = logo.chain
    currentLabel = logo.outputLabel
  }

  if (crop) {
    const cropExpr = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
    ;({ videoFilter, currentLabel } = appendFilter(videoFilter, currentLabel, cropExpr, 'vcrop'))
  }

  if (orientationExpr) {
    ;({ videoFilter, currentLabel } = appendFilter(videoFilter, currentLabel, orientationExpr, 'vorient'))
  }

  const args = ['-i', inputName]
  if (videoFilter) {
    args.push('-vf', videoFilter)
  }
  args.push('-frames:v', '1', outputName)

  return args
}

export function buildFfmpegArgs(inputName: string, outputName: string, settings: EditSettings): string[] {
  const { trimStart, trimEnd, volume, speed, logoRegions, frameWidth, frameHeight, cropRect, rotation, flipHorizontal, flipVertical } = settings

  const logo = buildLogoFilter(logoRegions, frameWidth, frameHeight)
  const crop = buildCropFilter(cropRect, frameWidth, frameHeight)
  const orientationExpr = buildOrientationFilterExpr(rotation, flipHorizontal, flipVertical)

  let videoFilter = ''
  let currentLabel: string | null = null

  if (logo) {
    videoFilter = logo.chain
    currentLabel = logo.outputLabel
  }

  if (crop) {
    const cropExpr = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
    ;({ videoFilter, currentLabel } = appendFilter(videoFilter, currentLabel, cropExpr, 'vcrop'))
  }

  if (speed !== 1) {
    const speedExpr = `setpts=PTS/${speed}`
    ;({ videoFilter, currentLabel } = appendFilter(videoFilter, currentLabel, speedExpr, 'vspeed'))
  }

  if (orientationExpr) {
    ;({ videoFilter, currentLabel } = appendFilter(videoFilter, currentLabel, orientationExpr, 'vorient'))
  }

  const audioFilters: string[] = []
  if (speed !== 1) {
    audioFilters.push(...buildAtempoChain(speed))
  }
  if (volume !== 1) {
    audioFilters.push(`volume=${volume}`)
  }

  const args = ['-ss', trimStart.toFixed(3), '-to', trimEnd.toFixed(3), '-i', inputName]

  if (videoFilter) {
    args.push('-vf', videoFilter)
  }
  if (audioFilters.length > 0) {
    args.push('-af', audioFilters.join(','))
  }

  // Sin filtros de por medio se podría copiar el stream sin recodificar,
  // pero recortar con -c copy puede desincronizar el primer fotograma;
  // recodificar siempre da un resultado más fiel al recorte pedido. El
  // usuario prefirió mantener esa precisión antes que acelerar con -c copy,
  // así que la única palanca de velocidad sin perder precisión es un ajuste
  // de compresión más veloz (el archivo final pesa algo más a cambio).
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', ...bitrateCapArgs(frameWidth, frameHeight), '-c:a', 'aac', outputName)

  return args
}

/**
 * Saca un solo fotograma como imagen — "-ss" antes de "-i" es mucho más
 * rápido que buscar después (salta directo cerca de ese punto en vez de
 * decodificar desde el principio), y como solo se pide 1 fotograma la
 * precisión exacta de ese salto rápido no importa acá.
 */
export function buildFrameExtractArgs(inputName: string, outputName: string, timestamp: number): string[] {
  return ['-ss', timestamp.toFixed(3), '-i', inputName, '-frames:v', '1', outputName]
}

/**
 * Solo audio, sin video ("-vn"), a mp3 — el formato más compatible para
 * reusar después en cualquier otra app o editor. "-q:a 2" es calidad VBR
 * alta (casi transparente) sin inflar el tamaño como un bitrate fijo alto.
 */
// "trimStart"/"trimEnd" son el mismo tramo que ya elige el usuario en
// "Cortar" (pedido 2026-11-10: antes "Extraer audio" sacaba SIEMPRE el
// archivo completo) — null/0 se comportan como antes (todo el audio).
export function buildAudioExtractArgs(
  inputName: string,
  outputName: string,
  trimStart = 0,
  trimEnd: number | null = null,
): string[] {
  const args: string[] = ['-i', inputName]
  // "-ss"/"-to" ANTES de "-i" (como en el resto de la app) hacen un salto
  // rápido al fotograma clave más cercano — con un video de pantalla, que
  // suele tener fotogramas clave muy espaciados (la imagen casi no cambia),
  // ese salto puede caer MUY antes de lo pedido, dejando igual el silencio
  // del inicio aunque se recorte más y más (reportado por el usuario,
  // 2026-11-10: recortar el inicio no sacaba el segundo de silencio). Acá
  // sí importa caer exacto (es audio solamente, no pesa tanto decodificar
  // de más) — por eso "-ss" va DESPUÉS de "-i" (salto preciso, cuadro por
  // cuadro) solo en esta función. "-t" (duración) en vez de "-to" para que
  // no dependa de si cuenta desde el inicio real del archivo o desde donde
  // ya se saltó.
  if (trimStart > 0) args.push('-ss', trimStart.toFixed(3))
  if (trimEnd !== null) args.push('-t', Math.max(0, trimEnd - trimStart).toFixed(3))
  args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputName)
  return args
}

/** Convierte a .mp4 (h264/aac) el .webm que entrega `MediaRecorder` (como
 * "Grabar pantalla"), en vez de solo re-muxearlo — dos problemas reales que
 * un simple "-c copy" no arreglaba del todo (2026-11-10):
 * 1. El .webm no trae la duración real en la cabecera (el navegador no la
 *    sabe de antemano mientras graba), así que `video.duration` puede dar
 *    `Infinity` en cualquier <video> que lo cargue — rompiendo el recorte
 *    (rango 0 a infinito) y la reproducción. Un simple remux SÍ arregla
 *    esto (recalcula la duración de los propios paquetes), pero no alcanzó
 *    para el problema de abajo.
 * 2. Un video de pantalla cambia poco de un cuadro a otro, así que el
 *    codificador de grabación mete fotogramas clave muy espaciados (a veces
 *    uno solo al principio) — buscar/recortar cerca del INICIO puede caer
 *    siempre cerca de ese único fotograma clave en vez de donde se pidió
 *    (reportado por el usuario: la línea de tiempo no avanzaba al recortar
 *    el inicio, aunque sí al recortar el final). Un remux no agrega
 *    fotogramas clave nuevos — solo una recodificación sí puede.
 * Por eso esto recodifica (más lento que un remux, pero el video ya va a
 * recodificarse de nuevo al exportar la edición final igual) a h264/aac en
 * .mp4 — mismo formato que usa el resto de la app — con un fotograma clave
 * forzado cada 1 segundo, para que buscar/recortar funcione parejo en todo
 * el video. De paso, h264/aac tiene mejor soporte de reproducción entre
 * navegadores/sistemas que vp9/opus en .webm (reportado: una grabación no
 * se reproducía en un PC pero sí en un Mac, con las mismas condiciones). */
export function buildFixContainerArgs(inputName: string, outputName: string): string[] {
  return [
    '-i',
    inputName,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-force_key_frames',
    'expr:gte(t,n_forced*1)',
    '-c:a',
    'aac',
    outputName,
  ]
}

export interface MergeClipInput {
  inputName: string
  trimStart: number
  trimEnd: number
  /** Si el clip no trae pista de audio propia, se le agrega silencio del mismo largo. */
  hasAudio: boolean
}

/** Biblioteca de transiciones ofrecida en la UI — "none" es el corte directo de siempre. */
export type TransitionType = 'none' | 'fade' | 'dissolve' | 'slide' | 'circle' | 'wipe' | 'smooth' | 'glitch'

// Nombre real del filtro "xfade" de ffmpeg para cada opción de la UI (todas
// menos "glitch", que no es un tipo de xfade — tiene su propia función más
// abajo, construida a mano con crop/overlay/concat).
// "fade" (xfade) es un cross-fade liso (un clip se desvanece sobre el otro,
// sin pasar por negro) — eso es lo que el usuario pidió como "Mezcla".
// "fadeblack" sí pasa por negro un instante — eso es "Fundido".
// "wipeleft" (pedido 2026-11-09): una línea vertical dura que recorre la
// pantalla revelando el video siguiente detrás, sin mezclar — distinto de
// "slideleft" (todo el fotograma se desplaza entero) y de "smoothleft"
// (igual que wipe pero con el borde difuminado en vez de una línea dura).
const XFADE_NAME: Record<Exclude<TransitionType, 'none' | 'glitch'>, string> = {
  fade: 'fadeblack',
  dissolve: 'fade',
  slide: 'slideleft',
  circle: 'circleopen',
  wipe: 'wipeleft',
  smooth: 'smoothleft',
}

const TRANSITION_DURATION = 0.6 // segundos — fijo, no configurable (mantener la UI simple)

/**
 * Duración real del video final de "Unir videos", en segundos — con
 * transición, cada unión se superpone "td" segundos (ver más abajo), así
 * que el resultado dura MENOS que la simple suma de los recortes. Se usa
 * tanto para construir el filtro como para calcular un progreso real en la
 * UI (el progreso que reporta ffmpeg.wasm en un filtergraph tan complejo no
 * es confiable — ver GOTCHAS.md).
 */
export function computeMergeOutputDuration(
  clips: { trimStart: number; trimEnd: number }[],
  transition: TransitionType,
): number {
  const durations = clips.map((c) => c.trimEnd - c.trimStart)
  const total = durations.reduce((a, b) => a + b, 0)
  if (transition === 'none' || clips.length < 2) return total
  const td = Math.min(TRANSITION_DURATION, Math.max(0.05, Math.min(...durations) * 0.4))
  return total - td * (clips.length - 1)
}

/**
 * Transición "Glitch" (pedida 2026-11-09, afinada en 3 rondas con el
 * usuario sobre un boceto animado antes de construirse acá): una franja
 * vertical ancha, con líneas más chicas detrás (cada una más angosta), que
 * hace un recorrido completo de izquierda a derecha y de vuelta.
 *
 * - Ida (mitad 1 del recorrido): el fondo se queda tal cual el clip A
 *   (no se revela nada todavía); las franjas pasan por encima mostrando por
 *   dentro un adelanto del clip B.
 * - Vuelta (mitad 2): recién ahí el fondo empieza a revelar el clip B
 *   detrás, a medida que la franja principal retrocede; las franjas siguen
 *   mostrando el clip A por dentro mientras tanto.
 *
 * No es un tipo de "xfade" — se arma a mano con "crop"+"overlay" encadenados
 * (plus "concat" al final, igual idea que "xfade" por dentro: el resultado
 * es el clip A completo con la transición superpuesta, seguido del resto
 * del clip B que no alcanzó a usarse en la superposición).
 *
 * Dos limitaciones de ffmpeg que moldean cómo está construida (confirmadas
 * probando con ffmpeg real antes de portar esto, ver GOTCHAS.md):
 * 1. El ancho/alto de un "crop" NO puede variar cuadro a cuadro (solo x/y
 *    sí) — por eso el ancho de cada franja es un número fijo calculado de
 *    antemano (que se va angostando de una franja a la siguiente), nunca
 *    una fórmula con "t" dentro.
 * 2. Por la limitación anterior, el fondo no se puede revelar con un solo
 *    "crop" de ancho creciente — se arma como una "persiana" de K franjas
 *    de ancho FIJO que aparecen de golpe cada una en su propio instante
 *    (`overlay enable='gte(t,...)'`), no con un barrido de ancho continuo.
 *    Con suficientes franjas (más en pantallas más anchas) no se nota el
 *    escalonado a simple vista.
 */
function buildGlitchTransitionFilter(
  labelA: string,
  labelB: string,
  offset: number,
  td: number,
  w: number,
  h: number,
  idx: number,
): { filter: string; outLabel: string } {
  const half = td / 2
  const BAR_W = Math.max(2, Math.round(w * 0.045))
  const LAG = 0.03
  // Antes era 5 (+ hasta 24 franjas para el fondo) — el navegador se
  // colgaba en seco con un filtro tan grande (confirmado 2026-11-09: el
  // MISMO filtro, probado tal cual en ffmpeg de verdad fuera del
  // navegador, anduvo perfecto e instantáneo — el problema es solo de
  // ffmpeg.wasm con filtros de cientos de piezas). 3 alcanza para que se
  // note el efecto sin ese riesgo.
  const BAR_COUNT = 3 // 1 principal (i=0, la más ancha) + 2 que la siguen, angostándose

  const barWidth = (i: number) => (i === 0 ? BAR_W : Math.max(2, Math.round(BAR_W * (1 - i / BAR_COUNT))))
  const barOpacity = (i: number) => (i === 0 ? 1 : Math.round(0.55 * (1 - i / BAR_COUNT) * 1000) / 1000)
  const clipExpr = (e: string, lo: number, hi: number) => `min(max(${e},${lo}),${hi})`
  // Posición de la franja i: ida (fase 1) de 0 a W, vuelta (fase 2) de W a
  // 0 — cada franja que sigue a la principal va con un pequeño retraso
  // ("LAG") para que se vea como si vinieran detrás.
  const posPhase1 = (i: number) => {
    const local = clipExpr(`(t-${offset.toFixed(4)}-${(i * LAG).toFixed(3)})`, 0, half)
    return `((${local})/${half})*${w}`
  }
  const posPhase2 = (i: number) => {
    const local = clipExpr(`(t-${(offset + half).toFixed(4)}-${(i * LAG).toFixed(3)})`, 0, half)
    return `${w}-((${local})/${half})*${w}`
  }

  // Mismo motivo que BAR_COUNT: un número fijo chico en vez de una persiana
  // de hasta 24 franjas (ver nota arriba).
  const K = 6

  const parts: string[] = []
  const tag = `gl${idx}`

  // "labelA"/"labelB" se usan como entrada de MUCHOS filtros distintos acá
  // abajo (cada franja, cada banda de la persiana) — a diferencia de un
  // especificador crudo tipo "0:v" (que ffmpeg sí deja reusar libremente),
  // una etiqueta de salida normal como "v0"/"v1" solo se puede consumir UNA
  // vez; reusarla tal cual rompía la exportación ("Stream specifier ...
  // matches no streams", confirmado 2026-11-09). "split" la copia tantas
  // veces como haga falta, una copia por cada punto donde se necesita.
  const needA = BAR_COUNT + 1 // 1 para el fondo + una por franja de fase 2
  const needB = K + BAR_COUNT + 1 // persiana + franjas de fase 1 + la cola
  const aCopies: string[] = Array.from({ length: needA }, (_, n) => `${tag}a${n}`)
  const bCopies: string[] = Array.from({ length: needB }, (_, n) => `${tag}b${n}`)
  parts.push(`[${labelA}]split=${needA}${aCopies.map((l) => `[${l}]`).join('')}`)
  parts.push(`[${labelB}]split=${needB}${bCopies.map((l) => `[${l}]`).join('')}`)
  let aIdx = 0
  let bIdx = 0
  const nextA = () => aCopies[aIdx++]
  const nextB = () => bCopies[bIdx++]

  // "Out of memory" real con videos reales del usuario (confirmado
  // 2026-11-09, no reproducible con clips de prueba cortos) — la causa:
  // CADA franja/banda de acá abajo recortaba una copia completa del clip A
  // o B (`crop` sin límite de tiempo), así que ffmpeg terminaba filtrando
  // el clip ENTERO en cada una de las ~12-16 ramas, aunque visualmente solo
  // se usa una ventana de medio segundo de cada una. Con clips reales
  // largos (y, en la segunda/tercera transición de una cadena, con "A"
  // siendo ya el resultado acumulado de las transiciones anteriores — cada
  // vez más largo) eso multiplica el trabajo y la memoria viva sin
  // necesidad. Arreglo: recortar cada copia a SOLO el tramo que esa rama
  // usa de verdad, con "trim", ANTES del "crop" — confirmado con ffmpeg
  // real que el recorte/encaje de tiempos sigue funcionando igual de bien
  // con el "enable" del overlay (ver GOTCHAS.md).
  // - Franjas/banda de B (fase 1 + persiana): solo usan el tramo [0, td]
  //   de B — "trim" lo deja ahí, y como B parte en 0 pero tiene que verse
  //   recién en el instante "offset" del resultado final, hay que
  //   desplazar sus tiempos con "setpts" (si no, el "enable" nunca
  //   calzaría).
  // - Franjas de A (fase 2): solo usan el tramo [offset+half, offset+td]
  //   de A — como A nunca se desplaza (su propio reloj YA es el del
  //   resultado final), "trim" sin "setpts" basta: conserva los tiempos
  //   originales tal cual, que ya calzan con el "enable".
  const localB = () => {
    const raw = nextB()
    const out = `${raw}loc`
    parts.push(`[${raw}]trim=start=0:end=${td.toFixed(4)},setpts=PTS-STARTPTS+${offset.toFixed(4)}/TB[${out}]`)
    return out
  }
  const localA = () => {
    const raw = nextA()
    const out = `${raw}loc`
    parts.push(`[${raw}]trim=start=${(offset + half).toFixed(4)}:end=${(offset + td).toFixed(4)}[${out}]`)
    return out
  }

  parts.push(`[${nextA()}]format=yuv420p[${tag}base0]`)
  let cur = `${tag}base0`

  // Fondo, fase 2: "persiana" de K franjas de ancho fijo que van apareciendo
  // de derecha a izquierda, a medida que la franja principal retrocede.
  for (let k = K - 1; k >= 0; k--) {
    const bx = Math.round((k * w) / K)
    const bw = k < K - 1 ? Math.round(w / K) : w - bx
    const revealT = offset + td - (k / K) * half
    const cropLabel = `${tag}rv${k}c`
    parts.push(`[${localB()}]crop=w=${bw}:h=${h}:x=${bx}:y=0[${cropLabel}]`)
    const next = `${tag}rv${k}o`
    parts.push(`[${cur}][${cropLabel}]overlay=x=${bx}:y=0:enable='gte(t,${revealT.toFixed(4)})'[${next}]`)
    cur = next
  }

  // Franjas, fase 1: contenido del clip B, fondo del clip A sin tocar.
  for (let i = BAR_COUNT - 1; i >= 0; i--) {
    const bw = barWidth(i)
    const xExpr = clipExpr(`${posPhase1(i)}-${bw}/2`, 0, w - bw)
    const cropLabel = `${tag}p1${i}c`
    parts.push(`[${localB()}]crop=w=${bw}:h=${h}:x='${xExpr}':y=0[${cropLabel}]`)
    let overSrc = cropLabel
    if (i !== 0) {
      const aLabel = `${tag}p1${i}a`
      parts.push(`[${cropLabel}]format=yuva420p,colorchannelmixer=aa=${barOpacity(i)}[${aLabel}]`)
      overSrc = aLabel
    }
    const next = `${tag}ap1${i}`
    parts.push(
      `[${cur}][${overSrc}]overlay=x='${xExpr}':y=0:enable='between(t,${offset.toFixed(4)},${(offset + half).toFixed(4)})'[${next}]`,
    )
    cur = next
  }

  // Franjas, fase 2: contenido del clip A, encima del fondo ya revelado.
  for (let i = BAR_COUNT - 1; i >= 0; i--) {
    const bw = barWidth(i)
    const xExpr = clipExpr(`${posPhase2(i)}-${bw}/2`, 0, w - bw)
    const cropLabel = `${tag}p2${i}c`
    parts.push(`[${localA()}]crop=w=${bw}:h=${h}:x='${xExpr}':y=0[${cropLabel}]`)
    let overSrc = cropLabel
    if (i !== 0) {
      const aLabel = `${tag}p2${i}a`
      parts.push(`[${cropLabel}]format=yuva420p,colorchannelmixer=aa=${barOpacity(i)}[${aLabel}]`)
      overSrc = aLabel
    }
    const next = `${tag}ap2${i}`
    parts.push(
      `[${cur}][${overSrc}]overlay=x='${xExpr}':y=0:enable='between(t,${(offset + half).toFixed(4)},${(offset + td).toFixed(4)})'[${next}]`,
    )
    cur = next
  }

  // Cola: lo que queda del clip B después del tramo ya usado en la
  // transición, pegado justo después de la "cabeza" (clip A completo con la
  // transición superpuesta) — misma idea que usa "xfade" por dentro.
  const tailLabel = `${tag}tail`
  parts.push(`[${nextB()}]trim=start=${td.toFixed(4)},setpts=PTS-STARTPTS[${tailLabel}]`)
  const outLabel = `glout${idx}`
  parts.push(`[${cur}][${tailLabel}]concat=n=2:v=1:a=0[${outLabel}]`)

  return { filter: parts.join(';'), outLabel }
}

/**
 * Une varios clips en uno solo, cada uno ya recortado a su propio
 * inicio/fin. Los videos de origen pueden venir en proporciones distintas
 * (uno horizontal, uno vertical), así que primero se escala cada uno para
 * CUBRIR el tamaño de destino (el del primer clip) y se recorta lo que
 * sobre, centrado — igual que "object-fit: cover" en CSS. Así no quedan
 * franjas negras, a cambio de perder un poco de los bordes en los clips que
 * no calzan con esa proporción.
 *
 * Sin transición ("none"), el filtro "concat" exige que TODOS los clips
 * traigan exactamente los mismos streams (un video + un audio cada uno) —
 * si alguno no tiene pista de audio propia (pasa con algunas grabaciones de
 * pantalla/cámara), referenciar su audio inexistente aborta todo el
 * procesamiento. Por eso cada clip sin audio se empareja con silencio
 * generado del mismo largo exacto que su recorte ("anullsrc", una fuente de
 * audio vacía, no hace falta un archivo real para eso) — igual con
 * transición, donde se encadena con "acrossfade" en vez de "concat".
 *
 * Con transición, "xfade"/"acrossfade" superponen el final de un clip con
 * el inicio del siguiente durante TRANSITION_DURATION segundos — por eso
 * cada clip necesita que su propio recorte dure más que eso en ambos
 * extremos; se recorta la duración pedida al clip más corto de la lista
 * para que ningún recorte muy breve rompa el filtro.
 *
 * Música de fondo opcional: se mezcla con el audio original de los clips
 * (que se mantiene a su volumen normal) a un volumen más bajo, y si es más
 * corta que el video final se repite sola con "-stream_loop -1" hasta
 * completarlo (amix con duration=first corta la mezcla justo al largo del
 * video, sin que sobre música de más).
 */
export function buildMergeArgs(
  clips: MergeClipInput[],
  targetWidth: number,
  targetHeight: number,
  musicInputName: string | null,
  musicVolume: number,
  outputName: string,
  transition: TransitionType = 'none',
): string[] {
  const args: string[] = []
  for (const clip of clips) {
    args.push('-ss', clip.trimStart.toFixed(3), '-to', clip.trimEnd.toFixed(3), '-i', clip.inputName)
  }
  if (musicInputName) {
    // "-stream_loop" es una opción del INPUT que sigue, no un filtro: hace
    // que ese archivo se repita solo tantas veces como haga falta.
    args.push('-stream_loop', '-1', '-i', musicInputName)
  }

  // "outputW/outputH" es SIEMPRE la resolución final del archivo (la que
  // pidió el usuario, la del primer clip) — "w/h" es la resolución de
  // TRABAJO, que para "Glitch" se achica para no quedarse sin memoria (ver
  // nota abajo) y se vuelve a agrandar al final con un "scale" de más,
  // justo antes de guardar. El usuario pidió explícitamente mantener la
  // resolución original del archivo aunque el efecto internamente trabaje
  // más chico (2026-11-10) — ojo que esto es agrandar con interpolación,
  // no nitidez nativa real, pero el archivo final SÍ queda con las
  // dimensiones que pidió.
  const outputW = Math.max(2, Math.round(targetWidth))
  const outputH = Math.max(2, Math.round(targetHeight))
  let w = outputW
  let h = outputH

  // "Glitch" es, por lejos, la transición más pesada en memoria (~12-16
  // ramas de crop/overlay por unión) — confirmado con un video real del
  // usuario (1082×1916, "Out of memory" repetible siempre a esa
  // resolución, 2026-11-10): a resolución completa se cuelga incluso
  // después de acotar cada rama a su propio tramo de tiempo (nota de
  // `buildGlitchTransitionFilter`). Las otras 7 transiciones no tienen este
  // problema (confirmadas por el usuario a resolución completa) — el tope
  // va solo acá, no para todas.
  //
  // El tope original (720p de área) funcionó bien en computador, pero en
  // celular el usuario reportó que la app "se reinicia" a mitad de export
  // (reportado 2026-11-10) — típico de que el sistema operativo mata la
  // pestaña por memoria, sin ni siquiera un error de ffmpeg (el celular
  // tiene mucho menos memoria disponible que un computador). Se bajó a
  // 960×540 de área — valor ya probado con margen real (540×958 anduvo
  // bien en ~21s con el mismo archivo pesado que antes fallaba) — para dar
  // más colchón en dispositivos con poca memoria.
  //
  // Ese tope (960×540) se probó y confirmó con 4 clips (3 uniones) tanto en
  // celular como en PC/iMac de Claude. Pero con 5 clips (4 uniones) el
  // usuario reportó "Out of memory" de nuevo en su iMac (Safari) Y en su PC
  // (Chrome) — Claude NO logró reproducir ese OOM exacto con clips
  // sintéticos a la misma resolución/duración en su propio navegador
  // (tampoco en Chrome), así que la causa exacta sigue sin confirmarse del
  // todo (¿memoria real disponible en esos equipos más baja?, ¿límite de
  // WASM de Safari más estricto?) — lo que SÍ es consistente con lo ya
  // documentado es que cada unión agrega ~12-16 ramas de crop/overlay al
  // mismo filtergraph, así que más clips = más memoria sin importar el
  // navegador. Mientras no haya forma de confirmar el límite exacto, el
  // tope de área ahora se achica más cuando hay más de 4 clips (más de 3
  // uniones), en vez de quedarse fijo — menos nitidez con muchos clips,
  // pero más margen real. Si el usuario vuelve a reportar OOM con 5+ clips
  // incluso con esto, bajar el piso (ahora 480×270) o re-pensar el enfoque
  // (ej. procesar las uniones en varias pasadas de ffmpeg en vez de un solo
  // filtergraph gigante).
  if (transition === 'glitch') {
    const BASE_SAFE_AREA = 960 * 540
    const BASELINE_TRANSITIONS = 3 // = 4 clips, ya confirmado seguro
    const MIN_AREA = 480 * 270
    const transitionsCount = Math.max(1, clips.length - 1)
    let safeArea = BASE_SAFE_AREA
    if (transitionsCount > BASELINE_TRANSITIONS) {
      safeArea = Math.max(MIN_AREA, Math.round((BASE_SAFE_AREA * BASELINE_TRANSITIONS) / transitionsCount))
    }
    const area = w * h
    if (area > safeArea) {
      const scale = Math.sqrt(safeArea / area)
      w = Math.max(2, Math.round(w * scale))
      h = Math.max(2, Math.round(h * scale))
    }
  }

  const FPS = 30 // concat/xfade exigen que todos los clips compartan la misma tasa de cuadros

  const videoChains = clips.map(
    (_, i) =>
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},setsar=1[v${i}]`,
  )
  const silenceChains = clips
    .map((clip, i) =>
      clip.hasAudio
        ? null
        : `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${(clip.trimEnd - clip.trimStart).toFixed(3)}[sil${i}]`,
    )
    .filter((c): c is string => c !== null)
  const allChains = [...videoChains, ...silenceChains]

  let filter: string
  let videoLabel: string
  let audioLabel: string

  if (transition === 'none' || clips.length < 2) {
    const concatRefs = clips.map((clip, i) => `[v${i}][${clip.hasAudio ? `${i}:a` : `sil${i}`}]`).join('')
    filter = `${allChains.join(';')};${concatRefs}concat=n=${clips.length}:v=1:a=1[vout][aout0]`
    videoLabel = '[vout]'
    audioLabel = '[aout0]'
  } else {
    const durations = clips.map((c) => c.trimEnd - c.trimStart)
    // La superposición no puede durar más que el clip más corto, o la
    // transición falla con un offset negativo — se acota automáticamente en
    // vez de dejar que el usuario tenga que calcularlo a mano.
    // 40% del clip más corto en vez de solo restarle un margen fijo: así
    // "td" queda SIEMPRE por debajo de la duración de cualquier clip, sin
    // casos límite con recortes muy breves (ej. un clip de 0.2s).
    const td = Math.min(TRANSITION_DURATION, Math.max(0.05, Math.min(...durations) * 0.4))

    const transitionChains: string[] = []
    let prevVideoLabel = 'v0'
    let prevAudioLabel = clips[0].hasAudio ? '0:a' : 'sil0'
    let cumulative = durations[0]
    for (let i = 1; i < clips.length; i++) {
      const offset = Math.max(0, cumulative - td)
      if (transition === 'glitch') {
        const { filter: glitchFilter, outLabel } = buildGlitchTransitionFilter(
          prevVideoLabel,
          `v${i}`,
          offset,
          td,
          w,
          h,
          i,
        )
        transitionChains.push(glitchFilter)
        prevVideoLabel = outLabel
      } else {
        const xfadeName = XFADE_NAME[transition as Exclude<TransitionType, 'none' | 'glitch'>]
        const vOut = `vx${i}`
        transitionChains.push(
          `[${prevVideoLabel}][v${i}]xfade=transition=${xfadeName}:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`,
        )
        prevVideoLabel = vOut
      }
      const aOut = `ax${i}`
      const thisAudioLabel = clips[i].hasAudio ? `${i}:a` : `sil${i}`
      transitionChains.push(`[${prevAudioLabel}][${thisAudioLabel}]acrossfade=d=${td.toFixed(3)}[${aOut}]`)
      prevAudioLabel = aOut
      cumulative = cumulative + durations[i] - td
    }

    filter = `${allChains.join(';')};${transitionChains.join(';')}`
    videoLabel = `[${prevVideoLabel}]`
    audioLabel = `[${prevAudioLabel}]`
  }

  if (musicInputName) {
    const musicIndex = clips.length
    // "normalize=0" evita que amix baje solo el volumen del audio original
    // por tener dos entradas — el balance entre ambos queda a cargo de
    // musicVolume, no de un promedio automático.
    filter += `;[${musicIndex}:a]volume=${musicVolume}[bgm];${audioLabel}[bgm]amix=inputs=2:duration=first:normalize=0[aout]`
    audioLabel = '[aout]'
  }

  // Si "Glitch" trabajó más chico que la resolución pedida, se agranda de
  // vuelta acá, al final, sobre el resultado YA completo (una sola vez,
  // no en cada rama del filtro) — mucho más liviano que haberlo mantenido
  // grande durante todo el filtro pesado de arriba.
  if (w !== outputW || h !== outputH) {
    filter += `;${videoLabel}scale=${outputW}:${outputH}[vfinal]`
    videoLabel = '[vfinal]'
  }

  args.push('-filter_complex', filter)
  args.push('-map', videoLabel, '-map', audioLabel)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', ...bitrateCapArgs(outputW, outputH), '-c:a', 'aac', outputName)
  return args
}

// Tope de memoria de "Glitch" — ver nota larga en `buildGlitchVideoOnlyArgs`.
// El "960×540 de área" de siempre funciona bien con clips CORTOS (confirmado
// hasta ~12-15s cada uno), pero el usuario encontró "Out of memory" de
// nuevo con un clip real de 3 MINUTOS (mezclado con otros dos más cortos,
// solo 2 uniones) — a esa misma resolución, sin que la cantidad de clips
// por sí sola explicara la falla (con solo 3 clips, el tope por cantidad de
// clips no bajaba nada). Confirmado por el propio usuario que sacando el
// clip largo (quedando con los dos cortos) sí anduvo bien.
//
// Causa: el "fondo" de cada transición (`format=yuv420p[tag_base0]` en
// `buildGlitchTransitionFilter`) NO es solo el medio segundo de la
// transición — es el clip A COMPLETO hasta ese punto (o, en la 2da/3ra
// unión de una cadena, todo lo acumulado de las uniones anteriores),
// encima del cual se apilan 9 "overlay" seguidos (persiana + franjas). Con
// clips cortos eso son pocos miles de cuadros pasando por esos 9 filtros;
// con un clip de varios MINUTOS son muchísimos más — el problema no es solo
// la resolución (que sí ayuda) sino la CANTIDAD DE CUADROS que atraviesan
// esa cadena, algo que bajar la resolución no arregla del todo. Separarlo
// de verdad (que cada unión solo toque una ventana chica de cada clip, sin
// arrastrar el resto) sería el arreglo de raíz, pero significa rehacer
// bastante de un filtro ya afinado a mano en varias rondas — por ahora se
// combina duración total + cantidad de uniones en un solo número ("carga")
// para bajar MÁS la resolución de trabajo cuando hay clips largos de por
// medio, y si aun así la carga es demasiado alta, se avisa ANTES de
// intentarlo (en vez de dejar que el usuario espere varios minutos para
// terminar en un error).
const GLITCH_BASE_SAFE_AREA = 960 * 540
// "Carga" de referencia: el caso ya confirmado seguro de 4 clips de ~12s
// (duración total ~48s) × 3 uniones = 144.
const GLITCH_BASELINE_LOAD = 144
const GLITCH_MIN_AREA = 480 * 270
// Carga del caso real que falló (3 clips, uno de 3 min, total ~362s × 2
// uniones ≈ 723) — el tope de "rechazar antes de intentar" se puso bien por
// debajo de eso, con margen, en vez de justo en el límite.
export const GLITCH_MAX_LOAD = 400

/** Mismo texto en los dos lugares donde hace falta (el aviso al tiro al
 * elegir "Glitch" en `MergeView.vue`, y el error real si de todos modos se
 * intenta unir, en `runMerge`) — un solo lugar para no desincronizar el
 * texto entre ambos. */
export const GLITCH_TOO_LONG_MESSAGE =
  'Glitch no aguanta bien clips largos (varios minutos) — funciona mejor con clips cortos, de hasta aprox. 1 ' +
  'minuto cada uno. Recorta el clip más largo antes de unir, o usa otra transición (las demás no tienen este límite).'

/** "Carga" estimada de un merge con "Glitch" — combina cuántas uniones hay
 * con cuánto video total pasa por la cadena de 9 "overlay" de cada una (ver
 * nota de arriba). Más alto = más riesgo de "Out of memory", sin importar
 * la resolución. */
export function estimateGlitchLoad(clips: { trimStart: number; trimEnd: number }[]): number {
  const totalDuration = clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart), 0)
  const transitionsCount = Math.max(1, clips.length - 1)
  return totalDuration * transitionsCount
}

/**
 * "Glitch" en DOS pasadas separadas (video por un lado, audio por otro,
 * mezclados recién al final) — arreglo a un bug encontrado 2026-11-10: con
 * "Glitch" (y SOLO con "Glitch" — confirmado por el usuario que "Barrido" y
 * "sin efecto" con los MISMOS clips salen con el audio bien) el audio de
 * algunos clips se perdía por completo y el resto quedaba desfasado,
 * sonando encima del clip equivocado. Se armaron clips sintéticos con un
 * tono distinto por clip para poder MEDIR exactamente qué pasaba (en vez de
 * solo "escuchar"): el audio del filtro de un solo paso salía ~6s más corto
 * de lo que debía (justo la duración de un clip completo), aunque el VIDEO
 * sí salía completo y bien armado. O sea, el filtro de audio en sí (el
 * mismo "acrossfade" encadenado que usan las otras 7 transiciones sin
 * problema) está bien — lo que falla es específico de mezclar ese audio
 * EN EL MISMO filtergraph que el video de "Glitch", que por lejos es el
 * más pesado (~12-16 ramas de crop/overlay por unión, con "split" repetido
 * muchas veces sobre el mismo clip de entrada). Se probó primero subir
 * "-thread_queue_size" en cada input (arreglo típico para este tipo de
 * problema) y NO alcanzó — el audio seguía saliendo corto exactamente
 * igual. En vez de seguir adivinando la causa exacta dentro de ffmpeg, se
 * separan los dos filtros en pasadas de ffmpeg independientes (el video
 * pesado de "Glitch" por un lado, sin audio; el audio liviano por otro,
 * igual al de las otras transiciones) y se mezclan al final con un tercer
 * paso rápido ("-c copy", sin recodificar) — así el audio nunca compite por
 * recursos con el filtro de video más pesado. Las otras 7 transiciones y
 * "Ninguna" siguen con `buildMergeArgs` de una sola pasada, ya confirmado
 * que ahí nunca pasó este problema.
 */
export function buildGlitchVideoOnlyArgs(
  clips: MergeClipInput[],
  targetWidth: number,
  targetHeight: number,
  outputName: string,
): string[] {
  const args: string[] = []
  for (const clip of clips) {
    args.push('-ss', clip.trimStart.toFixed(3), '-to', clip.trimEnd.toFixed(3), '-i', clip.inputName)
  }

  const outputW = Math.max(2, Math.round(targetWidth))
  const outputH = Math.max(2, Math.round(targetHeight))
  let w = outputW
  let h = outputH

  // Mismo tope de memoria que antes vivía en `buildMergeArgs` — se repite
  // acá porque esta pasada ahora construye el video de "Glitch" por su
  // cuenta. Ver `estimateGlitchLoad` para el porqué del número que combina
  // clips y duración total.
  const safeArea = Math.max(GLITCH_MIN_AREA, Math.round((GLITCH_BASE_SAFE_AREA * GLITCH_BASELINE_LOAD) / Math.max(GLITCH_BASELINE_LOAD, estimateGlitchLoad(clips))))
  const area = w * h
  if (area > safeArea) {
    const scale = Math.sqrt(safeArea / area)
    w = Math.max(2, Math.round(w * scale))
    h = Math.max(2, Math.round(h * scale))
  }

  const FPS = 30
  const videoChains = clips.map(
    (_, i) =>
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},setsar=1[v${i}]`,
  )

  const durations = clips.map((c) => c.trimEnd - c.trimStart)
  const td = Math.min(TRANSITION_DURATION, Math.max(0.05, Math.min(...durations) * 0.4))

  const transitionChains: string[] = []
  let prevVideoLabel = 'v0'
  let cumulative = durations[0]
  for (let i = 1; i < clips.length; i++) {
    const offset = Math.max(0, cumulative - td)
    const { filter: glitchFilter, outLabel } = buildGlitchTransitionFilter(prevVideoLabel, `v${i}`, offset, td, w, h, i)
    transitionChains.push(glitchFilter)
    prevVideoLabel = outLabel
    cumulative = cumulative + durations[i] - td
  }

  let filter = `${videoChains.join(';')};${transitionChains.join(';')}`
  let videoLabel = `[${prevVideoLabel}]`

  if (w !== outputW || h !== outputH) {
    filter += `;${videoLabel}scale=${outputW}:${outputH}[vfinal]`
    videoLabel = '[vfinal]'
  }

  args.push('-filter_complex', filter)
  args.push('-map', videoLabel)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', ...bitrateCapArgs(outputW, outputH), '-an', outputName)
  return args
}

/**
 * El audio completo de "Unir videos" (crossfade entre clips + silencio para
 * los que no traen audio + música de fondo opcional) como pasada propia, sin
 * nada de video — ver nota en `buildGlitchVideoOnlyArgs` de por qué existe
 * esto separado. Misma lógica de audio que ya usa `buildMergeArgs` para las
 * otras transiciones (xfade), solo que acá vive sola.
 */
export function buildMergeAudioOnlyArgs(
  clips: MergeClipInput[],
  musicInputName: string | null,
  musicVolume: number,
  outputName: string,
): string[] {
  const args: string[] = []
  for (const clip of clips) {
    args.push('-ss', clip.trimStart.toFixed(3), '-to', clip.trimEnd.toFixed(3), '-i', clip.inputName)
  }
  if (musicInputName) {
    args.push('-stream_loop', '-1', '-i', musicInputName)
  }

  const silenceChains = clips
    .map((clip, i) =>
      clip.hasAudio
        ? null
        : `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${(clip.trimEnd - clip.trimStart).toFixed(3)}[sil${i}]`,
    )
    .filter((c): c is string => c !== null)

  const durations = clips.map((c) => c.trimEnd - c.trimStart)
  const td = Math.min(TRANSITION_DURATION, Math.max(0.05, Math.min(...durations) * 0.4))

  const chains: string[] = [...silenceChains]
  let prevAudioLabel = clips[0].hasAudio ? '0:a' : 'sil0'
  for (let i = 1; i < clips.length; i++) {
    const aOut = `ax${i}`
    const thisAudioLabel = clips[i].hasAudio ? `${i}:a` : `sil${i}`
    chains.push(`[${prevAudioLabel}][${thisAudioLabel}]acrossfade=d=${td.toFixed(3)}[${aOut}]`)
    prevAudioLabel = aOut
  }

  let filter = chains.join(';')
  let audioLabel = `[${prevAudioLabel}]`

  if (musicInputName) {
    const musicIndex = clips.length
    filter += `;[${musicIndex}:a]volume=${musicVolume}[bgm];${audioLabel}[bgm]amix=inputs=2:duration=first:normalize=0[aout]`
    audioLabel = '[aout]'
  }

  args.push('-filter_complex', filter)
  args.push('-map', audioLabel)
  args.push('-c:a', 'aac', '-b:a', '192k', outputName)
  return args
}

/** Combina el video (sin audio) y el audio (sin video) de las dos pasadas de
 * arriba en un solo archivo final, copiando ambos streams tal cual (sin
 * recodificar — rápido) y cortando al más corto de los dos por si alguno
 * quedó unos milisegundos más largo que el otro por redondeo. */
export function buildMuxArgs(videoName: string, audioName: string, outputName: string): string[] {
  return ['-i', videoName, '-i', audioName, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', outputName]
}
