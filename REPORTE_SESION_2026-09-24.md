# Reporte de Sesión — 2026-09-24 19:25

> **Proyecto:** `svg-ornamento` (carpeta `C:\Users\user\Documents\job\parametricos.con.SVG`)
> **Objetivo de este archivo:** servir de **memoria para la próxima sesión** (una IA nueva no recuerda nada; todo lo necesario está aquí y en `REPORTE.md`).
> **Fecha:** 2026-09-24 (hora local 19:25; zona UTC+4).

---

## 1. Qué es el proyecto

Herramienta paramétrica que **convierte un archivo SVG en un modelo 3D imprimible**: una **placa base** con **relieve** (raised) o **incrustado** (inlay), exportada como **STL** y **3MF de 2 colores** (2 objetos/2 colores para impresión multimaterial). El pipeline es:

```
SVG (Illustrator) → normalizador (lib/svg.js) → SVG limpio 0..100 → template.scad con parámetros → OpenSCAD → STL + 3MF fusionado (2 colores)
```

- Backend: **Hono** en `server.js`, puerto **3100** (`process.env.PORT || '3100'`).
- Frontend: `public/` (index.html + app.js con viewer **three.js**, style.css). Editos el código OpenSCAD en la UI, ves vista previa 2D y 3D, y descargas STL/3MF.
- Node **22**; dependencias del `package.json`: `hono`, `@hono/node-server`, `fflate`.
- OpenSCAD instalado y localizado (el servidor lo resuelve). Inkscape **1.4.2** y ffmpeg también disponibles en la máquina (usados para validación visual).

## 2. Cómo arrancar y validar

```bash
cd C:\Users\user\Documents\job\parametricos.con.SVG
npm install          # la primera vez
node server.js       # → http://localhost:3100
```

- **Validación E2E:** `node scripts/e2e.mjs` → debe imprimir `E2E: PASS ✓` (3 secciones: flujo limpio "deco", regresión auto-intersección "Asset 91", y base-off).
- **Generación por lotes:** `node scripts/batch-generate.mjs <carpeta-con-svgs> [carpeta-salida]` (guardar `nombre.stl` + `nombre.3mf` por SVG; salida por defecto `batch-out/`).
- `run.cmd` / `npm start` inician el server también.

> ⚠️ **IMPORTANTE (trampa detectada):** si `http://localhost:3100` ya responde al arrancar otro server, el **puerto ya está ocupado** y el proceso nuevo muere con `EADDRINUSE`. El server recarga `lib/svg.js` **por petición** (siempre lee la última versión), pero el código de **`server.js` se congela al arrancar**. Por eso, ante bugs de `server.js`, hay que **matar el proceso dueño del puerto** (ver PID con `Get-NetTCPConnection -LocalPort 3100 -State Listen | select OwningProcess`, luego `Stop-Process -Id <pid> -Force`) y relanzar. Los PID "wrapper" de `cmd` que aparecen al lanzar con `Win32_Process Create` **no son el node real**; el real es el que escucha en el puerto.

## 3. Arquitectura / archivos clave

| Archivo | Rol |
|---|---|
| `server.js` | API Hono: `POST /upload` (sube SVG + calcula meta), `GET /current.svg` (normalizado), `POST /preview` (SVG 2D del diseño), `POST /generate` (STL/3MF vía OpenSCAD), `GET /template.scad`, estáticos de `public/`. |
| `lib/svg.js` | **Normalizador.** Lee el XML (escáner liviano), aplica `transform`s acumulados (grupos + elemento), aplanó curvas C/S/Q/T y arcos A, calcula agujeros por contención, emite SVG con `viewBox="0 0 100 100"`, paths `fill="#000" fill-rule="evenodd"`. Exporta `parseTransform` y `collectGeometry`. |
| `template.scad` | Plantilla OpenSCAD con todos los parámetros (ver §4). Tokens `__SVG_HALF_H__`, `__SVG_HALF_W__`, `__SVG_REPAIR__` los rellena el server. |
| `public/` | UI: editor de código, vista previa 2D (SVG en `<img>`) y 3D (three.js: STL/3MF). `STORAGE_KEY='svg-ornamento-code-v2'` en localStorage. |
| `scripts/e2e.mjs` | Suite de validación end-to-end contra el server en marcha. |
| `scripts/batch-generate.mjs` | Batch upload→generate→guardar archivos. |
| `temp/` | Archivos temporales del job (`<uuid>.scad`, `current.svg`, STL/3MF, preview SVG). En gitignore. |
| `REPORTE.md` | Documentación técnica del sistema (reglas OpenSCAD, validación). |
| `REPORTE_SESION_2026-09-24.md` | **Este archivo** (memoria de sesión). |

## 4. Parámetros de `template.scad` (editables en la UI)

| Parámetro | Default | Rango | Descripción |
|---|---|---|---|
| `Design_Size` | 60 | 10..200 | Tamaño máximo del dibujo en mm |
| `Flip_Vertical` | true | bool | true = relieve se ve como en pantalla |
| `Relief_Mode` | "raised" | raised/inlay | raised = relieve; inlay = incrustado a ras |
| `Base_Enable` | true | bool | Agregar o quitar la placa/base (**NUEVO esta sesión**) |
| `Base_Thickness` | 1.6 | 0.6..8.0 | Grosor de la placa |
| `Base_Border` | 4.0 | 0..15 | Margen de placa alrededor del dibujo |
| `Relief_Thickness` | 2.0 | 0.5..8.0 | Alto del relieve / profundidad del inlay |
| `Keychain_Hole` | false | bool | Agujero para llavero |
| `Keychain_Diameter` | 4.0 | 1.5..8.0 | Diámetro del agujero |
| `Keychain_Edge_Gap` | 2.5 | 0..10 | Distancia del centro del agujero al borde |
| `Color_Base` | `#1a1a1a` | color | Color de la placa |
| `Color_Relief` | `#F4A0B0` | color | Color del relieve |

Internos (los calcula el server): `_fw = Design_Size/100`, `_svg_half_h`/`_svg_half_w`, `_inlay`, `_depth = min(Relief_Thickness, Base_Thickness-0.3)`, `_reparar = __SVG_REPAIR__`.

**Modo inlay:** la placa es sólida y el dibujo se excava `_depth` desde arriba (sin perforar). `_b_z`/`_b_h` colocan el relieve sobre la placa o en z=0 (sin base).

## 5. Reglas de OpenSCAD (verificadas empíricamente; están en REPORTE.md)

1. **Escala:** `import()` usa 1 unidad = 0.35278 mm (72 dpi). El normalizador declara `width/height="283.4645669"` (= 100/0.35278) para que el lienzo mida exactamente 100 mm y `_fw` sea exacto.
2. **viewBox negativo rompe el import** (desplazamiento en Y ≈ 35.28 mm) → el normalizador emite coordenadas **positivas 0..100**.
3. **OpenSCAD ignora `transform`s** → el normalizador "aplana" toda la geometría a polilíneas absolutas (matriz acumulada grupos + elemento).
4. **Huecos:** solo por winding en un solo `<path>` con varios subpaths (outer = área positiva, hole = negativa) o `evenodd`. Elementos separados **se unionan**, no recortan.
5. **Auto-intersección:** un contorno que se cruza (el path 1 de "Asset 91") genera triángulos de área cero → falla el 3MF con **"Can't add triangle to 3MF model"** + crash `0xC0000409` (los STL por Manifold NO fallan, `polygon()` tampoco). El server detecta con `needRepair` y aplica `offset(r=0.02,$fn=24)` en `diseno_2d()` (bulge < 0.04 mm, inapreciable; verificado que no sobre-rellena ni pierde agujeros).

## 6. 🔥 Bugs corregidos en esta sesión (2026-09-24) — lo más importante

El usuario reportó que **"las geometrías del SVG se ven diferentes a Illustrator"**. Con Inkscape como renderizador independiente se diagnosticaron **2 bugs reales**, ambos corregidos:

### Bug 1 (CRÍTICO): Tokenizador compacto de Illustrator → geometría deformada
- **Síntoma:** el relieve/placa y el preview de ciertos SVGs salían con forma distinta a Illustrator (en "Asset 91": objetos 2, 3 y 9 deformados; el resto coincidía). La proporción ancho/alto del contenido normalizado daba 0.737 en vez de 0.8825.
- **Causa raíz:** Adobe exporta números adyacentes **sin separador** cuando el segundo empieza por `.`: ej. `50.6551.029`, `2.5464.0928`, `7.6136.98`. El tokenizador de `lib/svg.js` (`tokenizeD`) **fusionaba eso en un único número** (ej. `50.6551029`) porque permitía múltiples `.` dentro de un token. Todo path con esa notación quedaba corrompido.
- **Fix:** según la gramática SVG un número admite **como máximo un `.`**; al detectar un segundo `.` se corta el token actual y el resto se tokeniza como el siguiente número (`break` en el bucle que consume el `.`).
- **Validación:** comparado objeto por objeto contra `inkscape --query-all` (bbox por path): los **12 paths coinciden** con diff < 0.2 unidades normalizadas; y por pixel el render de `original.png` vs `normalized.png` da **0.77 %** de píxeles distintos (solo anti-aliasing de bordes). Antes del fix la proporción de algunos objetos difería hasta un 3.6×.

### Bug 2: El preview 2D se veía como un esquema vacío
- **Síntoma:** la vista previa 2D (la que el usuario ve en la UI) mostraba solo **contornos finos** en vez del macizo relleno, por eso "se veía diferente" a Illustrator. El diff por píxel contra el original daba **32.6 %** de diferencia.
- **Causa raíz:** OpenSCAD exporta los polígonos 2D con `fill="none" stroke="black" stroke-width="0.35"` (modo contorno).
- **Fix:** en el `POST /preview` de `server.js`, post-proceso: `svg.replace(/stroke="black" fill="none"/g, 'fill="#000" stroke="none"')`.
- **Validación:** original vs preview ahora **0.92 %** y normalizado vs preview **0.38 %** (solo bordes).

### Bugs anteriores ya resueltos (referencia)
- `matMul` incorrecta para composiciones `translate+scale`; `scale(sx sy)` intercambiados; `transform` a nivel de elemento no se aplicaba.
- Símbolo de diferencia del archivo del usuario: **"Asset 91.svg"** en `G:\My Drive\otros\3D\09 Septiembre 2026\24-09-2026\Asset 91.svg` (copia en `C:\Users\user\AppData\Local\Temp\opencode\asset91.svg`). Tiene 12 paths de un solo color (#606839, clase cls-1), uno con auto-intersecciones; fue la base de las regresiones E2E.

## 7. Metodología de validación visual (replicable en otra sesión)

Muy útil para "¿se ve igual que Illustrator?" sin depender de ojos:
1. **Inkscape como renderizador independiente:** `"C:\Program Files\Inkscape\bin\inkscape.com" <file>.svg --export-type=png --export-area-drawing --export-width=900 ...` (usar `inkscape.com`, no `.exe`, en PowerShell; el `.exe` es GUI y no espera). `--file=` está deprecado: pasar el archivo **posicional**.
2. **Bboxes de verdad:** `inkscape.com file.svg --query-all` (svg/objetos; con el artboard tipico, `--export-area-drawing` equivale a la página).
3. ⚠️ **Fondo:** Inkscape por defecto exporta **transparente** y ffmpeg convierte alfa a negro (¡parece todo negro!). SIEMPRE usar `--export-background=#FFFFFF --export-background-opacity=255` y verificar.
4. **Diff numérico:** binarizar con ffmpeg `format=gray,lut=c0='if(lt(val,128),0,255)'`, luego `blend=all_mode=difference` y medir con `signalstats`/rawvideo. Ver archivos de apoyo en `C:\Users\user\AppData\Local\Temp\opencode\vis\` (original.svg/normalized.svg/openscad_preview.svg + PNGs): `vis-prep.mjs`, `diffmap.mjs`, `profiles.mjs`, `per-object.mjs`, `dump-d.mjs`.
5. Comparar geometría **objeto por objeto** (bbox normalizado) contra Inkscape localiza el path culpable al instante.

## 8. Estado actual al cierre (2026-09-24 19:25)

- ✅ E2E completo: **PASS** (3 secciones).
- ✅ Bug 1 (tokenizador) y Bug 2 (preview fill) corregidos y validados por pixel.
- ✅ `REPORTE.md` actualizado (notas del preview + apartado tokenizador).
- ✅ Server funcionando en `http://localhost:3100` (node real PID 17012 al cierre; ver §2 para reiniciarlo).
- Comparativas de la sesión: original vs normalizado **0.77 %**, original vs preview **0.92 %**, normalizado vs preview **0.38 %** de píxeles distintos.
- ✅ Repo GitHub: commit inicial + push (URL en §10).

## 9. Pendiente / ideas para la próxima sesión

- Revisar en la UI real (navegador) el preview 2D del Asset 91 con el fix del relleno (el usuario lo confirmará de nuevo).
- Considerar si el tokenizador debe tratarse con el parser de "comma-wavy" completo de la spec (el corte en el segundo `.` es correcto, pero ide un test dedicado con `a.b.c` en paths con exponentes `e+-`).
- Posible feature: expandir `stroke` (hoy los trazos con `fill="none"` se ignoran).
- El usuario mencionó "seguimos construyendo" → pregunta qué módulo quiere ampliar (más parámetros, UI, exportación, etc.).

## 10. Git / GitHub

- Repo local inicializado en la carpeta del proyecto (commit inicial con este reporte).
- Remoto subido por `gh repo create` (cuenta **Guadarismo**). URL: **https://github.com/Guadarismo/svg-ornamento** (público, rama `main`).

## 11. Notas de entorno

- Sistema: Windows, shell PowerShell 5.1 (usar `; ` para encadenar, no `&&`).
- Herramientas: Node 22.18, OpenSCAD (ruta resuelta por server), Inkscape 1.4.2, ffmpeg 8.1.1, gh 2.86 (autenticado como Guadarismo).
- No tocar `C:\Users\user\Documents\job\clip-lapiz-tool-skill` (proyecto de referencia, solo lectura).
- Clave de localStorage del frontend: `svg-ornamento-code-v2` (sube a v3 si cambias la forma del código guardado).