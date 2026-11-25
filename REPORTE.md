# SVG Ornamento — placa base paramétrica desde SVG

Herramienta web + servidor Node que convierte un archivo **SVG** en un modelo 3D
imprimible en **2 colores**: una placa base con la silueta del dibujo (con margen
configurable) y el diseño en **relieve elevado** o **inlay a ras de la placa**
(incrustado, sin perforarla). Incluye agujero opcional para llavero/cordón.

## Cómo ejecutar

```bash
npm install        # (ya hecho: hono, @hono/node-server, fflate)
npm start          # o: node server.js  → http://localhost:3100
```

Requiere **OpenSCAD** (busca primero en `portable\openscad\openscad.exe`, luego en `C:\Program Files\OpenSCAD (Nightly)\openscad.exe`, o en `OPENSCAD_PATH`).

### Modo 100% offline / pendrive

- Todas las librerías del frontend (**CodeMirror 5.65.16** y **Three.js 0.170.0** con `OrbitControls` y `STLLoader`) están guardadas localmente en `public/vendor/`. La app no hace ninguna petición a internet.
- Para llevarla en un pendrive a otra PC sin instalar Node ni OpenSCAD:
  1. Copia la carpeta completa del proyecto (incluyendo `node_modules/` y `public/vendor/`).
  2. Coloca los binarios portables (`.zip` oficial de Windows) dentro de `portable/`:
     - `portable\node\node.exe`
     - `portable\openscad\openscad.exe`
  3. Ejecuta `run.cmd` (detecta automáticamente `portable\node\node.exe` y `server.js` detecta `portable\openscad\openscad.exe`).

El puerto se puede cambiar con `PORT` (por defecto **3100**):

```bash
$env:PORT = 4100; node server.js
```

## Uso

1. Abre `http://localhost:3100`.
2. Sube un SVG (arrastrando o seleccionando). Si no subes nada, se usa una **flor de ejemplo** normalizada al arrancar.
3. Ajusta los parámetros (tamaño, grosor, modo relieve/inlay, agujero de llavero, colores…).
4. *Vista Previa* → render 2D (OpenSCAD). *Generar 3D* → STL completo/por partes y 3MF de 2 colores.
5. Descarga el STL o el 3MF (compatible con OrcaSlicer/Bambu Studio, 2 objetos con su color).

## Parámetros

| Parámetro | Default | Descripción |
|---|---|---|
| `Design_Size` | 60 | Lado mayor del dibujo en mm (el lienzo normalizado vale 100 unidades) |
| `Flip_Vertical` | true | Invierte el eje Y: lo impreso queda igual que en pantalla |
| `Relief_Mode` | raised | `raised` = relieve sobre la placa · `inlay` = incrustado a ras |
| `Base_Enable` | true | **Agregar/quitar base**: si se desactiva, se imprime solo el dibujo (STL completo = relieve macizo desde z=0; el 3MF lleva 1 solo objeto y la API devuelve `baseStlUrl: null`) |
| `Base_Thickness` | 1.6 | Grosor de la placa (mm) |
| `Base_Border` | 4.0 | Margen de placa alrededor del dibujo (mm) |
| `Relief_Thickness` | 2.0 | Alto del relieve / profundidad del inlay (mm) |
| `Keychain_Hole` | false | Agujero para llavero/cordón |
| `Keychain_Diameter` | 4.0 | Diámetro del agujero (mm) |
| `Keychain_Edge_Gap` | 2.5 | Distancia del centro del agujero al borde del dibujo (mm) |
| `Color_Base` / `Color_Relief` | #1a1a1a / #F4A0B0 | Colores de placa y relieve |

El inlay usa `_depth = min(Relief_Thickness, Base_Thickness - 0.3)` para no
perforar la placa (el relieve queda a ras de la cara superior).

## Arquitectura

```
server.js                  API (Hono) + renderizado OpenSCAD + merge 3MF a 2 colores
template.scad              Plantilla paramétrica (módulos diseno_2d / base_3d / relief_3d)
lib/svg.js                 Normalizador SVG → polilíneas absolutas (sin dependencias)
public/                    Frontend (index.html, app.js, style.css, CodeMirror + three.js)
scripts/batch-generate.mjs Genera STL+3MF para todos los .svg de una carpeta
scripts/e2e.mjs            Validación automática end-to-end
temp/                      Estado persistido (current.svg, current-meta.json, .scad/.stl/.3mf)
```

### Endpoints

| Endpoint | Descripción |
|---|---|
| `POST /upload` | Sube un SVG, lo normaliza y lo guarda como `temp/current.svg` |
| `GET /template.scad` | Plantilla con `__SVG_HALF_H__` / `__SVG_HALF_W__` rellenos |
| `GET /meta` | `{ name, halfW, halfH, count }` del SVG actual |
| `POST /preview` | Reemplaza la llamada final por `diseno_2d();` y exporta un SVG 2D |
| `POST /generate` | Genera STL (completo, base, relieve) y 3MF en 2 colores; devuelve URLs de descarga |
| `GET /download/:file` | Descarga los archivos generados |
| `GET /current.svg` | El SVG normalizado actual |

### Renderizado (`/generate`)

- **STL** con `--backend=Manifold` (rápido, sin color).
- **3MF** con CGAL (sin Manifold) para conservar `color()` por parte.
- El **3MF final** se fusiona con `fflate`: un objeto por parte (base y relieve),
  cada uno con su `pid → m:colorgroup` (formato Bambu/Orca; luego se limpian y se
  lanza `forfiles` a 30 días).

## Por qué un "normalizador" en el servidor

> **Nota:** la vista 2D ("Vista Previa") podía verse **espejada** respecto a
> Illustrator: OpenSCAD exporta el SVG con Y hacia arriba y el navegador lo pinta
> con Y hacia abajo. El servidor envuelve el preview en `<g transform="scale(1 -1)">`
> sobre el centro vertical del viewBox para que se vea igual que la pantalla.
> (El 3D y la impresión siempre fueron correctos con `Flip_Vertical=true`.)
>
> **Nota 2:** el preview 2D podía aparecer como un **esquema vacío** (solo contornos)
> en lugar del macizo de Illustrator. OpenSCAD exporta los polígonos 2D con
> `fill="none" stroke="black"`; el servidor fuerza `fill="#000" stroke="none"`
> en el post-proceso del SVG del preview.

OpenSCAD importa SVG de forma **limitada** y con varios giros (verificado empíricamente
con renders + STL):

1. **Escala:** `import()` usa **1 unidad = 0.35278 mm** (72 dpi, 25.4/72). El
   normalizador declara `width/height = 283.4645669` (= 100/0.35278) para que el
   lienzo mida **exactamente 100 mm** y `_fw = Design_Size/100` sea exacto.
2. **viewBox negativo:** coordenadas negativas (`-50 -50…`) producen un
   **desplazamiento en Y** (~35.28 mm). El normalizador emite coordenadas **0..100
   positivas** (`viewBox="0 0 100 100"`) con el contenido centrado en (50,50).
3. **Transformaciones:** OpenSCAD ignora varios `transform` (anida raros, ignora
   el de elementos, y no respeta compuestas ni `skew` bien). El normalizador
   "aplanará" TODA la geometría a **polilíneas absolutas** aplicando los `transform`
   acumulados (grupos + elemento: matrix/translate/scale/rotate/skewX/skewY),
   curvas C/S/Q/T y arcos A incluidos.
4. **Huecos:** OpenSCAD solo crea agujeros por **winding en un solo `<path>` con
   varios subpaths** (outer = área **positiva** en y-down / horario en pantalla;
   hole = **negativa**) o `fill-rule="evenodd"`. Elementos separados **siempre se
   unionan** (no recortan). El normalizador agrupa cada ELEMENTO fuente en un solo
   `<path>` con la orientación de cada contorno calculada por contención
   (raycast por `absArea`) y `fill-rule="evenodd"`.
5. **Contornos auto-intersecantes:** un path cuyo propio contorno se cruza (p. ej.
   el "Asset 91.svg" de Illustrator) hace que el import genere triángulos de área
   cero → la exportación 3MF falla con **"Can't add triangle to 3MF model"** (los
   STL sí salen, y `polygon()` de OpenSCAD no sufre esto). El servidor lo **detecta**
   (`needRepair`) y activa un `offset(r=0.02)` infinitesimal en `diseno_2d()`, que
   re-triangula la silueta limpiamente sin cambiar la forma (bulge < 0.04 mm,
   inapreciable; verificado que no sobre-rellena corbatines ni pierde agujeros).

### Limitaciones conocidas (comportamiento esperado)

- **No** se expanden `stroke` (elementos con `fill="none"` o `display="none"` se
  ignoran): los trazos finos no imprimen área.
- Se ignoran `text`, `defs`, `use`, `style`, gradientes, `image`, `marker`, `switch`, etc.
- Un contorno blanco superpuesto "para recortar" **no recorta** (es unión).
- Con `Keychain_Hole` y un dibujo pequeño, el agujero puede asomar por el borde si
  `Keychain_Edge_Gap` es demasiado pequeño; ajústalo.

## Validación (verificada con STL reales de OpenSCAD)

- **Pipeline de áreas:** área rellena esperada **2138.2** == área medida de la cara
  superior del STL (donut con su agujero interno recortado), diff **0.00**.
- **E2E** (`scripts/e2e.mjs`, PASS):
  - Upload → `halfW/halfH/count` correctos para un diseño con grupos + rotaciones
    + arcos + cuadrado sesgado.
  - `raised`: base `x ∈ ±(halfW·0.6+4)`, `y ∈ ±(halfH·0.6+4)` (tolerancia 0.1 mm),
    simétrico en el origen; total `z 0..3.6`.
  - `inlay`: total `z 0..1.6`; relieve `0.30..1.60` (a ras, sin perforar).
  - 3MF fusionado: **2 objetos, 2 colores (#1A1A1A, #F4A0B0)**.
  - **Regresión "Asset 91"**: un SVG con contorno auto-intersecante activa
    `needRepair=true`, genera STL+3MF sin error, y el 3MF fusionado mantiene los
    2 objetos/colores y los agujeros del diseño.
- **Batería de edge cases** del parser (rutas relativas, `A`/`C`/`S`/`Q`/`T`,
  exponentes `1e1`, `defs`, letra "O" como ring, subpaths múltiples, polilínea
  abierta, `translate+scale`, `skew`, transform a nivel de elemento) — todas pasan.
- **Bugs corregidos durante la validación** (en `lib/svg.js`): multiplicación de
  matrices afines `matMul` incorrecta para composiciones `translate+scale`;
  parámetros de `scale(sx sy)` intercambiados; `transform` a nivel de elemento
  no se aplicaba (solo en grupos).
- **Tokenizador compacto de Illustrator (bug crítico):** Adobe exporta números
  adyacentes **sin separador** como `50.6551.029` o `2.5464.0928` (el segundo
  número empieza por `.`). El tokenizador los fusionaba en UN token
  (`50.6551029`), deformando todos los paths con esa notación (en el "Asset 91"
  objetos 2, 3 y 9): el preview y el relieve salían con geometría distinta a
  Illustrator. Corregido: un token SVG admite **como máximo un `.`**; al ver un
  segundo `.` se corta y el resto se tokeniza como el siguiente número.
  Verificado objeto por objeto contra `inkscape --query-all` (bbox por path,
  diff < 0.2 unidades normalizadas) y por pixel (original vs normalizado:
  **0.77 %** de píxeles, solo bordes anti-aliased).

## Generación por lotes

```bash
node scripts/batch-generate.mjs <carpeta-con-svgs> [carpeta-salida]
```

Por cada `.svg` de la carpeta sube, genera (parámetros por defecto) y guarda
`nombre.stl` + `nombre.3mf` en la carpeta de salida (`batch-out/` por defecto).

## Fichero de plantilla

`template.scad` usa varios tokens que el servidor rellena con la geometría del SVG
actual:

```
_svg_half_h = __SVG_HALF_H__;   // media altura del dibujo (unidades SVG, 0..50)
_svg_half_w = __SVG_HALF_W__;   // media anchura
_reparar    = __SVG_REPAIR__;   // 1 si algún contorno se auto-interseca (activa el offset de reparación)
```

El keyhole se sitúa en `±(halfH·_fw + Keychain_Edge_Gap)` según `Flip_Vertical`.