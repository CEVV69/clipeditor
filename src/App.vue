<script setup lang="ts">
import { computed, ref } from 'vue'
import VideoUploader from './components/VideoUploader.vue'
import VideoPreview from './components/VideoPreview.vue'
import ToolNav, { type ToolDef } from './components/ToolNav.vue'
import TrimPanel from './components/TrimPanel.vue'
import VolumeSpeedPanel from './components/VolumeSpeedPanel.vue'
import LogoPanel from './components/LogoPanel.vue'
import AspectRatioPanel from './components/AspectRatioPanel.vue'
import { useFfmpeg } from './ffmpeg/useFfmpeg'
import type { CropRect, LogoRegion } from './ffmpeg/commandBuilder'

const VIDEO_TOOLS: ToolDef[] = [
  { id: 'trim', label: 'Cortar', icon: 'cut' },
  { id: 'volume-speed', label: 'Volumen y velocidad', icon: 'speed' },
  { id: 'logo', label: 'Quitar logo', icon: 'logo' },
  { id: 'aspect', label: 'Proporción', icon: 'crop' },
]
// Cortar y Volumen/velocidad son conceptos de tiempo: no aplican a una
// imagen fija, así que su menú solo trae Quitar logo y Proporción.
const IMAGE_TOOLS: ToolDef[] = [
  { id: 'logo', label: 'Quitar logo', icon: 'logo' },
  { id: 'aspect', label: 'Proporción', icon: 'crop' },
]

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

const activeTool = ref<string>('trim')

const file = ref<File | null>(null)
const sourceUrl = ref('')
const mediaType = computed<'video' | 'image'>(() => (file.value?.type.startsWith('image/') ? 'image' : 'video'))
const tools = computed<ToolDef[]>(() => (mediaType.value === 'image' ? IMAGE_TOOLS : VIDEO_TOOLS))

const duration = ref(0)
const trimStart = ref(0)
const trimEnd = ref(0)
const seekTo = ref<number | null>(null)
const frameWidth = ref(0)
const frameHeight = ref(0)

const volume = ref(1)
const speed = ref(1)

const logoEditing = ref(false)
const logoRegions = ref<LogoRegion[]>([])
const MAX_LOGO_REGIONS = 3

const cropRect = ref<CropRect | null>(null)
const activeCropPreset = ref<string | null>('original')

const resultUrl = ref('')
const errorMessage = ref('')

const { loading, progress, runEdit, runImageEdit } = useFfmpeg()
const exporting = ref(false)

function resetForNewFile(selected: File) {
  file.value = selected
  // Un "blob:" URL falla para mostrar el archivo elegido cuando ClipEditor
  // corre como app instalada (PWA) — Chrome lo bloquea ahí aunque en una
  // pestaña normal funcione igual. Un "data:" URL (el archivo entero
  // codificado en el propio texto de la URL) no tiene ese problema.
  sourceUrl.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') sourceUrl.value = reader.result
  }
  reader.readAsDataURL(selected)
  duration.value = 0
  trimStart.value = 0
  trimEnd.value = 0
  volume.value = 1
  speed.value = 1
  logoRegions.value = []
  logoEditing.value = false
  cropRect.value = null
  activeCropPreset.value = 'original'
  resultUrl.value = ''
  errorMessage.value = ''
  activeTool.value = mediaType.value === 'image' ? 'logo' : 'trim'
}

function onDuration(seconds: number) {
  duration.value = seconds
  trimEnd.value = seconds
}

function onNaturalSize(size: { width: number; height: number }) {
  frameWidth.value = size.width
  frameHeight.value = size.height
  // Arranca sin recortar nada (el rectángulo cubre el fotograma completo),
  // listo para ajustar a mano o elegir una proporción.
  cropRect.value = { x: 0, y: 0, width: size.width, height: size.height }
}

// Centra el recorte más grande posible con la proporción elegida dentro del
// video original. "Original" vuelve a dejar el fotograma completo.
function selectCropPreset(id: string) {
  activeCropPreset.value = id
  if (!frameWidth.value || !frameHeight.value) return
  if (id === 'original') {
    cropRect.value = { x: 0, y: 0, width: frameWidth.value, height: frameHeight.value }
    return
  }
  const [rw, rh] = id.split(':').map(Number)
  const targetRatio = rw / rh
  const frameRatio = frameWidth.value / frameHeight.value
  let width: number
  let height: number
  if (targetRatio > frameRatio) {
    width = frameWidth.value
    height = width / targetRatio
  } else {
    height = frameHeight.value
    width = height * targetRatio
  }
  cropRect.value = {
    x: (frameWidth.value - width) / 2,
    y: (frameHeight.value - height) / 2,
    width,
    height,
  }
}

// Ajustar un borde a mano dejó de corresponder a cualquier preset.
function onCropRectUpdate(rect: CropRect) {
  cropRect.value = rect
  activeCropPreset.value = null
}

// Alterna el modo de dibujo para la siguiente zona (hasta un máximo de 3).
// Si el usuario se arrepiente a medio trazo, volver a hacer clic en el
// mismo botón ("Dibujando…") lo cancela.
function startSelecting() {
  if (logoRegions.value.length >= MAX_LOGO_REGIONS) return
  logoEditing.value = !logoEditing.value
}

// Al completar un trazo válido se agrega como zona nueva y se sale del modo
// dibujo automáticamente: el botón pasa solo a "Seleccionar zona N+1" sin
// que haga falta un clic extra para "confirmar" la zona.
function onRegionDrawn(region: LogoRegion) {
  if (logoRegions.value.length < MAX_LOGO_REGIONS) {
    logoRegions.value = [...logoRegions.value, region]
  }
  logoEditing.value = false
}

function onDrawingCancelled() {
  logoEditing.value = false
}

// "Borrar selección" borra todas las zonas de una vez y vuelve al punto de
// partida, lista para marcar desde la zona 1 otra vez. Esto no procesa el
// video — el que de verdad quita los logos es "Ejecutar edición".
function clearAllLogoRegions() {
  logoRegions.value = []
  logoEditing.value = false
}

// Dibujar la región de logo solo tiene sentido mientras esa herramienta
// está activa; si el usuario cambia de herramienta, se sale del modo dibujo.
// El resultado exportado también se oculta: quedó atado a los ajustes de
// la herramienta anterior y ya no refleja lo que se está editando ahora.
function onToolChange(tool: string) {
  activeTool.value = tool
  if (tool !== 'logo') logoEditing.value = false
  if (resultUrl.value) {
    URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = ''
  }
  errorMessage.value = ''
}

async function onExport() {
  if (!file.value) return
  errorMessage.value = ''
  exporting.value = true
  try {
    const blob = mediaType.value === 'image'
      ? await runImageEdit(file.value, {
          logoRegions: logoRegions.value,
          frameWidth: frameWidth.value,
          frameHeight: frameHeight.value,
          cropRect: cropRect.value,
        })
      : await runEdit(file.value, {
          trimStart: trimStart.value,
          trimEnd: trimEnd.value,
          volume: volume.value,
          speed: speed.value,
          logoRegions: logoRegions.value,
          frameWidth: frameWidth.value,
          frameHeight: frameHeight.value,
          cropRect: cropRect.value,
        })
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.error('export failed', err)
    errorMessage.value = mediaType.value === 'image'
      ? 'No se pudo generar la imagen. Intenta de nuevo.'
      : 'No se pudo generar el video. Intenta de nuevo.'
  } finally {
    exporting.value = false
  }
}

const exportLabel = computed(() => {
  if (loading.value) return 'Preparando…'
  if (exporting.value) return `Procesando ${Math.round(progress.value * 100)}%`
  return 'Ejecutar edición'
})
const exportDisabled = computed(() => exporting.value || loading.value)

const resultFileName = computed(() => {
  if (mediaType.value !== 'image') return 'video-editado.mp4'
  const name = file.value?.name ?? ''
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'png'
  return `imagen-editada.${IMAGE_EXTENSIONS.has(ext) ? ext : 'png'}`
})
</script>

<template>
  <div class="app">
    <header>
      <h1>ClipEditor</h1>
    </header>

    <VideoUploader v-if="!file" @selected="resetForNewFile" />

    <template v-else>
      <div class="toolbar">
        <ToolNav :tools="tools" :model-value="activeTool" :disabled="false" @update:model-value="onToolChange" />
        <button class="change-video" type="button" @click="file = null" title="Elegir otro archivo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 15.3-6.4M21 12a9 9 0 0 1-15.3 6.4" />
            <path d="M18 3v4h-4M6 21v-4h4" />
          </svg>
        </button>
      </div>

      <VideoPreview
        :src="sourceUrl"
        :media-type="mediaType"
        :logo-editing="logoEditing && activeTool === 'logo'"
        :logo-regions="logoRegions"
        :crop-editing="activeTool === 'aspect'"
        :crop-rect="cropRect"
        :volume="volume"
        :speed="speed"
        :seek-to="seekTo"
        @duration="onDuration"
        @natural-size="onNaturalSize"
        @region-drawn="onRegionDrawn"
        @drawing-cancelled="onDrawingCancelled"
        @update:crop-rect="onCropRectUpdate"
      />

      <TrimPanel
        v-if="activeTool === 'trim'"
        :duration="duration"
        v-model:trim-start="trimStart"
        v-model:trim-end="trimEnd"
        @seek="seekTo = $event"
      />

      <VolumeSpeedPanel
        v-else-if="activeTool === 'volume-speed'"
        v-model:volume="volume"
        v-model:speed="speed"
      />

      <LogoPanel
        v-else-if="activeTool === 'logo'"
        :logo-editing="logoEditing"
        :regions-count="logoRegions.length"
        @start-selecting="startSelecting"
        @clear-all="clearAllLogoRegions"
      />

      <AspectRatioPanel
        v-else
        :active-preset="activeCropPreset"
        :has-crop="cropRect !== null"
        @select-preset="selectCropPreset"
      />

      <button class="export" type="button" :disabled="exportDisabled" @click="onExport">
        {{ exportLabel }}
      </button>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <div v-if="resultUrl" class="result">
        <video v-if="mediaType === 'video'" :src="resultUrl" controls />
        <img v-else :src="resultUrl" alt="" />
        <a class="download" :href="resultUrl" :download="resultFileName">Descargar</a>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 20px 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
header {
  margin-bottom: 8px;
}
header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-align: center;
}
.toolbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  position: relative;
}
.change-video {
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  color: var(--text-dim);
  backdrop-filter: blur(20px);
}
.change-video:hover {
  color: var(--text);
}
.change-video svg {
  width: 16px;
  height: 16px;
}
.export {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 14px;
  padding: 14px;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.export:active:not(:disabled) {
  transform: scale(0.99);
}
.error {
  color: var(--accent-2);
  font-size: 0.85rem;
  margin: 0;
  text-align: center;
}
.result {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
}
.result video,
.result img {
  width: 100%;
  max-height: 60vh;
  border-radius: 16px;
}
.result .download {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: var(--glass-strong);
  border: 1px solid var(--glass-border);
  color: var(--text);
  text-decoration: none;
  padding: 10px 20px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
