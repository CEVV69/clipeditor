<script setup lang="ts">
import { ref } from 'vue'
import YoutubeImportPanel from './YoutubeImportPanel.vue'

const emit = defineEmits<{ (e: 'selected', file: File): void }>()

const mode = ref<'file' | 'youtube'>('file')
const rejectionError = ref('')

// Las fotos de iPhone/Mac quedan en HEIC por defecto — ni el navegador las
// muestra de forma confiable (solo Safari, a medias) ni el motor de edición
// las puede procesar. file.type suele venir vacío para HEIC en varios
// navegadores, así que se revisa también la extensión del nombre.
function isHeic(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  )
}

function handleFile(file: File) {
  if (isHeic(file)) {
    rejectionError.value =
      'Esta foto está en formato HEIC, que no se puede mostrar ni editar acá. Conviértela antes a JPG o PNG: ábrela con Vista Previa en tu Mac → Archivo → Exportar → elige JPEG.'
    return
  }
  rejectionError.value = ''
  emit('selected', file)
}

function onInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleFile(file)
}

function onDrop(ev: DragEvent) {
  ev.preventDefault()
  const file = ev.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}
</script>

<template>
  <div class="uploader">
    <div class="mode-switch">
      <button type="button" class="mode-tab" :class="{ active: mode === 'file' }" @click="mode = 'file'">
        Subir archivo
      </button>
      <button type="button" class="mode-tab" :class="{ active: mode === 'youtube' }" @click="mode = 'youtube'">
        Importar de YouTube
      </button>
    </div>

    <label v-if="mode === 'file'" class="dropzone glass" @dragover.prevent @drop="onDrop">
      <input type="file" accept="video/*,image/*" @change="onInputChange" hidden />
      <div class="dropzone-content">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <strong>Arrastra un video o imagen aquí</strong>
        <span>o haz clic para elegir un archivo</span>
        <small>No se sube a ningún servidor — todo se procesa en tu propio navegador.</small>
      </div>
    </label>

    <YoutubeImportPanel v-else @selected="(file) => emit('selected', file)" />

    <p v-if="rejectionError" class="error">{{ rejectionError }}</p>
  </div>
</template>

<style scoped>
.uploader {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mode-switch {
  display: flex;
  gap: 6px;
  align-self: center;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 3px;
}
.mode-tab {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 9px;
}
.mode-tab.active {
  background: var(--glass-strong);
  color: var(--text);
}
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
.error {
  margin: 0;
  color: var(--accent-2);
  font-size: 0.85rem;
  text-align: center;
}
</style>
