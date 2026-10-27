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
  <div class="panel">
    <h2>Volumen y velocidad</h2>

    <div class="field">
      <label>Volumen: {{ Math.round(volume * 100) }}%</label>
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
      <label>Velocidad: {{ speed.toFixed(2) }}x</label>
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
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
}
h2 {
  margin: 0;
  font-size: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 0.9rem;
  color: var(--text-dim);
}
input[type='range'] {
  width: 100%;
}
</style>
