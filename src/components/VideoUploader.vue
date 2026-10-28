<script setup lang="ts">
const emit = defineEmits<{ (e: 'selected', file: File): void }>()

function onInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('selected', file)
}

function onDrop(ev: DragEvent) {
  ev.preventDefault()
  const file = ev.dataTransfer?.files?.[0]
  if (file) emit('selected', file)
}
</script>

<template>
  <label
    class="dropzone glass"
    @dragover.prevent
    @drop="onDrop"
  >
    <input type="file" accept="video/*" @change="onInputChange" hidden />
    <div class="dropzone-content">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <strong>Arrastra un video aquí</strong>
      <span>o haz clic para elegir un archivo</span>
      <small>No se sube a ningún servidor — todo se procesa en tu propio navegador.</small>
    </div>
  </label>
</template>

<style scoped>
.dropzone {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  border-radius: 24px;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.dropzone:hover {
  background: var(--glass-strong);
}
.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: var(--text-dim);
  padding: 20px;
}
.icon {
  width: 30px;
  height: 30px;
  color: var(--text-faint);
  margin-bottom: 4px;
}
.dropzone-content strong {
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 600;
}
.dropzone-content small {
  max-width: 280px;
  font-size: 0.8rem;
}
</style>
