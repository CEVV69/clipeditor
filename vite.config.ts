import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// ffmpeg.wasm (modo single-thread) no necesita cabeceras cross-origin
// especiales, así que el servidor de desarrollo de Vite funciona tal cual.
export default defineConfig({
  // Se publica en GitHub Pages bajo /clipeditor/, así que todos los assets
  // deben referenciarse con esa base en vez de la raíz del dominio.
  base: '/clipeditor/',
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
