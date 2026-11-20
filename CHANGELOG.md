# Changelog

## Pi-Terax v0.9.0-dev.25 (2026-11-20)

- Tres motores de voz locales más: Pocket TTS (Kyutai), OmniVoice (k2-fsa) y ZONOS3-Mini (Zyphra, Apple Silicon), con voces en español e inglés listas para usar.
- Cada motor se ajusta a la máquina: dispositivo, precisión, hilos, int8, pasos de difusión y build de PyTorch, explicados en su tarjeta de Ajustes.
- Revisión de todos los flujos para empezar, parar y retomar una lectura, en el artifact de las maquetas.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.25.md).

## Pi-Terax v0.9.0-dev.24 (2026-11-19)

- Atajos globales del Reader (⌘⌥P, ⌘⌥← →, ⌘⌥= -, ⌘⌥R, ⌘⌥B) y controles multimedia del sistema: «Ahora suena», teclas multimedia y auriculares.
- Exportación en fragmentos para textos largos: un WAV por sección, párrafo o frase, con índice y lista de reproducción.
- `reader.generate` para que los agentes generen audio de un texto o fichero en segundo plano; `reader.export` con `split` y progreso consultable en `reader.state`.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.24.md).

## Pi-Terax v0.9.0-dev.23 (2026-11-19)

- Reader en un panel acoplado bajo cualquier pestaña (terminal, editor o Markdown), sin cambiar de pestaña: «Read here», `terax-read` y la paleta.
- Lista de lecturas en el icono del libro, con borrar una o todas y la cadena para volver a la pestaña donde se hizo cada una.
- Correcciones de reproducción, guardado y lectura de texto partido salidas de una revisión independiente, y `reader.dock` y `reader.delete` para los agentes.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.23.md).

## Pi-Terax v0.9.0-dev.22 (2026-11-19)

- Reader: pestaña que lee textos largos con la voz local y resalta cada palabra, con clic para empezar, atajos estilo vim, velocidad de 0.75x a 2.5x y controles flotantes.
- Audio por frase guardado en disco, retomada exacta, marcadores, pausas y paradas guionizadas, y exportación a WAV con capítulos.
- `terax-read` desde los terminales, «Open in Reader» y comandos `reader.*` para los agentes.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.22.md).

## Pi-Terax v0.9.0-dev.21 (2026-11-19)

- Antigravity (agy) y GitHub Copilot CLI como proveedores de la barra de IA, con el MCP de Terax y reglas de permiso por postura.
- Selector de modelos con iconos unicos e insignia de origen, favoritos por modelo (tambien en los CLIs) y catalogos vivos.
- Chat acoplable a los lados o sobre la barra inferior, filas de herramientas legibles y comando `chat.layout`.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.21.md).

## Pi-Terax v0.9.0-dev.20 (2026-11-17)

- El Pi-Terax Agente controla toda la aplicacion: terminales no privados (listar, leer, abrir, dividir, cerrar, escribir), spaces y watches que avisan o despiertan al agente cuando cambia la salida de un comando.
- Regla de paridad: registro, MCP, extension Pi-Terax e instrucciones del agente cambian juntos, con tests que lo exigen.
- Modelo por defecto por agente, `!` y `!!` para ejecutar comandos desde la barra de Terax AI, y snippets `/new` y `/compact`.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.20.md).

## Pi-Terax v0.9.0-dev.19 (2026-11-17)

- Corrige el empaquetado: Pi-Terax.app, titulos Pi-Terax e identidad habitual app.crynta.terax.
- Utiliza el perfil de desarrollo existente y la identidad local de firma disponible, con Ghostty precompilado.
- Mantiene el contenido funcional de QA; no instala ni abre la app sobre datos existentes durante la publicacion.
- [Changelog detallado y limitaciones](docs/releases/v0.9.0-dev.19.md).

## Pi-Terax v0.9.0-dev.18 (2026-11-17)

- Corrige la colision de numeracion con una compilacion local dev.17 anterior.
- Sustituye la release dev.17 publicada en GitHub el mismo dia, conservando el contenido funcional QA.
- Alinea la version interna del DMG, Tauri, Rust, paquete y extension Pi en 0.9.0-dev.18.
- Incluye el [changelog detallado](docs/releases/v0.9.0-dev.18.md) de terminal Ghostty, Blocks, imagenes, agentes, GraphX y vistas Raw/Rendered/Side by side, con sus comprobaciones y limitaciones.


## Pi-Terax v0.9.0-dev.17

Publicado el 17 de noviembre de 2026. Esta versión continúa la serie de desarrollo después de v0.9.0-dev.16 y consolida el trabajo de la rama qa, incluido el candidato funcional ace5857. El número 0.9.0-dev.17 también se incorpora al paquete, a la configuración de Tauri, al crate Rust y a la extensión Pi.

### Nueva terminal nativa

- Integración de libghostty-vt para interpretar y mantener el estado del terminal, con un renderizador WebGL2 compartido por ventana.
- Sesiones nativas independientes de los componentes React: ocultar pestañas o cambiar de renderizador conserva el proceso y su estado.
- Renderizador Canvas2D de respaldo y selección GPU/software desde las preferencias.
- Entrada negociada de teclado, eventos de foco, informes de ratón SGR, rueda en pantalla alternativa y compatibilidad con programas interactivos.
- Historial retenido con consultas acotadas, búsqueda anclada y aplicación de los límites de scrollback.
- Integración del directorio de trabajo y del estado de preparación del shell mediante metadatos autenticados.
- Acciones de selección conectadas con los consumidores de la aplicación, incluida la apertura de Mermaid y la creación de notas.
- Colores del tema, fuente, tamaño, espaciado, zoom y preferencias del cursor conectados al motor nativo.

### Terminal por bloques

- Seguimiento de comandos y límites de salida autenticados, encabezados y borradores independientes.
- Controles de búsqueda, copia del comando, copia de salida y repetición sobre el bloque correspondiente.
- Conservación de comandos largos y multilínea; lectura que distingue salida vacía de salida no disponible.
- Adjuntar un bloque al compositor de IA: comando y salida normal, o solo el comando cuando la salida es válidamente vacía.
- Protección frente a lecturas pendientes cuyo propietario, visibilidad o alcance privado haya cambiado.
- Se conserva la restricción previa de un único panel por pestaña Blocks.

### Texto, imágenes y portapapeles

- Transporte y rasterización de clusters completos para caracteres combinados, CJK y emoji, incluido el modo negociado 2027.
- Imágenes inline Kitty con PNG, RGB y RGBA directos, recorte, capas y reconstrucción tras ocultar la pestaña o cambiar de renderizador.
- Compatibilidad con placeholders Unicode de imágenes Kitty.
- Escrituras OSC52 del terminal al portapapeles mediante un observador nativo acotado y comprobaciones del propietario.
- Corrección de Cmd+V en macOS para consumir el evento de pegado de WebKit sin provocar el menú modal de acceso al portapapeles.
- Corrección de las coordenadas Retina en el arrastre de archivos, con selección del panel receptor y rutas correctamente entrecomilladas.
- Captura de paneles nativos activos e inactivos, con rechazo de superficies privadas y composición de los elementos admitidos.

### Agentes y compositor de IA

- El compositor y Ask Terax reconocen los CLI instalados sin exigir una clave de proveedor SDK.
- La disponibilidad de CLI se comparte entre arranque, selector y Settings mediante una caché efímera y solicitudes deduplicadas, sin sondeo periódico ni llamadas de autenticación o modelo.
- La elección explícita de un CLI conserva los adjuntos y no sustituye automáticamente el modelo predeterminado configurado.
- Correcciones en la detección de agentes a partir de metadatos autenticados del shell y comandos codificados.
- Conservación de la persona al cambiar de proveedor CLI.
- Restauración y entrega de tareas vinculadas al propietario del terminal, evitando reutilizar sesiones retiradas.
- Se ha comprobado en M2 un turno manual de Codex entregado una sola vez y la restauración Always con recuperación de contexto en un segundo turno.

### Pi-Terax Agente y GraphX

- Agente integrado Pi-Terax Agente para gestionar la aplicación mediante las capacidades del registro de comandos.
- Acciones personalizables por proyecto en .terax/pi-terax-commands.json, sujetas a la validación y a las políticas de aprobación existentes.
- Pestañas y documentos GraphX persistentes con identidad de documento, revisión y comprobaciones de actualización.
- Paneles movibles y acoplables para colocar un grafo junto al terminal, con geometría conservada y redimensionamiento en vivo.
- Motor GraphX/ELK empaquetado para ejecución local en un iframe aislado con política de contenido restrictiva.
- Correcciones de carga de recursos y estilos en WebKit empaquetado, títulos personalizados, foco al colocar paneles y altura durante el resize.
- Capturas de GraphX compuestas sobre el terminal, vinculadas a la revisión visible; los acompañantes se ocultan junto a terminales privados.

### Archivos Raw, Rendered y Side by side

- Controles compartidos Raw / Rendered / Side by side para Markdown, HTML/HTM, Mermaid y archivos GraphX editables.
- Edición y vista previa conservan el mismo búfer, el estado modificado y el flujo de guardado.
- División redimensionable; en paneles estrechos, la distribución pasa a vertical.
- HTML abre en Raw y ofrece una vista estática filtrada en un iframe aislado, sin scripts, navegación ni acceso a recursos externos o relativos.
- Markdown actualiza la vista previa desde el texto editado y conserva el guardado explícito.
- GraphX incorpora Format JSON y diagnósticos sintácticos con línea y columna en el documento y en archivos .graphx.
- El formato JSON solo modifica espacios: conserva lexemas numéricos y claves duplicadas, se deshace con una única operación y no guarda ni aplica cambios por sí solo.

### Correcciones adicionales

- El cursor permanece estable y hueco cuando el panel o la ventana pierden el foco, tanto en GPU como en software.
- Los atajos del terminal actúan sobre el propietario enfocado.
- Las acciones de selección no desaparecen por una actualización de lectura ajena a la selección.
- Publicación atómica de los perfiles de shell para evitar archivos parcialmente escritos durante aperturas paralelas.
- Errores del motor y fallos de inicialización se muestran de forma explícita.
- La política de cierre del shell ordinario mantiene el comportamiento previo de la aplicación.

### Compilación y comprobaciones

- Se compila en el M4 con la biblioteca ARM64 precompilada y verificada del M2, sin instalar ni ejecutar Zig y sin cambiar el antivirus.
- La prueba anterior del consumidor M4 completó comprobación de tipos, frontend, compilación nativa, iteraciones React/Rust y ejecución de terminal, resize y HTML renderizado.
- El candidato de base reúne evidencias funcionales de M2 para pegado, selección avanzada, Blocks, imágenes, Unicode, preferencias, Codex, GraphX y vistas de documentos.
- Esta publicación añade el cambio de versión y el changelog. No equivale a completar las pruebas generales pendientes ni amplía por sí sola las evidencias a otras plataformas.

### Descarga y limitaciones

- Artefacto de esta publicación: Pi-Terax Sandbox para macOS 13 o posterior, Apple Silicon ARM64, motor Ghostty activado.
- Compilación de desarrollo/debug con firma ad-hoc, sin notarización ni actualización automática. Mantiene una identidad Sandbox separada de la aplicación habitual.
- No incluye binarios Intel, Linux o Windows; el número de versión no implica que esos destinos hayan sido validados.
- La migración continúa en QA. Quedan la comprobación agrupada de presentación, Redraw y captura inactiva compleja; actividad y finalización en paneles separados; y la reconciliación final del inventario de paridad.
- La entrega de contexto a un modelo SDK y la reproducción audible TTS no se han establecido en este barrido. La disponibilidad del CLI no concede herramientas SDK a ese proveedor.
- El objetivo opcional de 60 FPS y, después, la composición japonesa/IME permanecen en el backlog; ninguno bloquea esta publicación.
- No se han ejecutado GitHub Actions. La actividad general de desarrollo y validación sigue pausada conforme al acuerdo previo.

Más detalle: [estado de aceptación](../plans/2026-11-16-terminal-acceptance-status.md) y [comprobaciones pendientes](../plans/2026-11-16-qa-publication-pause.md).

---

Work landed on `qa` since `be21959` (*Add typescript 7 for better performance*).
Each entry names the commit it came from.

## Local speech output

### Added - read anything aloud, entirely on your machine

Terax can speak. Select text in a terminal or an editor and read it aloud from
the context menu, the command palette's new **Voice** group, or `Mod+Shift+R`
(`Mod+Shift+.` stops). A pill in the status bar shows the voice, the chunk
position and a stop button while audio plays.

Synthesis is local and self-contained. Rust owns a private directory under the
app's local data dir holding a `uv` binary, a Python 3.11, one virtual
environment per engine and the model weights; a standard-library Python sidecar
per engine binds `127.0.0.1:0`, requires a per-launch bearer token that never
appears in argv, and is killed when Terax exits. No shell profile, `PATH`,
`~/.cache`, system Python or system package manager is touched, and **Purge
everything** returns the machine to its prior state.

Two engines and four models are offered, installed and downloaded on demand as
cancellable background jobs with live logs: Kokoro (Spanish and English, preset
voices, ~330 MB) and Chatterbox (multilingual, Turbo and Nano, zero-shot cloning
from a short WAV sample). A voice profile pairs a model, a language, a preset or
a sample, synthesis parameters and a style definition, and each language has
exactly one default so "read this in Spanish" is deterministic. Two built-in
Kokoro profiles ship enabled, so reading aloud works as soon as the engine is
installed.

Long text is stripped of ANSI escapes and prompt noise, split into
sentence-sized chunks and played as a queue, so audio starts before the whole
text is synthesized. Nothing runs until the feature is used: no sidecar, no
poll, no mounted component.

Pi and the in-app agent reach it through eight new registry commands
(`tts.status`, `tts.start`, `tts.stop`, `tts.install`, `tts.download`,
`tts.voices`, `tts.speak`, `tts.stopSpeaking`), a `terax_speak` tool and a
bundled `terax-tts` skill that documents when to speak and how to write text for
each model. `app.snapshot` reports engine, model and speaking state, never the
text, never a token. Private terminals do not offer **Read aloud**, keeping the
boundary they already have with the AI.

User guide: [`docs/tts.md`](docs/tts.md).

## Mermaid diagrams

### Added — a Mermaid tab with source and visual editing ([`438dfb3`](https://github.com/Sendery/terax-ai/commit/438dfb3), merged in [`b216f42`](https://github.com/Sendery/terax-ai/commit/b216f42))

A `mermaid` tab kind: a split source editor and live diagram preview, with a
**Source** mode that accepts every Mermaid format and a structured **Visual**
mode for flowcharts and sequence diagrams.

Mermaid source stays the canonical representation. A conservative parser admits
only a documented subset, and no visual mutation reaches the tab until the real
Mermaid runtime accepts the regenerated source, so an unsupported, malformed or
stale source can never be overwritten. Flowchart node coordinates have no
Mermaid representation, so they live as bounded, defensively hydrated private
per-tab metadata, serialized with the space and omitted from `app.snapshot`.

Pointer drag works on the node body and every drag has a keyboard equivalent;
sequence participants and messages reorder through drag handles and explicit
move buttons. Selecting Mermaid code anywhere in Terax offers **Open Mermaid**
in the selection popup.

Two defects were found and fixed while building it:

- Mermaid only accepts `participant` and `actor` as sequence declaration
  keywords. The other six participant kinds were emitting source the real parser
  rejects; they now serialize as `participant Id@{ "type": ... }` shape metadata.
- The whole pane scrolled instead of the inspector, taking the Source/Visual
  toggle out of reach.

User guide: [`docs/mermaid-diagrams.md`](docs/mermaid-diagrams.md).

## Pi bridge

### Fixed — requests that follow a mutating command went unanswered ([`15a4705`](https://github.com/Sendery/terax-ai/commit/15a4705), merged in [`3a8159b`](https://github.com/Sendery/terax-ai/commit/3a8159b))

Two defects made write-then-read — the sequence an agent uses constantly —
unusable, while every command passed in isolation.

The bridge listener was re-subscribed whenever App rebuilt its handler object,
which is on almost every state change. Tauri's `listen` registers
asynchronously, so a request arriving between teardown and re-registration was
dropped and the caller waited out its 5 second frame timeout.

The scheduled-task handlers read `tasks` through a ref assigned during render,
so a command issued before React re-rendered saw the previous list: `tasks.add`
returned an id that `tasks.update` then rejected as unknown.

Also added a parity test over the three hand-maintained command allowlists — the
frontend registry, the extension package and the Rust bridge — since nothing
previously stopped them from drifting.

### Added — the last surfaces Pi could not reach ([`59a39e3`](https://github.com/Sendery/terax-ai/commit/59a39e3), merged in [`2bd1c71`](https://github.com/Sendery/terax-ai/commit/2bd1c71))

Five commands, taking the bridge from 47 to 52:

| Command | What it does |
| --- | --- |
| `git.history.open` | Opens the commit graph for a repository |
| `git.commitFile.open` | Opens a file's diff as it was at one commit |
| `search.content` | Ripgrep search under a root, returning hits |
| `tab.move` | Reorders a tab inside its own space |
| `tab.setPinned` | Pins an editor tab or returns it to the preview slot |

`git.commitFile.open` requires a 7 to 40 character hexadecimal sha: it reaches
git as an argument, so a revision expression is never resolved on the caller's
behalf. `search.content` opens nothing; its root and every hit pass the same
read deny-list the in-app AI tools use, so a match cannot reveal a path the
agent may not read.

Every non-AI tab kind is now reachable from Pi: editor, markdown, preview,
mermaid, git-diff, git-history and git-commit-file. Terminal creation remains
unexposed.

## Session history panel

### Fixed — the panel blanked when you looked at anything else ([`19c64b9`](https://github.com/Sendery/terax-ai/commit/19c64b9), merged in [`d061cac`](https://github.com/Sendery/terax-ai/commit/d061cac))

The panel resolved its transcript from the active tab's cwd, which is null for
every tab that is not a terminal. Opening a file, a diagram or a diff blanked it
mid-read. The binding now follows the focused terminal and is held until that
terminal closes.

### Added — inspect the session of any open terminal ([`19c64b9`](https://github.com/Sendery/terax-ai/commit/19c64b9))

Resolving a transcript from a directory is a heuristic: two agents of the same
kind in one directory are indistinguishable, and a session belonging to an
unfocused terminal was unreachable. Every open terminal pane is now probed, and
a picker in the panel header lists their transcripts grouped by terminal, with
the focused one marked. Choosing one pins the panel to it across focus changes.

## Git history

### Fixed — branch labels and merge stats were never fetched ([`44781d5`](https://github.com/Sendery/terax-ai/commit/44781d5), merged in [`23b1091`](https://github.com/Sendery/terax-ai/commit/23b1091))

Branch, tag and remote labels were missing from the data, not the UI: the log
format carried no `%D` and nothing asked git to decorate. Decorations are now
requested with `--decorate=full`, so a local branch named `origin/x` is not read
as a remote one, and the refs are typed rather than guessed from a short name.

Every merge showed a dash instead of stats because `git log --shortstat` prints
nothing for a merge unless asked. It now diffs against the first parent, which
is what the merge brought in. A git too old for `--diff-merges` falls back
rather than failing the view.

### Added — classics the view was missing ([`44781d5`](https://github.com/Sendery/terax-ai/commit/44781d5))

- The full commit message in the detail panel, which showed only the subject.
- Relative ages in the list, with the absolute timestamp on hover.
- Search across the body and ref names as well as the subject and both sha
  lengths, so a branch or tag name finds where it points.

## Agent notifications

### Fixed — notifications said too little, and some of it was wrong ([`e6ec6d8`](https://github.com/Sendery/terax-ai/commit/e6ec6d8), merged in [`9c9a34e`](https://github.com/Sendery/terax-ai/commit/9c9a34e))

- **No text.** The hook reporting a Claude event ran a fixed `printf` and never
  read the JSON Claude writes to its stdin, where `message` is the only field
  that says why the agent stopped. It is now extracted and carried on the OSC
  marker.
- **Every recap read as completion.** Claude's `Stop` hook fires at the end of
  every turn, so "claude finished" appeared each time it handed the turn back.
  Turn ends, the agent exiting, and being blocked on you are now three kinds,
  and the agent exiting produces a notification at all, which it never did.
- **No tab identity.** Rows and toasts now carry the tab's palette colour and
  the label the tab bar shows, rather than the raw title, which for a terminal
  stays "shell" while the bar shows the cwd or a custom name.
- **An error nobody had caused.** A false hook status means "not installed yet",
  which is every fresh profile, but the panel rendered it as *Could not update
  Claude Code config* before the user had touched anything.
