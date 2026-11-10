// Service worker propio (en JS, no TS, para no chocar con el tsconfig del
// proyecto — este archivo corre en el contexto "WebWorker", no "DOM").
//
// Hace DOS cosas en uno, para no tener dos service workers compitiendo por
// el mismo origen (ver docs/GOTCHAS.md — ese choque era justo el riesgo que
// frenaba este cambio antes):
// 1. Precachea los archivos del build (lo que antes hacía "generateSW" solo)
//    para que la app siga instalable y funcione sin internet.
// 2. Le agrega a CADA respuesta las cabeceras "Cross-Origin-Opener-Policy" y
//    "Cross-Origin-Embedder-Policy" — GitHub Pages no deja configurarlas
//    directo, así que esta es la única forma de activar el modo
//    "cross-origin isolated" que el navegador exige para dejar usar
//    SharedArrayBuffer, necesario para el núcleo MULTI-HILO de ffmpeg.wasm
//    (varios núcleos del procesador en vez de uno solo).
import { PrecacheController } from 'workbox-precaching'

const precacheController = new PrecacheController()
precacheController.precache(self.__WB_MANIFEST)

self.addEventListener('install', (event) => {
  event.waitUntil(precacheController.install(event))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(precacheController.activate(event))
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      let response = await precacheController.matchPrecache(event.request)
      if (!response) {
        response = await fetch(event.request)
      }
      // Una respuesta "opaque" (ej. un recurso de otro origen pedido sin
      // CORS) no se puede leer ni reconstruir — se entrega tal cual, sin
      // las cabeceras extra, en vez de que el fetch entero falle.
      if (response.type === 'opaque' || response.status === 0) return response

      const headers = new Headers(response.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    })(),
  )
})
