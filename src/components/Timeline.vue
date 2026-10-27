<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  duration: number
  trimStart: number
  trimEnd: number
}>()

const emit = defineEmits<{
  (e: 'update:trimStart', value: number): void
  (e: 'update:trimEnd', value: number): void
}>()

const startPct = computed(() => (props.duration ? (props.trimStart / props.duration) * 100 : 0))
const endPct = computed(() => (props.duration ? (props.trimEnd / props.duration) * 100 : 100))

function onStartInput(ev: Event) {
  const value = Number((ev.target as HTMLInputElement).value)
  emit('update:trimStart', Math.min(value, props.trimEnd - 0.1))
}

function onEndInput(ev: Event) {
  const value = Number((ev.target as HTMLInputElement).value)
  emit('update:trimEnd', Math.max(value, props.trimStart + 0.1))
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
</script>

<template>
  <div class="timeline">
    <div class="track">
      <div class="selected-range" :style="{ left: startPct + '%', width: (endPct - startPct) + '%' }" />
      <input
        class="range start"
        type="range"
        min="0"
        :max="duration"
        step="0.05"
        :value="trimStart"
        @input="onStartInput"
      />
      <input
        class="range end"
        type="range"
        min="0"
        :max="duration"
        step="0.05"
        :value="trimEnd"
        @input="onEndInput"
      />
    </div>
    <div class="labels">
      <span>Inicio: {{ formatTime(trimStart) }}</span>
      <span>Duración seleccionada: {{ formatTime(trimEnd - trimStart) }}</span>
      <span>Fin: {{ formatTime(trimEnd) }}</span>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.track {
  position: relative;
  height: 32px;
}
.selected-range {
  position: absolute;
  top: 13px;
  height: 6px;
  background: var(--accent);
  border-radius: 3px;
}
.range {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  margin: 0;
  background: transparent;
  pointer-events: none;
  appearance: none;
  height: 32px;
}
.range::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--text);
  margin-top: 9px;
  cursor: pointer;
}
.range::-moz-range-thumb {
  pointer-events: auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--text);
  cursor: pointer;
}
.labels {
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
  font-size: 0.85rem;
}
</style>
