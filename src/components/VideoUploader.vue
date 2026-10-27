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
    class="dropzone"
    @dragover.prevent
    @drop="onDrop"
  >
    <input type="file" accept="video/*" @change="onInputChange" hidden />
    <div class="dropzone-content">
      <strong>Arrastra un video aquí</strong>
      <span>o haz clic para elegir un archivo</span>
      <small>El video se procesa en tu navegador; no se sube a ningún servidor.</small>
    </div>
  </label>
</template>

<style scoped>
.dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  background: var(--panel);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.dropzone:hover {
  border-color: var(--accent);
}
.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  color: var(--text-dim);
}
.dropzone-content strong {
  color: var(--text);
  font-size: 1.1rem;
}
.dropzone-content small {
  max-width: 320px;
}
</style>
