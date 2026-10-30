<script setup lang="ts">
import { computed, ref } from 'vue'
import TrimPanel from './TrimPanel.vue'
import { useFfmpeg } from '../ffmpeg/useFfmpeg'

const emit = defineEmits<{ (e: 'back'): void }>()

interface ClipItem {
  id: number
  file: File
  url: string
  duration: number
  trimStart: number
  trimEnd: number
  naturalWidth: number
  naturalHeight: number
  hasAudio: boolean
}

let nextId = 1
const clips = ref<ClipItem[]>([])
const clipVideoEls = new Map<number, HTMLVideoElement>()

const musicFile = ref<File | null>(null)
const musicVolume = ref(0.25)

const outputName = ref('video-unido')
// Sin caracteres que rompan un nombre de archivo, y siempre con ".mp4" al
// final (el usuario no tiene por qué escribir la extensión).
const downloadFileName = computed(() => {
  const base = outputName.value.trim().replace(/[\\/:*?"<>|]/g, '') || 'video-unido'
  return base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`
})

const { loading, progress, runMerge } = useFfmpeg()
const exporting = ref(false)
const errorMessage = ref('')
const resultUrl = ref('')

function setClipVideoEl(id: number, el: Element | null) {
  if (el) clipVideoEls.set(id, el as HTMLVideoElement)
  else clipVideoEls.delete(id)
}

function addFiles(fileList: FileList | File[]) {
  for (const f of Array.from(fileList)) {
    if (!f.type.startsWith('video/')) continue
    clips.value.push({
      id: nextId++,
      file: f,
      url: URL.createObjectURL(f),
      duration: 0,
      trimStart: 0,
      trimEnd: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      hasAudio: true,
    })
  }
}

function onInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (input.files) addFiles(input.files)
  input.value = ''
}

function onDrop(ev: DragEvent) {
  ev.preventDefault()
  if (ev.dataTransfer?.files) addFiles(ev.dataTransfer.files)
}

function onClipLoadedMetadata(id: number, ev: Event) {
  const video = ev.target as HTMLVideoElement
  const clip = clips.value.find((c) => c.id === id)
  if (!clip) return
  clip.duration = video.duration
  clip.trimEnd = video.duration
  clip.naturalWidth = video.videoWidth
  clip.naturalHeight = video.videoHeight
  // "video.audioTracks" NO existe en Chrome real (quedaba undefined incluso
  // con audio presente) — la forma que sí funciona es capturar el elemento
  // como MediaStream y mirar cuántas pistas de audio trae, sin necesidad de
  // reproducirlo. Si el navegador no soporta "captureStream" (algunas
  // versiones de Safari), se asume que sí trae audio, como antes.
  const anyVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream
    mozCaptureStream?: () => MediaStream
  }
  const captureFn = anyVideo.captureStream ?? anyVideo.mozCaptureStream
  if (captureFn) {
    try {
      clip.hasAudio = captureFn.call(video).getAudioTracks().length > 0
    } catch {
      clip.hasAudio = true
    }
  } else {
    clip.hasAudio = true
  }
}

function updateClipTrim(id: number, field: 'trimStart' | 'trimEnd', value: number) {
  const clip = clips.value.find((c) => c.id === id)
  if (clip) clip[field] = value
}

function seekClip(id: number, time: number) {
  const el = clipVideoEls.get(id)
  if (el) el.currentTime = time
}

function moveClip(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= clips.value.length) return
  const arr = [...clips.value]
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
  clips.value = arr
}

function removeClip(id: number) {
  const clip = clips.value.find((c) => c.id === id)
  if (clip) URL.revokeObjectURL(clip.url)
  clipVideoEls.delete(id)
  clips.value = clips.value.filter((c) => c.id !== id)
}

function onMusicChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) musicFile.value = f
  input.value = ''
}

function removeMusic() {
  musicFile.value = null
}

async function onMergeExport() {
  if (clips.value.length < 2) return
  errorMessage.value = ''
  exporting.value = true
  try {
    // La proporción de salida se ajusta siempre a la del primer clip de la
    // lista: los demás se escalan para cubrirla (y se recorta lo que sobre,
    // centrado) en vez de dejar franjas negras cuando no calzan.
    const target = clips.value[0]
    const blob = await runMerge(
      clips.value.map((c) => ({ file: c.file, trimStart: c.trimStart, trimEnd: c.trimEnd, hasAudio: c.hasAudio })),
      target.naturalWidth,
      target.naturalHeight,
      musicFile.value,
      musicVolume.value,
    )
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.error('merge failed', err)
    errorMessage.value = 'No se pudo unir los videos. Intenta de nuevo.'
  } finally {
    exporting.value = false
  }
}

const exportLabel = ref('Unir videos')
</script>

<template>
  <div class="merge-view">
    <div class="merge-header">
      <button type="button" class="back" @click="emit('back')">← Volver</button>
      <h2>Unir videos</h2>
    </div>
    <p class="hint">
      Sube dos o más videos, ajusta el inicio y fin de cada uno, y únelos en un solo archivo. El
      resultado toma la proporción del primer video de la lista.
    </p>

    <label class="add-dropzone glass" @dragover.prevent @drop="onDrop">
      <input type="file" accept="video/*" multiple @change="onInputChange" hidden />
      <span>+ Agregar video{{ clips.length ? 's' : '' }}</span>
    </label>

    <div v-if="clips.length" class="clip-list">
      <div v-for="(clip, i) in clips" :key="clip.id" class="clip-card glass">
        <video
          :ref="(el) => setClipVideoEl(clip.id, el as Element | null)"
          :src="clip.url"
          class="clip-preview"
          muted
          playsinline
          controls
          @loadedmetadata="onClipLoadedMetadata(clip.id, $event)"
        />
        <div class="clip-body">
          <div class="clip-header">
            <span class="clip-index">{{ i + 1 }}</span>
            <span class="clip-name">{{ clip.file.name }}</span>
            <div class="clip-actions">
              <button type="button" title="Subir" :disabled="i === 0" @click="moveClip(i, -1)">↑</button>
              <button type="button" title="Bajar" :disabled="i === clips.length - 1" @click="moveClip(i, 1)">↓</button>
              <button type="button" class="remove" title="Quitar" @click="removeClip(clip.id)">✕</button>
            </div>
          </div>
          <TrimPanel
            v-if="clip.duration"
            :duration="clip.duration"
            :trim-start="clip.trimStart"
            :trim-end="clip.trimEnd"
            @update:trim-start="(v) => updateClipTrim(clip.id, 'trimStart', v)"
            @update:trim-end="(v) => updateClipTrim(clip.id, 'trimEnd', v)"
            @seek="(v) => seekClip(clip.id, v)"
          />
        </div>
      </div>
    </div>

    <div v-if="clips.length" class="music-section glass">
      <p class="section-title">Música de fondo (opcional)</p>
      <label v-if="!musicFile" class="add-music">
        <input type="file" accept="audio/*" @change="onMusicChange" hidden />
        <span>+ Agregar música</span>
      </label>
      <div v-else class="music-row">
        <span class="music-name">{{ musicFile.name }}</span>
        <input v-model.number="musicVolume" class="music-volume" type="range" min="0" max="1" step="0.01" />
        <button type="button" class="remove" @click="removeMusic">Quitar</button>
      </div>
    </div>

    <div v-if="clips.length >= 2" class="output-name glass">
      <label>
        <span class="section-title">Nombre del archivo</span>
        <input v-model="outputName" type="text" placeholder="video-unido" maxlength="100" />
      </label>
    </div>

    <button
      v-if="clips.length >= 2"
      class="export"
      type="button"
      :disabled="exporting || loading"
      @click="onMergeExport"
    >
      {{ loading ? 'Preparando…' : exporting ? `Procesando ${Math.round(progress * 100)}%` : exportLabel }}
    </button>
    <p v-else-if="clips.length === 1" class="hint">Agrega al menos un video más para poder unirlos.</p>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <div v-if="resultUrl" class="result">
      <video :src="resultUrl" controls />
      <a class="download" :href="resultUrl" :download="downloadFileName">Descargar</a>
    </div>
  </div>
</template>

<style scoped>
.merge-view {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.merge-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
}
.back {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 0.85rem;
}
.back:hover {
  color: var(--text);
}
.merge-header h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.85rem;
  text-align: center;
}
.add-dropzone {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: 16px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 0.9rem;
  font-weight: 600;
  transition: background-color 0.15s ease;
}
.add-dropzone:hover {
  background: var(--glass-strong);
  color: var(--text);
}
.clip-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.clip-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  align-items: flex-start;
}
.clip-preview {
  width: 220px;
  max-height: 180px;
  object-fit: contain;
  border-radius: 12px;
  background: #000;
  flex-shrink: 0;
}
.clip-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* La franja de recorte de cada clip reutiliza TrimPanel (el mismo de
   "Cortar"), pero más compacta — acá hay varias, una por clip, así que el
   espacio que gana la vista previa se lo devuelve achicando esto. */
.clip-body :deep(.panel) {
  padding: 10px 12px 8px;
  gap: 8px;
  border-radius: 14px;
}
.clip-body :deep(.track) {
  height: 22px;
}
.clip-body :deep(.range::-webkit-slider-thumb) {
  width: 15px;
  height: 15px;
  margin-top: 3.5px;
}
.clip-body :deep(.range::-moz-range-thumb) {
  width: 15px;
  height: 15px;
}
.clip-body :deep(.stepper button) {
  width: 22px;
  height: 22px;
  font-size: 0.85rem;
}
.clip-body :deep(.stepper .time) {
  font-size: 0.75rem;
}
.clip-body :deep(.edge-label) {
  font-size: 0.65rem;
}

@media (max-width: 480px) {
  .clip-card {
    flex-direction: column;
  }
  .clip-preview {
    width: 100%;
    max-height: 200px;
  }
}
.clip-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clip-index {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--glass-strong);
  color: var(--text-dim);
  font-size: 0.72rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.clip-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.clip-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.clip-actions button {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: var(--glass-strong);
  color: var(--text);
  font-size: 0.8rem;
}
.clip-actions button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18);
}
.clip-actions button.remove:hover:not(:disabled) {
  background: var(--accent-2);
  color: #fff;
}
.music-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
}
.section-title {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.add-music {
  align-self: flex-start;
  cursor: pointer;
  color: var(--accent);
  font-size: 0.88rem;
  font-weight: 600;
}
.music-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.music-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}
.music-volume {
  width: 100px;
}
.music-row .remove {
  background: var(--glass-strong);
  border: none;
  border-radius: 8px;
  color: var(--text);
  padding: 6px 10px;
  font-size: 0.78rem;
}
.music-row .remove:hover {
  background: var(--accent-2);
  color: #fff;
}
.output-name {
  width: 100%;
  padding: 14px 16px;
  border-radius: 16px;
}
.output-name label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.output-name input {
  background: var(--glass-strong);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 0.9rem;
  font-family: inherit;
}
.output-name input:focus {
  outline: 1.5px solid var(--accent);
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
  margin: 0;
  color: var(--accent-2);
  font-size: 0.85rem;
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
.result video {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
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
  font-size: 0.88rem;
  font-weight: 600;
}
.result .download:hover {
  background: rgba(255, 255, 255, 0.18);
}
</style>
