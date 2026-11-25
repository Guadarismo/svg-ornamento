# Reporte de Sesión — 2026-11-25 18:29

> **Proyecto:** `svg-ornamento` (`C:\Users\user\Documents\job\parametricos.con.SVG`)
> **Objetivo de este archivo:** servir de **memoria completa para la próxima sesión** (una IA nueva no recuerda nada; todo el contexto está aquí, en `REPORTE.md` y en `REPORTE_SESION_2026-09-24.md`).
> **Fecha y hora:** 2026-11-25 18:29 (hora local, UTC-4).
> **Repositorio GitHub:** https://github.com/Guadarismo/svg-ornamento (rama `main`).

---

## 1. Resumen rápido del proyecto

`svg-ornamento` es una herramienta web local + servidor Node (ESM) que convierte un archivo **SVG** en un modelo 3D imprimible en **2 colores**: una **placa base** que sigue la silueta del dibujo (con margen configurable) y el diseño en **relieve elevado (`raised`)** o **incrustado a ras (`inlay`)**, con agujero opcional para llavero y opción de quitar la placa (`Base_Enable`).

**Pipeline completo:**
```text
SVG (Illustrator u otro)
  → normalizador sin dependencias (lib/svg.js) → temp/current.svg (lienzo positivo 0..100 = 100 mm)
  → template.scad (parámetros editables en UI / CodeMirror)
  → OpenSCAD (Manifold para STL rápido; CGAL sin Manifold para 3MF con color)
  → fusión 3MF bicolor con fflate en server.js (compatible con Bambu Studio / OrcaSlicer)
```

- **Backend:** Hono en `server.js`, puerto `3100` (`process.env.PORT || '3100'`). Dependencias npm: `hono`, `@hono/node-server`, `fflate`.
- **Frontend:** `public/index.html`, `public/app.js`, `public/style.css` + librerías locales en `public/vendor/` (CodeMirror 5.65.16 + Three.js 0.170.0 con `OrbitControls` y `STLLoader`). Sin paso de build/bundler.
- **Cómo arrancar:** `run.cmd` o `node server.js` → `http://localhost:3100`.
- **Cómo validar:** con el servidor arriba, ejecutar `node scripts/e2e.mjs` (debe imprimir `E2E: PASS ✓` y `base-off: PASS ✓`).

---

## 2. Qué se hizo en esta sesión (2026-11-24 / 2026-11-25)

El usuario reportó que el sistema funciona excelente pero **dejaba de funcionar al caerse internet**, y pidió volverlo **100% standalone / off the grid** y listo para **llevar en un pendrive**.

### Diagnóstico
- Todo el backend (`server.js`, `lib/svg.js`, `template.scad`, OpenSCAD, `public/style.css`) ya operaba 100% en local sin red.
- El único punto de fallo estaba en `public/index.html`, que cargaba **CodeMirror 5.65.16** desde `cdnjs.cloudflare.com` y **Three.js 0.170.0** (`three.module.js`, `OrbitControls.js`, `STLLoader.js`) desde `cdn.jsdelivr.net`.
- Al no haber internet, `import * as THREE from 'three'` fallaba al cargar el módulo `public/app.js`, impidiendo que el frontend se inicializara (la UI quedaba congelada en `"cargando…"`).

### Cambios realizados

1. **Vendorización completa en `public/vendor/` (6 archivos, 1.48 MB en total):**
   - `public/vendor/codemirror/codemirror.min.css` (6,037 B)
   - `public/vendor/codemirror/codemirror.min.js` (170,535 B)
   - `public/vendor/codemirror/javascript.min.js` (17,315 B)
   - `public/vendor/three/three.module.js` (1,314,681 B — autocontenido en r170, sin `three.core.js`)
   - `public/vendor/three/addons/controls/OrbitControls.js` (32,134 B — solo importa `'three'`)
   - `public/vendor/three/addons/loaders/STLLoader.js` (10,043 B — solo importa `'three'`)

2. **`public/index.html` 100% local:**
   - Reemplazadas las 3 referencias a `cdnjs.cloudflare.com` por `/vendor/codemirror/...`.
   - Reemplazado el `<script type="importmap">` de `cdn.jsdelivr.net` por:
     - `"three": "/vendor/three/three.module.js"`
     - `"three/addons/": "/vendor/three/addons/"`
   - Verificado: **0 URLs `http://` o `https://`** en todo `public/index.html`, `public/app.js` y `public/style.css`.

3. **Soporte portable / pendrive en `server.js`:**
   - `getOpenSCAD()` ahora busca en este orden de prioridad:
     1. `process.env.OPENSCAD_PATH`
     2. `portable\openscad\openscad.exe` (relativo a `__dirname`)
     3. `portable\openscad\openscad.com`
     4. `openscad\openscad.exe`
     5. `C:\Program Files\OpenSCAD (Nightly)\openscad.exe`
     6. `C:\Program Files\OpenSCAD\openscad.exe`
     7. `openscad` (en `PATH`)
   - Agregada `supportsManifold(openscadBin)` usando `spawnSync(openscadBin, ['--help'])`: detecta si el binario soporta `--backend=Manifold` aunque la carpeta no se llame `(Nightly)` (fundamental para OpenSCAD Nightly portable dentro de `portable\openscad\`).
   - `GET /template.scad` ahora lee `join(__dirname, 'template.scad')` para ser inmune al directorio de trabajo actual.
   - Al arrancar, el servidor imprime en consola el OpenSCAD detectado y si Manifold está activo (`🔧 OpenSCAD: ... (Manifold: sí/no)`).

4. **Lanzador portable en `run.cmd`:**
   - Detecta automáticamente `portable\node\node.exe` junto a `run.cmd` y lo usa si existe; en caso contrario usa `node` del sistema.

5. **`.gitignore` y documentación (`REPORTE.md`):**
   - Agregado `portable/` a `.gitignore` para poder colocar binarios de Node/OpenSCAD en un pendrive sin subir decenas/cientos de MB al repositorio Git.
   - Documentada en `REPORTE.md` la sección **"Modo 100% offline / pendrive"**.

---

## 3. Cómo armar el pendrive (para usar en otra PC sin instalar nada)

1. Copiar la carpeta completa del proyecto al pendrive (incluyendo `node_modules/` y `public/vendor/`).
2. Descargar las versiones `.zip` portables de Windows y descomprimirlas en `portable/`:
   - `portable\node\node.exe` (Node.js Windows binary `.zip`, x64)
   - `portable\openscad\openscad.exe` (OpenSCAD Nightly Windows `.zip`, x64 — recomendado para tener Manifold rápido)
3. Ejecutar `run.cmd` y abrir `http://localhost:3100` en cualquier navegador (no requiere internet).

---

## 4. Validaciones ejecutadas en esta sesión

- **Carga de recursos locales:** verificados los 9 endpoints (`/`, `/style.css`, `/app.js` y los 6 archivos en `/vendor/...`) → todos `HTTP 200` con `Content-Type` correcto (`text/html`, `text/css`, `text/javascript`).
- **Auditoría de red:** `0` enlaces `http://` o `https://` en `public/index.html`, `public/app.js` y `public/style.css`; verificado también que `three.module.js`, `OrbitControls.js` y `STLLoader.js` no tienen imports externos faltantes.
- **Suite E2E (`node scripts/e2e.mjs`):** **PASS ✓** en las 3 pruebas:
  1. Flujo normal (`deco.svg`): `raised`, `inlay`, simetría, cotas Z y 3MF bicolor (2 objetos, `#1A1A1A` + `#F4A0B0`).
  2. Regresión auto-intersección ("Asset 91"): `needRepair=true`, 3MF fusionado sin error (2 objetos/colores).
  3. Regresión `Base_Enable = false` (`base-off`): `baseStlUrl=null`, 3MF de 1 objeto (`#F4A0B0`), `z 0..2.00`.
- **Estado del usuario preservado:** tras correr `e2e.mjs`, se restauraron `temp/current.svg` y `temp/current-meta.json` al último diseño activo del usuario (`Asset 11.svg`, `halfW: 50`, `halfH: 17.0028`, `count: 35`, `needRepair: true`).

---

## 5. Mapa actual de archivos del proyecto

| Archivo / Carpeta | Rol |
|---|---|
| `server.js` | API Hono, resolución portable de OpenSCAD + Manifold, preview 2D con relleno y flip Y, generación STL/3MF y fusión 3MF bicolor con `fflate`. |
| `lib/svg.js` | Normalizador SVG sin dependencias (transforms, curvas/arcos, agujeros por contención, tokenizador compacto de Illustrator, detección `needRepair`). |
| `template.scad` | Plantilla OpenSCAD paramétrica (`diseno_2d`, `base_3d`, `relief_3d`, `svg_ornamento`). |
| `public/index.html` | Interfaz web (100% local, cero CDNs). |
| `public/app.js` | Lógica de UI, sincronización parámetros ↔ CodeMirror (`localStorage` clave `svg-ornamento-code-v2`), visor 3D con Three.js (`STLLoader` + `OrbitControls`). |
| `public/style.css` | Estilos oscuros de la UI (solo fuentes de sistema). |
| `public/vendor/` | Librerías locales: `codemirror/` (5.65.16) y `three/` (0.170.0 + `OrbitControls` + `STLLoader`). |
| `run.cmd` | Lanzador Windows compatible con `portable\node\node.exe` o `node` del sistema. |
| `scripts/e2e.mjs` | Suite de pruebas E2E contra `http://localhost:3100`. |
| `scripts/batch-generate.mjs` | Generación por lotes de STL + 3MF para todos los `.svg` de una carpeta. |
| `temp/` | Estado persistido (`current.svg`, `current-meta.json`) y archivos generados (ignorado por Git). |
| `REPORTE.md` | Documentación técnica principal del proyecto. |
| `REPORTE_SESION_2026-09-24.md` | Memoria de la sesión anterior (fixes del tokenizador compacto, preview 2D relleno, `Base_Enable`). |
| `REPORTE_SESION_2026-11-25.md` | **Este archivo** (memoria de la sesión actual). |

---

## 6. ⚠️ Hallazgo técnico importante detectado (para arreglar en la próxima sesión)

Al revisar los últimos `.scad` generados en `temp/` junto con `server.js` y `public/app.js`, se detectó un **bug sutil de sincronización con `localStorage`**:

- **Qué pasa:**
  1. Al abrir la web, `public/app.js` llama a `GET /template.scad`.
  2. `server.js` devuelve `template.scad` **con `__SVG_HALF_H__`, `__SVG_HALF_W__` y `__SVG_REPAIR__` ya sustituidos por números literales** del SVG activo en ese momento.
  3. `public/app.js` guarda ese texto en `localStorage` (`svg-ornamento-code-v2`).
  4. Cuando el usuario sube un **SVG nuevo** (sin pulsar "Restaurar"), el editor sigue enviando los números literales del SVG anterior; como ya no existen los tokens `__SVG_HALF_H__`, `__SVG_HALF_W__` ni `__SVG_REPAIR__`, `fillTemplate(code)` en `server.js` no reemplaza nada.
- **Evidencia observada:** el último job en `temp/` tenía `_svg_half_h = 50; _svg_half_w = 36.832; _reparar = 1;` aunque `temp/current-meta.json` ya era `Asset 11.svg` (`halfW: 50, halfH: 17.003`).
- **Impacto:** afecta la posición vertical de `Keychain_Hole` (usa `_svg_half_h`) y el flag `_reparar` (podría quedar encendido o apagado según un SVG anterior).
- **Fix recomendado para la próxima sesión:**
  - En `fillTemplate(code)` de `server.js`, además de reemplazar los tokens `__SVG_*__`, reemplazar siempre las líneas de asignación `_svg_half_h = ...;`, `_svg_half_w = ...;` y `_reparar = ...;` con los valores reales de `meta` (y opcionalmente que `GET /template.scad` deje los tokens o se refresque tras `/upload` sin perder los parámetros editados del usuario).

---

## 7. Pendientes e ideas para próximas sesiones

1. **Corregir el bug de sincronización de `_svg_half_h` / `_svg_half_w` / `_reparar` con `localStorage`** (descrito en §6).
2. **Limpieza automática de `temp/`:** actualmente hay ~445 archivos acumulados; el `setInterval` de `server.js` solo ejecuta `forfiles` para `*.stl` de > 30 días, dejando `.3mf` y `.scad` indefinidamente. Conviene extender la limpieza (en Node puro con `fs.readdir`/`stat`, además más portable que `forfiles`) para `.stl`, `.3mf` y `.scad` viejos (respetando `current.svg` y `current-meta.json`).
3. **Probar el paquete en pendrive real:** descargar Node portable + OpenSCAD Nightly portable en `portable/` y probar `run.cmd` en otra PC sin dependencias instaladas.
4. **Mejoras funcionales abiertas desde la sesión anterior:**
   - Tests dedicados en `lib/svg.js` para números compactos con exponentes (`e+-`) en `tokenizeD`.
   - Posible soporte para expandir `stroke` (hoy los trazos con `fill="none"` se ignoran).
   - Otras mejoras de UI/parámetros que el usuario proponga al retomar.

---

## 8. Notas de entorno y operación

- **SO / Shell:** Windows, PowerShell 5.1.
- **Herramientas verificadas en esta PC:** Node `v24.22.0`, OpenSCAD Nightly (`C:\Program Files\OpenSCAD (Nightly)\openscad.exe`, Manifold soportado), Git, `gh` autenticado como `Guadarismo`.
- **Trampa del puerto 3100:** si `server.js` ya está corriendo, el nuevo proceso fallará con `EADDRINUSE` y el servidor anterior mantiene en memoria la versión vieja de `server.js`. Para reiniciarlo:
  ```powershell
  Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object OwningProcess
  Stop-Process -Id <PID> -Force
  node server.js
  ```
- **No modificar** `C:\Users\user\Documents\job\clip-lapiz-tool-skill` (proyecto de referencia de solo lectura).
- **Respaldo Git de esta sesión:** todos los cambios (`public/vendor/`, `public/index.html`, `server.js`, `run.cmd`, `.gitignore`, `REPORTE.md` y este `REPORTE_SESION_2026-11-25.md`) commiteados en `main` y subidos a `origin` (`https://github.com/Guadarismo/svg-ornamento.git`).
