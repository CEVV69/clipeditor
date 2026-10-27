# Editor de video

Editor de video que corre **enteramente en el navegador**: nada se sube a un
servidor. Usa la misma técnica que el editor de video de
[123apps](https://123apps.com/es/) (online-video-cutter.com): carga
**FFmpeg compilado a WebAssembly** dentro de un Web Worker y le pasa comandos
tipo ffmpeg sobre el archivo elegido.

## Funciones de esta primera versión

- Cargar un video (arrastrar o elegir archivo).
- Cortar/recortar con una línea de tiempo de doble control (inicio/fin).
- Cambiar volumen (0% a 300%) y velocidad (0.25x a 4x).
- Quitar un logo o marca de agua: se dibuja un rectángulo sobre el video y se
  aplica el filtro `delogo` de ffmpeg sobre esa región.
- Exportar y descargar el resultado en `.mp4`.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (por defecto `http://localhost:5173`).

La primera vez que exportas un video, el navegador descarga el núcleo de
FFmpeg (WebAssembly, unos 25 MB) desde un CDN público; después queda cacheado.

## Estructura

- `src/ffmpeg/commandBuilder.ts` — traduce los controles de la UI (recorte,
  volumen, velocidad, región de logo) a los argumentos reales de ffmpeg.
- `src/ffmpeg/useFfmpeg.ts` — carga `@ffmpeg/ffmpeg` y ejecuta la edición.
- `src/components/` — subida de archivo, previsualización con selector de
  región de logo, línea de tiempo de corte y panel de controles.

## Limitaciones conocidas

- Corre en modo de un solo hilo (sin `SharedArrayBuffer`), así que es más
  lento que la versión multi-hilo; videos largos o en alta resolución pueden
  tardar. Para habilitar multi-hilo hay que servir el sitio con las
  cabeceras `Cross-Origin-Opener-Policy: same-origin` y
  `Cross-Origin-Embedder-Policy: require-corp`.
- El filtro `delogo` difumina la región marcada; funciona mejor sobre fondos
  relativamente uniformes, igual que en 123apps.
