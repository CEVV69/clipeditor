import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// ffmpeg.wasm (modo single-thread) no necesita cabeceras cross-origin
// especiales, así que el servidor de desarrollo de Vite funciona tal cual.
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
