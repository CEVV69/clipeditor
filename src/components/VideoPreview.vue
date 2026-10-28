<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { LogoRegion } from '../ffmpeg/commandBuilder'

const props = defineProps<{
  src: string
  logoEditing: boolean
  logoRegion: LogoRegion | null
  volume: number
  speed: number
  /** Segundo al que saltar (vista previa en vivo al mover el corte). */
  seekTo: number | null
}>()

const emit = defineEmits<{
  (e: 'duration', seconds: number): void
  (e: 'update:logoRegion', region: LogoRegion | null): void
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)

const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)

// El volumen por encima del 100% no lo soporta <video>.volume de forma
// nativa (tope en 1), así que para amplificar de verdad enrutamos el audio
// por Web Audio una sola vez; por debajo de 100% basta con el volumen nativo.
let audioCtx: AudioContext | null = null
let gainNode: GainNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null

function ensureAudioGraph() {
  if (sourceNode || !videoEl.value) return
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  audioCtx = new Ctx()
  sourceNode = audioCtx.createMediaElementSource(videoEl.value)
  gainNode = audioCtx.createGain()
  sourceNode.connect(gainNode).connect(audioCtx.destination)
}

function applyVolume(v: number) {
  if (!videoEl.value) return
  if (v <= 1) {
    videoEl.value.volume = Math.max(0, v)
    if (gainNode) gainNode.gain.value = 1
    return
  }
  videoEl.value.volume = 1
  ensureAudioGraph()
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {})
  if (gainNode) gainNode.gain.value = v
}

watch(() => props.volume, applyVolume, { immediate: true })
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
  applyVolume(props.volume)
  videoEl.value.playbackRate = props.speed
}

function onPointerDown(ev: PointerEvent) {
  if (!props.logoEditing || !videoEl.value) return
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

function onPointerUp() {
  if (!dragging.value || !videoEl.value || !dragRect.value) return
  dragging.value = false

  const rect = videoEl.value.getBoundingClientRect()
  const scaleX = naturalWidth.value / rect.width
  const scaleY = naturalHeight.value / rect.height

  const region: LogoRegion = {
    x: dragRect.value.left * scaleX,
    y: dragRect.value.top * scaleY,
    width: dragRect.value.width * scaleX,
    height: dragRect.value.height * scaleY,
  }

  if (region.width < 4 || region.height < 4) {
    emit('update:logoRegion', null)
  } else {
    emit('update:logoRegion', region)
  }
}

// Si cambia el video, se pierde cualquier región de logo marcada sobre el anterior.
watch(() => props.src, () => {
  dragRect.value = null
  emit('update:logoRegion', null)
})
</script>

<template>
  <div class="preview-wrap">
    <div
      class="stage"
      :class="{ 'is-editing-logo': logoEditing }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <video ref="videoEl" :src="src" controls @loadedmetadata="onLoadedMetadata" />
      <div v-if="logoRegion && !dragging" class="logo-box saved" :style="{
        left: (logoRegion.x / naturalWidth * 100) + '%',
        top: (logoRegion.y / naturalHeight * 100) + '%',
        width: (logoRegion.width / naturalWidth * 100) + '%',
        height: (logoRegion.height / naturalHeight * 100) + '%',
      }" />
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
.stage.is-editing-logo {
  cursor: crosshair;
}
video {
  display: block;
  width: 100%;
  max-height: 60vh;
}
.logo-box {
  position: absolute;
  border: 1.5px solid var(--accent);
  background: rgba(10, 132, 255, 0.18);
  border-radius: 2px;
  pointer-events: none;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
</style>
