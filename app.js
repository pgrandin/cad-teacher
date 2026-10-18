// UI: a Fusion-like shell around cad.js. The timeline (`features`) is the only real state;
// the 3D view, dialogs and lesson progress are all derived from it.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { LineSegments2 } from './vendor/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/LineSegmentsGeometry.js';
import { LineMaterial } from './vendor/LineMaterial.js';
import * as cad from './cad.js';
import { LESSONS, CHALLENGES } from './lessons.js';

const $ = s => document.querySelector(s);
const V = a => new THREE.Vector3(...a);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = n => String(Math.round(n * 10) / 10);

let features = [];             // the timeline
let built = cad.rebuild([]);   // the timeline, rebuilt
let sketch = null;             // sketch mode: { index, feature, plane, before, tool, pts, cursor, sel }
let cmd = null;                // open command: { index, feature, before, preview, sel: Map(edgeId -> edge ref) }
let pickingPlane = false;      // Create Sketch is waiting for a plane or face click
let lesson = null;             // { def, challenge, steps, step, startCount, goal, mine, match }
let hover = null;
let showGoal = true;
const undoStack = [];
let uid = 0;

// ---------- 3D view ----------
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
view.prepend(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 0.5, 2);
camera.add(sun);
scene.add(camera);

const grid = new THREE.GridHelper(200, 20, 0x8f9ba5, 0xc5ccd2);
grid.rotation.x = Math.PI / 2;
const sketchGrid = new THREE.GridHelper(200, 40, 0x7d8b96, 0xc9d0d5);
sketchGrid.rotation.x = Math.PI / 2;
sketchGrid.userData.keep = true;
scene.add(grid, new THREE.AxesHelper(30));

const fatMats = [];
const fatMat = (color, linewidth, opacity = 1) => {
  const m = new LineMaterial({ color, linewidth, opacity, transparent: true, depthTest: false });
  fatMats.push(m);
  return m;
};
const M = {
  body: new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  edge: new THREE.LineBasicMaterial({ color: 0x1f2a33 }),
  hoverFace: new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  fill: new THREE.MeshBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  cursor: new THREE.PointsMaterial({ color: 0xe65100, size: 8, sizeAttenuation: false, depthTest: false }),
  closeCursor: new THREE.PointsMaterial({ color: 0x2e9e4f, size: 12, sizeAttenuation: false, depthTest: false }),
  hoverEdge: fatMat(0xff8f00, 5),
  selEdge: fatMat(0x0696d7, 5),
  sketch: fatMat(0x1565c0, 2),
  sketchSel: fatMat(0xe65100, 3),
  draft: fatMat(0x42a5f5, 2),
  goal: fatMat(0xff8a00, 2, 0.6),
};
const fat = (positions, mat) => {
  const l = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), mat);
  l.renderOrder = 10;
  return l;
};

const shownGroup = new THREE.Group(), hlGroup = new THREE.Group(), sketchGroup = new THREE.Group(), goalGroup = new THREE.Group();
scene.add(shownGroup, hlGroup, sketchGroup, goalGroup);
const clear = g => {
  g.traverse(o => { if (o !== g && !o.userData.keep) o.geometry?.dispose(); });
  g.clear();
};

// Fusion shows the three origin planes when you start a sketch. Laid out as an open room corner
// (floor in front, walls behind) so none hides another from the home view.
const originPlanes = [['XY', 0, 0, [20, -20, 0]], ['XZ', Math.PI / 2, 0, [20, 0, 20]], ['YZ', 0, Math.PI / 2, [0, -20, 20]]].map(([base, rx, ry, pos]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.set(rx, ry, 0);
  m.position.set(...pos);
  m.userData.base = base;
  m.visible = false;
  scene.add(m);
  return m;
});

let queued = 0;
const draw = () => { queued ||= requestAnimationFrame(() => { queued = 0; renderer.render(scene, camera); }); };
controls.addEventListener('change', draw);
new ResizeObserver(() => {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  fatMats.forEach(m => m.resolution.set(w, h));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  draw();
}).observe(view);

// Three.js objects for a body: the shaded mesh, its edges, and the raw mesh data used for picking.
function bodyObjects(body) {
  const m = cad.meshOf(body);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.faces.vertices, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.faces.normals, 3));
  g.setIndex(m.faces.triangles);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(m.edges.lines, 3));
  return { body, m, mesh: new THREE.Mesh(g, M.body), lines: new THREE.LineSegments(eg, M.edge), refs: new Map() };
}
const disposeObjs = o => { o.mesh.geometry.dispose(); o.lines.geometry.dispose(); };

// `shown` is what you see; `picker` is what clicks resolve against (the body before the open command).
let shown = null, picker = null;
function setShown(body) {
  if ((shown?.body ?? null) === body) return;
  if (shown && shown !== picker) disposeObjs(shown);
  shown = !body ? null : picker?.body === body ? picker : bodyObjects(body);
  shownGroup.clear();
  if (shown) shownGroup.add(shown.mesh, shown.lines);
}
function setPicker(body) {
  if ((picker?.body ?? null) === body) return;
  if (picker && picker !== shown) disposeObjs(picker);
  picker = !body ? null : shown?.body === body ? shown : bodyObjects(body);
  hover = null;
}
const faceRefOf = id => {
  if (!picker.refs.has(id)) picker.refs.set(id, cad.faceRef(picker.body, id));
  return picker.refs.get(id);
};
const edgePositions = id => {
  const g = picker.m.edges.edgeGroups.find(g => g.edgeId === id);
  return g ? picker.m.edges.lines.slice(g.start * 3, (g.start + g.count) * 3) : [];
};
function faceGeometry(id) {
  const g = picker.m.faces.faceGroups.find(g => g.faceId === id);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(picker.m.faces.vertices, 3));
  geo.setIndex(picker.m.faces.triangles.slice(g.start, g.start + g.count));
  return geo;
}

// ---------- sketches ----------
function outline(s) {
  if (s.kind === 'rect') {
    const a = s.w / 2, b = s.h / 2;
    return [[s.x - a, s.y - b], [s.x + a, s.y - b], [s.x + a, s.y + b], [s.x - a, s.y + b]];
  }
  if (s.kind === 'circle') return Array.from({ length: 64 }, (_, i) => [s.x + s.d / 2 * Math.cos(i * Math.PI / 32), s.y + s.d / 2 * Math.sin(i * Math.PI / 32)]);
  return s.pts;
}
const loopSegs = pts => pts.flatMap((p, i) => { const q = pts[(i + 1) % pts.length]; return [p[0], p[1], 0, q[0], q[1], 0]; });
const pathSegs = pts => pts.slice(1).flatMap((q, i) => [pts[i][0], pts[i][1], 0, q[0], q[1], 0]);
const circleD = (a, c) => Math.round(2 * Math.hypot(c[0] - a[0], c[1] - a[1]));

// A group whose local XY is the sketch plane.
function planeGroup(pl) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(V(pl.u), V(pl.v), V(pl.n)).setPosition(V(pl.o));
  g.matrixWorldNeedsUpdate = true;
  return g;
}
function addShapes(g, shapes, sel = -1) {
  shapes.forEach((s, i) => {
    const pts = outline(s);
    if (pts.length < 2) return;
    g.add(fat(loopSegs(pts), i === sel ? M.sketchSel : M.sketch));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p)))), M.fill);
    fill.position.z = 0.02;
    g.add(fill);
  });
}
function draftShape() {
  const { tool, pts, cursor: c } = sketch;
  if (!tool || !pts.length || !c) return null;
  const a = pts[0];
  if (tool === 'rect') return { closed: true, pts: outline({ kind: 'rect', x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, w: Math.abs(c[0] - a[0]), h: Math.abs(c[1] - a[1]) }) };
  if (tool === 'circle') return { closed: true, pts: outline({ kind: 'circle', x: a[0], y: a[1], d: circleD(a, c) }) };
  return { closed: false, pts: [...pts, c] };
}
const closesLine = () => sketch.tool === 'line' && sketch.pts.length >= 3 && sketch.cursor && sketch.cursor.every((v, i) => v === sketch.pts[0][i]);

function drawSketches() {
  clear(sketchGroup);
  if (sketch) {
    const g = planeGroup(sketch.plane);
    g.add(sketchGrid);
    addShapes(g, sketch.feature.shapes, sketch.sel);
    const d = draftShape();
    if (d) g.add(fat(d.closed ? loopSegs(d.pts) : pathSegs(d.pts), M.draft));
    if (sketch.tool && sketch.cursor) {
      const p = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...sketch.cursor, 0.1)]), closesLine() ? M.closeCursor : M.cursor);
      p.renderOrder = 11;
      g.add(p);
    }
    sketchGroup.add(g);
    return;
  }
  // Like Fusion, a sketch hides once an extrude uses it.
  const used = new Set(features.filter(f => f.type === 'extrude').map(f => f.sketch));
  for (const f of features) {
    if (f.type !== 'sketch' || used.has(f.id) || !built.planes[f.id]) continue;
    const g = planeGroup(built.planes[f.id]);
    addShapes(g, f.shapes);
    sketchGroup.add(g);
  }
}

function drawHighlights() {
  clear(hlGroup);
  originPlanes.forEach(p => (p.material.opacity = hover?.kind === 'plane' && hover.id === p.userData.base ? 0.5 : 0.22));
  if (!picker) return;
  if (cmd?.sel) for (const id of cmd.sel.keys()) {
    const pos = edgePositions(id);
    if (pos.length) hlGroup.add(fat(pos, M.selEdge));
  }
  if (hover?.kind === 'edge') hlGroup.add(fat(edgePositions(hover.id), M.hoverEdge));
  if (hover?.kind === 'face') hlGroup.add(new THREE.Mesh(faceGeometry(hover.id), M.hoverFace));
}

// ---------- camera ----------
function fitView(body) {
  const [min, max] = body ? body.boundingBox.bounds : [[-30, -30, 0], [30, 30, 20]];
  const c = min.map((v, i) => (v + max[i]) / 2);
  const r = Math.max(Math.hypot(...max.map((v, i) => v - min[i])) / 2, 25);
  return { c, r };
}
function home() {
  const { c, r } = fitView(built.body);
  camera.up.set(0, 0, 1);
  controls.target.set(...c);
  camera.position.copy(V(c)).addScaledVector(new THREE.Vector3(1, -1.3, 1).normalize(), r * 3.6);
  controls.update();
  draw();
}
function lookAtPlane(pl) {
  const { c, r } = fitView(sketch.before.body);
  const k = dot(c.map((v, i) => v - pl.o[i]), pl.n);
  const t = c.map((v, i) => v - k * pl.n[i]); // body center, dropped onto the sketch plane
  camera.up.copy(V(pl.v));
  controls.target.set(...t);
  camera.position.copy(V(t)).addScaledVector(V(pl.n), Math.max(r, 40) * 3.6);
  controls.update();
  draw();
}
function sketchControls(on) {
  controls.enableRotate = !on;
  controls.mouseButtons.LEFT = !on ? THREE.MOUSE.ROTATE : sketch?.tool ? null : THREE.MOUSE.PAN;
}
$('#home').onclick = () => (sketch ? lookAtPlane(sketch.plane) : home());

// ---------- timeline actions ----------
const LABEL = { sketch: 'Sketch', extrude: 'Extrude', fillet: 'Fillet', chamfer: 'Chamfer', hole: 'Hole' };
const nameAt = (i, type) => LABEL[type] + (features.slice(0, i).filter(f => f.type === type).length + 1);
const pushUndo = () => { undoStack.push(structuredClone(features)); if (undoStack.length > 50) undoStack.shift(); };

function rebuildAll() {
  built = cad.rebuild(features);
  if (lesson) {
    lesson.mine = cad.metrics(built.body);
    lesson.match = cad.sameShape(lesson.mine, lesson.goal);
  }
  refresh();
}

function undoLast() {
  if (!undoStack.length) return;
  sketch = cmd = null;
  pickingPlane = false;
  sketchControls(false);
  features = undoStack.pop();
  rebuildAll();
}

function defaultSketch(index) {
  const prior = features.slice(0, index);
  const used = new Set(prior.filter(f => f.type === 'extrude').map(f => f.sketch));
  const sketches = prior.filter(f => f.type === 'sketch');
  return (sketches.findLast(f => !used.has(f.id)) || sketches.at(-1))?.id || '';
}

const DEFAULTS = {
  extrude: i => ({ sketch: defaultSketch(i), distance: 10, op: 'join' }),
  fillet: () => ({ edges: [], r: 2 }),
  chamfer: () => ({ edges: [], r: 1 }),
  hole: () => ({ face: null, x: 0, y: 0, d: 6, depth: 0 }),
};

function startCommand(type, index = features.length, feature = null) {
  const f = feature ? structuredClone(feature) : { type, id: 'u' + ++uid, ...DEFAULTS[type](index) };
  const before = cad.rebuild(features.slice(0, index));
  cmd = { index, feature: f, before, sel: f.edges ? new Map() : null };
  if (f.edges?.length && before.body) {
    try { cad.matchEdges(before.body, f.edges).forEach((id, i) => cmd.sel.set(id, f.edges[i])); } catch { /* edges gone; kid re-picks */ }
  }
  updatePreview();
  refresh();
}
// ponytail: replays the whole timeline on every keystroke; cache prefixes if parts get big.
const updatePreview = () => { cmd.preview = cad.rebuild([...features.slice(0, cmd.index), cmd.feature]); };

function commitCommand() {
  if (!cmd || cmd.preview.errors[cmd.feature.id]) return;
  pushUndo();
  features.splice(cmd.index, cmd.index < features.length ? 1 : 0, cmd.feature);
  cmd = null;
  rebuildAll();
}

function deleteFeature(i) {
  pushUndo();
  features.splice(i, 1);
  cmd = null;
  rebuildAll();
}

function enterSketch(index, feature) {
  const before = cad.rebuild(features.slice(0, index));
  let plane;
  try { plane = cad.resolvePlane(feature.plane, before.body); } catch { plane = cad.planeFrom(cad.BASE_PLANES.XY); }
  pickingPlane = false;
  cmd = null;
  sketch = { index, feature: structuredClone(feature), plane, before, tool: null, pts: [], cursor: null, sel: -1 };
  sketchControls(true);
  lookAtPlane(plane);
  refresh();
}

function finishSketch() {
  const { index, feature } = sketch;
  const isNew = index === features.length;
  if (!isNew || feature.shapes.length) {
    pushUndo();
    features.splice(index, isNew ? 0 : 1, feature);
  }
  sketch = null;
  sketchControls(false);
  rebuildAll();
  home();
}

function editFeature(i) {
  const f = features[i];
  pickingPlane = false;
  cmd = null;
  if (f.type === 'sketch') enterSketch(i, f);
  else startCommand(f.type, i, f);
}

function exportSTL() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(cad.stlOf(built.body));
  a.download = (lesson?.def.id || 'part') + '.stl';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function act(id, fromKey = false) {
  if (sketch) {
    if (id === 'finish') return finishSketch();
    sketch.tool = sketch.tool === id && !fromKey ? null : id;
    sketch.pts = [];
    sketchControls(true);
    return refresh();
  }
  if (id === 'undo') return undoLast();
  if (id === 'stl') return exportSTL();
  cmd = null;
  pickingPlane = id === 'sketch';
  if (pickingPlane) return refresh();
  startCommand(id);
}

function escape() {
  if (sketch) {
    if (sketch.pts.length) sketch.pts = [];
    else sketch.tool = null;
    sketchControls(true);
  } else {
    cmd = null;
    pickingPlane = false;
  }
  refresh();
}

// ---------- pointer ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

function pick(e) {
  const wantEdge = !!cmd?.sel, wantFace = pickingPlane || cmd?.feature.type === 'hole';
  if (!wantEdge && !wantFace) return null;
  setRay(e);
  const meshHit = picker && ray.intersectObject(picker.mesh)[0];
  if (wantEdge) {
    if (!picker) return null;
    const tol = (ray.params.Line.threshold = camera.position.distanceTo(controls.target) * 0.01);
    const h = ray.intersectObject(picker.lines)[0];
    if (!h || (meshHit && h.distance > meshHit.distance + tol)) return null; // hidden behind the part
    const g = picker.m.edges.edgeGroups.find(g => h.index >= g.start && h.index < g.start + g.count);
    return g && { kind: 'edge', id: g.edgeId };
  }
  // The part's faces win over the see-through origin planes in front of them.
  if (!meshHit) {
    const planeHit = pickingPlane && ray.intersectObjects(originPlanes)[0];
    return planeHit ? { kind: 'plane', id: planeHit.object.userData.base } : null;
  }
  const t = meshHit.faceIndex * 3;
  const g = picker.m.faces.faceGroups.find(g => t >= g.start && t < g.start + g.count);
  const ref = g && faceRefOf(g.faceId);
  return ref && { kind: 'face', id: g.faceId, ref, point: meshHit.point.toArray() };
}

function modelClick(e) {
  const h = pick(e);
  if (!h) return;
  if (pickingPlane) return enterSketch(features.length, { type: 'sketch', id: 'u' + ++uid, plane: h.kind === 'plane' ? { base: h.id } : { face: h.ref }, shapes: [] });
  if (h.kind === 'edge') {
    if (cmd.sel.has(h.id)) cmd.sel.delete(h.id);
    else cmd.sel.set(h.id, cad.edgeRef(picker.body, h.id));
    cmd.feature.edges = [...cmd.sel.values()];
  } else {
    const pl = cad.resolvePlane({ face: h.ref }, picker.body);
    const p = h.point.map((v, i) => v - pl.o[i]);
    Object.assign(cmd.feature, { face: h.ref, x: Math.round(dot(p, pl.u)), y: Math.round(dot(p, pl.v)) });
  }
  updatePreview();
  refresh();
}

function sketchCursor(e) {
  setRay(e);
  const pl = sketch.plane;
  const p = ray.ray.intersectPlane(new THREE.Plane(V(pl.n), -dot(pl.n, pl.o)), new THREE.Vector3());
  if (!p) return;
  const d = p.toArray().map((v, i) => v - pl.o[i]);
  sketch.cursor = [Math.round(dot(d, pl.u)), Math.round(dot(d, pl.v))]; // snap to the 1 mm grid
  const ro = $('#readout'), d0 = draftShape(), a = sketch.pts[0], c = sketch.cursor;
  ro.hidden = !sketch.tool;
  ro.textContent = !d0 ? `${c[0]}, ${c[1]}`
    : sketch.tool === 'rect' ? `${Math.abs(c[0] - a[0])} × ${Math.abs(c[1] - a[1])}`
    : sketch.tool === 'circle' ? `Ø ${circleD(a, c)}`
    : `${fmt(Math.hypot(c[0] - sketch.pts.at(-1)[0], c[1] - sketch.pts.at(-1)[1]))} mm`;
  const r = view.getBoundingClientRect();
  ro.style.left = e.clientX - r.left + 16 + 'px';
  ro.style.top = e.clientY - r.top + 16 + 'px';
}

function addShape(s) {
  sketch.feature.shapes.push(s);
  sketch.pts = [];
  sketch.sel = sketch.feature.shapes.length - 1;
}

function sketchClick() {
  const s = sketch, p = s.cursor;
  if (!p) return;
  if (s.tool === 'line') {
    if (closesLine()) addShape({ kind: 'poly', pts: s.pts });
    else if (!s.pts.length || p.some((v, i) => v !== s.pts.at(-1)[i])) s.pts.push(p);
  } else if (!s.pts.length) s.pts.push(p);
  else {
    const a = s.pts[0];
    if (s.tool === 'rect') {
      const w = Math.abs(p[0] - a[0]), h = Math.abs(p[1] - a[1]);
      if (w && h) addShape({ kind: 'rect', x: (a[0] + p[0]) / 2, y: (a[1] + p[1]) / 2, w, h });
    } else if (circleD(a, p)) addShape({ kind: 'circle', x: a[0], y: a[1], d: circleD(a, p) });
  }
  refresh();
}

let down = null;
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, button: e.button };
  if (sketch?.tool && e.button === 0) { sketchCursor(e); sketchClick(); }
});
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5, button = down.button;
  down = null;
  if (button !== 0) return;
  if (sketch?.tool) {
    // Drag-to-draw: releasing away from the first corner/center finishes the shape.
    if (moved && sketch.pts.length === 1 && sketch.tool !== 'line') { sketchCursor(e); sketchClick(); }
  } else if (!moved && !sketch) modelClick(e);
});
canvas.addEventListener('pointermove', e => {
  if (sketch) {
    if (!sketch.tool) return;
    sketchCursor(e);
    drawSketches();
    draw();
    return;
  }
  const h = pick(e);
  canvas.style.cursor = h ? 'pointer' : '';
  if (h?.kind !== hover?.kind || h?.id !== hover?.id) {
    hover = h;
    drawHighlights();
    draw();
  }
});
canvas.addEventListener('pointerleave', () => { $('#readout').hidden = true; });

addEventListener('keydown', e => {
  if (e.target.closest?.('input, select')) {
    if (e.key === 'Enter' && cmd) commitCommand();
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.key === 'Escape') return escape();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undoLast(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Same shortcuts as Fusion 360.
  const id = (sketch ? { l: 'line', r: 'rect', c: 'circle' } : { e: 'extrude', h: 'hole', f: 'fillet' })[e.key.toLowerCase()];
  const b = id && document.querySelector(`[data-tool="${id}"]`);
  if (b && !b.disabled) act(id, true);
});

// ---------- panels ----------
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
const ICON = {
  sketch: svg('<rect x="3" y="7" width="12" height="12" rx="1"/><path d="M13 13l7-7 2 2-7 7-3 1z"/>'),
  extrude: svg('<path d="M3 16l9 4 9-4-9-4z"/><path d="M12 14V3M8.5 6.5L12 3l3.5 3.5"/>'),
  hole: svg('<path d="M3 9l9-4 9 4-9 4z"/><path d="M3 9v7l9 4 9-4V9"/><ellipse cx="12" cy="9" rx="3" ry="1.4" fill="currentColor"/>'),
  fillet: svg('<path d="M4 21V12a8 8 0 0 1 8-8h9"/>'),
  chamfer: svg('<path d="M4 21v-9l8-8h9"/>'),
  line: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12"/><circle cx="4" cy="6" r="1.5"/><circle cx="20" cy="18" r="1.5"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  finish: svg('<path d="M4 12.5l5 5L20 6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  stl: svg('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>'),
};

const toolBtn = (id, label, { on = false, disabled = false, key = '' } = {}) =>
  `<button class="tool${on ? ' on' : ''}" data-tool="${id}"${disabled ? ' disabled' : ''} title="${label}${key ? ` (${key})` : ''}">${ICON[id]}<span>${label}</span></button>`;
const group = (label, items) => `<div class="group"><div class="row">${items.join('')}</div><div class="glabel">${label}</div></div>`;

function renderToolbar() {
  $('#tab').textContent = sketch ? 'SKETCH' : 'SOLID';
  const t = cmd?.feature.type, body = !!built.body;
  $('#tools').innerHTML = sketch
    ? group('CREATE', [
      toolBtn('line', 'Line', { on: sketch.tool === 'line', key: 'L' }),
      toolBtn('rect', 'Rectangle', { on: sketch.tool === 'rect', key: 'R' }),
      toolBtn('circle', 'Circle', { on: sketch.tool === 'circle', key: 'C' }),
    ]) + group('FINISH', [toolBtn('finish', 'Finish Sketch')])
    : group('CREATE', [
      toolBtn('sketch', 'Create Sketch', { on: pickingPlane }),
      toolBtn('extrude', 'Extrude', { on: t === 'extrude', disabled: !features.some(f => f.type === 'sketch'), key: 'E' }),
      toolBtn('hole', 'Hole', { on: t === 'hole', disabled: !body, key: 'H' }),
    ]) + group('MODIFY', [
      toolBtn('fillet', 'Fillet', { on: t === 'fillet', disabled: !body, key: 'F' }),
      toolBtn('chamfer', 'Chamfer', { on: t === 'chamfer', disabled: !body }),
    ]) + group('FILE', [
      toolBtn('undo', 'Undo', { disabled: !undoStack.length, key: 'Ctrl+Z' }),
      toolBtn('stl', 'Export STL', { disabled: !body }),
    ]);
}
$('#tools').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) act(b.dataset.tool);
});

const num = (label, value, attrs) => `<label>${label}<input type="number" step="1" value="${value}" ${attrs}></label>`;
const select = (label, k, value, options) =>
  `<label>${label}<select data-k="${k}">${options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
const SHAPE = {
  rect: ['Rectangle', [['x', 'Center X'], ['y', 'Center Y'], ['w', 'Width'], ['h', 'Height']]],
  circle: ['Circle', [['x', 'Center X'], ['y', 'Center Y'], ['d', 'Diameter']]],
  poly: ['Line shape', []],
};

function renderDialog() {
  const el = $('#dialog');
  el.hidden = !sketch && !cmd;
  if (sketch) {
    const rows = sketch.feature.shapes.map((s, i) => {
      const [name, fields] = SHAPE[s.kind];
      return `<fieldset data-i="${i}"${i === sketch.sel ? ' class="sel"' : ''}><legend>${name} ${i + 1}<button data-act="del-shape" data-i="${i}" title="Delete">✕</button></legend>` +
        fields.map(([k, label]) => num(label, s[k], `data-i="${i}" data-k="${k}"`)).join('') +
        (s.kind === 'poly' ? `<p class="note">${s.pts.length} corners</p>` : '') + '</fieldset>';
    }).join('');
    el.innerHTML = `<div class="dh">SKETCH<small>${nameAt(sketch.index, 'sketch')}</small></div>
      <div class="db">${rows || '<p class="note">Nothing drawn yet. Pick Line, Rectangle or Circle in the toolbar.</p>'}</div>
      <div class="df"><span></span><button data-act="finish" class="ok">Finish Sketch</button></div>`;
    return;
  }
  if (!cmd) return;
  const f = cmd.feature;
  let body = '';
  if (f.type === 'extrude') {
    const sketches = features.slice(0, cmd.index).map((g, i) => [g, i]).filter(([g]) => g.type === 'sketch');
    body = select('Profile', 'sketch', f.sketch, sketches.map(([g, i]) => [g.id, nameAt(i, 'sketch')])) +
      num('Distance (mm)', f.distance, 'data-k="distance"') +
      select('Operation', 'op', f.op, [['join', 'Join (add)'], ['cut', 'Cut (remove)']]);
  } else if (f.type === 'hole') {
    body = `<p class="note">${f.face ? 'Face picked ✓ Click another face to move the hole.' : 'Click a flat face on the part.'}</p>` +
      num('Position X', f.x, 'data-k="x"') + num('Position Y', f.y, 'data-k="y"') +
      num('Diameter (mm)', f.d, 'data-k="d"') + num('Depth (0 = through)', f.depth, 'data-k="depth"');
  } else {
    body = `<p class="note">${cmd.sel.size} edge${cmd.sel.size === 1 ? '' : 's'} picked. Click edges on the part to add or remove them.</p>` +
      num(f.type === 'fillet' ? 'Radius (mm)' : 'Distance (mm)', f.r, 'data-k="r" step="0.5"');
  }
  const isNew = cmd.index === features.length;
  el.innerHTML = `<div class="dh">${LABEL[f.type].toUpperCase()}<small>${nameAt(cmd.index, f.type)}</small></div>
    <div class="db">${body}<p class="err" id="cmderr"></p></div>
    <div class="df">${isNew ? '' : '<button data-act="delete" class="danger">Delete</button>'}<span></span><button data-act="cancel">Cancel</button><button data-act="ok" class="ok" id="okbtn">OK</button></div>`;
  updateCmdError();
}
function updateCmdError() {
  if (!cmd) return;
  const err = cmd.preview.errors[cmd.feature.id] || '';
  $('#cmderr').textContent = err;
  $('#okbtn').disabled = !!err;
}

$('#dialog').addEventListener('input', e => {
  const t = e.target, k = t.dataset.k;
  if (!k) return;
  const v = t.tagName === 'SELECT' ? t.value : parseFloat(t.value);
  if (Number.isNaN(v)) return; // half-typed, like "-"
  if (sketch) {
    sketch.feature.shapes[+t.dataset.i][k] = v;
    drawSketches();
    checkLesson();
    draw();
    return;
  }
  cmd.feature[k] = v;
  updatePreview();
  refresh(false);
});
$('#dialog').addEventListener('focusin', e => {
  e.target.select?.();
  if (!sketch || e.target.dataset.i === undefined) return;
  sketch.sel = +e.target.dataset.i;
  $('#dialog').querySelectorAll('fieldset').forEach(f => f.classList.toggle('sel', +f.dataset.i === sketch.sel));
  drawSketches();
  draw();
});
$('#dialog').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  const a = b?.dataset.act;
  if (a === 'finish') finishSketch();
  else if (a === 'del-shape') { sketch.feature.shapes.splice(+b.dataset.i, 1); sketch.sel = -1; refresh(); }
  else if (a === 'ok') commitCommand();
  else if (a === 'cancel') { cmd = null; refresh(); }
  else if (a === 'delete') deleteFeature(cmd.index);
});

function renderTimeline() {
  const active = sketch?.index ?? cmd?.index ?? -1;
  $('#chips').innerHTML = features.map((f, i) => {
    const err = built.errors[f.id], name = nameAt(i, f.type);
    const cls = ['chip', err && 'err', i === active && 'on', active >= 0 && i > active && 'rolled'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-i="${i}" title="${name}${err ? ': ' + err : ''} (click to edit)">${ICON[f.type]}<span>${name}</span></button>`;
  }).join('') || '<span class="empty">Empty. Every feature you make lands here, in order.</span>';
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (sketch) return flash('Finish the sketch first.');
  editFeature(+b.dataset.i);
});

function hintText() {
  if (pickingPlane) return 'Click a plane, or a flat face of your part, to sketch on it. Esc cancels.';
  if (sketch) {
    const n = sketch.pts.length;
    return {
      line: n ? 'Keep clicking to add corners. Click the first point again (it turns green) to close the shape. Esc stops.' : 'Line: click where the shape starts.',
      rect: n ? 'Click the opposite corner.' : 'Rectangle: click the first corner.',
      circle: n ? 'Click to set the size.' : 'Circle: click the center.',
    }[sketch.tool] || 'Pick Line, Rectangle or Circle. Type exact sizes in the panel. Drag to pan, scroll to zoom.';
  }
  if (cmd) return {
    extrude: 'Set the distance. A negative number goes the other way.',
    fillet: 'Click edges to round them. Left-drag to orbit.',
    chamfer: 'Click edges to bevel them. Left-drag to orbit.',
    hole: 'Click a flat face where the hole goes.',
  }[cmd.feature.type];
  return 'Left-drag to orbit · Shift-drag or right-drag to pan · Scroll to zoom';
}
let flashTimer = 0;
const renderHint = () => { if (!flashTimer) $('#hint').textContent = hintText(); };
function flash(msg) {
  $('#hint').textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashTimer = 0; renderHint(); }, 2500);
}

// ---------- lessons ----------
const ALL = [...LESSONS.map(def => ({ def, challenge: false })), ...CHALLENGES.map(def => ({ def, challenge: true }))];
const DONE_KEY = 'cad-teacher-done';
const doneIds = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch { return []; } };
const markDone = id => { try { localStorage.setItem(DONE_KEY, JSON.stringify([...new Set([...doneIds(), id])])); } catch { /* private mode */ } };

function openLesson(def, challenge) {
  sketch = cmd = null;
  pickingPlane = false;
  sketchControls(false);
  undoStack.length = 0;
  features = structuredClone(def.start || []);
  const goalBody = cad.rebuild(def.goal).body;
  clear(goalGroup);
  goalGroup.add(fat(cad.meshOf(goalBody).edges.lines, M.goal));
  goalGroup.visible = showGoal;
  const steps = def.steps || [{ text: 'Build the part until it matches the goal.', done: s => s.match }];
  lesson = { def, challenge, steps, step: 0, startCount: features.length, goal: cad.metrics(goalBody) };
  rebuildAll();
  renderLearn();
  home();
}

function checkLesson() {
  if (!lesson) return;
  const s = {
    features, mode: sketch ? 'sketch' : 'model', draft: sketch?.feature.shapes, sketchOnFace: !!sketch?.feature.plane.face,
    dialog: cmd?.feature.type, selected: cmd?.sel?.size || 0, holeFace: !!cmd?.feature.face, match: lesson.match, startCount: lesson.startCount,
  };
  const before = lesson.step;
  while (lesson.step < lesson.steps.length && lesson.steps[lesson.step].done(s)) lesson.step++;
  if (lesson.step === lesson.steps.length && before < lesson.step) markDone(lesson.def.id);
  if (lesson.step !== before || lesson.challenge) renderLearn();
}

const sizeOf = m => (m ? [0, 1, 2].map(i => fmt(m.max[i] - m.min[i])).join(' × ') : '-');
const volOf = m => (m ? Math.round(m.volume).toLocaleString() + ' mm³' : '-');

function renderLearn() {
  const el = $('#learn');
  if (!lesson) {
    const done = doneIds();
    const item = ({ def, challenge }, i) => `<li><button data-open="${def.id}">${done.includes(def.id) ? '✅' : `<b>${i + 1}</b>`} ${def.title}</button></li>`;
    el.innerHTML = `<h2>Lessons</h2><ol class="menu">${ALL.filter(x => !x.challenge).map(item).join('')}</ol>
      <h2>Challenges</h2><ol class="menu">${ALL.filter(x => x.challenge).map(item).join('')}</ol>
      <p class="tip">Free building is what Fusion 360 is for. Here you learn the moves you will use there: sketch, extrude, then add features on top.</p>`;
    return;
  }
  const { def, challenge, steps, step } = lesson;
  const won = step >= steps.length;
  const next = ALL[ALL.findIndex(x => x.def === def) + 1];
  el.innerHTML = `<button class="back" data-act="back">← All lessons</button>
    <h2>${challenge ? 'Challenge: ' : ''}${def.title}</h2>
    ${def.intro ? `<p>${def.intro}</p>` : ''}
    ${challenge
      ? `<p>Build this part. Use any features you like.</p><ul class="brief">${def.brief.map(b => `<li>${b}</li>`).join('')}</ul>
        <table class="cmp"><tr><th></th><th>Yours</th><th>Goal</th></tr>
        <tr><td>Size</td><td>${sizeOf(lesson.mine)}</td><td>${sizeOf(lesson.goal)}</td></tr>
        <tr><td>Volume</td><td>${volOf(lesson.mine)}</td><td>${volOf(lesson.goal)}</td></tr></table>`
      : `<ol class="steps">${steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}">${s.text}</li>`).join('')}</ol>`}
    ${won ? `<div class="win"><b>🎉 Nice work! Your part matches.</b>${def.outro ? `<p>${def.outro}</p>` : ''}${next ? `<button class="btn" data-act="next">Next: ${next.def.title} →</button>` : ''}</div>` : ''}
    <label class="check"><input type="checkbox" data-act="goal"${showGoal ? ' checked' : ''}> Show the goal shape (orange lines)</label>
    <button class="btn" data-act="restart">Start over</button>`;
}
$('#learn').addEventListener('click', e => {
  const t = e.target.closest('[data-open], [data-act]');
  if (!t) return;
  if (t.dataset.open) {
    const x = ALL.find(x => x.def.id === t.dataset.open);
    return openLesson(x.def, x.challenge);
  }
  const a = t.dataset.act;
  if (a === 'back') { lesson = null; clear(goalGroup); renderLearn(); draw(); }
  else if (a === 'next') { const x = ALL[ALL.findIndex(x => x.def === lesson.def) + 1]; openLesson(x.def, x.challenge); }
  else if (a === 'restart') openLesson(lesson.def, lesson.challenge);
});
$('#learn').addEventListener('change', e => {
  if (e.target.dataset.act !== 'goal') return;
  showGoal = goalGroup.visible = e.target.checked;
  draw();
});

// ---------- refresh ----------
function refresh(full = true) {
  setShown(cmd ? cmd.preview.body : sketch ? sketch.before.body : built.body);
  setPicker(cmd ? cmd.before.body : pickingPlane ? built.body : null);
  grid.visible = !sketch;
  originPlanes.forEach(p => (p.visible = pickingPlane));
  canvas.style.cursor = sketch?.tool ? 'crosshair' : '';
  if (!sketch?.tool) $('#readout').hidden = true;
  drawSketches();
  drawHighlights();
  renderToolbar();
  renderTimeline();
  renderHint();
  if (full) renderDialog();
  else updateCmdError();
  checkLesson();
  draw();
}

renderLearn();
refresh();
home();
try {
  await cad.init();
  $('#loading').remove();
} catch (e) {
  $('#loading').textContent = 'Could not load the CAD engine: ' + (e?.message || e);
}
