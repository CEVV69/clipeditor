<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  logoEditing: boolean
  regionsCount: number
}>()

defineEmits<{
  (e: 'start-selecting'): void
  (e: 'clear-all'): void
}>()

const MAX_REGIONS = 3

const selectLabel = computed(() => {
  if (props.logoEditing) return 'Dibujando…'
  return props.regionsCount === 0 ? 'Seleccionar zona' : `Seleccionar zona ${props.regionsCount + 1}`
})
const canSelectMore = computed(() => props.regionsCount < MAX_REGIONS)
</script>

<template>
  <div class="panel glass">
    <p class="hint">
      Marca hasta 3 zonas sobre el video, encima de los logos o marcas de agua que quieres tapar. Cada una
      se ve ya difuminada arriba, antes de exportar.
    </p>
    <div class="actions">
      <button
        v-if="canSelectMore"
        type="button"
        class="pill"
        :class="{ active: logoEditing }"
        @click="$emit('start-selecting')"
      >
        {{ selectLabel }}
      </button>
      <button
        v-if="regionsCount > 0"
        type="button"
        class="pill ghost"
        @click="$emit('clear-all')"
      >
        Quitar marcas
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
  font-size: 0.85rem;
}
.actions {
  display: flex;
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
.pill.ghost {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-dim);
}
</style>
