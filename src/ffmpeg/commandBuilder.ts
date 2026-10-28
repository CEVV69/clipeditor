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
 * Tapa cada zona en dos pasos:
 * 1. "delogo" interpola el contenido de la zona a partir de los píxeles del
 *    borde, fotograma a fotograma — no es una reconstrucción inteligente del
 *    fondo (eso requeriría un modelo de IA, inviable 100% en el navegador),
 *    pero sí se recalcula en cada fotograma, así que sigue en algo los
 *    cambios del video en vez de quedar fija.
 * 2. Un desenfoque suave, solo dentro de esa misma zona, disimula las rayas
 *    que deja la interpolación de delogo sobre fondos con textura.
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
  const boxes = regions.map((r) => {
    // Redondear x/y y ancho/alto por separado puede sumar hasta 1px más que
    // el borde real del video (ej. x=575.5→576 y width=64.5→65 ya suman
    // 641 sobre un cuadro de 640), así que los bordes derecho/inferior se
    // redondean como tales (no width/height sueltos) antes de acotarlos.
    const x = Math.max(MARGIN, Math.round(r.x))
    const y = Math.max(MARGIN, Math.round(r.y))
    const right = Math.min(frameWidth - MARGIN, Math.round(r.x + r.width))
    const bottom = Math.min(frameHeight - MARGIN, Math.round(r.y + r.height))
    return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
  }).filter((b) => b.w > 0 && b.h > 0)

  if (boxes.length === 0) return null

  // "band" no está disponible en el delogo compilado en este núcleo de
  // ffmpeg (lo rechaza con "Option 'band' not found" y aborta todo el
  // filtro), así que solo se usan x/y/w/h.
  const delogoChain = boxes.map((b) => `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`).join(',')

  let chain = `${delogoChain}[lg0]`
  let currentLabel = 'lg0'
  boxes.forEach((b, i) => {
    const bg = `bg${i}`
    const fg = `fg${i}`
    const blurred = `blur${i}`
    const out = `lgout${i}`
    chain += `;[${currentLabel}]split[${bg}][${fg}]`
    chain += `;[${fg}]crop=${b.w}:${b.h}:${b.x}:${b.y},gblur=sigma=5[${blurred}]`
    chain += `;[${bg}][${blurred}]overlay=${b.x}:${b.y}[${out}]`
    currentLabel = out
  })

  return { chain, outputLabel: currentLabel }
}

export function buildFfmpegArgs(inputName: string, outputName: string, settings: EditSettings): string[] {
  const { trimStart, trimEnd, volume, speed, logoRegions, frameWidth, frameHeight } = settings

  const logo = buildLogoFilter(logoRegions, frameWidth, frameHeight)
  let videoFilter = ''
  if (logo) {
    videoFilter = logo.chain
    if (speed !== 1) {
      videoFilter += `;[${logo.outputLabel}]setpts=PTS/${speed}`
    }
  } else if (speed !== 1) {
    videoFilter = `setpts=PTS/${speed}`
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
