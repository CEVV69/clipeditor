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
  (e: 'seek', value: number): void
}>()

// Paso aproximado de un fotograma; el navegador no expone el fps real de
// un <video>, así que usamos un valor típico para avanzar de a poco.
const FRAME_STEP = 1 / 30

const startPct = computed(() => (props.duration ? (props.trimStart / props.duration) * 100 : 0))
const endPct = computed(() => (props.duration ? (props.trimEnd / props.duration) * 100 : 100))

function setStart(value: number) {
  const clamped = Math.min(Math.max(value, 0), props.trimEnd - FRAME_STEP)
  emit('update:trimStart', clamped)
  emit('seek', clamped)
}

function setEnd(value: number) {
  const clamped = Math.max(Math.min(value, props.duration), props.trimStart + FRAME_STEP)
  emit('update:trimEnd', clamped)
  emit('seek', clamped)
}

function onStartInput(ev: Event) {
  setStart(Number((ev.target as HTMLInputElement).value))
}
function onEndInput(ev: Event) {
  setEnd(Number((ev.target as HTMLInputElement).value))
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
</script>

<template>
  <div class="panel glass">
    <div class="track">
      <div class="selected-range" :style="{ left: startPct + '%', width: (endPct - startPct) + '%' }" />
      <input class="range" type="range" min="0" :max="duration" step="0.01" :value="trimStart" @input="onStartInput" />
      <input class="range" type="range" min="0" :max="duration" step="0.01" :value="trimEnd" @input="onEndInput" />
    </div>

    <div class="edges">
      <div class="edge">
        <span class="edge-label">Inicio</span>
        <div class="stepper">
          <button type="button" @click="setStart(trimStart - FRAME_STEP)">–</button>
          <span class="time">{{ formatTime(trimStart) }}</span>
          <button type="button" @click="setStart(trimStart + FRAME_STEP)">+</button>
        </div>
      </div>
      <div class="edge">
        <span class="edge-label">Fin</span>
        <div class="stepper">
          <button type="button" @click="setEnd(trimEnd - FRAME_STEP)">–</button>
          <span class="time">{{ formatTime(trimEnd) }}</span>
          <button type="button" @click="setEnd(trimEnd + FRAME_STEP)">+</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-radius: 20px;
  padding: 18px 18px 16px;
}
.track {
  position: relative;
  height: 28px;
}
.selected-range {
  position: absolute;
  top: 11px;
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
  height: 28px;
}
.range::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  margin-top: 5px;
  cursor: grab;
}
.range::-moz-range-thumb {
  pointer-events: auto;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: grab;
}
.edges {
  display: flex;
  gap: 12px;
}
.edge {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edge-label {
  font-size: 0.72rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--glass-strong);
  border-radius: 10px;
  padding: 4px;
}
.stepper button {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-size: 1rem;
  line-height: 1;
}
.stepper button:hover {
  background: rgba(255, 255, 255, 0.1);
}
.stepper .time {
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
</style>
