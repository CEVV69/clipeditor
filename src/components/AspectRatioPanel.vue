<script setup lang="ts">
const PRESETS = [
  { id: 'original', label: 'Original' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '1:1', label: '1:1' },
]

defineProps<{
  activePreset: string | null
  hasCrop: boolean
}>()

defineEmits<{
  (e: 'select-preset', id: string): void
}>()
</script>

<template>
  <div class="panel glass">
    <p class="hint">
      Elige una proporción y arrastra el video para centrar lo que quieres conservar. También puedes
      ajustar los bordes del recuadro a mano, horizontal y vertical.
    </p>
    <div class="presets">
      <button
        v-for="preset in PRESETS"
        :key="preset.id"
        type="button"
        class="pill"
        :class="{ active: activePreset === preset.id }"
        @click="$emit('select-preset', preset.id)"
      >
        {{ preset.label }}
      </button>
    </div>
    <p v-if="hasCrop && !activePreset" class="hint small">Recorte personalizado.</p>
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
  font-size: 0.85rem;
}
.hint.small {
  font-size: 0.78rem;
  color: var(--text-faint);
}
.presets {
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
