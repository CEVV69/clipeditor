// Construye los argumentos de ffmpeg a partir de la edición elegida en la UI,
// igual a como lo hace el editor de 123apps: un solo paso de ffmpeg que
// recorta, ajusta volumen/velocidad y tapa hasta 3 logos si se pidió.

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
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', outputName)

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
export function buildAudioExtractArgs(inputName: string, outputName: string): string[] {
  return ['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputName]
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
  const BAR_COUNT = 5 // 1 principal (i=0, la más ancha) + 4 que la siguen, angostándose

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

  const K = Math.min(24, Math.max(12, Math.round(w / 50)))

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

  parts.push(`[${nextA()}]format=yuv420p[${tag}base0]`)
  let cur = `${tag}base0`

  // Fondo, fase 2: "persiana" de K franjas de ancho fijo que van apareciendo
  // de derecha a izquierda, a medida que la franja principal retrocede.
  for (let k = K - 1; k >= 0; k--) {
    const bx = Math.round((k * w) / K)
    const bw = k < K - 1 ? Math.round(w / K) : w - bx
    const revealT = offset + td - (k / K) * half
    const cropLabel = `${tag}rv${k}c`
    parts.push(`[${nextB()}]crop=w=${bw}:h=${h}:x=${bx}:y=0[${cropLabel}]`)
    const next = `${tag}rv${k}o`
    parts.push(`[${cur}][${cropLabel}]overlay=x=${bx}:y=0:enable='gte(t,${revealT.toFixed(4)})'[${next}]`)
    cur = next
  }

  // Franjas, fase 1: contenido del clip B, fondo del clip A sin tocar.
  for (const i of [4, 3, 2, 1, 0]) {
    const bw = barWidth(i)
    const xExpr = clipExpr(`${posPhase1(i)}-${bw}/2`, 0, w - bw)
    const cropLabel = `${tag}p1${i}c`
    parts.push(`[${nextB()}]crop=w=${bw}:h=${h}:x='${xExpr}':y=0[${cropLabel}]`)
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
  for (const i of [4, 3, 2, 1, 0]) {
    const bw = barWidth(i)
    const xExpr = clipExpr(`${posPhase2(i)}-${bw}/2`, 0, w - bw)
    const cropLabel = `${tag}p2${i}c`
    parts.push(`[${nextA()}]crop=w=${bw}:h=${h}:x='${xExpr}':y=0[${cropLabel}]`)
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

  const w = Math.max(2, Math.round(targetWidth))
  const h = Math.max(2, Math.round(targetHeight))
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

  args.push('-filter_complex', filter)
  args.push('-map', videoLabel, '-map', audioLabel)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', outputName)
  return args
}
