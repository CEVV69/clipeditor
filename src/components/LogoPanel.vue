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
  <div class="panel">
    <h2>Quitar logo o marca de agua</h2>
    <p class="hint">Marca la región y dibuja un rectángulo sobre el video, encima del logo que quieres tapar.</p>
    <div class="actions">
      <button
        type="button"
        class="secondary"
        :class="{ active: logoEditing }"
        @click="$emit('toggle-logo-editing')"
      >
        {{ logoEditing ? 'Dibujando región…' : 'Marcar región' }}
      </button>
      <button
        v-if="hasLogoRegion"
        type="button"
        class="secondary ghost"
        @click="$emit('clear-logo-region')"
      >
        Quitar marca
      </button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
}
h2 {
  margin: 0;
  font-size: 1rem;
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
</style>
