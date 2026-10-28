import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// ffmpeg.wasm (modo single-thread) no necesita cabeceras cross-origin
// especiales, así que el servidor de desarrollo de Vite funciona tal cual.
export default defineConfig({
  // Se publica en GitHub Pages bajo /clipeditor/, así que todos los assets
  // deben referenciarse con esa base en vez de la raíz del dominio.
  base: '/clipeditor/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-32.png', 'icons/icon-180.png'],
      manifest: {
        name: 'ClipEditor',
        short_name: 'ClipEditor',
        lang: 'es',
        description: 'Editor de video en el navegador: cortar, quitar logos, cambiar proporción — todo sin subir nada a un servidor.',
        theme_color: '#0a84ff',
        background_color: '#0c0d11',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo se precachean los archivos propios del build (HTML/JS/CSS/
        // íconos). Sin reglas de runtimeCaching, cualquier otra petición —
        // en particular el núcleo de ffmpeg que se trae de unpkg.com en
        // tiempo de ejecución — pasa de largo sin que el worker la toque.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
