<script setup lang="ts">
defineProps<{
  volume: number
  speed: number
}>()

const emit = defineEmits<{
  (e: 'update:volume', value: number): void
  (e: 'update:speed', value: number): void
}>()
</script>

<template>
  <div class="panel glass">
    <p class="hint">Reproduce el video de arriba para escuchar el resultado antes de ejecutar la edición.</p>

    <div class="field">
      <div class="field-head">
        <span>Volumen</span>
        <span class="value">{{ Math.round(volume * 100) }}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="3"
        step="0.05"
        :value="volume"
        @input="emit('update:volume', Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <div class="field">
      <div class="field-head">
        <span>Velocidad</span>
        <span class="value">{{ speed.toFixed(2) }}x</span>
      </div>
      <input
        type="range"
        min="0.25"
        max="4"
        step="0.05"
        :value="speed"
        @input="emit('update:speed', Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border-radius: 20px;
  padding: 18px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}
.field-head span:first-child {
  color: var(--text-dim);
}
.field-head .value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
input[type='range'] {
  width: 100%;
}
</style>
