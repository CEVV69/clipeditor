<script setup lang="ts">
import { ref, watch } from 'vue'
import { extractYouTubeId } from '../youtube/videoId'
import { useYoutubeImport } from '../youtube/useYoutubeImport'

const emit = defineEmits<{ (e: 'selected', file: File): void }>()

// Safari también expone getDisplayMedia, pero sin poder elegir "esta
// pestaña" puntual (solo ventana/pantalla completa), así que el resultado
// queda sucio con el resto de la interfaz. Se exige un Chromium real.
const isChromiumBrowser = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent)
const supportsCapture =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && isChromiumBrowser

const urlInput = ref('')
const inputError = ref('')
const playerContainer = ref<HTMLElement | null>(null)

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
  if (!playerContainer.value) return
  await load(playerContainer.value, id)
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
      Esta función necesita Chrome o Edge en computador.
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
        ref="playerContainer"
        class="player"
        :class="{ hidden: state === 'idle' || state === 'loading' || state === 'error' }"
      />

      <div v-if="state === 'ready'" class="ready">
        <strong v-if="title" class="title">{{ title }}</strong>
        <span class="duration">Dura {{ formatTime(duration) }}</span>
        <p v-if="duration > LONG_VIDEO_SECONDS" class="hint">
          Es un video largo — importarlo toma el mismo tiempo que dura, porque se graba mientras se reproduce.
        </p>
        <p class="hint">
          Al grabar, el navegador te va a pedir elegir qué pestaña compartir — elige esta misma pestaña.
        </p>
        <div class="actions">
          <button type="button" class="pill accent" @click="startRecording">Grabar</button>
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
