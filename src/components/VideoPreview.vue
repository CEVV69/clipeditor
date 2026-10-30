<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { CropRect, LogoRegion } from '../ffmpeg/commandBuilder'

const props = defineProps<{
  src: string
  mediaType: 'video' | 'image'
  logoEditing: boolean
  logoRegions: LogoRegion[]
  cropEditing: boolean
  cropRect: CropRect | null
  volume: number
  speed: number
  /** Segundo al que saltar (vista previa en vivo al mover el corte). */
  seekTo: number | null
}>()

const emit = defineEmits<{
  (e: 'duration', seconds: number): void
  (e: 'natural-size', size: { width: number; height: number }): void
  (e: 'region-drawn', region: LogoRegion): void
  (e: 'drawing-cancelled'): void
  (e: 'update:cropRect', rect: CropRect): void
}>()

// El mismo elemento de referencia sirve para <video> o <img> — todo el
// manejo de puntero de abajo (dibujar zonas, arrastrar el recorte) solo
// necesita getBoundingClientRect(), que ambos tienen igual.
const mediaEl = ref<HTMLVideoElement | HTMLImageElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)

const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)

// Medir getBoundingClientRect() en cada pointermove, justo después de que
// el movimiento anterior ya escribió nuevos estilos, fuerza al navegador a
// recalcular el diseño en cada evento (decenas por segundo) — se nota
// como lentitud al arrastrar. El tamaño del video no cambia a mitad de un
// arrastre, así que basta con medirlo una sola vez al empezar.
let dragBoundRect: DOMRect | null = null

// El control nativo de volumen de <video> no pasa del 100%, así que el
// audio se enruta siempre por Web Audio y el volumen real lo controla la
// ganancia; así el mismo camino sirve tanto para bajarlo como para
// subirlo por encima de lo original. El contexto se reanuda recién en el
// evento "play" porque Safari exige que ocurra dentro de un gesto del
// usuario, y disparar el video es justamente eso.
let audioCtx: AudioContext | null = null
let gainNode: GainNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null

function ensureAudioGraph() {
  if (sourceNode || !(mediaEl.value instanceof HTMLVideoElement)) return
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  audioCtx = new Ctx()
  sourceNode = audioCtx.createMediaElementSource(mediaEl.value)
  gainNode = audioCtx.createGain()
  gainNode.gain.value = Math.max(0, props.volume)
  sourceNode.connect(gainNode).connect(audioCtx.destination)
}

function onPlay() {
  ensureAudioGraph()
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {})
}

watch(() => props.volume, (v) => {
  if (gainNode) gainNode.gain.value = Math.max(0, v)
})
watch(() => props.speed, (s) => {
  if (mediaEl.value instanceof HTMLVideoElement) mediaEl.value.playbackRate = s
}, { immediate: true })
watch(() => props.seekTo, (t) => {
  if (mediaEl.value instanceof HTMLVideoElement && t !== null && Number.isFinite(t)) {
    mediaEl.value.currentTime = t
  }
})

onBeforeUnmount(() => {
  sourceNode?.disconnect()
  gainNode?.disconnect()
  audioCtx?.close().catch(() => {})
})

function onLoadedMetadata() {
  if (!(mediaEl.value instanceof HTMLVideoElement)) return
  naturalWidth.value = mediaEl.value.videoWidth
  naturalHeight.value = mediaEl.value.videoHeight
  emit('duration', mediaEl.value.duration)
  emit('natural-size', { width: naturalWidth.value, height: naturalHeight.value })
  mediaEl.value.playbackRate = props.speed
}

function onImageLoad() {
  if (!(mediaEl.value instanceof HTMLImageElement)) return
  naturalWidth.value = mediaEl.value.naturalWidth
  naturalHeight.value = mediaEl.value.naturalHeight
  emit('natural-size', { width: naturalWidth.value, height: naturalHeight.value })
}

function onPointerDown(ev: PointerEvent) {
  if (!mediaEl.value) return
  ev.preventDefault()
  // Captura explícita del puntero: así, aunque el cursor salga del
  // recuadro de dibujo antes de soltar (o el gesto lo entregue de forma
  // rara, como a veces pasa con trackpad en Safari), el "pointerup" que
  // cierra el trazo sigue llegando a este mismo elemento en vez de
  // perderse. Sin esto, un trazo "fallido" podía dejar dragging=true
  // para siempre y el botón se quedaba pegado en "Dibujando…".
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  dragBoundRect = mediaEl.value.getBoundingClientRect()
  const rect = dragBoundRect
  dragStart.value = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  dragRect.value = { left: dragStart.value.x, top: dragStart.value.y, width: 0, height: 0 }
  dragging.value = true
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value || !dragBoundRect) return
  const rect = dragBoundRect
  const x = ev.clientX - rect.left
  const y = ev.clientY - rect.top
  dragRect.value = {
    left: Math.min(dragStart.value.x, x),
    top: Math.min(dragStart.value.y, y),
    width: Math.abs(x - dragStart.value.x),
    height: Math.abs(y - dragStart.value.y),
  }
}

function finishDrag() {
  if (!dragging.value || !dragBoundRect || !dragRect.value) {
    dragging.value = false
    dragBoundRect = null
    return
  }
  dragging.value = false

  const rect = dragBoundRect
  dragBoundRect = null
  const scaleX = naturalWidth.value / rect.width
  const scaleY = naturalHeight.value / rect.height
  const drawn = dragRect.value
  dragRect.value = null

  // El filtro que tapa el logo rechaza de plano cualquier región que se
  // salga del fotograma (aborta todo el procesamiento, no solo la
  // recorta), y es muy fácil pasarse un poco del borde al dibujar —
  // sobre todo cerca de las esquinas, donde suelen estar los logos. Por
  // eso la región se acota siempre a los límites reales del video.
  const x = Math.max(0, Math.min(drawn.left * scaleX, naturalWidth.value))
  const y = Math.max(0, Math.min(drawn.top * scaleY, naturalHeight.value))
  const region: LogoRegion = {
    x,
    y,
    width: Math.min(drawn.width * scaleX, naturalWidth.value - x),
    height: Math.min(drawn.height * scaleY, naturalHeight.value - y),
  }

  if (region.width < 4 || region.height < 4) {
    emit('drawing-cancelled')
  } else {
    emit('region-drawn', region)
  }
}

// Si el gesto se cancela (el sistema lo interrumpe) en vez de terminar con
// un "pointerup" normal, igual hay que cerrar el trazo; de lo contrario
// queda "dragging" encendido sin que nada lo vuelva a apagar.
function onPointerCancel() {
  dragging.value = false
  dragRect.value = null
  dragBoundRect = null
  emit('drawing-cancelled')
}

// Red de seguridad: si por lo que sea queda un trazo a medias cuando se
// sale del modo de dibujo (cambiando de herramienta, por ejemplo), no debe
// quedar un estado colgado — ni el rectángulo a medio dibujar ni "dragging".
watch(() => props.logoEditing, (editing) => {
  if (!editing) {
    dragging.value = false
    dragRect.value = null
  }
})
watch(() => props.cropEditing, (editing) => {
  if (!editing) cropDragHandle.value = null
})

// Si cambia el video, se pierde cualquier trazo a medias sobre el anterior
// (las zonas guardadas en sí las resetea el componente padre).
watch(() => props.src, () => {
  dragging.value = false
  dragRect.value = null
})

// --- Recorte / proporción ---
// Cuatro tiradores, uno por borde, ajustan el tamaño del recuadro. Arrastrar
// el recuadro por dentro (fuera de los tiradores) lo desplaza entero sin
// cambiar su tamaño ni su proporción — así se elige qué parte del video
// original queda dentro de un encuadre que ya tiene el ancho/alto fijado
// (por un preset, por ejemplo), en vez de tener que estirar los bordes.
type CropHandle = 'top' | 'right' | 'bottom' | 'left' | 'move'
const cropDragHandle = ref<CropHandle | null>(null)
const CROP_MIN_SIZE = 20 // tamaño mínimo del recorte, en píxeles reales del video
const cropMoveOrigin = ref({ pointerX: 0, pointerY: 0, rectX: 0, rectY: 0 })

function onCropHandleDown(handle: CropHandle, ev: PointerEvent) {
  if (!props.cropRect || !mediaEl.value) return
  ev.preventDefault()
  ev.stopPropagation()
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  dragBoundRect = mediaEl.value.getBoundingClientRect()
  cropDragHandle.value = handle
  if (handle === 'move') {
    cropMoveOrigin.value = {
      pointerX: ev.clientX,
      pointerY: ev.clientY,
      rectX: props.cropRect.x,
      rectY: props.cropRect.y,
    }
  }
}

function onCropHandleMove(ev: PointerEvent) {
  if (!cropDragHandle.value || !dragBoundRect || !props.cropRect) return
  const rect = dragBoundRect
  const scaleX = naturalWidth.value / rect.width
  const scaleY = naturalHeight.value / rect.height

  const c = { ...props.cropRect }
  if (cropDragHandle.value === 'move') {
    const dx = (ev.clientX - cropMoveOrigin.value.pointerX) * scaleX
    const dy = (ev.clientY - cropMoveOrigin.value.pointerY) * scaleY
    c.x = Math.max(0, Math.min(cropMoveOrigin.value.rectX + dx, naturalWidth.value - c.width))
    c.y = Math.max(0, Math.min(cropMoveOrigin.value.rectY + dy, naturalHeight.value - c.height))
    emit('update:cropRect', c)
    return
  }

  const px = (ev.clientX - rect.left) * scaleX
  const py = (ev.clientY - rect.top) * scaleY
  if (cropDragHandle.value === 'top') {
    const newY = Math.max(0, Math.min(py, c.y + c.height - CROP_MIN_SIZE))
    c.height += c.y - newY
    c.y = newY
  } else if (cropDragHandle.value === 'bottom') {
    const newBottom = Math.max(c.y + CROP_MIN_SIZE, Math.min(py, naturalHeight.value))
    c.height = newBottom - c.y
  } else if (cropDragHandle.value === 'left') {
    const newX = Math.max(0, Math.min(px, c.x + c.width - CROP_MIN_SIZE))
    c.width += c.x - newX
    c.x = newX
  } else if (cropDragHandle.value === 'right') {
    const newRight = Math.max(c.x + CROP_MIN_SIZE, Math.min(px, naturalWidth.value))
    c.width = newRight - c.x
  }
  emit('update:cropRect', c)
}

function onCropHandleUp() {
  cropDragHandle.value = null
  dragBoundRect = null
}
</script>

<template>
  <div class="preview-wrap">
    <div class="stage" :class="{ 'is-editing-logo': logoEditing }">
      <video
        v-if="mediaType === 'video'"
        ref="mediaEl"
        :src="src"
        :controls="!logoEditing && !cropEditing"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
      />
      <img v-else ref="mediaEl" :src="src" @load="onImageLoad" alt="" />
      <!--
        Mientras se dibuja la región, un overlay transparente recibe el
        arrastre en vez del <video>: así un clic o un gesto de reproducción
        nunca llega al elemento nativo (que si lo recibe, se pone a
        reproducir y el rectángulo que se estaba dibujando se pierde).
      -->
      <div
        v-if="logoEditing"
        class="draw-overlay"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="finishDrag"
        @pointercancel="onPointerCancel"
      />
      <!--
        Cada zona marcada se muestra ya difuminada (backdrop-filter
        desenfoca lo que hay justo detrás, en vivo, incluso reproduciendo),
        para ver de antemano más o menos cómo va a quedar sin tener que
        exportar primero.
      -->
      <div
        v-for="(region, i) in logoRegions"
        :key="i"
        class="logo-box saved"
        :style="{
          left: (region.x / naturalWidth * 100) + '%',
          top: (region.y / naturalHeight * 100) + '%',
          width: (region.width / naturalWidth * 100) + '%',
          height: (region.height / naturalHeight * 100) + '%',
        }"
      />
      <div v-if="dragging && dragRect" class="logo-box dragging" :style="{
        left: dragRect.left + 'px',
        top: dragRect.top + 'px',
        width: dragRect.width + 'px',
        height: dragRect.height + 'px',
      }" />

      <!--
        Recorte: lo que queda fuera del rectángulo se oscurece con cuatro
        franjas (arriba/abajo/izquierda/derecha), y cuatro tiradores en los
        bordes del rectángulo permiten ajustarlo a mano.
      -->
      <template v-if="cropEditing && cropRect && naturalWidth && naturalHeight">
        <div class="crop-dim" :style="{ left: 0, top: 0, right: 0, height: (cropRect.y / naturalHeight * 100) + '%' }" />
        <div class="crop-dim" :style="{ left: 0, bottom: 0, right: 0, height: (100 - (cropRect.y + cropRect.height) / naturalHeight * 100) + '%' }" />
        <div class="crop-dim" :style="{
          left: 0,
          top: (cropRect.y / naturalHeight * 100) + '%',
          width: (cropRect.x / naturalWidth * 100) + '%',
          height: (cropRect.height / naturalHeight * 100) + '%',
        }" />
        <div class="crop-dim" :style="{
          right: 0,
          top: (cropRect.y / naturalHeight * 100) + '%',
          width: (100 - (cropRect.x + cropRect.width) / naturalWidth * 100) + '%',
          height: (cropRect.height / naturalHeight * 100) + '%',
        }" />
        <div
          class="crop-rect"
          :style="{
            left: (cropRect.x / naturalWidth * 100) + '%',
            top: (cropRect.y / naturalHeight * 100) + '%',
            width: (cropRect.width / naturalWidth * 100) + '%',
            height: (cropRect.height / naturalHeight * 100) + '%',
          }"
          @pointerdown="onCropHandleDown('move', $event)"
          @pointermove="onCropHandleMove"
          @pointerup="onCropHandleUp"
        >
          <div
            class="crop-handle top"
            @pointerdown="onCropHandleDown('top', $event)"
            @pointermove="onCropHandleMove"
            @pointerup="onCropHandleUp"
          />
          <div
            class="crop-handle bottom"
            @pointerdown="onCropHandleDown('bottom', $event)"
            @pointermove="onCropHandleMove"
            @pointerup="onCropHandleUp"
          />
          <div
            class="crop-handle left"
            @pointerdown="onCropHandleDown('left', $event)"
            @pointermove="onCropHandleMove"
            @pointerup="onCropHandleUp"
          />
          <div
            class="crop-handle right"
            @pointerdown="onCropHandleDown('right', $event)"
            @pointermove="onCropHandleMove"
            @pointerup="onCropHandleUp"
          />
        </div>
      </template>
    </div>
    <p v-if="logoEditing" class="hint">Dibuja un rectángulo sobre lo que quieres tapar.</p>
    <p v-if="cropEditing" class="hint">Arrastra para centrar lo que quieres conservar, o los bordes del recuadro para ajustar el tamaño del recorte.</p>
  </div>
</template>

<style scoped>
.preview-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.stage {
  position: relative;
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  background: #000;
}
video,
img {
  display: block;
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
}
.draw-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  touch-action: none;
}
.logo-box {
  position: absolute;
  border: 1.5px solid var(--accent);
  border-radius: 2px;
  pointer-events: none;
}
.logo-box.saved {
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.logo-box.dragging {
  background: rgba(10, 132, 255, 0.18);
}
.crop-dim {
  position: absolute;
  background: rgba(0, 0, 0, 0.65);
  pointer-events: none;
}
.crop-rect {
  position: absolute;
  border: 1.5px solid #fff;
  box-sizing: border-box;
  cursor: move;
  touch-action: none;
}
.crop-handle {
  position: absolute;
  background: #fff;
  border-radius: 3px;
  touch-action: none;
}
.crop-handle.top,
.crop-handle.bottom {
  left: 50%;
  width: 36px;
  height: 6px;
  margin-left: -18px;
  cursor: ns-resize;
}
.crop-handle.top {
  top: -3px;
}
.crop-handle.bottom {
  bottom: -3px;
}
.crop-handle.left,
.crop-handle.right {
  top: 50%;
  width: 6px;
  height: 36px;
  margin-top: -18px;
  cursor: ew-resize;
}
.crop-handle.left {
  left: -3px;
}
.crop-handle.right {
  right: -3px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
</style>
