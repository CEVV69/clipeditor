<script setup lang="ts">
import { computed, ref } from 'vue'
import VideoUploader from './components/VideoUploader.vue'
import VideoPreview from './components/VideoPreview.vue'
import Timeline from './components/Timeline.vue'
import ControlsPanel from './components/ControlsPanel.vue'
import { useFfmpeg } from './ffmpeg/useFfmpeg'
import type { LogoRegion } from './ffmpeg/commandBuilder'

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
}

function onDuration(seconds: number) {
  duration.value = seconds
  trimEnd.value = seconds
}

function toggleLogoEditing() {
  logoEditing.value = !logoEditing.value
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
      <h1>Editor de video</h1>
      <p class="subtitle">
        Corta, ajusta volumen/velocidad y quita logos — todo dentro de tu navegador, con FFmpeg
        compilado a WebAssembly (igual técnica que usa 123apps).
      </p>
    </header>

    <main>
      <VideoUploader v-if="!file" @selected="onFileSelected" />

      <template v-else>
        <section class="workspace">
          <VideoPreview
            :src="sourceUrl"
            :logo-editing="logoEditing"
            v-model:logo-region="logoRegion"
            @duration="onDuration"
          />

          <Timeline
            v-if="duration > 0"
            :duration="duration"
            v-model:trim-start="trimStart"
            v-model:trim-end="trimEnd"
          />

          <ControlsPanel
            v-model:volume="volume"
            v-model:speed="speed"
            :logo-editing="logoEditing"
            :has-logo-region="logoRegion !== null"
            :exporting="exporting"
            :export-progress="progress"
            @toggle-logo-editing="toggleLogoEditing"
            @clear-logo-region="logoRegion = null"
            @export="onExport"
          />

          <p class="status">{{ statusText }}</p>
          <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

          <div v-if="resultUrl" class="result">
            <h2>Resultado</h2>
            <video :src="resultUrl" controls />
            <a class="export" :href="resultUrl" download="video-editado.mp4">Descargar video</a>
          </div>
        </section>

        <button class="change-file" type="button" @click="file = null">Elegir otro video</button>
      </template>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 820px;
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
  max-width: 560px;
}
.workspace {
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  gap: 12px;
}
.result video {
  max-width: 100%;
  border-radius: 10px;
}
.result .export {
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
  margin-top: 20px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
}
</style>
