<script setup lang="ts">
import { ref, watch } from 'vue'
import { extractYouTubeId } from '../youtube/videoId'
import { useYoutubeImport } from '../youtube/useYoutubeImport'

const emit = defineEmits<{ (e: 'selected', file: File): void }>()

const supportsCapture =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

const urlInput = ref('')
const inputError = ref('')
// El reproductor reemplaza el elemento que se le pasa por su propio iframe,
// así que se usa un contenedor aparte (estable, nunca reemplazado) para
// pantalla completa.
const playerWrapper = ref<HTMLElement | null>(null)
const playerMount = ref<HTMLElement | null>(null)
const fullscreenEnabled = ref(false)
const quality = ref<'1080p' | '4k'>('1080p')

const LONG_VIDEO_SECONDS = 30 * 60

const {
  state,
  errorMessage,
  title,
  duration,
  currentTime,
  resultFile,
  load,
  startRecording,
  stopRecording,
  reset,
} = useYoutubeImport()

// En cuanto la grabación produce un archivo, se entrega igual que un
// archivo local arrastrado: la app pasa directo al editor, sin pantalla
// intermedia de "listo".
watch(resultFile, (file) => {
  if (!file) return
  emit('selected', file)
  reset()
  urlInput.value = ''
})

async function onSubmit() {
  inputError.value = ''
  const id = extractYouTubeId(urlInput.value)
  if (!id) {
    inputError.value = 'Pega un link válido de YouTube.'
    return
  }
  if (!playerMount.value || !playerWrapper.value) return
  await load(playerMount.value, playerWrapper.value, id)
}

function onReset() {
  reset()
  urlInput.value = ''
  inputError.value = ''
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="yt-import glass">
    <p v-if="!supportsCapture" class="hint">
      Esta función necesita un navegador de computador (no funciona en celular).
    </p>

    <template v-else>
      <form
        v-if="state === 'idle' || state === 'loading' || state === 'error'"
        class="url-form"
        @submit.prevent="onSubmit"
      >
        <input
          v-model="urlInput"
          type="url"
          inputmode="url"
          placeholder="Pega un link de YouTube"
          :disabled="state === 'loading'"
        />
        <button type="submit" class="pill" :disabled="state === 'loading' || !urlInput">
          {{ state === 'loading' ? 'Cargando…' : 'Cargar video' }}
        </button>
      </form>

      <p v-if="inputError" class="error">{{ inputError }}</p>
      <p v-if="state === 'error' && errorMessage" class="error">{{ errorMessage }}</p>

      <div
        ref="playerWrapper"
        class="player"
        :class="{ hidden: state === 'idle' || state === 'loading' || state === 'error' }"
      >
        <div ref="playerMount" class="player-mount" />
      </div>

      <div v-if="state === 'ready'" class="ready">
        <strong v-if="title" class="title">{{ title }}</strong>
        <span class="duration">Dura {{ formatTime(duration) }}</span>
        <p v-if="duration > LONG_VIDEO_SECONDS" class="hint">
          Es un video largo — importarlo toma el mismo tiempo que dura, porque se graba mientras se reproduce.
        </p>
        <p class="hint">
          Al grabar, el navegador te pide elegir qué compartir — elige esta pestaña o ventana. El
          resultado incluye el resto de esta página alrededor del video.
        </p>
        <div class="quality">
          <span class="quality-label">Calidad de la grabación:</span>
          <div class="quality-options">
            <button
              type="button"
              class="pill"
              :class="{ active: quality === '1080p' }"
              @click="quality = '1080p'"
            >
              1080p (rápido)
            </button>
            <button
              type="button"
              class="pill"
              :class="{ active: quality === '4k' }"
              @click="quality = '4k'"
            >
              4K
            </button>
          </div>
          <p v-if="quality === '4k'" class="hint">
            El archivo quedará más pesado y la edición después será más lenta.
          </p>
        </div>
        <label class="checkbox">
          <input v-model="fullscreenEnabled" type="checkbox" />
          Pantalla completa al grabar (resultado más limpio en Safari; para detenerla, tecla Esc)
        </label>
        <div class="actions">
          <button type="button" class="pill accent" @click="startRecording(fullscreenEnabled, quality)">Grabar</button>
          <button type="button" class="pill ghost" @click="onReset">Cancelar</button>
        </div>
      </div>

      <div v-if="state === 'recording'" class="recording">
        <span class="dot" />
        <span>Grabando… {{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
        <button type="button" class="pill ghost" @click="stopRecording">Detener y usar</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.yt-import {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  border-radius: 20px;
  padding: 18px;
}
.url-form {
  display: flex;
  gap: 8px;
}
.url-form input {
  flex: 1;
  min-width: 0;
  background: var(--glass-strong);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 0.85rem;
}
.url-form input::placeholder {
  color: var(--text-faint);
}
.pill {
  background: var(--glass-strong);
  color: var(--text);
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 0.85rem;
  white-space: nowrap;
}
.pill.accent {
  background: var(--accent);
}
.pill.ghost {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-dim);
}
.error {
  margin: 0;
  color: var(--accent-2);
  font-size: 0.82rem;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
.player {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  overflow: hidden;
}
.player.hidden {
  display: none;
}
.player-mount {
  width: 100%;
  height: 100%;
}
.player:fullscreen {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  background: #000;
}
.ready {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ready .title {
  font-size: 0.9rem;
}
.ready .duration {
  color: var(--text-dim);
  font-size: 0.8rem;
}
.quality {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.quality-label {
  color: var(--text-dim);
  font-size: 0.8rem;
}
.quality-options {
  display: flex;
  gap: 8px;
}
.quality-options .pill.active {
  background: var(--accent);
  color: var(--text);
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 0.8rem;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.recording {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.recording .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-2);
  animation: pulse 1.2s ease-in-out infinite;
}
.recording button {
  margin-left: auto;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
