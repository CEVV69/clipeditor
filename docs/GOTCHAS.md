# Gotchas y decisiones de diseño — ClipEditor

Historial técnico detallado del proyecto. La memoria de Claude (`project_clipeditor.md`) solo
tiene el resumen; el detalle completo vive acá.

## Unir videos (2026-10-30)

Pantalla aparte (`MergeView.vue`), accesible desde una portada con dos tarjetas ("Editar un
archivo" / "Unir videos") en vez de agregarse al menú del editor de un solo archivo, que ya
tenía 6 pestañas. Cada clip reutiliza `TrimPanel.vue` (el mismo de "Cortar") para elegir
inicio/fin, con vista previa más chica; se puede reordenar con flechas arriba/abajo (sin drag,
a propósito — ver el historial de bugs de arrastre más abajo) y quitar. Música de fondo
opcional, con volumen ajustable y loop automático si es más corta que el resultado.

- **Proporción de salida = la del primer clip ("cover", sin franjas negras):** decisión
  explícita del usuario. Cada clip se escala con
  `scale=W:H:force_original_aspect_ratio=increase,crop=W:H` (el mismo truco de "cubrir y
  recortar centrado" que `object-fit: cover` en CSS) antes de `concat`, más `fps=30,setsar=1`
  parejo en todos (el filtro `concat` exige que coincidan).
- **Clip sin pista de audio rompía TODO el procesamiento (bug real, no hipotético — lo
  reprodujeron mis propias pruebas al primer intento):** `concat` referencia `[i:a]` para cada
  clip; si algún input no tiene audio, ffmpeg aborta con "Stream specifier ':a' ... matches no
  streams" y no procesa nada, ni siquiera los demás clips. Arreglo: a cada clip sin audio se le
  genera silencio del mismo largo exacto con `anullsrc=channel_layout=stereo:sample_rate=44100:
  duration=<segundos>` (una fuente de audio vacía dentro del propio filtergraph, no necesita un
  archivo real), y se referencia esa etiqueta en el `concat` en vez de `[i:a]`.
- **`video.audioTracks` NO sirve para detectar si un clip trae audio — no existe en Chrome
  real** (quedaba `undefined` incluso con un video que sí tenía audio, pese a aparecer en
  algunas referencias de la API como si fuera estándar). Lo que sí funciona, confirmado:
  `video.captureStream().getAudioTracks().length` — da la respuesta correcta inmediatamente
  después de `loadedmetadata`, sin necesidad de reproducir el video.
- **Música mezclada con `amix=inputs=2:duration=first:normalize=0`** — `normalize=0` es
  necesario porque por defecto `amix` promedia el volumen entre las entradas (bajaría también
  el audio original solo por tener dos pistas de por medio); con `normalize=0` el balance queda
  enteramente a cargo del `volume=` que ya se le aplicó a la música antes de mezclarla.
  `duration=first` corta la mezcla justo al largo del audio original ya concatenado (la primera
  entrada), así la música de fondo (repetida con `-stream_loop -1` en su propio input) nunca
  sobra ni falta.
- **Gotcha de pruebas (no del código):** generar un archivo de video+audio sintético válido con
  `MediaStream`+`AudioContext`+`MediaRecorder` en este entorno de pruebas headless produce un
  webm corrupto (`0x00 at pos 36 invalid as first byte of an EBML number`) — ni el navegator
  puede reproducirlo. Para probar con audio de verdad, mejor generar un `.wav` a mano (cabecera
  RIFF + PCM 16 bits, unas 20 líneas) en vez de depender de `MediaRecorder` para el audio de
  prueba.

## ffmpeg.wasm

- Core desde `dist/esm` de `@ffmpeg/core`, nunca `dist/umd` (el umd tira "failed to import
  ffmpeg-core.js" porque `@ffmpeg/ffmpeg` lo carga con `import()` dinámico).
- `delogo` de este build no soporta el parámetro `band`.
- `delogo` rechaza cualquier zona que toque el borde exacto del frame (no solo que se pase) —
  `MARGIN=2px` de aire, y los bordes derecho/inferior se redondean como tales (no w/h sueltos)
  para no sumar 1px de más por redondeos independientes.
- `ffmpeg.exec()` puede devolver `exitCode≠0` sin lanzar excepción — hay que chequearlo o el
  video queda corrupto en silencio (ya se chequea en `runEdit`/`runImageEdit`/`runExtractFrame`).
  **Pero también puede lanzar una excepción directamente** (no solo devolver código≠0) cuando el
  punto pedido con `-ss` no tiene ningún fotograma real ahí. Pasó en `runExtractFrame`/"Capturar
  fotograma" al pedir el final exacto del video (2026-10-29): un solo intento con margen fijo de
  1/30s no bastaba para todos los videos reales, y como la excepción no estaba atrapada, ni
  siquiera llegaba a reintentarse. Confirmado con pruebas: tras ese intento fallido la instancia
  de ffmpeg (compartida con `runEdit`/`runImageEdit`) sigue funcionando normal — NO queda
  "abortada" para siempre; el "Aborted()" que aparece en el log es solo texto de ese intento, no
  un crash del módulo wasm. Arreglo: `runExtractFrame` envuelve cada intento en try/catch y
  reintenta con el mismo archivo cada vez más atrás (0, 0.15, 0.4, 0.8, 1.5s) antes de fallar de
  verdad. Si se vuelve a tocar esa función, mantener el try/catch — no asumir que un exitCode≠0
  es la única forma de fallo.
- Audio del preview siempre por Web Audio (gainNode), nunca `video.volume` nativo — el camino
  dual fallaba en Safari. AudioContext se resume en el evento `play` (gesto real del usuario).
- Difuminado de logo = delogo + anillo de blur suave + blur fuerte en el centro (doble
  transición). El usuario entiende que no es reconstrucción tipo IA; quedó así a propósito.
- Toda edición recodifica siempre (incluso "Cortar" solo, sin otros filtros) para mantener el
  corte exacto en el punto pedido — el usuario prefirió esto explícitamente antes que un
  `-c copy` más rápido pero con el corte desplazado hasta 1-2s al keyframe más cercano (no
  reabrir esa pregunta sin que él la traiga). Preset `-preset ultrafast` (no `veryfast`) —
  medido ~2.8x más rápido (48s→17s en un video de prueba de 10s/854×480) sin perder precisión,
  solo un poco más pesado el archivo final. Siguiente palanca de velocidad: el core multi-hilo
  `@ffmpeg/core-mt`, que exige cross-origin-isolation (COOP/COEP) — GitHub Pages no deja
  configurar esas cabeceras directo, haría falta un service worker tipo "coi-serviceworker",
  con riesgo real de chocar con el SW de la PWA. No implementado — evaluar solo si el usuario
  pide más velocidad.
- `buildFrameExtractArgs` ("Capturar fotograma") no aplica ningún filtro — solo
  `-ss <t> -i input -frames:v 1 output.png`. Si el video de origen tiene letterboxing/
  pillarboxing incrustado en los píxeles, el fotograma capturado hereda esas franjas porque son
  parte real del contenido — no es un bug, mismo límite que "Proporción" (ver abajo).

## Vista previa (`VideoPreview.vue`)

- **Zonas de logo/recorte desalineadas tras agregar `object-fit:contain` (2026-10-29),
  consecuencia directa de otro fix:** al agregar `object-fit:contain` a `video/img` para que no
  se estiraran (ver más abajo), el contenido puede quedar más chico que su caja (franjas vacías
  cuando la proporción del archivo no calza con la caja disponible). Las zonas de logo y el
  recuadro de "Proporción" se calculaban con `mediaEl.getBoundingClientRect()` como si el
  contenido llenara toda la caja — con letterbox, quedaban corridos hacia esas franjas vacías en
  vez de pegados a los bordes reales. Arreglo: un cálculo de `contentBox` (área real donde cae
  el contenido dentro de la caja, recalculado con `ResizeObserver` sobre `mediaEl`), y las zonas
  de logo + el recuadro de recorte envueltas en un `.content-box` posicionado exactamente sobre
  esa área — sus porcentajes se miden contra el contenido real, no contra la caja. Los handlers
  de puntero (`onPointerDown`, `onCropHandleDown`) toman el rect vía `getContentClientRect()` en
  vez del rect crudo del elemento. **Lección:** la próxima vez que se toque `object-fit` o el
  tamaño de la caja de vista previa, revisar también las zonas de logo y el recorte.
- **`video`/`img` sin `object-fit` se estiraban (2026-10-29):** `.result video/img` y
  `VideoPreview.vue video/img` tenían `width:100%; max-height:60vh` sin `object-fit`. Si la
  altura real a ese ancho supera 60vh, el navegador recorta la caja a 60vh mantiene el ancho al
  100% — sin `object-fit:contain` el contenido se ESTIRA para rellenar esa caja mal
  proporcionada en vez de conservar su proporción. Con un video/imagen portrait (ej. un
  resultado rotado 90°) esto deforma de verdad, no es percepción. Arreglado agregando
  `object-fit: contain` en ambos lugares (`App.vue` para el resultado, `VideoPreview.vue` para
  la vista previa en vivo).
- **Arrastrar zonas de logo/recorte lento en la vida real (2026-10-29):**
  `getBoundingClientRect()` se recalculaba en cada `pointermove` — con estilos recién escritos
  por el movimiento anterior, eso fuerza layout thrashing (reflow síncrono en cada evento,
  decenas por segundo). Un único evento sintético nunca lo revela; solo arrastres reales con
  muchos pointermove seguidos lo muestran. Arreglado: la medida se cachea una sola vez en
  pointerdown/`onCropHandleDown` (`dragBoundRect`), no se repite por evento.
- Probar siempre con eventos de puntero sintéticos (`dispatchEvent(new PointerEvent(...))`) en
  vez de arrastre con coordenadas de pantalla — el navegador del panel escala el viewport real
  vs el screenshot de forma inconsistente entre llamadas. Usar `pointerId: 1` — un ID inventado
  (2, 5, etc.) hace que `setPointerCapture` tire `NotFoundError` y aborta el handler antes de
  activar el arrastre.
- **"Proporción" no mueve los bordes izq/der en un video con barras negras — NO es bug
  (2026-10-29):** si el video tiene pillarboxing/letterboxing incrustado en los píxeles
  (contenido vertical centrado en un cuadro más ancho, con franjas negras a los lados), el
  recorte automático no puede distinguir esas franjas del contenido real — matemáticamente,
  cualquier preset más ancho que el contenido real mantiene ese eje al tamaño completo del
  fotograma (incluidas las franjas) y solo ajusta el otro eje. Confirmado con dos videos de
  prueba (uno horizontal, uno vertical sin barras): el cálculo funciona simétrico en ambos ejes.
  La solución es arrastrar el borde a mano para sacar las franjas.

## Menú de herramientas (`ToolNav.vue` + `App.vue`)

- **Layout roto con 6 pestañas (2026-10-29):** texto cortado y la última pestaña tapada por el
  botón circular. Arreglado con `.app` más ancho (640→860px) + `.tool-nav` con
  `overflow-x:auto` y scrollbar oculta, botones con `white-space:nowrap; flex-shrink:0`.
- **Botón circular solapado sobre el menú (2026-10-29):** `.change-video` estaba con
  `position:absolute; right:0` encima del menú. Arreglado convirtiendo `.toolbar` en una fila
  flex normal (sin `position:relative`/`absolute`), con el `ToolNav` y el botón como hijos
  normales — nunca se solapan.
- **Menú pegado a la izquierda con pocas pestañas (imagen, 3 tabs), tras el fix anterior
  (2026-10-29):** al darle `flex:1 1 auto` al ToolNav para que no se solapara con el botón
  circular, quedaba estirado a todo el ancho y las pestañas (sin `justify-content` propio) se
  alineaban a la izquierda — se notaba con imagen (3 pestañas) pero no con video (6, que ya
  llenaba el ancho). Arreglado con `flex: 0 1 auto` (flex-grow:0, flex-shrink:1): no se estira
  de más cuando sobra espacio (queda centrado junto al botón por el `justify-content:center` del
  `.toolbar`), pero igual se achica y hace scroll cuando no alcanza el espacio (video).
- **Gotcha propio grave — cambios hechos pero nunca commiteados/pusheados (2026-10-29):** un
  arreglo del menú se hizo en el disco local pero no se llegó a hacer `git commit`/`push` antes
  de reportarlo como "desplegado" — el usuario probó en la app instalada y en el navegador y vio
  el estado de antes, porque GitHub Pages seguía sirviendo el último commit real. **Antes de
  decirle al usuario que algo "ya está desplegado" o pedirle que lo pruebe, correr `git status`
  y confirmar que no hay cambios sin commitear/pushear relacionados.**

## Subida de archivos / PWA instalada

- **`blob:` URL falla en la app instalada (PWA), SOLO para el archivo de imagen recién elegido
  (2026-10-29):** `URL.createObjectURL(selected)` se mostraba bien en una pestaña normal de
  Chrome pero en la app instalada tiraba `ERR_ACCESS_DENIED` en silencio con una imagen — vista
  previa vacía, sin error. Arreglo en `App.vue`/`resetForNewFile`: `data:` URL
  (`FileReader.readAsDataURL()`) SOLO para imágenes; video sigue con `blob:` como siempre.
  ⚠️ Ya se probó aplicar `data:` a todo por igual y rompió lo real: un video de 759MB no subía y
  una grabación de YouTube "no grababa nada" — codificar un archivo grande entero en una sola
  cadena de texto agota memoria/se cuelga. `resultUrl` (el de `runEdit`/`runImageEdit`) usa
  `blob:` siempre y nunca tuvo el problema, ni para video ni para imagen — no tocarlo.
- `App.vue` no deja pasar a la pantalla de edición hasta que el `FileReader` termina con éxito
  (`loadingFile`/`fileLoadError`, 20s de timeout) — antes el recuadro de subida desaparecía
  apenas se elegía el archivo, incluso si la lectura fallaba después, dejando la pantalla en
  blanco sin aviso.
- **Fotos elegidas directo desde la integración de Fotos en el diálogo "Abrir archivo" de
  Finder** pueden fallar con `NotReadableError` al leerlas (confirmado con una foto ya
  descargada en la app Fotos — no es un tema de iCloud sin bajar, ni de permisos en
  Configuración → Privacidad → Fotos, ambas causas se descartaron). Solución que funcionó:
  arrastrar la foto desde Fotos al Escritorio primero (crea un archivo normal) y subir esa
  copia. Causa raíz exacta no investigada — si vuelve a pasar, partir directo por el workaround.
- HEIC/HEIF se rechaza de entrada con aviso (ffmpeg.wasm y la mayoría de navegadores no lo
  leen).
- PWA instalable: `vite-plugin-pwa` (generateSW, sin runtimeCaching para no tocar el fetch de
  ffmpeg a unpkg.com). Íconos del usuario en `public/icons/`. El service worker no registra
  dentro del navegador embebido de pruebas ("unknown error fetching the script" — limitación del
  propio panel/CDP), pero sí funciona y activa en producción (cevv69.github.io); verificar ahí,
  no en el panel.

## Rotación/volteo de imagen — investigación de un reporte de "deformación"

**El usuario rechazó la primera explicación de "teoría" (con razón: hacía falta prueba dura, no
solo verse parecido) — verificado a nivel de píxel, confirmado NO es bug (2026-10-29):**
reportado con una imagen real (arte IA de una cara emergiendo de vetas de madera, 1920×1080
webp, simétrica por diseño). Primera explicación (volteo horizontal se ve "parecido" al
original ⇒ debe ser simetría) fue insuficiente para el usuario. Se verificó entonces con
matemática real, no apariencia: se tomó la imagen de origen y el resultado rotado (`transpose=1`,
90° horario), se aplicó la fórmula exacta de rotación 90° CW (`O(x,y) = I(y, H-1-x)`, con
H=alto original) sobre 576 puntos de muestra repartidos en toda la imagen, y se comparó el
píxel esperado contra el píxel real del resultado: diferencia promedio de ~6.5 (suma de
|ΔR|+|ΔG|+|ΔB|, rango 0-765) y máxima de 46 — solo ruido típico de decodificar webp y
recodificar a PNG, no corrupción. Conclusión con evidencia dura: el filtro `transpose` mueve
cada píxel exactamente a donde matemáticamente corresponde. Lo que se ve "deformado" es la
imagen real, correctamente rotada — el diseño original tiene simetría radial fuerte (rostro al
centro, vetas de madera irradiando), y rotar 90° un objeto con simetría radial reordena esas
"parejas espejo" de un modo que el ojo humano lee como una imagen distinta, aunque cada píxel
esté en su lugar correcto.

**Técnica para la próxima vez que se reporte algo así:** no alcanza con "se ve parecido" —
samplear decenas de puntos con la fórmula de rotación exacta y medir la diferencia numérica
contra el resultado real. Y antes de eso: si no se reproduce con pruebas sintéticas, pedir el
archivo real del usuario, copiarlo a `public/` temporalmente para cargarlo same-origin en el
dev server, y **borrarlo antes de cualquier commit**.

## Importar de YouTube (2026-10-29, funcionando y probado por el usuario)

Se descartó yt-dlp+servidor (`server/`, código sin desplegar, quedó de referencia) — las IPs de
datacenter (Railway) quedan bloqueadas por YouTube aunque se usen cookies de sesión válidas.
Solución: `src/youtube/` incrusta el reproductor oficial de YouTube (IFrame API, `controls:0`
dentro de `<div ref="playerMount">`) y graba con `getDisplayMedia`+`MediaRecorder` — 100%
client-side, sin servidor, sin tema de ToS (es grabar tu propia reproducción, no scraping).
Funciona en Chrome/Edge/Safari (no solo Chrome); requiere que el video tenga incrustación
habilitada por quien lo subió; la importación toma el tiempo real del video.

- **Casillero "Pantalla completa" (opcional, apagado por defecto):** el usuario prefiere la
  ventana chica por defecto ("pantalla completa te saca de la app" — no activarla sin que la
  pida explícitamente). Si se activa, Esc la detiene y guarda lo grabado hasta ese momento
  (igual que el botón "Detener y usar").
- **Gotcha importante:** `new YT.Player(el, ...)` REEMPLAZA `el` por su propio `<iframe>` — una
  referencia guardada al elemento original queda apuntando a un nodo ya desconectado del DOM.
  Por eso `requestFullscreen()` no hacía nada en silencio. Arreglo: usar un contenedor exterior
  aparte (`playerWrapper`) que nunca se toca, con un `playerMount` interior reemplazable adentro.
- **Element Capture (`RestrictionTarget.restrictTo`) NO sirve para este caso:** Chrome lo acepta
  sin error pero no genera fotogramas (`[ElementCapture] Do not produce frames if media player
  is tainted`) porque el iframe es contenido de otro origen (youtube.com) — da un archivo de
  0:00 en silencio. No reintentar esta vía.
- **Queda sin resolver (aceptado así por el usuario):** al inicio de la grabación se alcanza a
  ver un instante la miniatura/botón "Mirar en YouTube" de YouTube pausado, incluso esperando el
  evento `onStateChange`→PLAYING antes de `mr.start()`. Recortable a mano con la herramienta
  "Cortar" — no seguir insistiendo en arreglarlo salvo que el usuario lo pida de nuevo.
- Pedir `requestFullscreen()` ANTES de `getDisplayMedia()` hace que el navegador cancele la
  pantalla completa sola (por el diálogo del sistema encima) — pedirla siempre después.
- El panel de pruebas de Claude bloquea tanto `getDisplayMedia` como `requestFullscreen` en
  silencio (promesa que nunca resuelve) — esta función solo se puede verificar de verdad en el
  navegador real del usuario, nunca en el panel.
- **Grabación sin tope de resolución/fps → export después brutalmente lento (reportado
  2026-10-31, un video de 18 min grabado y recortado a ~9.5 min: 1 hora para solo 18% de
  avance):** `getDisplayMedia({video: true, ...})` sin restricciones graba al tamaño físico real
  de la pantalla/pestaña compartida (en Retina, 2x-3x más píxeles que 1080p) y sin límite de
  cuadros por segundo. Como toda edición recodifica siempre con un solo hilo (ver arriba), un
  archivo de origen así de pesado multiplica el tiempo de codificación directamente por la
  cantidad de píxeles — no es el recorte el lento, es el tamaño real del archivo grabado.
  Arreglo: `video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } }` en
  `getDisplayMedia` (`useYoutubeImport.ts`) — 1080p/30fps de sobra para YouTube, y arregla todas
  las importaciones futuras, no solo la reportada. Si el usuario pide aún más velocidad en
  ediciones ya livianas (1080p o menos), la siguiente palanca sigue siendo el core multi-hilo
  `@ffmpeg/core-mt` (ver nota arriba) — no implementado por el riesgo de chocar con el SW de la
  PWA, requiere evaluarse con cuidado y probarse en producción (el SW no registra en el panel).
  **Primer tope puesto como fijo sin opción (mismo día) — el usuario sí quería poder elegir 4K a
  propósito, sabiendo que sale más lento de editar:** se agregó un selector "1080p (rápido)" /
  "4K" en `YoutubeImportPanel.vue` (por defecto 1080p), que pasa la calidad elegida a
  `startRecording(useFullscreen, quality)`; con `quality==='4k'` las restricciones de video se
  omiten (`video: true`, sin tope), igual que el comportamiento original.
- **YouTube downloaders de terceros (ytdown.to, etc.) — no replicar gratis:** corren detrás de
  protección anti-bots seria (Cloudflare), señal de que mantienen infraestructura de servidor
  cara de proteger — confirma lo ya descartado antes (yt-dlp+servidor gratis no sirve, YouTube
  bloquea IPs de datacenter). Si el usuario insiste, la única vía real sigue siendo un proxy
  residencial pagado.
