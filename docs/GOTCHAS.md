# Gotchas y decisiones de diseño — ClipEditor

Historial técnico detallado del proyecto. La memoria de Claude (`project_clipeditor.md`) solo
tiene el resumen; el detalle completo vive acá.

## "Glitch": tope bajado más por fallar en celular (2026-11-10, mismo día)

Con el tope de 720p (nota de abajo) el usuario probó en su celular: llegó a 75% y "la app se
reinicia sola, vuelve a la pantalla de subir video" — SIN mensaje de error. Eso es la firma
típica de que el sistema operativo del celular mata la pestaña/app por memoria (un celular tiene
mucha menos memoria disponible por pestaña que un computador, y no siempre avisa con un error de
JS como en desktop — simplemente recarga la página). Aún no probó en PC para comparar.

**Arreglo preventivo (sin esperar más pruebas, dado que ya hay margen real medido):** se bajó el
tope de área de 1280×720 (921.600px) a **960×540 (518.400px)** — valor que YA se había probado
con margen cómodo en la investigación anterior (540×958 con el archivo real que fallaba, 20.9s,
sin apuros) en vez de un valor nuevo sin probar. Confirmado de nuevo con el mismo archivo real
(1082×1916) tras el cambio: sigue funcionando bien (19s). Si el celular específico del usuario
sigue fallando incluso con este tope más bajo, ya no sería solo cosa de resolución — revisar si
ese celular en particular (iOS Safari, sobre todo) tiene un límite de memoria por pestaña más
chico de lo normal.

## "Glitch": tope automático de resolución — CONFIRMADO con el archivo real que causaba el error (2026-11-10)

El usuario volvió a probar (con el arreglo de `trim` de la nota de abajo ya puesto) y seguía
fallando — pero esta vez el log de error trajo la resolución exacta de sus videos:
**1082×1916** (prácticamente 1080p vertical completo, h264 High profile, generado por "Wan").
Con ese dato se pudo por fin REPRODUCIR el "Out of memory" de verdad (generando clips sintéticos
pero a esa resolución exacta, 1082×1916/10s/h264 High, con `ffmpeg` real en la Mac) — confirmado
el MISMO error exacto ("Error while filtering: Out of memory", mismo patrón de `swscaler`
repetido) con 4 clips de esa resolución + música + "Glitch".

**Con un repro real por fin en la mano**, se probó bajar la resolución de trabajo: a la mitad
(540×958) funcionó (20.9s); a 720p (720×1276) también funcionó (26.2s) — confirma que la
resolución (no la duración, ni la cantidad de clips, ni el `trim` ya puesto) es la palanca real.
El arreglo de `trim` de la nota de abajo sigue siendo válido y necesario (ayuda con clips largos
en una cadena de varias transiciones), pero por sí solo NO alcanza a resolución completa.

**Arreglo final:** `buildMergeArgs` ahora topa automáticamente la resolución de trabajo SOLO
cuando `transition === 'glitch'` — si el área (ancho×alto) supera 1280×720 píxeles, la achica
proporcionalmente (mismo aspecto) hasta calzar en esa área, antes de armar cualquier filtro. Las
otras 7 transiciones NO tienen este tope (confirmadas por el usuario funcionando bien a
resolución completa con sus propios videos) — es una limitación específica de "Glitch" por lo
pesado de su filtro, no de "Unir videos" en general. El usuario no tiene que hacer nada: el tope
es automático y transparente.

**CONFIRMADO de punta a punta** con la resolución EXACTA del usuario (1082×1916, sin achicarla a
mano) — llamada directa a `runMerge` Y por la UI real completa (arrastrar 4 clips → elegir
"Glitch" → exportar): sin error, salida de 720×1276 (el tope aplicado solo), 38.2s de duración
(4×10s − 3×0.6s de transiciones, como corresponde), ~27s de proceso.

**Contrapartida a tener presente:** con "Glitch" el video final queda a 720p como máximo (en vez
de a la resolución real de los clips subidos) — un recorte de calidad real, pero es la única
forma de que la transición no falle del todo con contenido de alta resolución en este motor de
ffmpeg dentro del navegador. Si el usuario pregunta por qué "Glitch" se ve menos nítido que las
otras transiciones con el mismo material, esa es la razón.

## "Glitch": arreglo real del "Out of memory" — recortar cada rama a su tramo (2026-11-10)

Retomando la pista de la nota de abajo ("cada clip se `split`ea en varias copias"), se encontró
y arregló la causa raíz real: cada franja/banda del filtro (persiana de revelado + franjas de
fase 1/fase 2) recortaba (`crop`) una copia COMPLETA del clip A o B — el `crop` nunca tenía
límite de TIEMPO, solo de posición/tamaño en pantalla. El `enable` del `overlay` que viene
después solo controla si esa rama se MEZCLA en el resultado final, no si ffmpeg se MOLESTA en
decodificar/filtrar esos fotogramas — así que, aunque visualmente cada franja solo se ve durante
medio segundo, ffmpeg estaba filtrando el clip ENTERO en cada una de las ~12-16 ramas. Peor
todavía en la segunda/tercera transición de una cadena de varios clips: ahí "A" ya es el
resultado ACUMULADO de las transiciones anteriores (cada vez más largo), así que cada franja de
esa transición filtraba ese acumulado completo de nuevo.

**Arreglo:** se agregó un `trim` (recorte por tiempo) ANTES del `crop` en cada rama, para que
ffmpeg solo filtre el tramo que esa rama realmente necesita:
- Franjas de B (persiana + fase 1): solo usan el tramo `[0, td]` de B (los primeros ~0.6s del
  clip que recién entra) — se recorta ahí y se desplaza con `setpts=PTS-STARTPTS+offset/TB`
  (B parte en el segundo 0 de su propio reloj, pero tiene que aparecer recién en el segundo
  `offset` del resultado final, así que hay que sumarle ese desplazamiento para que el `enable`
  del `overlay`, que mira el reloj del resultado final, siga calzando).
- Franjas de A (fase 2): solo usan el tramo `[offset+half, offset+td]` de A — como A nunca se
  desplaza (su propio reloj YA es el del resultado final), `trim` solo, SIN `setpts`, alcanza:
  conserva los tiempos originales tal cual, que ya calzan con el `enable`.
- El fondo (`format` inicial de A) y la "cola" (lo que queda de B tras el tramo usado) NO se
  tocan — esos sí necesitan el clip completo, son los únicos que de verdad lo usan entero.

**Verificado con ffmpeg real antes de aplicar el cambio** (dos pruebas aparte, con `color=`
sólido de origen/destino distinto y un `overlay` con `enable='between(t,...)'`): recortar el
input del `overlay` con `trim` — con o sin `setpts` según el caso — sigue funcionando exactamente
igual que antes, el `enable` sigue calzando en el momento correcto. Confirmado también de punta a
punta con el filtro real (2 y 3 clips encadenados, formato vertical 576×1024, con movimiento real
cuadro a cuadro en vez de color sólido fijo) — el resultado visual es idéntico a antes del
arreglo (fondo intacto + adelanto de B en la ida, revelado + A de fondo en la vuelta).

**Sigue sin confirmarse con los archivos reales del usuario** (nunca se pudo reproducir el "Out
of memory" con clips sintéticos, ni antes ni después de este arreglo) — la razón de este cambio
es puramente el razonamiento (reduce drásticamente la cantidad de datos que pasan por cada rama,
en teoría debería bajar la memoria viva de forma proporcional), no una comparación antes/después
midiendo memoria real. Si el usuario lo prueba y sigue fallando, el siguiente paso es pedirle
directamente uno de sus archivos reales (o un link) para poder medir de verdad, en vez de seguir
con sintéticos — ya se gastó mucho tiempo de sesión así sin reproducir el problema real.

## Causa real del error de "Glitch" con archivos reales: Out of memory (2026-11-09, sesión siguiente — PENDIENTE, sin arreglar)

Después de re-habilitar "Glitch" (nota de abajo), el usuario la siguió probando con sus propios
videos reales (generados con una IA llamada "Wan", formato 9:16, silenciosos, duraciones tipo
10/15/15/10s) y seguía fallando — pero esta vez con el arreglo de mostrar más líneas del log
(60 en vez de 5, commit `822f3e3`) se pudo ver la causa real por primera vez, en Chrome Y en
Safari por igual (NO es un tema de navegador):

```
frame=  207 fps=6.3 q=19.0 size=    5120kB time=00:00:06.83 bitrate=6138.0kbits/s speed=0.207x
Error while filtering: Out of memory
Failed to inject frame into filter network: Out of memory
Error while processing the decoded data for stream #3:0
```

**"Out of memory" de verdad** — ffmpeg.wasm se queda sin memoria WASM disponible a mitad del
filtrado (fotograma 207, ~6.8s de metraje procesado de un video final más largo). No se pudo
reproducir con archivos sintéticos de prueba (se probó con duraciones iguales, formato 9:16,
mudos, con música, en navegador normal y en la app instalada — todo funcionó) — la diferencia
real debe estar en el PESO/complejidad de los archivos de video reales del usuario (contenido
real con mucho detalle/movimiento pesa mucho más al decodificar que un `testsrc2` sintético, y
el filtro de "Glitch" decodifica y mantiene en memoria VARIAS copias de cada clip a la vez por el
`split` que usa para poder reutilizar cada clip en múltiples franjas/bandas — ver la nota de más
abajo sobre por qué existe ese `split`).

**Pistas para retomar la investigación:**
- El filtro de "Glitch" es, por lejos, el más pesado en memoria de las 8 transiciones — cada
  clip se `split`ea en `K+BAR_COUNT+1` copias (con `K=6`/`BAR_COUNT=3` actual, hasta 10 copias
  por clip) para poder usarlo como entrada de muchos `crop`/`overlay` distintos. Con clips reales
  pesados (no sintéticos), tener tantas copias de cada fotograma decodificado vivas al mismo
  tiempo en la memoria WASM (que en `ffmpeg.wasm` sin hilos tiene un techo más bajo que en
  escritorio) es la sospecha más fuerte.
- Primer paso sugerido para la próxima sesión: pedirle al usuario UNO de sus archivos reales
  (o un link para descargarlo) para probar con el peso/complejidad real en vez de seguir
  adivinando con sintéticos — esta sesión se gastó mucho tiempo en sintéticos que nunca
  reprodujeron el problema real.
- Caminos de arreglo a evaluar: (a) bajar aún más `K`/`BAR_COUNT` (ya se bajó de 5/24 a 3/6, se
  podría intentar 2/3), (b) evitar el `split` reestructurando el filtro para que cada clip se
  decodifique una sola vez y las franjas se saquen todas de una sola copia ya en memoria en vez
  de `split`eada, (c) bajar la resolución de trabajo interna de "Glitch" específicamente (p.ej.
  escalar a 720p antes del filtro y reescalar al final) si el usuario sube clips en una
  resolución más alta de la necesaria.
- Mientras tanto, si el usuario insiste en usar "Glitch" con sus videos reales: probar con menos
  clips a la vez (de a 2 en vez de 4), o clips más cortos, para ver si hay un punto donde sí
  entra en memoria — eso ayudaría a entender si es un techo duro o algo que escala con la
  cantidad/peso total.

## Transición "Glitch" — RE-HABILITADA, el "cuelgue" era un bug de mis propias pruebas (2026-11-09)

Después de arreglar el cuelgue del núcleo multi-hilo (nota más abajo), el usuario probó de
nuevo con sus 5 videos reales (3 de 15s, uno de 10s, uno de 4s) + música + "Glitch": avanzó a
3% y mostró "No se pudo unir los videos" (ya no colgada — un error real esta vez). Al investigar
esto, varias pruebas directas (fuera de la UI, llamando `runMerge` a mano) SÍ se colgaban en
0% para siempre, con 2, 3 y 5 clips, con y sin música, incluso con el filtro reducido al mínimo
posible (`BAR_COUNT=1`, `K=1`) — y el mismo filtro corrido en ffmpeg real de esta Mac (no
ffmpeg.wasm) funcionaba perfecto e instantáneo. Con esa evidencia se sacó "Glitch" del selector.

**Pero esa "evidencia" tenía un error metodológico propio, encontrado al retomar la
investigación a pedido del usuario ("me interesa mucho ese efecto, investiga cómo hacerlo sin
afectar el rendimiento"):** todas esas pruebas directas llamaban `await inst.load()` A MANO
ANTES de llamar `inst.runMerge(...)`, para medir tiempos de carga por separado. Pero
`inst.load()` sin argumentos usa `preferMultiThread=true` por defecto — en un contexto
"cross-origin isolated" (que el dev server SÍ es, por la cabecera COOP/COEP agregada
permanentemente, ver nota de abajo), eso cargaba el núcleo MULTI-HILO primero. Como
`loaded.value` queda en `true` después de esa carga, cuando `runMerge` hacía su propio
`await load(false)` internamente, el guard `if (loaded.value || loading.value) return` lo
convertía en un no-op — **`runMerge` terminaba corriendo con el núcleo multi-hilo de todos
modos**, el mismo que ya se sabía (nota de abajo) que se cuelga con cualquier filtro de varios
clips. El cuelgue era 100% el bug de multi-hilo ya conocido, disparado por mi propio código de
prueba, no un problema de "Glitch" en absoluto.

**Confirmado llamando `runMerge` SIN pre-cargar nada a mano (como lo hace la app real):**
funcionó de punta a punta — 2 clips (4.8s), 5 clips con proporciones de duración iguales a las
del usuario + música (4.5s), y de nuevo a través de la UI real completa (arrastrar → elegir
"Glitch" → exportar), sin ningún error. Se volvió a agregar "Glitch" al selector.

**Lección para la próxima vez que algo "se cuelgue" en una prueba directa (fuera de la UI):**
si el código de prueba llama `load()` por su cuenta antes de la función real, verificar que no
esté pisando una decisión de núcleo (single/multi-hilo) que esa función toma internamente —
mejor nunca pre-cargar a mano, dejar que la función bajo prueba haga su propio `load()` como lo
haría la UI real, para no introducir un falso positivo así.

Gotcha real (no de pruebas) encontrado en el camino, sigue válido: al achicar `BAR_COUNT` (de 5
a un número menor) sin querer, los loops de las franjas de fase 1/fase 2 seguían con el rango
fijo `[4, 3, 2, 1, 0]` (asumiendo siempre 5 franjas) — con `BAR_COUNT` más chico,
`nextA()`/`nextB()` se quedaban sin copias que entregar a mitad de loop y devolvían
`undefined`, generando un filtro con la etiqueta literal `undefined` adentro ("Stream
specifier 'undefined'"). Arreglado a `for (let i = BAR_COUNT - 1; i >= 0; i--)` — si se vuelve
a tocar `BAR_COUNT`, revisar que los loops lo usen en vez de un rango fijo. Quedó en
`BAR_COUNT=3`/`K=6` (más liviano que el original 5/hasta 24, sin necesidad real ya que el
cuelgue no era de tamaño, pero más liviano nunca está de más).

## Núcleo multi-hilo de ffmpeg.wasm — implementado (2026-11-09)

Pedido explícito del usuario tras ver que "Unir videos" con sus 5 clips tardaba varios minutos
("¿por qué no poner al menos 2 núcleos?"). Hasta ahora quedaba como "palanca pendiente,
evaluar solo si el usuario pide más velocidad" (ver nota más abajo) — ya se implementó.

- **`@ffmpeg/core-mt` en vez de `@ffmpeg/core`** — usa varios núcleos del procesador (igual
  versión, `0.12.6`, mismo patrón `toBlobURL` de siempre, pero cargando también
  `ffmpeg-core.worker.js` además de `.js`/`.wasm`). Solo funciona en una página
  "cross-origin isolated" (cabeceras `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`,
  que exigen `SharedArrayBuffer`) — GitHub Pages no deja configurar cabeceras HTTP propias
  directo, así que se activa vía un service worker.
- **`src/sw.js` reemplaza el service worker automático de `vite-plugin-pwa`** (antes
  `generateSW`, ahora `injectManifest` con un worker a mano) — hace las DOS cosas en un solo
  archivo para no tener dos service workers compitiendo por el mismo origen (ese era justo el
  riesgo que tenía frenado este cambio): precachea el build igual que antes (`PrecacheController`
  de `workbox-precaching`, agregado como devDependency explícita — ya estaba en `node_modules`
  de forma transitiva pero no declarada, riesgo real de que un `npm install` futuro no la
  trajera) y en el `fetch` le agrega a CADA respuesta las dos cabeceras COOP/COEP antes de
  devolverla.
- **`crossOriginIsolated` se chequea en tiempo de ejecución antes de pedir el núcleo multi-hilo**
  (`useFfmpeg.ts`, función `load()`) — si no está disponible (navegador viejo, o la primera
  visita antes de que el service worker tome control), cae solo al núcleo de un hilo de
  siempre, con try/catch extra por si el núcleo multi-hilo falla cargar por cualquier otro
  motivo. Nunca debería dejar la app sin poder editar, en el peor caso solo más lento.
- **Gotcha real encontrado armando el service worker:** por defecto `injectManifest` compila
  `src/sw.js` como MÓDULO ES (con `import` adentro, ya que usa `workbox-precaching`), pero
  `registerSW.js` (el script que lo registra) lo hace SIN `type: 'module'` — confirmado
  probando el build real (`npm run build` + `npm run preview`): el navegador rechazaba el
  registro con "unknown error fetching the script" (el mismo texto, por casualidad, que ya
  estaba documentado como limitación del panel de pruebas — pero esta vez la causa real era
  otra, el panel tampoco deja probar service workers de todos modos). Arreglo:
  `injectManifest.rollupFormat: 'iife'` en `vite.config.ts` — empaqueta todo (incluido
  `workbox-precaching`) en un solo archivo clásico sin `import`, que sí registra bien sin
  necesitar `type: 'module'`.
- **Actualización — el usuario SÍ probó en producción y encontró un cuelgue real (mismo día):**
  "Unir videos" con 5 clips de apenas 15s + música + "Glitch" se quedó pegado en 0% de
  progreso, sin avanzar nunca — peor que antes de este cambio, para un caso mucho más chico y
  liviano que el de la prueba anterior (5 clips de 1.5 min). Causa real encontrada y confirmada
  directo (ver técnica más abajo): **el núcleo multi-hilo se cuelga con cualquier
  `-filter_complex` de varios clips** — no es un problema de "Glitch" en particular (se probó
  también con `transition: 'none'`, el `concat` más simple posible, y se colgó exactamente
  igual) ni de la cantidad de clips (se colgó con 2 Y con 5). La edición de un solo archivo
  (`runEdit`, sin `-filter_complex`, solo `-vf`/`-af` sobre un único `-i`) SÍ funciona perfecto
  y rápido con el núcleo multi-hilo — confirmado con una prueba aparte. Arreglo: `runMerge`
  ahora pide el núcleo de un hilo a propósito (`load(false)`, nuevo parámetro `preferMultiThread`
  en `load()`), igual que siempre funcionó; el resto de las operaciones (`runEdit`,
  `runImageEdit`, `runExtractFrame`, `runExtractAudio`, todas en la instancia de `App.vue`,
  aparte de la de `MergeView.vue`) sí usan el núcleo multi-hilo cuando está disponible.
- **Técnica que permitió encontrar esto rápido, sin esperar otro despliegue:** agregar las
  mismas cabeceras COOP/COEP directo en `vite.config.ts` → `server.headers` — así el servidor
  de desarrollo de Vite TAMBIÉN corre "cross-origin isolated" (confirmado con
  `crossOriginIsolated` en la consola) y se puede probar el núcleo multi-hilo en local, sin
  depender del service worker (que nunca registra en el panel de pruebas). **Ojo con los
  puertos repetidos:** la primera vez que se probó esto en el puerto 5174 (ya usado muchas
  veces antes en esta misma sesión, sin esas cabeceras) `crossOriginIsolated` seguía dando
  `false` pese a que las cabeceras SÍ llegaban (confirmado con `curl`) — Chrome fija el estado
  de aislamiento por proceso/origen la primera vez que se visita ese origen en la sesión del
  navegador, y no lo revisa de nuevo solo por agregar cabeceras después. Cambiar de puerto
  (origen nuevo) lo resolvió al toque. Esta configuración de `server.headers` se dejó puesta
  de forma permanente (no es solo para depurar) — así el dev server queda más parecido a
  producción y un problema así se encuentra en el acto la próxima vez, no después de pedirle
  al usuario que pruebe un despliegue.
- **Confirmado por el usuario en dispositivo real:** con "Unir videos" ya forzando el núcleo de
  un hilo (arreglo de arriba), las 7 transiciones que quedan (todas menos "Glitch", ver nota
  aparte) funcionan bien con sus propios videos reales — este arreglo quedó validado.

## "Unir videos" con clips largos/pesados — reportado como "no funciona" (2026-11-09)

El usuario reportó que 5 clips de ~1.5 min cada uno (con transición y música) "no fue capaz de
unirlos". Reproducido con 5 clips sintéticos pero REALISTAS (no los de prueba habituales de
colores sólidos, que pesan casi nada): `testsrc2` 1920×1080/90s a 6 Mbps de origen (~67MB cada
uno, generados con ffmpeg real en la Mac, servidos desde `public/__sizetest/` temporalmente y
borrados después — nunca commitear archivos de prueba). Dos problemas reales encontrados, no uno:

1. **El export NO estaba fallando — solo tardaba mucho más de lo que el progreso mostraba, y el
   progreso llegaba a "100%" muchísimo antes de terminar de verdad.** Confirmado leyendo
   `logLines` directo (el "time=" de ffmpeg seguía avanzando, con el archivo de salida
   creciendo, minutos después de que `progress.value` ya marcaba 1.0) — el usuario casi seguro
   vio "Procesando 100%" congelado por varios minutos y asumió que se quedó pegada. Causa:
   `ffmpeg.wasm` no calcula bien el progreso en un filtergraph complejo (varios inputs +
   transición) — no es algo que se pueda arreglar del lado del core. Arreglo: `runMerge` ahora
   calcula su PROPIO progreso leyendo "time=HH:MM:SS.cc" de las últimas líneas del log contra
   la duración real esperada del resultado (`computeMergeOutputDuration`, misma fórmula que ya
   usaba `buildMergeArgs` para el offset de la transición, extraída a función aparte para no
   duplicarla) — con una bandera `useNativeProgress` en `useFfmpeg.ts` para que el evento nativo
   de ffmpeg no lo pise mientras tanto.
2. **Sin tope de bitrate, el archivo de salida podía pesar e tardar mucho más de lo razonable
   en contenido complejo.** Con el `-preset ultrafast` + CRF por defecto de siempre (sin
   `-maxrate`/`-bufsize`), el clip de prueba (bastante más complejo visualmente que un video
   casero típico, a propósito para forzar el peor caso) terminó codificando a MÁS DE 16 Mbps
   —casi 3 veces el bitrate de origen (6 Mbps)— a 0.82x tiempo real (más lento que reproducirlo),
   con la salida creciendo sin freno (pasó de 272MB a 339MB solo entre dos chequeos). Arreglo:
   `bitrateCapArgs(w,h)` en `commandBuilder.ts` — tope de `-maxrate`/`-bufsize` según resolución
   (5 Mbps hasta 720p, 8 Mbps hasta 1080p, 14 Mbps hasta 1440p, 20 Mbps más allá), aplicado al
   export de "Unir videos" Y al de edición de un solo archivo (mismo `-preset ultrafast` sin
   tope ahí también, mismo riesgo aunque menos probable con un solo clip).

**Límite real de la app (no hay un tope de archivos/peso/duración puesto a propósito, es
enteramente cuestión de tiempo de espera):** todo corre en un solo hilo dentro del navegador
(ffmpeg.wasm sin soporte multi-hilo acá, ver nota de "core-mt" más abajo) — no hay memoria
compartida entre pestañas ni límite de tamaño de archivo subido, pero procesar un video de
calidad real puede tardar aproximadamente 1x-1.5x su propia duración, o bastante más con
contenido muy complejo (mucho detalle/movimiento). Con 5 clips de 1.5 min (7.5 min en total),
el tiempo de espera real puede ser de varios minutos — ahora al menos el progreso real se lo
hace saber al usuario en vez de parecer colgada.

**Actualización (mismo día, tras reportar el usuario que el error real era un mensaje en rojo
"no se pudo procesar", no la app colgada):** se corrió el caso completo (5 clips de 90s/1080p
reales + música, mismo contenido complejo de prueba) HASTA EL FINAL con los arreglos ya puestos
— terminó bien, sin error, en ~8.8 minutos (530s), salida de 453MB a ~8 Mbps (dentro del tope
nuevo). Antes del arreglo, a los 38% de avance el archivo ya pesaba 272MB a ~16 Mbps y seguía
creciendo — de haber seguido a ese ritmo habría terminado cerca de 900MB, el doble de memoria
viva en el navegador en el peor momento. No se pudo reproducir el mensaje en rojo exacto que
vio el usuario (la prueba sin el arreglo se cortó antes de llegar al final, por tiempo) — la
hipótesis más probable es que esa memoria casi al doble haya llegado a tope (`Aborted()`/out of
memory de WASM, que el `catch` de `runMerge` muestra como el mensaje genérico de error) pero
queda sin confirmar al 100%. Si el usuario vuelve a ver un error rojo después de este arreglo,
pedirle el texto exacto (o una captura) — es la forma más rápida de descartar o confirmar esta
hipótesis.

## Transición "Glitch" en "Unir videos" (2026-11-09)

Pedida explícitamente por el usuario tras probar las primeras 7 transiciones (xfade) —
quería algo más elaborado, no un tipo de transición estándar de ffmpeg. Se validó el
mecanismo ANTES de tocar la app: con ffmpeg real instalado en la Mac (`/opt/homebrew/bin/ffmpeg`,
mucho más rápido de iterar que probar cada intento en ffmpeg.wasm dentro del navegador),
generando clips sintéticos de color sólido con `-f lavfi -i color=...` y extrayendo
fotogramas con `ffprobe`/`-frames:v 1` para inspeccionar visualmente cada ajuste. Una vez
funcionando ahí, recién se portó a `commandBuilder.ts` (`buildGlitchTransitionFilter`).

**El efecto en sí (afinado en 3 rondas sobre un boceto animado — Artifact HTML con canvas —
antes de construirse, a pedido del propio usuario: "si tienes dudas, pregúntame antes de
implementar"):** una franja ancha con líneas más chicas detrás (angostándose), un solo
recorrido completo de izquierda a derecha y de vuelta.
- **Ida (mitad 1):** el fondo se queda tal cual el clip A — las franjas pasan por encima
  mostrando por dentro un adelanto del clip B.
- **Vuelta (mitad 2):** recién ahí el fondo empieza a revelar el clip B detrás, a medida que
  la franja principal retrocede; las franjas siguen mostrando el clip A por dentro mientras
  tanto, hasta desaparecer al final.

**Dos limitaciones de ffmpeg descubiertas probando (no son intuitivas, documentarlas para la
próxima vez que se toque un filtro así de elaborado):**
1. **El ancho/alto de un `crop` NO puede variar cuadro a cuadro — solo `x`/`y` sí.** Un primer
   intento con `crop=w='<fórmula con t>'` para que el área revelada creciera con el tiempo
   compiló sin error pero el ancho quedaba congelado en su valor inicial (t=0) — confirmado
   comparando fotogramas a distintos tiempos del mismo render, el "x" sí se movía pero el
   ancho no. Arreglo: el ancho de cada franja es siempre un número fijo calculado de
   antemano en TS (nunca una fórmula con "t"), y el fondo se revela con una "persiana" de K
   franjas de ancho FIJO que aparecen de golpe cada una en su propio instante
   (`overlay enable='gte(t,...)'`) en vez de un barrido de ancho continuo — con suficientes
   franjas (`K` entre 12 y 24 según el ancho del video) no se nota el escalonado a simple
   vista.
2. **Una etiqueta de salida normal (ej. `[v1]`, definida por un filtro anterior) solo se
   puede usar como entrada de OTRO filtro una vez — a diferencia de un especificador crudo
   tipo `[0:v]`/`[1:v]`, que sí se puede referenciar muchas veces sin problema.** El primer
   intento portado a la app (que SÍ funcionaba igual en ffmpeg de la Mac, porque ahí se
   referenciaba `[0:v]`/`[1:v]` directo) reusaba `[v0]`/`[v1]` como entrada de ~20 filtros
   distintos (cada franja, cada banda de la persiana) y fallaba en ffmpeg.wasm con
   `Stream specifier 'v1' ... matches no streams` / `Invalid stream specifier: v1` — un error
   bastante confuso que no menciona "split" ni deja claro la causa real. Arreglo: `split=N`
   al principio de la función, generando N copias numeradas de cada clip de entrada, y cada
   franja/banda consume una copia distinta en vez de reusar la misma etiqueta.

**Probado de punta a punta:**
- 2 clips (webm sintético con audio real, patrón canvas+oscillator+MediaStreamDestination) vía
  llamada directa a `runMerge` Y vía la UI real (arrastrar, elegir "Glitch", exportar) —
  exportó sin error, duración correcta, y revisando fotogramas a varios tiempos del resultado
  se confirmó visualmente el comportamiento descrito arriba (fondo sin tocar + adelanto en la
  ida, fondo revelándose + franjas del clip anterior en la vuelta, limpio al final).
- **3 clips encadenados** (para confirmar que la segunda transición del loop no choca en
  nombres de etiquetas con la primera — cada llamada a `buildGlitchTransitionFilter` recibe
  un `idx` único, usado como prefijo de TODAS sus etiquetas): el segundo cruce (clip2→clip3)
  se ve igual de bien que el primero.
- **Rendimiento:** con clips sintéticos de 720p/5s, "Glitch" tomó ~2.1s contra ~3.3s de
  "Mezcla" en el mismo entorno de pruebas — pese a tener un filtergraph mucho más grande
  (`split` + ~20 crop/overlay), no resultó más lento en la práctica. No se probó con video
  real de más duración/resolución — si el usuario reporta que esta transición en particular
  es notablemente más lenta con sus propios videos, el primer sospechoso es el tamaño de "K"
  (la cantidad de franjas de la persiana, que escala con el ancho del video).

Falta confirmación del usuario en dispositivo real.

## Transiciones en "Unir videos" (2026-11-09)

Una sola transición elegida para TODAS las uniones (decisión explícita del usuario, no por
clip — más simple de usar y de construir), 7 opciones en `MergeView.vue`: Ninguna (comportamiento
de siempre, `concat`), Fundido, Mezcla, Deslizar, Círculo, Barrido, Barrido suave (las últimas
dos agregadas 2026-11-09 a pedido del usuario tras probar las primeras 5). Mapeo a los nombres
reales del filtro `xfade` de ffmpeg en `commandBuilder.ts` (`XFADE_NAME`): Fundido→`fadeblack`
(pasa por negro), Mezcla→`fade` (cross-fade liso, sin pasar por negro — ojo que el nombre del
filtro "fade" es la Mezcla de la UI, no el Fundido), Deslizar→`slideleft`, Círculo→`circleopen`,
Barrido→`wipeleft` (línea vertical dura que recorre la pantalla revelando el siguiente clip
detrás, sin mezclar — pedido textual: "línea vertical que... se desplaza... hasta desaparecer y
quedar el video siguiente"), Barrido suave→`smoothleft` (igual idea pero con degradado en vez de
línea dura — pedido textual: "fundido de derecha a izquierda"). Ambas confirmadas visualmente en
el panel de pruebas: Barrido mostró una línea vertical dura dividiendo los dos colores de
prueba, Barrido suave mostró un degradado horizontal continuo entre ambos.

- **Con transición, el video usa `xfade` en cadena en vez de `concat`** (uno por cada par de
  clips consecutivos, encadenados: `[v0][v1]xfade=...[vx1]`, `[vx1][v2]xfade=...[vx2]`, etc.) y
  el audio usa `acrossfade` igual encadenado — mismo patrón de silencio con `anullsrc` para
  clips sin audio que ya usaba `concat`, solo que ahora se cruza con `acrossfade` en vez de
  concatenarse.
- **Offset de cada `xfade`:** no es fijo — depende de la duración acumulada del resultado hasta
  ese punto menos la duración de la transición (`cumulative - td`). Si se vuelve a tocar este
  código, no asumir que el offset es igual en cada paso.
- **Duración de la transición (`td`) se acota SIEMPRE al clip más corto de la lista** (40% de su
  duración, tope 0.6s) — `xfade`/`acrossfade` fallan con offset negativo si la superposición
  pedida dura más que algún clip. No expuesto como ajuste en la UI a propósito (fijo en
  `TRANSITION_DURATION = 0.6`), acorde al pedido del usuario de mantener la UI simple — si pide
  poder ajustarla, agregar un slider ahí, no tocar el cálculo de seguridad.
- **Probado de punta a punta en el panel de pruebas** con 2 clips sintéticos (colores sólidos
  rojo/azul, con audio real vía canvas+oscillator+MediaStreamDestination, mismo patrón que
  funcionó para "Extraer audio") y transición "Mezcla": exportó sin error, duración final
  correcta (2.9+2.9-0.6≈5.3s) y, al buscar el punto medio del video resultante, el fotograma
  mostraba un tono mezclado entre el rojo y el azul de origen — confirma que el cross-dissolve
  real está ocurriendo, no solo que el comando no falló. No se probaron Fundido/Deslizar/Círculo
  individualmente (mismo código `xfade` genérico, solo cambia el nombre del tipo) ni ninguna con
  más de 2 clips — si se reporta un problema con 3+ clips o con esas tres específicamente, revisar
  el encadenado de offsets primero.

## Extraer audio (2026-11-08)

Nueva herramienta de video (no aplica a imagen): "-vn -c:a libmp3lame -q:a 2" (sin filtro de
video, mp3 con VBR alta calidad) — `buildAudioExtractArgs` en `commandBuilder.ts`,
`runExtractAudio` en `useFfmpeg.ts`. Acción aparte de "Ejecutar edición", igual patrón que
"Capturar fotograma" (`AudioPanel.vue`, un solo botón sin ajustes — nada que elegir, coherente
con el pedido de "poco texto" del usuario). Si el archivo no tiene pista de audio, `exec` sale
con código≠0 (no hay nada que `-vn` deje escribir) — mensaje propio en vez del genérico:
"Este archivo no tiene pista de audio, o no se pudo extraer."

**Probado de punta a punta en el panel de pruebas (caso real, no solo sintético directo):**
un video de prueba generado con canvas+oscillator+MediaRecorder (combinando
`canvas.captureStream()` y `AudioContext.createMediaStreamDestination()` en un mismo
`MediaStream`) SÍ produjo un webm válido y reproducible esta vez — a diferencia del gotcha de
"Unir videos" (2026-10-30) que documentaba ese mismo combo como corrupto. No se investigó por
qué cambió (¿versión de Chrome del panel, duración más corta, codecs explícitos `vp8,opus`?) —
si se repite el problema viejo en otra prueba, no asumir que esta técnica siempre funciona,
probar primero con un clip bien corto (~1.5s) antes de descartarla. Con ese archivo: extracción
dio `audio/mpeg`, duración correcta, nombre de descarga `audio.mp3` — confirmado via `fetch()`
del blob resultante, no solo visualmente. También se probó el camino de error con un video sin
audio (solo `canvas.captureStream()`, sin pista de audio) — mensaje propio mostrado
correctamente. Aun así, falta la confirmación del usuario con un archivo real suyo.

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
  con riesgo real de chocar con el SW de la PWA. **El usuario lo pidió explícitamente
  (2026-11-09, "¿por qué no poner al menos 2 núcleos?")** tras ver que "Unir videos" con 5
  clips reales tardó ~9 minutos — pendiente de implementar, pero no se tocó todavía porque es
  un cambio de infraestructura real (no solo de ffmpeg) con riesgo genuino de romper el modo
  offline/instalable si se hace mal, y el service worker no se puede probar en el panel de
  pruebas (solo en producción) — avisar al usuario de ese riesgo antes de implementarlo.
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

- **Grabar solo un tramo del video de YouTube (mismo día, pedido explícito del usuario tras lo
  de arriba — "¿puede empezar la grabación en el minuto 8 y pararse en el 17:30?"):** dos campos
  opcionales "Desde"/"Hasta" (texto libre, acepta `8:00`, `1:17:30` o segundos sueltos —
  `parseTimeInput` en `YoutubeImportPanel.vue`) antes de "Grabar". `startRecording` ahora recibe
  `(useFullscreen, quality, startTime, endTime)`: si `startTime>0` hace `player.seekTo(startTime,
  true)` ANTES de `playVideo()` (así no se grava nada de lo anterior), y el mismo timer de
  progreso que ya actualizaba `currentTime` cada 500ms ahora también revisa si llegó a `endTime`
  para detener la grabación sola (`autoStopAt`, igual que si el video hubiese terminado ahí). El
  tipo `YT.Player` no tenía declarado `seekTo` en `iframeApi.d.ts` (propio del proyecto, la
  IFrame API no trae tipos oficiales) — se agregó. **Límite esperado, no un bug:** sigue
  grabando en tiempo real (no hay forma de "saltar" la grabación en sí, solo de no grabar antes
  del inicio ni después del fin pedido), así que un tramo de 9.5 min sigue tomando ~9.5 min en
  grabarse — pero ya no arrastra los ~8 min previos ni el resto después, que antes había que
  cortar después con "Cortar" (recodificando un archivo mucho más pesado).
- **YouTube downloaders de terceros (ytdown.to, etc.) — no replicar gratis:** corren detrás de
  protección anti-bots seria (Cloudflare), señal de que mantienen infraestructura de servidor
  cara de proteger — confirma lo ya descartado antes (yt-dlp+servidor gratis no sirve, YouTube
  bloquea IPs de datacenter). Si el usuario insiste, la única vía real sigue siendo un proxy
  residencial pagado.
