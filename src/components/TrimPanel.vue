<script setup lang="ts">
import Timeline from './Timeline.vue'

defineProps<{
  duration: number
  trimStart: number
  trimEnd: number
}>()

defineEmits<{
  (e: 'update:trimStart', value: number): void
  (e: 'update:trimEnd', value: number): void
}>()
</script>

<template>
  <div class="panel">
    <h2>Cortar video</h2>
    <p class="hint">Arrastra los controles para marcar el inicio y el fin del fragmento que quieres conservar.</p>
    <Timeline
      v-if="duration > 0"
      :duration="duration"
      :trim-start="trimStart"
      :trim-end="trimEnd"
      @update:trim-start="$emit('update:trimStart', $event)"
      @update:trim-end="$emit('update:trimEnd', $event)"
    />
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
</style>
