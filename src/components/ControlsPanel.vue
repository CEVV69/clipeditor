<script setup lang="ts">
const props = defineProps<{
  volume: number
  speed: number
  logoEditing: boolean
  hasLogoRegion: boolean
  exporting: boolean
  exportProgress: number
}>()

const emit = defineEmits<{
  (e: 'update:volume', value: number): void
  (e: 'update:speed', value: number): void
  (e: 'toggle-logo-editing'): void
  (e: 'clear-logo-region'): void
  (e: 'export'): void
}>()
</script>

<template>
  <div class="panel">
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

    <div class="field logo-field">
      <label>Quitar logo / marca de agua</label>
      <div class="logo-actions">
        <button
          type="button"
          class="secondary"
          :class="{ active: logoEditing }"
          @click="emit('toggle-logo-editing')"
        >
          {{ logoEditing ? 'Dibujando región…' : 'Marcar región' }}
        </button>
        <button
          v-if="hasLogoRegion"
          type="button"
          class="secondary ghost"
          @click="emit('clear-logo-region')"
        >
          Quitar marca
        </button>
      </div>
    </div>

    <button class="export" type="button" :disabled="exporting" @click="emit('export')">
      {{ exporting ? `Procesando… ${Math.round(exportProgress * 100)}%` : 'Exportar video' }}
    </button>
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
.logo-actions {
  display: flex;
  gap: 8px;
}
button.secondary {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 0.9rem;
}
button.secondary.active {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
button.secondary.ghost {
  background: transparent;
}
button.export {
  margin-top: 4px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px;
  font-size: 1rem;
  font-weight: 600;
}
</style>
