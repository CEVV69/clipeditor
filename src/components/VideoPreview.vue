<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { LogoRegion } from '../ffmpeg/commandBuilder'

const props = defineProps<{
  src: string
  logoEditing: boolean
  logoRegions: LogoRegion[]
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
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)

const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)

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
  if (sourceNode || !videoEl.value) return
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  audioCtx = new Ctx()
  sourceNode = audioCtx.createMediaElementSource(videoEl.value)
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
  if (videoEl.value) videoEl.value.playbackRate = s
}, { immediate: true })
watch(() => props.seekTo, (t) => {
  if (videoEl.value && t !== null && Number.isFinite(t)) {
    videoEl.value.currentTime = t
  }
})

onBeforeUnmount(() => {
  sourceNode?.disconnect()
  gainNode?.disconnect()
  audioCtx?.close().catch(() => {})
})

function onLoadedMetadata() {
  if (!videoEl.value) return
  naturalWidth.value = videoEl.value.videoWidth
  naturalHeight.value = videoEl.value.videoHeight
  emit('duration', videoEl.value.duration)
  emit('natural-size', { width: naturalWidth.value, height: naturalHeight.value })
  videoEl.value.playbackRate = props.speed
}

function onPointerDown(ev: PointerEvent) {
  if (!videoEl.value) return
  ev.preventDefault()
  // Captura explícita del puntero: así, aunque el cursor salga del
  // recuadro de dibujo antes de soltar (o el gesto lo entregue de forma
  // rara, como a veces pasa con trackpad en Safari), el "pointerup" que
  // cierra el trazo sigue llegando a este mismo elemento en vez de
  // perderse. Sin esto, un trazo "fallido" podía dejar dragging=true
  // para siempre y el botón se quedaba pegado en "Dibujando…".
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  const rect = videoEl.value.getBoundingClientRect()
  dragStart.value = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  dragRect.value = { left: dragStart.value.x, top: dragStart.value.y, width: 0, height: 0 }
  dragging.value = true
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value || !videoEl.value) return
  const rect = videoEl.value.getBoundingClientRect()
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
  if (!dragging.value || !videoEl.value || !dragRect.value) {
    dragging.value = false
    return
  }
  dragging.value = false

  const rect = videoEl.value.getBoundingClientRect()
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

// Si cambia el video, se pierde cualquier trazo a medias sobre el anterior
// (las zonas guardadas en sí las resetea el componente padre).
watch(() => props.src, () => {
  dragging.value = false
  dragRect.value = null
})
</script>

<template>
  <div class="preview-wrap">
    <div class="stage" :class="{ 'is-editing-logo': logoEditing }">
      <video
        ref="videoEl"
        :src="src"
        :controls="!logoEditing"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
      />
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
    </div>
    <p v-if="logoEditing" class="hint">Dibuja un rectángulo sobre lo que quieres tapar.</p>
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
video {
  display: block;
  width: 100%;
  max-height: 60vh;
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
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
</style>
