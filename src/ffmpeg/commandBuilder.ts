// Construye los argumentos de ffmpeg a partir de la edición elegida en la UI,
// igual a como lo hace el editor de 123apps: un solo paso de ffmpeg que
// recorta, ajusta volumen/velocidad y tapa un logo si se pidió.

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
  /** Región a tapar con el filtro delogo, o null si no se activó. */
  logoRegion: LogoRegion | null
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

export function buildFfmpegArgs(inputName: string, outputName: string, settings: EditSettings): string[] {
  const { trimStart, trimEnd, volume, speed, logoRegion } = settings

  const videoFilters: string[] = []
  const audioFilters: string[] = []

  if (logoRegion) {
    const { x, y, width, height } = logoRegion
    videoFilters.push(`delogo=x=${Math.round(x)}:y=${Math.round(y)}:w=${Math.round(width)}:h=${Math.round(height)}`)
  }

  if (speed !== 1) {
    videoFilters.push(`setpts=PTS/${speed}`)
    audioFilters.push(...buildAtempoChain(speed))
  }

  if (volume !== 1) {
    audioFilters.push(`volume=${volume}`)
  }

  const args = ['-ss', trimStart.toFixed(3), '-to', trimEnd.toFixed(3), '-i', inputName]

  if (videoFilters.length > 0) {
    args.push('-vf', videoFilters.join(','))
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
