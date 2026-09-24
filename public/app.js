import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const TEMPLATE_URL = '/template.scad';
const STORAGE_KEY = 'svg-ornamento-code-v2';

function saveCodeToStorage(code) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { }
}
function loadCodeFromStorage() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function clearCodeFromStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { }
}

let editor;
let currentStlUrl = null;
let currentStlName = null;
let current3mfUrl = null;
let current3mfName = null;
let threeScene = null;
let threeRenderer = null;

const PARAM_DEFS = [
  { key: 'Design_Size', label: 'Tamaño dibujo (mm)', type: 'range', min: 10, max: 200, step: 1, default: 60 },
  { key: 'Flip_Vertical', label: 'Espejo vertical (imprime al derecho)', type: 'bool', default: true },
  {
    key: 'Relief_Mode', label: 'Modo relieve', type: 'select', default: 'raised',
    options: [
      { value: 'raised', label: 'Relieve (sobre la placa)' },
      { value: 'inlay', label: 'Inlay (a ras de la placa)' },
    ],
  },
  { key: 'Base_Enable', label: 'Agregar o quitar base', type: 'bool', default: true },
  { key: 'Base_Thickness', label: 'Grosor placa (mm)', type: 'range', min: 0.6, max: 8, step: 0.1, default: 1.6 },
  { key: 'Base_Border', label: 'Margen de placa (mm)', type: 'range', min: 0, max: 15, step: 0.5, default: 4.0 },
  { key: 'Relief_Thickness', label: 'Grosor relieve (mm)', type: 'range', min: 0.5, max: 8, step: 0.1, default: 2.0 },
  { key: 'Keychain_Hole', label: 'Agujero para llavero', type: 'bool', default: false },
  { key: 'Keychain_Diameter', label: 'Diám. agujero (mm)', type: 'range', min: 1.5, max: 8, step: 0.1, default: 4.0 },
  { key: 'Keychain_Edge_Gap', label: 'Dist. al borde (mm)', type: 'range', min: 0, max: 10, step: 0.5, default: 2.5 },
  { key: 'Color_Base', label: 'Color placa', type: 'color', default: '#1a1a1a' },
  { key: 'Color_Relief', label: 'Color relieve', type: 'color', default: '#F4A0B0' },
];

async function loadTemplate() {
  const res = await fetch(TEMPLATE_URL);
  return await res.text();
}

async function loadMeta() {
  const res = await fetch('/meta');
  if (!res.ok) return { name: '', halfW: 50, halfH: 50, count: 0 };
  return await res.json();
}

function initCodeMirror(code) {
  const container = document.getElementById('editorContainer');
  editor = CodeMirror(container, {
    value: code,
    mode: 'javascript',
    theme: 'material',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    extraKeys: { 'Ctrl-S': () => {} },
  });

  let saveTimer = null;
  editor.on('change', () => {
    extractParamsFromCode(editor.getValue());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCodeToStorage(editor.getValue()), 300);
  });
}

function extractParamsFromCode(code) {
  for (const def of PARAM_DEFS) {
    if (def.type === 'text' || def.type === 'select' || def.type === 'color') {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*"([^"]*)"`));
      if (m) {
        const el = document.getElementById(`param-${def.key}`);
        if (el && el.value !== m[1]) el.value = m[1];
      }
    } else if (def.type === 'bool') {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*(true|false)`));
      if (m) {
        const el = document.getElementById(`param-${def.key}`);
        if (el && el.checked !== (m[1] === 'true')) el.checked = m[1] === 'true';
      }
    } else {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*([^;\\/\\n]+)`));
      if (m) {
        const val = parseFloat(m[1].trim());
        if (!isNaN(val)) {
          const el = document.getElementById(`param-${def.key}`);
          if (el && parseFloat(el.value) !== val) el.value = val;
        }
      }
    }
  }
}

function buildParamValue(def, el) {
  if (def.type === 'text' || def.type === 'select' || def.type === 'color') return `"${el.value}"`;
  if (def.type === 'bool') return el.checked ? 'true' : 'false';
  return el.value;
}

function updateCodeFromParams() {
  let code = editor.getValue();
  for (const def of PARAM_DEFS) {
    const el = document.getElementById(`param-${def.key}`);
    if (!el) continue;
    const newVal = buildParamValue(def, el);
    if (def.type === 'text' || def.type === 'select' || def.type === 'color') {
      const regex = new RegExp(`(\\b${def.key}\\s*=\\s*)"[^"]*"`);
      code = code.replace(regex, `$1${newVal}`);
    } else if (def.type === 'bool') {
      const regex = new RegExp(`(\\b${def.key}\\s*=\\s*)(true|false)`);
      code = code.replace(regex, `$1${newVal}`);
    } else {
      const regex = new RegExp(`(\\b${def.key}\\s*=\\s*)[^;\\/\\n]+`);
      code = code.replace(regex, `$1${newVal}`);
    }
  }
  const cursor = editor.getCursor();
  editor.setValue(code);
  editor.setCursor(cursor);
}

function createParamFields(code) {
  const grid = document.getElementById('paramsGrid');
  grid.innerHTML = '';

  for (const def of PARAM_DEFS) {
    const group = document.createElement('div');
    group.className = 'param-group';

    const label = document.createElement('label');
    label.htmlFor = `param-${def.key}`;
    label.textContent = def.label;

    const input = document.createElement(def.type === 'select' ? 'select' : 'input');
    input.id = `param-${def.key}`;

    if (def.type === 'select') {
      for (const opt of def.options) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        input.appendChild(option);
      }
    } else {
      input.type = def.type === 'range' ? 'number' : (def.type === 'bool' ? 'checkbox' : def.type);
      if (def.type === 'range') {
        input.min = def.min;
        input.max = def.max;
        input.step = def.step;
      }
    }

    let val = def.default;
    if (def.type === 'select' || def.type === 'color') {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*"([^"]*)"`));
      if (m) val = m[1];
    } else if (def.type === 'bool') {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*(true|false)`));
      if (m) val = m[1] === 'true';
    } else {
      const m = code.match(new RegExp(`\\b${def.key}\\s*=\\s*([^;\\/\\n]+)`));
      if (m) { const n = parseFloat(m[1].trim()); if (!isNaN(n)) val = n; }
    }
    if (def.type === 'bool') {
      input.checked = val;
    } else {
      input.value = val;
    }

    input.addEventListener('input', () => updateCodeFromParams());

    group.appendChild(label);
    group.appendChild(input);
    grid.appendChild(group);
  }
}

async function fetchPreview(code) {
  const res = await fetch('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al generar preview');
  return data.svg;
}

async function fetchGenerate(code) {
  const res = await fetch('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al generar 3D');
  return data;
}

async function uploadSvg(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al subir el SVG');
  return data;
}

function showSVG(svgContent) {
  const container = document.getElementById('svgContainer');
  container.innerHTML = svgContent;
  const svgEl = container.querySelector('svg');
  if (svgEl) {
    svgEl.style.maxWidth = '100%';
    svgEl.style.maxHeight = '100%';
    svgEl.style.background = 'white';
    svgEl.style.borderRadius = '4px';
  }
}

function initThreeViewer() {
  const container = document.getElementById('viewer3dContainer');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d2e);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 1000);
  camera.position.set(30, 20, 40);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;

  const ambientLight = new THREE.AmbientLight(0x404060);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0x8888ff, 0.5);
  dirLight2.position.set(-10, -5, -10);
  scene.add(dirLight2);

  const gridHelper = new THREE.GridHelper(40, 20, 0x444488, 0x333366);
  scene.add(gridHelper);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);

  threeScene = scene;
  threeRenderer = renderer;
  return { scene, renderer, controls };
}

async function loadModelIntoViewer({ baseUrl, reliefUrl, baseColor, reliefColor }) {
  const container = document.getElementById('viewer3dContainer');
  container.innerHTML = '';

  const { scene, controls } = initThreeViewer();

  try {
    const loader = new STLLoader();
    const [baseGeom, reliefGeom] = await Promise.all([
      baseUrl ? loader.loadAsync(baseUrl) : Promise.resolve(null),
      loader.loadAsync(reliefUrl),
    ]);

    if (reliefGeom) reliefGeom.computeVertexNormals();

    const reliefMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(reliefColor || '#f4a0b0'),
      specular: 0x333344,
      shininess: 40,
    });
    const reliefMesh = new THREE.Mesh(reliefGeom, reliefMat);

    const group = new THREE.Group();
    group.add(reliefMesh);

    if (baseGeom) {
      baseGeom.computeVertexNormals();
      const baseMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(baseColor || '#1a1a1a'),
        specular: 0x333344,
        shininess: 40,
      });
      const baseMesh = new THREE.Mesh(baseGeom, baseMat);
      group.add(baseMesh);
    }

    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    reliefMesh.position.sub(center);
    if (baseGeom) group.children.find(c => c !== reliefMesh)?.position.sub(center);

    controls.autoRotate = true;
  } catch (err) {
    console.error('Error loading model:', err);
    container.innerHTML = '<div class="placeholder">Error al cargar el modelo 3D</div>';
  }
}

function setStatus(msg, type = '') {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = 'status-bar' + (type ? ' ' + type : '');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
}

async function refreshUploadInfo() {
  const m = await loadMeta();
  const el = document.getElementById('uploadCurrent');
  el.textContent = m.name
    ? `${m.name} · ${m.count} contornos`
    : 'Sin dibujo todavía (usa el SVG por defecto)';
}

async function handlePreview() {
  const code = editor.getValue();
  setStatus('Generando vista previa...', 'loading');
  try {
    const svg = await fetchPreview(code);
    showSVG(svg);
    showTab('svg');
    setStatus('Vista previa generada', 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
}

async function handleGenerate() {
  const code = editor.getValue();
  setStatus('Generando modelo 3D (tarda unos segundos)...', 'loading');
  try {
    const data = await fetchGenerate(code);
    currentStlUrl = data.stlUrl;
    currentStlName = data.stlName;
    current3mfUrl = data.model3mfUrl;
    current3mfName = data.model3mfName;

    document.getElementById('downloadGroup').style.display = 'flex';

    const baseColor = document.getElementById('param-Color_Base')?.value || '#1a1a1a';
    const reliefColor = document.getElementById('param-Color_Relief')?.value || '#f4a0b0';
    loadModelIntoViewer({
      baseUrl: data.baseStlUrl,
      reliefUrl: data.reliefStlUrl,
      baseColor,
      reliefColor,
    });
    showTab('3d');

    setStatus('Modelo 3D generado ✓', 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
}

async function handleUploadFile(file) {
  if (!file) return;
  if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
    setStatus('El archivo debe ser un SVG', 'error');
    return;
  }
  setStatus('Procesando SVG...', 'loading');
  try {
    await uploadSvg(file);
    await refreshUploadInfo();
    setStatus('SVG subido y normalizado ✓ Generando vista previa...', 'success');
    await handlePreview();
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
}

function setupUploadUI() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  fileInput.addEventListener('change', () => handleUploadFile(fileInput.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleUploadFile(e.dataTransfer.files[0]);
  });
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function main() {
  let code = await loadTemplate();
  const saved = loadCodeFromStorage();
  if (saved) code = saved;

  createParamFields(code);
  initCodeMirror(code);
  setupUploadUI();
  await refreshUploadInfo();

  document.getElementById('previewBtn').addEventListener('click', handlePreview);
  document.getElementById('generateBtn').addEventListener('click', handleGenerate);

  document.getElementById('downloadStlBtn').addEventListener('click', () => {
    if (currentStlUrl) downloadFile(currentStlUrl, currentStlName || 'svg-ornamento.stl');
  });
  document.getElementById('download3mfBtn').addEventListener('click', () => {
    if (current3mfUrl) downloadFile(current3mfUrl, current3mfName || 'svg-ornamento.3mf');
  });

  document.getElementById('resetCodeBtn').addEventListener('click', async () => {
    code = await loadTemplate();
    editor.setValue(code);
    createParamFields(code);
    clearCodeFromStorage();
    setStatus('Código restaurado', 'success');
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.tab);
    });
  });

  setStatus('Listo. Sube un SVG (o usa la flor de ejemplo) y ajusta los parámetros.', '');
}

main().catch(err => {
  setStatus('Error de inicialización: ' + err.message, 'error');
  console.error(err);
});