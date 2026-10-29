<script setup lang="ts">
const props = defineProps<{
  rotation: 0 | 90 | 180 | 270
  flipHorizontal: boolean
  flipVertical: boolean
}>()

const emit = defineEmits<{
  (e: 'update:rotation', value: 0 | 90 | 180 | 270): void
  (e: 'update:flipHorizontal', value: boolean): void
  (e: 'update:flipVertical', value: boolean): void
}>()

// Un solo botón va rotando de a 90° en vez de cuatro botones (uno por
// ángulo) — más simple, y el ángulo actual queda a la vista en el texto.
function rotateNext() {
  const next = { 0: 90, 90: 180, 180: 270, 270: 0 } as const
  emit('update:rotation', next[props.rotation])
}
</script>

<template>
  <div class="panel glass">
    <p class="hint">Se aplica junto con lo demás al ejecutar la edición — no hace falta un botón aparte.</p>
    <div class="actions">
      <button type="button" class="pill" @click="rotateNext">
        Girar 90° ({{ rotation }}°)
      </button>
      <button
        type="button"
        class="pill"
        :class="{ active: flipHorizontal }"
        @click="emit('update:flipHorizontal', !flipHorizontal)"
      >
        Voltear horizontal
      </button>
      <button
        type="button"
        class="pill"
        :class="{ active: flipVertical }"
        @click="emit('update:flipVertical', !flipVertical)"
      >
        Voltear vertical
      </button>
    </div>
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
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pill {
  background: var(--glass-strong);
  color: var(--text);
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 0.85rem;
}
.pill.active {
  background: var(--accent);
}
</style>
