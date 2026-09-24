import fs from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = 'http://localhost:3100';
const O = 'C:/Users/user/AppData/Local/Temp/opencode/e2e';
fs.mkdirSync(O, { recursive: true });

function stlBbox(buf) {
  const text = Buffer.from(buf).toString('latin1');
  const vr = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m, bx = [Infinity, Infinity, Infinity], xx = [-Infinity, -Infinity, -Infinity];
  while ((m = vr.exec(text))) for (let k = 0; k < 3; k++) {
    const v = parseFloat(m[k + 1]);
    if (v < bx[k]) bx[k] = v; if (v > xx[k]) xx[k] = v;
  }
  return { bx, xx };
}
function download(url) { return fetch(`${BASE}${url}`).then(r => r.arrayBuffer()); }
async function upload(xml, name) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'image/svg+xml' }), name);
  return (await fetch(`${BASE}/upload`, { method: 'POST', body: fd })).json();
}
async function generate() {
  const tpl = await (await fetch(`${BASE}/template.scad`)).text();
  const res = await (await fetch(`${BASE}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: tpl }),
  })).json();
  if (res.error) throw new Error(res.error);
  return res;
}
async function modelCounts(url) {
  const buf = new Uint8Array(await download(url));
  const entries = unzipSync(buf);
  const key = Object.keys(entries).find(k => k.toLowerCase().endsWith('3dmodel.model'));
  const xml = strFromU8(entries[key]);
  const objects = (xml.match(/<object\b/g) || []).length;
  const groups = [...xml.matchAll(/<m:color color="([^"]+)"\s*\/>/g)].map(m => m[1]);
  return { objects, groups };
}

// ---------- 1) flujo normal sin auto-intersecciones ----------
const deco = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <g transform="translate(150,150)">
    <g transform="scale(0.9)">
      <path fill="#000" d="M0,-95 a95,95 0 1 1 0.01,0 Z M0,-60 a60,60 0 1 1 -0.01,0 Z"/>
      <rect x="-40" y="-40" width="80" height="80" transform="rotate(22.5)" fill="#000"/>
      <ellipse cx="0" cy="-120" rx="28" ry="48" transform="rotate(45)" fill="#000"/>
      <ellipse cx="0" cy="120" rx="28" ry="48" transform="rotate(45)" fill="#000"/>
    </g>
  </g>
</svg>`;

const up = await upload(deco, 'deco.svg');
console.log('upload:', up.ok, 'halfW', up.halfW.toFixed(2), 'halfH', up.halfH.toFixed(2), 'count', up.count, 'repair', up.needRepair);
if (!up.ok || up.needRepair) { console.log('E2E FAIL (flags de upload inesperados)'); process.exit(1); }

const fw = 60 / 100;
const expX = +(up.halfW * fw + 4).toFixed(2), expY = +(up.halfH * fw + 4).toFixed(2);

let res = await generate();
let full = stlBbox(await download(res.stlUrl));
let base = stlBbox(await download(res.baseStlUrl));
let relief = stlBbox(await download(res.reliefStlUrl));
const raisedFullZ = full.xx[2];
console.log('raised (flip): base bbox x ±' + expX + ' (actual ' + base.bx[0].toFixed(2) + '..' + base.xx[0].toFixed(2) + '), y ±' + expY
  + ' (actual ' + base.bx[1].toFixed(2) + '..' + base.xx[1].toFixed(2) + '), z 0..1.6 | full z 0..' + full.xx[2].toFixed(1)
  + ' | simétrico: ' + (Math.abs(base.bx[0] + base.xx[0]) < 0.01 && Math.abs(base.bx[1] + base.xx[1]) < 0.01));

// inlay
const tplInlay = (await (await fetch(`${BASE}/template.scad`)).text()).replace('"raised"', '"inlay"');
res = await (await fetch(`${BASE}/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: tplInlay }),
})).json();
full = stlBbox(await download(res.stlUrl));
relief = stlBbox(await download(res.reliefStlUrl));
console.log('inlay: full z 0..' + full.xx[2].toFixed(2) + ', relief z ' + relief.bx[2].toFixed(2) + '..' + relief.xx[2].toFixed(2) + ' (esperado 0.30..1.60)');

const m = await modelCounts(res.model3mfUrl);
console.log('3MF merge (deco): objetos=' + m.objects + ' colores=' + JSON.stringify(m.groups));

const checks1 = {
  sym: Math.abs(base.bx[0] + base.xx[0]) < 0.01 && Math.abs(base.bx[1] + base.xx[1]) < 0.01,
  bx: [Math.abs(base.bx[0] + expX) < 0.1, Math.abs(base.xx[0] - expX) < 0.1],
  by: [Math.abs(base.bx[1] + expY) < 0.02, Math.abs(base.xx[1] - expY) < 0.02],
  raisedFullZ: Math.abs(raisedFullZ - 3.6) < 0.01,
  inlayFullZ: Math.abs(full.bx[2]) < 0.01 && Math.abs(full.xx[2] - 1.6) < 0.01,
  reliefInlay: Math.abs(relief.bx[2] - 0.3) < 0.01 && Math.abs(relief.xx[2] - 1.6) < 0.01,
  objects: m.objects === 2,
  colors: m.groups.length === 2 && m.groups.includes('#1A1A1A') && m.groups.includes('#F4A0B0'),
};
console.log('checks1:', JSON.stringify(checks1, null, 1));

// ---------- 2) regresión: SVG con contorno auto-intersecante ----------
// Path 1 de "Asset 91.svg" (cruce propio) + una "o" con agujero para verificar
// que la reparación convive con los huecos.
const selfCross = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <g transform="translate(200,200) scale(2.6)">
    <path fill="#000" d="M28.1085,87.9234 c2.1381-.621,4.2751-1.2807,6.4391-1.8348 a2.3333,2.3333 0 0 1 1.3492.3683 29.5074,29.5074 0 0 0 21.1438,2.0474 c.2757-.0751.5481-.1641.8175-.2594 1.4756.0861 2.8347.2063 4.1959.2378 6.4108.1484 12.4694-1.0574 17.8162-4.82 c-.6809-.4792-1.0951-.1685-1.6354.1425 A15.52,15.52 0 0 1 16.29,81.2079 c-.3989-.3927-.7431-.8409-1.1847-1.3457 a15.0347,15.0347 0 0 1 8.9161-3.8981 16.6234,16.6234 0 0 1 11.4949,9.5936 30,30 0 0 0 1.35 1.5 c2.4333,2.3169 5.6855,3.1878 8.89,3.9275 a46.9167,46.9167 0 0 0 17.9383.8981 c3.0371-.4811 5.9687-1.9488 8.8058-3.2748 2.5053-1.1709 4.8132-2.7643 7.32-4.2368 L83.515,80.685 C70.7385,95.3389 45.9681,99.574 28.1085,87.9234 Z"/>
    <path fill-rule="evenodd" d="M -20,-20 A 8,8 0 1 1 -20.01,-20 Z M -20,-7 A 4,4 0 1 1 -19.99,-7 Z" transform="translate(30,-10)"/>
  </g>
</svg>`;

const up2 = await upload(selfCross, 'selfcross.svg');
console.log('\nupload (auto-intersecante):', up2.ok, 'count', up2.count, 'repair =', up2.needRepair, '(esperado true)');
if (!up2.ok || !up2.needRepair) { console.log('E2E FAIL (needRepair no detectado)'); process.exit(1); }

res = await generate(); // raised por defecto
const m2 = await modelCounts(res.model3mfUrl);
const full2 = stlBbox(await download(res.stlUrl));
const base2 = stlBbox(await download(res.baseStlUrl));
fs.writeFileSync(O + '/regresion.3mf', Buffer.from(await download(res.model3mfUrl)));
console.log('generate (reparado): ok, merged 3MF objetos=' + m2.objects + ' colores=' + JSON.stringify(m2.groups)
  + ' | base z 0..' + base2.xx[2].toFixed(1) + ', full z 0..' + full2.xx[2].toFixed(1));
const checks2 = {
  objects: m2.objects === 2,
  colors: m2.groups.length === 2 && m2.groups.includes('#1A1A1A') && m2.groups.includes('#F4A0B0'),
  fullSolid: Math.abs(full2.bx[2]) < 0.01 && Math.abs(full2.xx[2] - 3.6) < 0.01,
};
console.log('checks2:', JSON.stringify(checks2, null, 1));

const pass = Object.values(checks1).every(Boolean) && Object.values(checks2).every(Boolean);
console.log('\nE2E:', pass ? 'PASS ✓' : 'FAIL ✗');

// ---------- 3) regresión: "agregar/quitar base" (sin placa) ----------
if (pass) {
  const up3 = await upload(deco, 'deco.svg');
  const tpl3 = (await (await fetch(`${BASE}/template.scad`)).text()).replace('Base_Enable     = true', 'Base_Enable     = false');
  res = await (await fetch(`${BASE}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: tpl3 }),
  })).json();
  if (res.error) { console.log('\nbase-off FAIL:', res.error); process.exit(1); }
  const full3 = stlBbox(await download(res.stlUrl));
  const m3 = await modelCounts(res.model3mfUrl);
  console.log('\nbase-off: baseStlUrl=' + res.baseStlUrl + ' | merged objetos=' + m3.objects + ' colores=' + JSON.stringify(m3.groups)
    + ' | full z 0..' + full3.xx[2].toFixed(2));
  const ok3 = res.baseStlUrl === null
    && m3.objects === 1 && m3.groups.length === 1 && m3.groups.includes('#F4A0B0')
    && Math.abs(full3.bx[2]) < 0.01 && Math.abs(full3.xx[2] - 2.0) < 0.01;
  console.log('base-off:', ok3 ? 'PASS ✓' : 'FAIL ✗');
}