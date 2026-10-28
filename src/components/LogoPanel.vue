<script setup lang="ts">
defineProps<{
  logoEditing: boolean
  hasLogoRegion: boolean
}>()

defineEmits<{
  (e: 'toggle-logo-editing'): void
  (e: 'clear-logo-region'): void
}>()
</script>

<template>
  <div class="panel glass">
    <p class="hint">Marca un rectángulo sobre el video, encima del logo o la marca de agua que quieres tapar. El video de arriba ya muestra el área difuminada, antes de exportar.</p>
    <div class="actions">
      <button
        type="button"
        class="pill"
        :class="{ active: logoEditing }"
        @click="$emit('toggle-logo-editing')"
      >
        {{ logoEditing ? 'Dibujando…' : 'Marcar región' }}
      </button>
      <button
        v-if="hasLogoRegion"
        type="button"
        class="pill ghost"
        @click="$emit('clear-logo-region')"
      >
        Quitar marca
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
