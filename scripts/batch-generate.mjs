// scripts/batch-generate.mjs — Genera STL y 3MF para cada SVG de una carpeta.
//
// Uso:
//   node scripts/batch-generate.mjs <carpeta-con-svgs> [carpeta-salida]
//   PORT=3100 node scripts/batch-generate.mjs .\svgs .\salida
//
// Por cada *.svg de la carpeta: /upload -> /generate (parámetros por defecto)
// y descarga el STL completo y el 3MF de 2 colores.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.PORT || '3100'}`;

const inDir = process.argv[2];
if (!inDir) {
  console.error('Uso: node scripts/batch-generate.mjs <carpeta-con-svgs> [carpeta-salida]');
  process.exit(1);
}
const outDir = process.argv[3] || path.join(process.cwd(), 'batch-out');
fs.mkdirSync(outDir, { recursive: true });

async function uploadTempFromCode() {
  // template con los half-extents ya rellenos (el server los sustituye igualmente)
  const tpl = await (await fetch(`${BASE}/template.scad`)).text();
  return tpl;
}

const svgs = fs.readdirSync(inDir).filter(f => /\.svg$/i.test(f));
if (!svgs.length) {
  console.error('No hay .svg en ' + inDir);
  process.exit(1);
}
console.log(`Procesando ${svgs.length} SVGs -> ${outDir}`);

let ok = 0, fail = 0;
for (const name of svgs) {
  const file = path.join(inDir, name);
  const baseName = path.basename(name, '.svg');
  try {
    const xml = fs.readFileSync(file, 'utf-8');
    const fd = new FormData();
    fd.append('file', new Blob([xml], { type: 'image/svg+xml' }), name);

    const up = await (await fetch(`${BASE}/upload`, { method: 'POST', body: fd })).json();
    if (up.error) throw new Error('upload: ' + up.error);

    const code = await uploadTempFromCode();
    const genRes = await fetch(`${BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const gen = await genRes.json();
    if (gen.error) throw new Error('generate: ' + gen.error);

    const stl = await (await fetch(`${BASE}${gen.stlUrl}`)).arrayBuffer();
    const m3mf = await (await fetch(`${BASE}${gen.model3mfUrl}`)).arrayBuffer();
    fs.writeFileSync(path.join(outDir, baseName + '.stl'), Buffer.from(stl));
    fs.writeFileSync(path.join(outDir, baseName + '.3mf'), Buffer.from(m3mf));

    console.log(`  ✓ ${name.padEnd(22)} ${up.count} contornos  STL ${stl.byteLength} B  3MF ${m3mf.byteLength} B`);
    ok++;
  } catch (e) {
    console.log(`  ✗ ${name.padEnd(22)} ${e.message}`);
    fail++;
  }
}
console.log(`\nTerminado: ${ok} OK, ${fail} errores. Salida en ${outDir}`);