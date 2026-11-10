<script setup lang="ts">
import { watch } from 'vue'
import { useScreenRecorder } from '../screenrecord/useScreenRecorder'

const emit = defineEmits<{ (e: 'selected', file: File): void }>()

const supportsCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

const { state, errorMessage, elapsedSeconds, resultFile, startRecording, stopRecording, reset } =
  useScreenRecorder()

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function onStop() {
  stopRecording()
}

// En cuanto la grabación produce un archivo, se entrega igual que un
// archivo local arrastrado: la app pasa directo al editor, sin pantalla
// intermedia de "listo".
watch(resultFile, (file) => {
  if (!file) return
  emit('selected', file)
  reset()
})
</script>

<template>
  <div class="screen-record glass">
    <p v-if="!supportsCapture" class="hint">
      Esta función necesita un navegador de computador (no funciona en celular).
    </p>

    <template v-else>
      <div v-if="state === 'idle' || state === 'error'" class="idle">
        <p class="hint">
          Al apretar "Grabar" el navegador te pregunta qué pantalla, ventana o pestaña compartir —
          ahí mismo puedes elegir si incluir audio.
        </p>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <button type="button" class="pill accent" @click="startRecording">Grabar pantalla</button>
      </div>

      <div v-if="state === 'recording'" class="recording">
        <span class="dot" />
        <span>Grabando… {{ formatTime(elapsedSeconds) }}</span>
        <button type="button" class="pill ghost" @click="onStop">Detener y usar</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.screen-record {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  border-radius: 20px;
  padding: 18px;
}
.idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  padding: 20px 10px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.82rem;
  max-width: 320px;
}
.error {
  margin: 0;
  color: var(--accent-2);
  font-size: 0.82rem;
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
.recording {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 4px 0;
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
