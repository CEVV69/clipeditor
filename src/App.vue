<script setup lang="ts">
import { computed, ref } from 'vue'
import VideoUploader from './components/VideoUploader.vue'
import VideoPreview from './components/VideoPreview.vue'
import ToolNav, { type ToolDef } from './components/ToolNav.vue'
import TrimPanel from './components/TrimPanel.vue'
import VolumeSpeedPanel from './components/VolumeSpeedPanel.vue'
import LogoPanel from './components/LogoPanel.vue'
import { useFfmpeg } from './ffmpeg/useFfmpeg'
import type { LogoRegion } from './ffmpeg/commandBuilder'

const TOOLS: ToolDef[] = [
  { id: 'trim', label: 'Cortar', icon: 'cut' },
  { id: 'volume-speed', label: 'Volumen y velocidad', icon: 'speed' },
  { id: 'logo', label: 'Quitar logo', icon: 'logo' },
]

const activeTool = ref<string>('trim')

const file = ref<File | null>(null)
const sourceUrl = ref('')

const duration = ref(0)
const trimStart = ref(0)
const trimEnd = ref(0)

const volume = ref(1)
const speed = ref(1)

const logoEditing = ref(false)
const logoRegion = ref<LogoRegion | null>(null)

const resultUrl = ref('')
const errorMessage = ref('')

const { loading, loaded, progress, runEdit } = useFfmpeg()
const exporting = ref(false)

function onFileSelected(selected: File) {
  file.value = selected
  sourceUrl.value = URL.createObjectURL(selected)
  duration.value = 0
  trimStart.value = 0
  trimEnd.value = 0
  logoRegion.value = null
  logoEditing.value = false
  resultUrl.value = ''
  errorMessage.value = ''
  activeTool.value = 'trim'
}

function onDuration(seconds: number) {
  duration.value = seconds
  trimEnd.value = seconds
}

function toggleLogoEditing() {
  logoEditing.value = !logoEditing.value
}

// Dibujar la región de logo solo tiene sentido mientras esa herramienta
// está activa; si el usuario cambia de herramienta, se sale del modo dibujo.
function onToolChange(tool: string) {
  activeTool.value = tool
  if (tool !== 'logo') logoEditing.value = false
}

async function onExport() {
  if (!file.value) return
  errorMessage.value = ''
  exporting.value = true
  try {
    const blob = await runEdit(file.value, {
      trimStart: trimStart.value,
      trimEnd: trimEnd.value,
      volume: volume.value,
      speed: speed.value,
      logoRegion: logoRegion.value,
    })
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.error('export failed', err)
    errorMessage.value = err instanceof Error ? err.message : 'No se pudo procesar el video.'
  } finally {
    exporting.value = false
  }
}

const statusText = computed(() => {
  if (loading.value) return 'Cargando FFmpeg (WebAssembly)…'
  if (!loaded.value) return 'FFmpeg se carga la primera vez que exportas.'
  return 'FFmpeg listo.'
})
</script>

<template>
  <div class="app">
    <header>
      <h1>ClipEditor</h1>
      <p class="subtitle">
        Corta, ajusta volumen/velocidad y quita logos — todo dentro de tu navegador, con FFmpeg
        compilado a WebAssembly (igual técnica que usa 123apps).
      </p>
    </header>

    <div class="layout">
      <ToolNav :tools="TOOLS" :model-value="activeTool" :disabled="!file" @update:model-value="onToolChange" />

      <main class="workspace">
        <VideoUploader v-if="!file" @selected="onFileSelected" />

        <template v-else>
          <VideoPreview
            :src="sourceUrl"
            :logo-editing="logoEditing && activeTool === 'logo'"
            v-model:logo-region="logoRegion"
            @duration="onDuration"
          />

          <TrimPanel
            v-if="activeTool === 'trim'"
            :duration="duration"
            v-model:trim-start="trimStart"
            v-model:trim-end="trimEnd"
          />

          <VolumeSpeedPanel
            v-else-if="activeTool === 'volume-speed'"
            v-model:volume="volume"
            v-model:speed="speed"
          />

          <LogoPanel
            v-else
            :logo-editing="logoEditing"
            :has-logo-region="logoRegion !== null"
            @toggle-logo-editing="toggleLogoEditing"
            @clear-logo-region="logoRegion = null"
          />

          <div class="export-bar">
            <button class="export" type="button" :disabled="exporting" @click="onExport">
              {{ exporting ? `Procesando… ${Math.round(progress * 100)}%` : 'Exportar video' }}
            </button>
            <p class="status">{{ statusText }}</p>
          </div>

          <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

          <div v-if="resultUrl" class="result">
            <h2>Resultado</h2>
            <video :src="resultUrl" controls />
            <a class="download" :href="resultUrl" download="video-editado.mp4">Descargar video</a>
          </div>

          <button class="change-file" type="button" @click="file = null">Elegir otro video</button>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}
header h1 {
  margin: 0 0 6px;
  font-size: 1.6rem;
}
.subtitle {
  color: var(--text-dim);
  margin: 0 0 28px;
  max-width: 640px;
}
.layout {
  display: flex;
  align-items: flex-start;
  gap: 28px;
}
.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.export-bar {
  display: flex;
  align-items: center;
  gap: 14px;
}
button.export {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 20px;
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
}
.status {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin: 0;
}
.error {
  color: var(--accent-2);
  margin: 0;
}
.result {
  border-top: 1px solid var(--border);
  padding-top: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.result h2 {
  align-self: flex-start;
  margin: 0;
  font-size: 1rem;
}
.result video {
  max-width: 100%;
  border-radius: 10px;
}
.result .download {
  display: inline-block;
  text-align: center;
  background: var(--accent);
  color: #fff;
  text-decoration: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
  width: fit-content;
}
.change-file {
  align-self: flex-start;
  margin-top: 4px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
}

@media (max-width: 720px) {
  .layout {
    flex-direction: column;
  }
}
</style>
