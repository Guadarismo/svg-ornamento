// lib/svg.js — Normaliza un SVG aislado de transformaciones para OpenSCAD.
//
// Recibe el XML de un SVG y devuelve un SVG NORMALIZADO:
//   - Toda la geometría (path/circle/ellipse/rect/polygon/polyline/line) se
//     convierte en polilíneas ABSOLUTAS aplicando los transforms acumulados
//     (grupos + elemento: matrix/rotate/scale/skew/translate).
//   - Curvas (C/S/Q/T) y arcos (A/a) se aplanan en segmentos de línea.
//   - Los agujeros internos de cada elemento (ej. la "o" de un logo) se
//     conservan: cada elemento se emite como un solo <path> con la orientación
//     de sus contornos calculada por contención.
//   - El dibujo queda CENTRADO en el origen y ajustado a una caja de 100x100
//     unidades (su lado mayor mide 100).
//   - text/style/defs/image/… se ignoran (solo geometría rellena).
//
// Devuelve { svg, halfW, halfH, count } con las medias extents (unidades SVG
// normalizadas, entre 0 y 50) para que el template.openscad pueda posicionar
// funciones adicionales (agujero de llavero, etc.).

const TAU = Math.PI * 2;

// ---------- matrices afines [a,b,c,d,e,f] (fila = a b c d y = m*x) ----------
const IDENTITY = [1, 0, 0, 1, 0, 0];
// Multiplicación estándar de matrices afines [a,b,c,d,e,f] con
// x' = a*x + c*y + e, y' = b*x + d*y + f  (producto A*B: aplica B primero).
function matMul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function matApply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function matTranslate(tx, ty) { return [1, 0, 0, 1, tx, ty]; }
function matScale(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }
function matRotate(deg, cx, cy) {
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return [co, si, -si, co, cx - cx * co + cy * si, cy - cx * si - cy * co];
}
function matSkewX(deg) { const a = (deg * Math.PI) / 180; return [1, 0, Math.tan(a), 1, 0, 0]; }
function matSkewY(deg) { const a = (deg * Math.PI) / 180; return [1, Math.tan(a), 0, 1, 0, 0]; }

// ---------- parsear transform="..." ----------
const TR_RE = /[a-zA-Z]+|[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/g;
export function parseTransform(str) {
  if (!str) return IDENTITY;
  let m = IDENTITY;
  const toks = str.match(TR_RE);
  if (!toks) return m;
  let i = 0;
  while (i < toks.length) {
    const fn = toks[i++].toLowerCase();
    const nums = [];
    while (i < toks.length && /^[-+.]?[\d.eE+-]+$/.test(toks[i])) nums.push(parseFloat(toks[i++]));
    let t = IDENTITY;
    switch (fn) {
      case 'matrix':
        if (nums.length >= 6) t = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
        break;
      case 'translate':
        t = matTranslate(nums[0] || 0, nums.length > 1 ? nums[1] : 0);
        break;
      case 'scale':
        t = matScale(nums[0] || 0, nums.length > 1 ? nums[1] : nums[0]);
        break;
      case 'rotate':
        t = matRotate(nums[0] || 0, nums[1] || 0, nums[2] || 0);
        break;
      case 'skewx': t = matSkewX(nums[0] || 0); break;
      case 'skewy': t = matSkewY(nums[0] || 0); break;
      default: t = IDENTITY;
    }
    m = matMul(m, t);
  }
  return m;
}

// ---------- aplanado de curvas ----------
function flattenCubic(p0, c1, c2, p1, tol) {
  const pts = [p0];
  function sub(a, b, c, d, depth) {
    if (depth > 14) return;
    const dx = d[0] - a[0], dy = d[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const dist1 = Math.abs((c[0] - d[0]) * dy - (c[1] - d[1]) * dx) / len;
    const dist2 = Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len;
    if (Math.max(dist1, dist2) < tol) { pts.push(d); return; }
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const cd = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
    const abc = [(ab[0] + bc[0]) / 2, (ab[1] + bc[1]) / 2];
    const bcd = [(bc[0] + cd[0]) / 2, (bc[1] + cd[1]) / 2];
    const mid = [(abc[0] + bcd[0]) / 2, (abc[1] + bcd[1]) / 2];
    sub(a, ab, abc, mid, depth + 1);
    sub(mid, bcd, cd, d, depth + 1);
  }
  sub(p0, c1, c2, p1, 0);
  return pts;
}

function flattenQuad(p0, c, p1, tol) {
  const c1 = [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])];
  const c2 = [p1[0] + (2 / 3) * (c[0] - p1[0]), p1[1] + (2 / 3) * (c[1] - p1[1])];
  return flattenCubic(p0, c1, c2, p1, tol);
}

// ---------- arco SVG -> polilínea (endpoint->centro) ----------
function flattenArc(p0, rx, ry, phi, large, sweep, p1, tol) {
  const out = [p0];
  if (rx <= 0 || ry <= 0) { out.push(p1); return out; }
  if (p0[0] === p1[0] && p0[1] === p1[1]) return out;
  const cP = Math.cos(phi), sP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1p = cP * dx + sP * dy;
  const y1p = -sP * dx + cP * dy;
  let rx2 = rx * rx, ry2 = ry * ry;
  let lambda = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
  if (lambda > 1) {
    const s = Math.sqrt(lambda); rx *= s; ry *= s; rx2 = rx * rx; ry2 = ry * ry;
  }
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = cP * cxp - sP * cyp + (p0[0] + p1[0]) / 2;
  const cy = sP * cxp + cP * cyp + (p0[1] + p1[1]) / 2;
  const th1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let dth = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - th1;
  if (!sweep && dth > 0) dth -= TAU;
  else if (sweep && dth < 0) dth += TAU;
  const steps = Math.max(4, Math.min(256, Math.ceil(Math.abs(dth) / 0.1) + 1));
  for (let k = 1; k <= steps; k++) {
    const th = th1 + (k / steps) * dth;
    const px = cx + rx * Math.cos(th) * cP - ry * Math.sin(th) * sP;
    const py = cy + rx * Math.cos(th) * sP + ry * Math.sin(th) * cP;
    out.push([px, py]);
  }
  return out;
}

// ---------- tokenizador del atributo d ----------
function isLetter(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isDigit(c) { return c >= '0' && c <= '9'; }

function tokenizeD(d) {
  const out = [];
  let i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i];
    if (isLetter(c)) { out.push(c); i++; continue; }
    if (isSpace(c) || c === ',') { i++; continue; }
    let num = '';
    if (c === '-' || c === '+') { num += c; i++; }
    let ints = 0, dec = false;
    while (i < n && (isDigit(d[i]) || d[i] === '.')) {
      if (d[i] === '.') {
        if (dec) break;
        dec = true;
      } else ints++;
      num += d[i];
      i++;
    }
    if (i < n && (d[i] === 'e' || d[i] === 'E')) {
      let j = i + 1;
      if (j < n && (d[j] === '-' || d[j] === '+')) j++;
      let expDigits = 0;
      while (j < n && isDigit(d[j])) { j++; expDigits++; }
      if (expDigits > 0) { num += d.slice(i, j); i = j; }
    }
    if (ints === 0 && !dec) { out.push(NaN); }
    else out.push(parseFloat(num));
  }
  return out;
}

function parsePathD(d, tol = 0.05) {
  let toks = tokenizeD(d);
  // filtrar posibles NaN
  toks = toks.filter(t => !Number.isNaN(t));

  // Convertir tokens -> comandos con repetición implícita
  const cmds = [];
  let cur = null;
  const argInfo = (cmd) => {
    switch (cmd.toUpperCase()) {
      case 'M': case 'L': case 'T': return 2;
      case 'H': case 'V': return 1;
      case 'C': return 6;
      case 'S': case 'Q': return 4;
      case 'A': return 7;
      case 'Z': return 0;
      default: return 2;
    }
  };
  for (const tok of toks) {
    if (typeof tok === 'string') { cur = { c: tok, args: [] }; cmds.push(cur); continue; }
    cur.args.push(tok);
  }
  // dividir args en repeticiones
  const expanded = [];
  for (const cm of cmds) {
    const nArgs = argInfo(cm.c);
    if (nArgs === 0) { expanded.push({ c: cm.c.toUpperCase(), args: [] }); continue; }
    // M: primer par obligatorio, pares extra = L (relativo igual)
    if (cm.c.toUpperCase() === 'M') {
      if (!cm.args.length) continue;
      const rest = cm.args.slice(2);
      expanded.push({ c: cm.c, args: cm.args.slice(0, 2) });
      for (let k = 0; k + 1 < rest.length; k += 2) {
        expanded.push({ c: cm.c === 'm' ? 'l' : 'L', args: rest.slice(k, k + 2) });
      }
      continue;
    }
    for (let k = 0; k + nArgs <= cm.args.length; k += nArgs) {
      expanded.push({ c: cm.c, args: cm.args.slice(k, k + nArgs) });
    }
  }

  // Interpretar a subpaths (cada uno: array de [[x,y], ...] cerrado)
  const subpaths = [];
  let sub = null;
  let sx = 0, sy = 0, px = 0, py = 0, cpx = 0, cpy = 0, qpx = 0, qpy = 0;
  const abs = (x, y) => { px = x; py = y; return [x, y]; };
  const rel = (x, y) => { px += x; py += y; return [px, py]; };

  for (const cm of expanded) {
    const R = cm.c === cm.c.toLowerCase();
    const UC = cm.c.toUpperCase();
    const args = cm.args;
    const args0 = args[0], args1 = args[1], args2 = args[2], args3 = args[3], args4 = args[4], args5 = args[5], args6 = args[6];
    switch (UC) {
      case 'M': {
        if (sub) subpaths.push(sub);
        let pt = R ? rel(args0, args1) : abs(args0, args1);
        sx = pt[0]; sy = pt[1];
        sub = [pt];
        cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      case 'L': {
        const pt = R ? rel(args0, args1) : abs(args0, args1);
        sub.push(pt); cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      case 'H': {
        const pt = R ? [px + args0, py] : [args0, py]; px = pt[0]; py = pt[1];
        sub.push(pt); cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      case 'V': {
        const pt = R ? [px, py + args0] : [px, args0]; px = pt[0]; py = pt[1];
        sub.push(pt); cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      case 'Z': {
        if (sub) subpaths.push(sub);
        px = sx; py = sy;
        sub = null; cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      case 'C': {
        const p0 = sub[sub.length - 1];
        const c1 = R ? [px + args0, py + args1] : [args0, args1];
        const c2 = R ? [px + args2, py + args3] : [args2, args3];
        const p1 = R ? rel(args4, args5) : abs(args4, args5);
        const seg = flattenCubic(p0, c1, c2, p1, tol);
        sub.push(...seg.slice(1));
        cpx = c2[0]; cpy = c2[1]; qpx = 0; qpy = 0;
        break;
      }
      case 'S': {
        const p0 = sub[sub.length - 1];
        const c1 = (cpx !== 0 || cpy !== 0) ? [2 * p0[0] - cpx, 2 * p0[1] - cpy] : [p0[0], p0[1]];
        const c2 = R ? [px + args0, py + args1] : [args0, args1];
        const p1 = R ? rel(args2, args3) : abs(args2, args3);
        const seg = flattenCubic(p0, c1, c2, p1, tol);
        sub.push(...seg.slice(1));
        cpx = c2[0]; cpy = c2[1]; qpx = 0; qpy = 0;
        break;
      }
      case 'Q': {
        const p0 = sub[sub.length - 1];
        const c = R ? [px + args0, py + args1] : [args0, args1];
        const p1 = R ? rel(args2, args3) : abs(args2, args3);
        const seg = flattenQuad(p0, c, p1, tol);
        sub.push(...seg.slice(1));
        qpx = c[0]; qpy = c[1]; cpx = 0; cpy = 0;
        break;
      }
      case 'T': {
        const p0 = sub[sub.length - 1];
        const c = (qpx !== 0 || qpy !== 0) ? [2 * p0[0] - qpx, 2 * p0[1] - qpy] : [p0[0], p0[1]];
        const p1 = R ? rel(args0, args1) : abs(args0, args1);
        const seg = flattenQuad(p0, c, p1, tol);
        sub.push(...seg.slice(1));
        qpx = c[0]; qpy = c[1]; cpx = 0; cpy = 0;
        break;
      }
      case 'A': {
        const p0 = sub[sub.length - 1];
        const seg = flattenArc(p0, Math.abs(args0), Math.abs(args1), (args2 * Math.PI) / 180, !!args3, !!args4,
          R ? rel(args5, args6) : abs(args5, args6), tol);
        sub.push(...seg.slice(1));
        cpx = 0; cpy = 0; qpx = 0; qpy = 0;
        break;
      }
      default: break;
    }
  }
  if (sub) subpaths.push(sub);
  return subpaths;
}

// ---------- primitivas ----------
function ellipsePts(cx, cy, rx, ry, steps) {
  const pts = [];
  for (let k = 0; k < steps; k++) {
    const th = (k / steps) * TAU;
    pts.push([cx + rx * Math.cos(th), cy + ry * Math.sin(th)]);
  }
  return pts;
}
function roundRectPts(x, y, w, h, rx, ry) {
  rx = Math.min(Math.max(Math.abs(rx || 0), 0), Math.abs(w) / 2);
  ry = Math.min(Math.max(Math.abs(ry || 0), 0), Math.abs(h) / 2);
  if (rx === 0 || ry === 0) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  const pts = [];
  const arc = (pcx, pcy, s0, t0, s1, t1) => {
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const th = s0 + ((t0 - s0) * k) / steps;
      pts.push([pcx + rx * Math.cos(th), pcy + ry * Math.sin(th)]);
      void t1;
    }
  };
  arc(x + w - rx, y + ry, -Math.PI / 2, 0);
  arc(x + w - rx, y + h - ry, 0, Math.PI / 2);
  arc(x + rx, y + h - ry, Math.PI / 2, Math.PI);
  arc(x + rx, y + ry, Math.PI, Math.PI * 1.5);
  return pts;
}

// ---------- utilidades geométricas ----------
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function inside(pt, pts) {
  // ray casting hacia +x
  let insideFlag = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1])) {
      const xx = ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (pt[0] < xx) insideFlag = !insideFlag;
    }
  }
  return insideFlag;
}

// Cuenta cruces PROPIOS de una polilínea cerrada (el contorno mismo se cruza).
// OpenSCAD triangula el import de un contorno auto-intersecante generando
// triángulos de área cero que rompen la exportación 3MF ("Can't add triangle").
// Los simples "toques"/tangencias (cruce en el extremo de un segmento) y las
// superposiciones colineales NO rompen la exportación, así que se ignoran.
function countSelfIntersections(pts) {
  const n = pts.length;
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSeg = (a, b, p) => {
    const d = 1e-6;
    return p[0] >= Math.min(a[0], b[0]) - d && p[0] <= Math.max(a[0], b[0]) + d &&
      p[1] >= Math.min(a[1], b[1]) - d && p[1] <= Math.max(a[1], b[1]) + d &&
      Math.abs(orient(a, b, p)) < 1e-6;
  };
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      const c = pts[j], d2 = pts[(j + 1) % n];
      if (i === 0 && j === n - 1) continue; // mismo vértice (costura)
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const o1 = orient(a, b, c), o2 = orient(a, b, d2), o3 = orient(c, d2, a), o4 = orient(c, d2, b);
      if (o1 * o2 < 0 && o3 * o4 < 0) count++; // cruce propio en el interior de ambos
      else if (onSeg(a, b, c) || onSeg(a, b, d2) || onSeg(c, d2, a) || onSeg(c, d2, b)) {
        // algún extremo toca el otro segmento: no cuenta (no rompe el export)
      }
    }
  }
  return count;
}

// ---------- recorrido del documento ----------
const SHAPES = /^(path|circle|ellipse|rect|polygon|polyline|line)$/;

export function collectGeometry(svgXml, opts = {}) {
  let svgAttrs = {};
  const tolerance = opts.tolerance ?? 0.05;

  // Hint de tamaño para una tolerancia RELATIVA decente (convertir "200px" -> 200)
  // (se reasigna después de escanear, cuando conocemos los atributos del <svg>).

  // Escáner XML liviano: construye una lista plana de (tag, attrs, depth,
  // es-apertura). Matriz acumulada calculada con una pila.
  const events = [];
  let i = 0;
  const n = svgXml.length;
  while (i < n) {
    const lt = svgXml.indexOf('<', i);
    if (lt < 0) break;
    i = lt + 1;
    if (svgXml.startsWith('<!--', lt)) {
      const e = svgXml.indexOf('-->', i);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const tagEnd = svgXml.indexOf('>', i);
    if (tagEnd < 0) break;
    let content = svgXml.slice(i, tagEnd);
    i = tagEnd + 1;
    if (content.startsWith('!') || content.startsWith('?')) continue;  // DOCTYPE / procesamiento
    if (content[0] === '/') {
      const name = content.slice(1).trim();
      events.push({ open: false, name });
      continue;
    }
    const selfClose = content.endsWith('/');
    if (selfClose) content = content.slice(0, -1);
    const sp = content.search(/[\s/>]/);
    const name = content.slice(0, sp < 0 ? content.length : sp).toLowerCase();
    const attrs = {};
    const ar = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = ar.exec(content)) !== null) attrs[m[1].toLowerCase()] = (m[3] ?? m[4]).trim();
    events.push({ open: true, name, attrs, selfClose });
  }

  // Construir árbol (ignorando defs/text/script/style).
  const root = { name: 'svg', attrs: {}, children: [] };
  const stack = [root];
  let skipping = 0;
  const SKIP = new Set(['defs', 'text', 'style', 'script', 'clipPath', 'mask', 'pattern', 'image', 'foreignObject', 'linearGradient', 'radialGradient', 'filter', 'symbol', 'metadata', 'title', 'desc', 'use', 'marker', 'switch']);
  for (const ev of events) {
    if (skipping > 0) {
      if (ev.open && !ev.selfClose) skipping++;
      if (!ev.open) skipping--;
      continue;
    }
    if (ev.open && SKIP.has(ev.name)) {
      if (!ev.selfClose) skipping++;
      continue;
    }
    if (!ev.open) {
      stack.pop();
      continue;
    }
    const node = { name: ev.name, attrs: ev.attrs, children: [] };
    if (ev.name === 'svg' && !svgAttrs.width && !svgAttrs.viewBox) svgAttrs = ev.attrs;
    if (ev.name === 'svg' || ev.name === 'g' || ev.name === 'a' || SHAPES.test(ev.name)) {
      stack[stack.length - 1].children.push(node);
    }
    if (ev.name === 'g' || ev.name === 'a' || ev.name === 'svg') {
      if (!ev.selfClose) stack.push(node);
    }
  }

  // Tolerancia relativa: ~0.05% del lado mayor del lienzo (con piso en 0.05).
  const dimHint = (v) => { const m = /^([-\d.]+)/.exec(String(v).trim()); return m ? parseFloat(m[1]) : 0; };
  const vb = (svgAttrs.viewBox || '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const hint = Math.max(dimHint(svgAttrs.width), dimHint(svgAttrs.height), ...vb, 1);
  const tol = Math.max(tolerance, hint * 0.0005);

  // Recorrer y extraer contornos con la matriz acumulada.
  const elements = []; // { contours: [[ [x,y], ... ], ...] }  (coordenadas origen)
  function walk(node, parentMtx) {
    const mtx = matMul(parentMtx, node.attrs.transform ? parseTransform(node.attrs.transform) : IDENTITY);
    if (node.name === 'g' || node.name === 'a' || node.name === 'svg') {
      for (const ch of node.children) walk(ch, mtx);
      return;
    }
    // Elemento de dibujo: aplica su propia transformación y extrae los contornos.
    const fill = (node.attrs.fill || '').toLowerCase();
    if (fill === 'none' || (node.attrs.display || '').toLowerCase() === 'none') return;
    const contours = [];
    const push = (raw) => {
      const mapped = raw.map(p => matApply(mtx, p[0], p[1])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (mapped.length >= 3) contours.push(mapped);
    };
    switch (node.name) {
      case 'path': {
        const d = node.attrs.d;
        if (!d) break;
        let subs;
        try { subs = parsePathD(d, tol); } catch (e) { break; }
        for (const s of subs) {
          if (s.length >= 3 && (s[0][0] !== s[s.length - 1][0] || s[0][1] !== s[s.length - 1][1])) s.push([s[0][0], s[0][1]]);
          push(s);
        }
        break;
      }
      case 'circle': {
        const r = parseFloat(node.attrs.r) || 0;
        if (r <= 0) break;
        push(ellipsePts(parseFloat(node.attrs.cx) || 0, parseFloat(node.attrs.cy) || 0, r, r, 96));
        break;
      }
      case 'ellipse': {
        const rx = parseFloat(node.attrs.rx) || 0, ry = parseFloat(node.attrs.ry) || 0;
        if (rx <= 0 || ry <= 0) break;
        push(ellipsePts(parseFloat(node.attrs.cx) || 0, parseFloat(node.attrs.cy) || 0, rx, ry, 96));
        break;
      }
      case 'rect': {
        const x = parseFloat(node.attrs.x) || 0, y = parseFloat(node.attrs.y) || 0;
        const w = parseFloat(node.attrs.width) || 0, h = parseFloat(node.attrs.height) || 0;
        if (!w || !h) break;
        push(roundRectPts(x, y, w, h, parseFloat(node.attrs.rx), parseFloat(node.attrs.ry)));
        break;
      }
      case 'polygon':
      case 'polyline': {
        const nums = (node.attrs.points || '').split(/[\s,]+/).filter(Boolean).map(Number);
        const raw = [];
        for (let k = 0; k + 1 < nums.length; k += 2) raw.push([nums[k], nums[k + 1]]);
        if (raw.length >= 3) {
          if (raw[0][0] !== raw[raw.length - 1][0] || raw[0][1] !== raw[raw.length - 1][1]) raw.push([raw[0][0], raw[0][1]]);
          push(raw);
        }
        break;
      }
      default: break;
    }
    if (contours.length) elements.push({ contours });
  }
  for (const ch of root.children) walk(ch, IDENTITY);

  if (elements.length === 0) return { svg: null, halfW: 50, halfH: 50, count: 0 };

  // Bbox total
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) for (const c of el.contours) for (const p of c) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const bw = Math.max(maxX - minX, 1e-6), bh = Math.max(maxY - minY, 1e-6);
  const s = 100 / Math.max(bw, bh); // -> el lado mayor mide 100
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const halfW = Math.max((bw * s) / 2, 0.5), halfH = Math.max((bh * s) / 2, 0.5);

  // Orientar correctamente los agujeros. Se asume orden de raster (nested):
  // contornos más externos = relleno, los contenidos por un número impar de
  // otros = agujeros. La dirección exacta se decidió empíricamente (ver tests):
  //   outer => área POSITIVA en coords svg (y abajo, horario en pantalla)
  //   hole  => área NEGATIVA
  // IMPORTANTE: el lienzo se emite con coordenadas 0..100 (positivas, centered
  // en 50/50). OpenSCAD importa fielmente coordenadas positivas (1px = 0.3528 mm);
  // con viewBox negativas (-50..50) su import sufre un desplazamiento en Y.
  const toN = (p) => [(p[0] - cx) * s + 50, (p[1] - cy) * s + 50];
  const selfX = (c) => countSelfIntersections(c.map(toN));
  let needRepair = false;
  const parts = [];
  let cnt = 0;
  for (const el of elements) {
    const norm = el.contours.map(c => ({ pts: c.map(toN), absArea: Math.abs(signedArea(c)) }));
    norm.sort((a, b) => b.absArea - a.absArea);
    // depth = cuántos contornos con mayor área lo contienen (raycast del vértice 0)
    const depthOf = (idx) => {
      const pt = norm[idx].pts[0];
      let d = 0;
      for (let j = 0; j < norm.length; j++) {
        if (j === idx) continue;
        if (norm[j].absArea <= norm[idx].absArea) continue;
        if (inside(pt, norm[j].pts)) d++;
      }
      return d;
    };
    const depth = norm.map((_, k) => depthOf(k));
    const subD = [];
    for (let k = 0; k < norm.length; k++) {
      const isHole = depth[k] % 2 === 1;
      let pts = norm[k].pts;
      const area = signedArea(pts);
      if ((isHole && area > 0) || (!isHole && area < 0)) pts = [...pts].reverse();
      subD.push(pts);
      cnt++;
    }
    const dAttr = subD.map(c => c.map((p, k) => `${k === 0 ? 'M' : 'L'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('') + 'z').join('');
    parts.push(`  <path d="${dAttr}" fill="#000" stroke="none" fill-rule="evenodd"/>`);
    if (!needRepair) needRepair = el.contours.some(c => selfX(c) > 0);
  }

  // OpenSCAD importa SVG asumiendo 1 px = 0.35278 mm (72 dpi, 25.4/72).
  // Si el lienzo midiera 100 px ("width=100"), el canvas imprimiría 35.28 mm.
  // Para que el canvas valga EXACTAMENTE 100 mm (y _fw = Design_Size/100 sea
  // exacto), declaramos width/height = 100 / 0.35278 = 283.4645669 px.
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="283.4645669" height="283.4645669">\n' +
    parts.join('\n') + '\n</svg>\n';

  return { svg, halfW, halfH, count: cnt, needRepair };
}