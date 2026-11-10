import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// El service worker propio (src/sw.js) hace dos cosas en una: precachea el
// build (como antes) y le agrega a cada respuesta las cabeceras
// cross-origin que activan SharedArrayBuffer — necesarias para el núcleo
// MULTI-HILO de ffmpeg.wasm. GitHub Pages no deja configurar cabeceras
// propias, así que esta es la única forma de lograrlo. El servidor de
// desarrollo de Vite no registra service workers del mismo modo, así que en
// local sigue corriendo en modo single-thread — eso es normal, no un bug.
export default defineConfig({
  // Se publica en GitHub Pages bajo /clipeditor/, así que todos los assets
  // deben referenciarse con esa base en vez de la raíz del dominio.
  base: '/clipeditor/',
  plugins: [
    vue(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
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
      injectManifest: {
        // Solo se precachean los archivos propios del build (HTML/JS/CSS/
        // íconos) — el núcleo de ffmpeg que se trae de unpkg.com en tiempo
        // de ejecución no entra acá, "fetch" lo deja pasar igual.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Por defecto compila el service worker como módulo ES ("import"
        // adentro), pero "registerSW.js" lo registra sin "type: 'module'"
        // — el navegador lo rechazaba con "unknown error fetching the
        // script" (confirmado probando el build real, 2026-11-09). "iife"
        // empaqueta todo (incluido "workbox-precaching") en un solo archivo
        // clásico, sin "import", que sí registra bien.
        rollupFormat: 'iife',
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
