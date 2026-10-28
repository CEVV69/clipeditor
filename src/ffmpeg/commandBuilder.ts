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

export function buildFfmpegArgs(inputName: string, outputName: string, settings: EditSettings): string[] {
  const { trimStart, trimEnd, volume, speed, logoRegions, frameWidth, frameHeight, cropRect } = settings

  const logo = buildLogoFilter(logoRegions, frameWidth, frameHeight)
  const crop = buildCropFilter(cropRect, frameWidth, frameHeight)

  let videoFilter = ''
  let currentLabel: string | null = null

  if (logo) {
    videoFilter = logo.chain
    currentLabel = logo.outputLabel
  }

  if (crop) {
    const cropExpr = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`
    if (currentLabel) {
      videoFilter += `;[${currentLabel}]${cropExpr}[vcrop]`
      currentLabel = 'vcrop'
    } else {
      videoFilter = cropExpr
    }
  }

  if (speed !== 1) {
    const speedExpr = `setpts=PTS/${speed}`
    if (currentLabel) {
      videoFilter += `;[${currentLabel}]${speedExpr}`
    } else if (videoFilter) {
      videoFilter += `,${speedExpr}`
    } else {
      videoFilter = speedExpr
    }
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
  // recodificar siempre da un resultado más fiel al recorte pedido.
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', outputName)

  return args
}
