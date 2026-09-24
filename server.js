import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { writeFile, readFile, unlink, mkdir, copyFile } from 'fs/promises';
import { execSync, exec } from 'child_process';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { collectGeometry } from './lib/svg.js';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, 'temp');
const CURRENT_SVG = join(TEMP_DIR, 'current.svg');
const CURRENT_META = join(TEMP_DIR, 'current-meta.json');

await mkdir(TEMP_DIR, { recursive: true });

const app = new Hono();

// SVG por defecto (una flor simple) que se normaliza al arrancar si no hay
// ninguno subido todavía. Usa transformaciones rotación/translación y un
// anillo (agujero) para ejercitar el normalizador.
const DEFAULT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <g transform="translate(200,200)">
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(0)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(45)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(90)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(135)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(180)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(225)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(270)"/>
    <ellipse cx="0" cy="-62" rx="36" ry="86" transform="rotate(315)"/>
    <circle r="40"/>
    <path fill-rule="evenodd" d="M0,-46 a46,46 0 1 1 0.01,0 Z M0,-30 a30,30 0 1 1 -0.01,0 Z"/>
  </g>
</svg>`;

// ---------- estado persistido ----------
let meta = { halfW: 50, halfH: 50, count: 0, name: '', needRepair: false };

async function loadMeta() {
  try {
    meta = { needRepair: false, ...JSON.parse(await readFile(CURRENT_META, 'utf-8')) };
  } catch { meta = { halfW: 50, halfH: 50, count: 0, name: '', needRepair: false }; }
}

async function saveMeta() {
  await writeFile(CURRENT_META, JSON.stringify(meta, null, 2), 'utf-8');
}

async function writeCurrentSvg(svg) {
  await writeFile(CURRENT_SVG, svg, 'utf-8');
  await copyFile(CURRENT_SVG, join(TEMP_DIR, 'current.svg')); // lo mismo en el temp de OpenSCAD
}

// ---------- OpenSCAD ----------
function getOpenSCAD() {
  const candidates = [
    'C:\\Program Files\\OpenSCAD (Nightly)\\openscad.exe',
    'C:\\Program Files\\OpenSCAD\\openscad.exe',
    'openscad',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, { stdio: 'pipe' });
      return cmd;
    } catch { }
  }
  return 'C:\\Program Files\\OpenSCAD (Nightly)\\openscad.exe';
}

const OPENSCAD = getOpenSCAD();
const MANIFOLD_SUPPORTED = OPENSCAD.includes('(Nightly)');
const FEATURES = MANIFOLD_SUPPORTED ? '--enable textmetrics' : '';

// ---------- rutas ----------
app.get('/template.scad', async (c) => {
  const content = await fillTemplate(await readFile('template.scad', 'utf-8'));
  return c.newResponse(content, 200, { 'Content-Type': 'text/plain' });
});

app.use('/public/*', serveStatic({ root: '.' }));
app.use('/*', serveStatic({ root: 'public', index: 'index.html' }));

app.get('/meta', (c) => c.json(meta));

app.get('/current.svg', async (c) => {
  if (!existsSync(CURRENT_SVG)) return c.json({ error: 'No hay SVG aún' }, 404);
  const svg = await readFile(CURRENT_SVG, 'utf-8');
  return c.newResponse(svg, 200, { 'Content-Type': 'image/svg+xml' });
});

app.post('/upload', async (c) => {
  try {
    const ct = c.req.header('content-type') || '';
    let xml = '';
    if (ct.includes('multipart')) {
      const fd = await c.req.formData();
      const file = fd.get('file');
      if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400);
      xml = await file.text();
      meta.name = file.name || '';
    } else if (ct.includes('application/json')) {
      const body = await c.req.json();
      xml = body.svg || '';
      meta.name = body.name || '';
    } else {
      xml = await c.req.text();
      meta.name = 'pegado.svg';
    }

    const r = collectGeometry(xml);
    if (r.count === 0 || !r.svg) {
      return c.json({ error: 'El SVG no tiene geometría rellena (solo se admiten path/circle/ellipse/rect/polygon/polyline/line rellenos).' }, 400);
    }

    meta.halfW = r.halfW;
    meta.halfH = r.halfH;
    meta.count = r.count;
    meta.needRepair = !!r.needRepair;
    await writeCurrentSvg(r.svg);
    await saveMeta();

    return c.json({ ok: true, halfW: r.halfW, halfH: r.halfH, count: r.count, name: meta.name, needRepair: meta.needRepair });
  } catch (err) {
    return c.json({ error: 'No se pudo procesar el SVG: ' + (err.message || err) }, 400);
  }
});

app.post('/preview', async (c) => {
  try {
    const { code } = await c.req.json();
    if (!code) return c.json({ error: 'No code provided' }, 400);
    const id = randomUUID();
    const scadFile = join(TEMP_DIR, `${id}.scad`);

    // Vista 2D: solo el contorno del dibujo (sin placa)
    const previewCode = (await fillTemplate(code)).replace(
      /^svg_ornamento\s*\(\s*\)\s*;?\s*$/m,
      'diseno_2d();'
    );

    await writeFile(scadFile, previewCode, 'utf-8');

    const svgOut = join(TEMP_DIR, `${id}.svg`);
    execSync(`"${OPENSCAD}" ${FEATURES} -o "${svgOut}" "${scadFile}"`, { timeout: 30000, stdio: 'pipe' });

    if (!existsSync(svgOut)) return c.json({ error: 'Failed to generate preview' }, 500);
    let svg = await readFile(svgOut, 'utf-8');

    // OpenSCAD exporta los polígonos 2D como contorno (fill="none" stroke), que se
    // ve como un esquema en lugar del macizo en Illustrator. Se pintan rellenos.
    svg = svg.replace(/stroke="black" fill="none"/g, 'fill="#000" stroke="none"');

    // OpenSCAD exporta el SVG con Y hacia ARRIBA, pero el navegador pinta con
    // Y hacia abajo: la vista 2D aparecería espejada respecto a Illustrator.
    // Se envuelve el contenido en un <g> espejado sobre el centro vertical del viewBox.
    const vb = svg.match(/viewBox="([^"]+)"/);
    if (vb) {
      const [vx, vy, vw, vh] = vb[1].split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vw) && Number.isFinite(vh)) {
        const yMid = vy + vh / 2;
        const flip = `\n<g transform="translate(0 ${2 * yMid}) scale(1 -1)">`;
        svg = svg.replace(/<svg[^>]*>/, m => m + flip);
        svg = svg.replace(/<\/svg>/, '</g>\n</svg>');
      }
    }

    await cleanup(id);
    return c.json({ svg });
  } catch (err) {
    return c.json({ error: err.message || 'Preview generation failed' }, 500);
  }
});

app.post('/generate', async (c) => {
  try {
    const { code } = await c.req.json();
    if (!code) return c.json({ error: 'No code provided' }, 400);
    if (meta.count === 0 || !existsSync(CURRENT_SVG)) {
      return c.json({ error: 'Sube primero un SVG' }, 400);
    }
    await writeCurrentSvg(await readFile(CURRENT_SVG, 'utf-8'));

    const id = randomUUID();
    const scadMain = join(TEMP_DIR, `${id}.scad`);
    const scadBase = join(TEMP_DIR, `${id}-base.scad`);
    const scadRelief = join(TEMP_DIR, `${id}-relief.scad`);

    const filled = await fillTemplate(code);
    const RE_MAIN = /^svg_ornamento\s*\(\s*\)\s*;?\s*$/m;

    // "Agregar/Quitar base": si Base_Enable=false no se genera ni una base ni su STL/3MF.
    const baseEnabled = !/\bBase_Enable\s*=\s*false\b/.test(filled);

    await Promise.all([
      writeFile(scadMain, filled, 'utf-8'),
      writeFile(scadBase, filled.replace(RE_MAIN, 'base_3d();'), 'utf-8'),
      writeFile(scadRelief, filled.replace(RE_MAIN, 'relief_3d();'), 'utf-8'),
    ]);

    // STL con Manifold (rápido). 3MF con CGAL (sin Manifold) para conservar color.
    const backend = MANIFOLD_SUPPORTED ? '--backend=Manifold' : '';
    const jobs = [
      { scad: scadMain,    out: `${id}.stl`,         backend },
      ...(baseEnabled ? [{ scad: scadBase, out: `${id}-base.stl`, backend }] : []),
      { scad: scadRelief,  out: `${id}-relief.stl`,  backend },
      ...(baseEnabled ? [{ scad: scadBase, out: `${id}-base.3mf`, backend: '' }] : []),
      { scad: scadRelief,  out: `${id}-relief.3mf`,  backend: '' },
    ];

    await Promise.all(jobs.map(async (job) => {
      const outFile = join(TEMP_DIR, job.out);
      await execAsync(
        `"${OPENSCAD}" ${FEATURES} ${job.backend} -o "${outFile}" "${job.scad}"`,
        { timeout: 120000 }
      );
      if (!existsSync(outFile)) throw new Error(`Failed to generate ${job.out}`);
    }));

    // 3MF final en 2 colores: un objeto por parte con su color (Bambu/Orca).
    const mergeParts = [
      ...(baseEnabled ? [{ path: join(TEMP_DIR, `${id}-base.3mf`) }] : []),
      { path: join(TEMP_DIR, `${id}-relief.3mf`) },
    ];
    await merge3mfColor(mergeParts, join(TEMP_DIR, `${id}.3mf`));

    return c.json({
      stlUrl: `/download/${id}.stl`,
      stlName: `svg-ornamento-${id.slice(0, 8)}.stl`,
      baseStlUrl: baseEnabled ? `/download/${id}-base.stl` : null,
      baseStlName: baseEnabled ? `svg-ornamento-${id.slice(0, 8)}-base.stl` : null,
      reliefStlUrl: `/download/${id}-relief.stl`,
      reliefStlName: `svg-ornamento-${id.slice(0, 8)}-relief.stl`,
      model3mfUrl: `/download/${id}.3mf`,
      model3mfName: `svg-ornamento-${id.slice(0, 8)}.3mf`,
    });
  } catch (err) {
    return c.json({ error: err.message || '3D generation failed' }, 500);
  }
});

// Sustituye los tokens del half-extent por los valores actuales.
async function fillTemplate(code) {
  return code
    .replace(/__SVG_HALF_H__/g, String(meta.halfH))
    .replace(/__SVG_HALF_W__/g, String(meta.halfW))
    .replace(/__SVG_REPAIR__/g, meta.needRepair ? '1' : '0');
}

// ---------- utilidades 3MF ----------
async function extract3mfParts(filePath) {
  const buf = await readFile(filePath);
  const entries = unzipSync(new Uint8Array(buf));
  const modelKey = Object.keys(entries).find(k => k.toLowerCase().endsWith('3dmodel.model'));
  if (!modelKey) throw new Error('3MF sin modelo: ' + filePath);

  const xml = strFromU8(entries[modelKey]);
  const vBlock = xml.match(/<vertices>[\s\S]*?<\/vertices>/);
  const tBlock = xml.match(/<triangles>[\s\S]*?<\/triangles>/);
  if (!vBlock || !tBlock) throw new Error('Malla invalida en ' + filePath);

  const bases = [...xml.matchAll(/<base name="([^"]*)" displaycolor="#([0-9A-Fa-f]{6})[0-9A-Fa-f]{2}"/g)];
  const colored = bases.find(b => b[1] !== 'Default');
  const color = colored ? '#' + colored[2].toUpperCase() : '#CCCCCC';

  return { vertices: vBlock[0], triangles: tBlock[0], color, entries, modelKey };
}

function parseTriangles(tBlock) {
  const out = [];
  for (const m of tBlock.matchAll(/<triangle\b([^>]*)\/>/g)) {
    const attr = m[1];
    const get = (name) => {
      const r = attr.match(new RegExp(name + '="(\\d+)"'));
      return r ? parseInt(r[1], 10) : null;
    };
    const v1 = get('v1'), v2 = get('v2'), v3 = get('v3');
    if (v1 !== null && v2 !== null && v3 !== null) out.push([v1, v2, v3]);
  }
  return out;
}

function buildMergedXml(parts) {
  const colorToGroup = new Map();
  let groupId = 1;
  for (const p of parts) {
    if (!colorToGroup.has(p.color)) colorToGroup.set(p.color, groupId++);
  }
  const triXml = (tris) => tris
    .map(t => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '" />')
    .join('\n');
  const colorGroups = [...colorToGroup.entries()]
    .map(([color, gid]) =>
      '\t\t<m:colorgroup id="' + gid + '">\n' +
      '\t\t\t<m:color color="' + color + '" />\n' +
      '\t\t</m:colorgroup>')
    .join('\n');
  const objects = parts.map((p, idx) => {
    const pid = colorToGroup.get(p.color);
    return [
      '\t\t<object id="' + (idx + 1) + '" type="model" pid="' + pid + '">',
      '\t\t\t<mesh>',
      indentXml(p.vertices, '\t\t\t'),
      indentXml(triXml(parseTriangles(p.triangles)), '\t\t\t'),
      '\t\t\t</mesh>',
      '\t\t</object>',
    ].join('\n');
  }).join('\n');
  const items = parts.map((_, idx) => '\t\t<item objectid="' + (idx + 1) + '" />').join('\n');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US"',
    '\txmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"',
    '\txmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">',
    '\t<metadata name="Title">svg-ornamento</metadata>',
    '\t<resources>',
    colorGroups,
    objects,
    '\t</resources>',
    '\t<build>',
    items,
    '\t</build>',
    '</model>',
  ].join('\n');
}

function indentXml(block, pad) {
  return block.split('\n').map(line => (line.trim() ? pad + line.trim() : line)).join('\n');
}

async function merge3mfColor(parts, outPath) {
  const extracted = [];
  for (const part of parts) extracted.push(await extract3mfParts(part.path));
  const mergedXml = buildMergedXml(extracted);
  const base = extracted[0];
  const entries = {};
  for (const key of Object.keys(base.entries)) {
    entries[key] = key === base.modelKey ? strToU8(mergedXml) : base.entries[key];
  }
  await writeFile(outPath, Buffer.from(zipSync(entries)));
}

// ---------- descarga y limpieza ----------
app.get('/download/:file', async (c) => {
  const file = c.req.param('file');
  if (!file.match(/^[a-f0-9-]+(-(base|relief))?\.(stl|3mf)$/)) {
    return c.json({ error: 'Invalid file' }, 400);
  }
  const filePath = join(TEMP_DIR, file);
  if (!existsSync(filePath)) return c.json({ error: 'File not found' }, 404);

  const ext = extname(file).slice(1);
  const mimeMap = { stl: 'application/sla', '3mf': 'application/vnd.ms-package.3dmanufacturing-tuple' };
  const mime = mimeMap[ext] || 'application/octet-stream';

  const buffer = await readFile(filePath);
  c.header('Content-Type', mime);
  c.header('Content-Disposition', `attachment; filename="svg-ornamento.${ext}"`);
  c.header('Content-Length', buffer.length.toString());
  return c.newResponse(buffer);
});

async function cleanup(id) {
  const files = ['scad', 'svg', 'stl', '3mf'];
  for (const ext of files) {
    for (const suffix of ['', '-base', '-relief']) {
      try { await unlink(join(TEMP_DIR, `${id}${suffix}.${ext}`)); } catch { }
    }
  }
}

setInterval(() => {
  try {
    execSync(
      `forfiles /p "${TEMP_DIR}" /m *.stl /c "cmd /c del @path" /d -30 2>nul`,
      { shell: 'cmd', stdio: 'pipe', timeout: 5000 }
    );
  } catch { }
}, 1800000);

// ---------- arranque: garantizar un current.svg ----------
await loadMeta();
if (!existsSync(CURRENT_SVG) || meta.count === 0) {
  const r = collectGeometry(DEFAULT_SVG);
  meta = { halfW: r.halfW, halfH: r.halfH, count: r.count, name: 'flor (por defecto)' };
  await writeCurrentSvg(r.svg);
  await saveMeta();
  console.log('🌼 SVG por defecto (flor) normalizado: halfW=' +
    r.halfW.toFixed(2) + ' halfH=' + r.halfH.toFixed(2) + ' count=' + r.count);
}

const port = parseInt(process.env.PORT || '3100');
serve({ fetch: app.fetch, port });
console.log(`🚀 Servidor iniciado en http://localhost:${port}`);