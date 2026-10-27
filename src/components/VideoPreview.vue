<script setup lang="ts">
import { ref, watch } from 'vue'
import type { LogoRegion } from '../ffmpeg/commandBuilder'

const props = defineProps<{
  src: string
  logoEditing: boolean
  logoRegion: LogoRegion | null
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

function onLoadedMetadata() {
  if (!videoEl.value) return
  naturalWidth.value = videoEl.value.videoWidth
  naturalHeight.value = videoEl.value.videoHeight
  emit('duration', videoEl.value.duration)
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
    <p v-if="logoEditing" class="hint">Dibuja un rectángulo sobre el logo o la marca de agua que quieres tapar.</p>
  </div>
</template>

<style scoped>
.preview-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}
.stage.is-editing-logo {
  cursor: crosshair;
}
video {
  display: block;
  max-width: 100%;
  max-height: 60vh;
}
.logo-box {
  position: absolute;
  border: 2px solid var(--accent-2);
  background: rgba(255, 91, 122, 0.2);
  pointer-events: none;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}
</style>
