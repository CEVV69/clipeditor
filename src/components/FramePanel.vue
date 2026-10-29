<script setup lang="ts">
const props = defineProps<{
  duration: number
  captureTime: number
  capturing: boolean
  progress: number
  errorMessage: string
}>()

const emit = defineEmits<{
  (e: 'update:captureTime', value: number): void
  (e: 'seek', value: number): void
  (e: 'capture'): void
}>()

// Medio cuadro antes del final — pedirle a ffmpeg el instante exacto de
// duración a veces no entrega ningún fotograma.
const END_MARGIN = 1 / 30

function setTime(value: number) {
  const clamped = Math.min(Math.max(value, 0), Math.max(0, props.duration - END_MARGIN))
  emit('update:captureTime', clamped)
  emit('seek', clamped)
}

function onSliderInput(ev: Event) {
  setTime(Number((ev.target as HTMLInputElement).value))
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
</script>

<template>
  <div class="panel glass">
    <p class="hint">Elige el momento exacto y captúralo como imagen — no toca el video original.</p>

    <div class="track">
      <input
        class="range"
        type="range"
        min="0"
        :max="duration"
        step="0.01"
        :value="captureTime"
        @input="onSliderInput"
      />
    </div>

    <div class="actions">
      <button type="button" class="pill" @click="setTime(0)">Inicio</button>
      <span class="time">{{ formatTime(captureTime) }}</span>
      <button type="button" class="pill" @click="setTime(duration)">Final</button>
    </div>

    <button type="button" class="capture" :disabled="capturing" @click="emit('capture')">
      {{ capturing ? `Capturando ${Math.round(progress * 100)}%` : 'Capturar fotograma' }}
    </button>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: 20px;
  padding: 18px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
.track {
  position: relative;
  height: 28px;
}
.range {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  margin: 0;
  appearance: none;
  background: transparent;
  height: 28px;
}
.range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--glass-strong);
}
.range::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  margin-top: -6px;
  cursor: grab;
}
.range::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--glass-strong);
}
.range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: grab;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.pill {
  background: var(--glass-strong);
  color: var(--text);
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 0.85rem;
}
.time {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  min-width: 56px;
  text-align: center;
}
.capture {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 14px;
  padding: 12px;
  font-size: 0.9rem;
  font-weight: 600;
}
.capture:disabled {
  opacity: 0.5;
}
.error {
  margin: 0;
  color: var(--accent-2);
  font-size: 0.85rem;
  text-align: center;
}
</style>
