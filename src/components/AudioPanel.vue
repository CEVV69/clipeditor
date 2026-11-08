<script setup lang="ts">
defineProps<{
  extracting: boolean
  progress: number
  errorMessage: string
}>()

defineEmits<{
  (e: 'extract'): void
}>()
</script>

<template>
  <div class="panel glass">
    <p class="hint">Saca el audio completo del video como mp3 — no toca el video original.</p>

    <button type="button" class="extract" :disabled="extracting" @click="$emit('extract')">
      {{ extracting ? `Extrayendo ${Math.round(progress * 100)}%` : 'Extraer audio' }}
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
.extract {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 14px;
  padding: 12px;
  font-size: 0.9rem;
  font-weight: 600;
}
.extract:disabled {
  opacity: 0.5;
}
.error {
  margin: 0;
  color: var(--accent-2);
  font-size: 0.85rem;
  text-align: center;
}
</style>
