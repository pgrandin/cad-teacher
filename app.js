// UI: a Fusion-like shell around cad.js. The timeline (`features`) is the only real state;
// the 3D view, dialogs and lesson progress are all derived from it.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { LineSegments2 } from './vendor/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/LineSegmentsGeometry.js';
import { LineMaterial } from './vendor/LineMaterial.js';
import * as cad from './cad.js';
import { LESSONS, CHALLENGES, COURSES } from './lessons.js';
import { t, tn, has, lang, setLang, LANGS } from './i18n.js';
import { poses } from './assembly.js';
import { overhangs, printMatrix } from './print.js';
import { VERSION } from './version.js';
import { createViewCube } from './view-cube.js';

const $ = s => document.querySelector(s);
const V = a => new THREE.Vector3(...a);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = n => String(Math.round(n * 10) / 10);

let features = [];             // the timeline
let built = cad.rebuild([]);   // the timeline, rebuilt
let sketch = null;             // sketch mode: { index, feature, plane, before, tool, pts, cursor, sel, picking }
let cmd = null;                // open command: { index, feature, before, preview, sel: Map(edgeId -> edge ref) }
let pickingPlane = false;      // Create Sketch is waiting for a plane or face click
let lesson = null;             // { def, challenge, steps, step, startCount, goal, mine, match }
let asm = null;                // assembly lesson: { components, joints, objs, driven }
let acmd = null;               // open assembly command: { kind: 'joint', index, joint } or { kind: 'drive', angles }
let printMode = false;         // print check: the part sits on the bed, overhangs show red
let printDown = null;          // outward normal of the face laid on the bed (null = as designed)
let printArea = 0;             // overhang area (mm²) in the current print placement
let hover = null;
let showGoal = true;
let showDiff = false;           // color what is missing (green) / extra (red) compared to the goal
const undoStack = [];
let uid = 0;

// ---------- 3D view ----------
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
view.prepend(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
// Sketches use an orthographic view like Fusion's: no perspective, so a square looks square.
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
const TAN = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
let camera = persp, aspect = 1, modelOrtho = false;
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 0.5, 2);
camera.add(sun);
scene.add(persp, ortho);

const grid = new THREE.GridHelper(200, 20, 0x8f9ba5, 0xc5ccd2);
grid.rotation.x = Math.PI / 2;
const sketchGrid = new THREE.GridHelper(200, 40, 0x7d8b96, 0xc9d0d5);
sketchGrid.rotation.x = Math.PI / 2;
sketchGrid.userData.keep = true;
const originAxes = new THREE.AxesHelper(30);
scene.add(grid, originAxes);

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
  axis: fatMat(0x37474f, 2.5),
  // Differences show through the part (depthTest off), so a misplaced hole reads as red + green.
  missing: new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }),
  extra: new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }),
  // Overhangs face down, so the view from above can't see them: show them through the part.
  overhang: new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }),
};
const printGroup = new THREE.Group(); // red overhang overlay, placed like the part
const bed = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ color: 0x5aa9e6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
bed.position.z = -0.05;
bed.visible = false;
const fat = (positions, mat) => {
  const l = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), mat);
  l.renderOrder = 10;
  return l;
};

// A sketch's axes in the colors of the origin axes (X red, Y green, Z blue), gray on a slanted face.
const axisMats = {};
const axisMat = d => (axisMats[d.map(Math.round)] ||= fatMat([0xe53935, 0x43a047, 0x1e88e5][d.findIndex(v => Math.abs(v) > 0.99)] ?? 0x78909c, 1.5));

const shownGroup = new THREE.Group(), hlGroup = new THREE.Group(), sketchGroup = new THREE.Group(), goalGroup = new THREE.Group(), diffGroup = new THREE.Group();
scene.add(shownGroup, hlGroup, sketchGroup, goalGroup, diffGroup, printGroup, bed);
for (const g of [shownGroup, hlGroup, printGroup]) g.matrixAutoUpdate = false;
const clear = g => {
  g.traverse(o => { if (o !== g && !o.userData.keep) o.geometry?.dispose(); });
  g.clear();
};

function originLabel(text, color) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 128;
  labelCanvas.height = 64;
  const ctx = labelCanvas.getContext('2d');
  ctx.font = `bold ${text.length > 3 ? 24 : 36}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  label.scale.set(12, 6, 1);
  label.raycast = () => {}; // Labels explain the geometry; surfaces handle selection.
  label.renderOrder = 13;
  return label;
}

const introAxes = new THREE.Group();
for (const [i, name, color] of [[0, 'X', '#e53935'], [1, 'Y', '#43a047'], [2, 'Z', '#1e88e5']]) {
  const direction = V([0, 0, 0].map((_, axis) => axis === i ? 1 : 0));
  const arrow = new THREE.ArrowHelper(direction, V([0, 0, 0]), 42, color, 3, 1.8);
  for (const part of [arrow.line, arrow.cone]) {
    part.material.depthTest = part.material.depthWrite = false;
    part.material.transparent = true;
    part.renderOrder = 12;
  }
  const label = originLabel(name, color);
  label.position.copy(direction).multiplyScalar(46);
  arrow.userData.axis = label.userData.axis = name;
  introAxes.add(arrow, label);
}
introAxes.visible = false;
scene.add(introAxes);

const introOrigin = new THREE.Group();
const originDot = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe07800, depthTest: false, transparent: true }));
originDot.renderOrder = 14;
const originCoordinates = originLabel('0, 0, 0', '#a65700');
originCoordinates.scale.set(18, 6, 1);
originCoordinates.position.z = -5;
introOrigin.add(originDot, originCoordinates);
introOrigin.visible = false;
scene.add(introOrigin);

// Reveal only the current concept; retain faint axes to give it a frame of reference.
function drawIntro() {
  const active = lesson?.def.id === 'intro' && !sketch;
  const focus = active && lesson.def.concepts[lesson.step];
  introAxes.visible = active;
  originAxes.visible = !active;
  introOrigin.visible = focus === 'origin';
  for (const child of introAxes.children) {
    const opacity = !focus || focus.includes(child.userData.axis) ? 1 : 0.15;
    if (child.isSprite) child.material.opacity = opacity;
    else for (const part of [child.line, child.cone]) part.material.opacity = opacity;
  }
  if (active && !pickingPlane) for (const plane of originPlanes) {
    plane.visible = !focus || focus === plane.userData.base;
    plane.material.opacity = focus ? 0.45 : hover?.id === plane.userData.base ? 0.5 : 0.22;
  }
}

// Fusion shows the three origin planes when you start a sketch. Laid out as an open room corner
// (floor in front, walls behind) so none hides another from the home view.
const originPlanes = [['XY', 0, 0, [20, -20, 0]], ['XZ', Math.PI / 2, 0, [20, 0, 20]], ['YZ', 0, Math.PI / 2, [0, -20, 20]]].map(([base, rx, ry, pos]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.set(rx, ry, 0);
  m.position.set(...pos);
  m.userData.base = base;
  const label = originLabel(base, '#805000');
  m.add(label);
  m.visible = false;
  scene.add(m);
  return m;
});

const updateViewCube = createViewCube($('#view-cube'), direction => {
  if (sketch && !sketch.picking) return;
  // Keep the current pan, zoom and projection when choosing a standard view.
  camera.up.set(...(!direction[0] && !direction[1] ? [0, direction[2], 0] : [0, 0, 1]));
  aim(controls.target.clone(), V(direction), viewHeight() / 2 / TAN);
  if (lesson) lesson.viewDirection = direction;
  checkLesson();
  saveWork();
}, t);
let queued = 0;
const draw = () => { queued ||= requestAnimationFrame(() => { queued = 0; drawIntro(); renderer.render(scene, camera); updateViewCube(camera, !!sketch && !sketch.picking); }); };
controls.addEventListener('change', draw);
new ResizeObserver(() => {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  fatMats.forEach(m => m.resolution.set(w, h));
  persp.aspect = aspect = w / h;
  persp.updateProjectionMatrix();
  ortho.left = ortho.bottom * aspect;
  ortho.right = ortho.top * aspect;
  ortho.updateProjectionMatrix();
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
    const pl = sketch.plane;
    for (const [pos, d] of [[[-100, 0, 0, 100, 0, 0], pl.u], [[0, -100, 0, 0, 100, 0], pl.v]]) g.add(Object.assign(fat(pos, axisMat(d)), { renderOrder: 9 }));
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
  const used = new Set(features.filter(f => (f.type === 'extrude' || f.type === 'revolve')).map(f => f.sketch));
  for (const f of features) {
    if (f.type !== 'sketch' || used.has(f.id) || !built.planes[f.id]) continue;
    const g = planeGroup(built.planes[f.id]);
    addShapes(g, f.shapes);
    sketchGroup.add(g);
  }
}

// Revolve spins around one of the sketch's two axes (Fusion: Axis selection). Shown as lines to click.
function revolveAxes() {
  const pl = cmd?.feature.type === 'revolve' && cmd.before.planes[cmd.feature.sketch];
  return pl ? [['v', pl.v], ['h', pl.u]].map(([id, d]) => ({ id, pos: [-60, 60].flatMap(k => pl.o.map((o, i) => o + k * d[i])) })) : [];
}

function drawHighlights() {
  clear(hlGroup);
  originPlanes.forEach(p => (p.material.opacity = hover?.kind === 'plane' && hover.id === p.userData.base ? 0.5 : 0.22));
  for (const a of revolveAxes()) hlGroup.add(fat(a.pos, hover?.kind === 'axis' && hover.id === a.id ? M.hoverEdge : cmd.feature.axis === a.id ? M.selEdge : M.axis));
  if (!picker) return;
  if (cmd?.sel) for (const id of cmd.sel.keys()) {
    const pos = edgePositions(id);
    if (pos.length) hlGroup.add(fat(pos, M.selEdge));
  }
  if (hover?.kind === 'edge') hlGroup.add(fat(edgePositions(hover.id), M.hoverEdge));
  if (hover?.kind === 'face') hlGroup.add(new THREE.Mesh(faceGeometry(hover.id), M.hoverFace));
}

// ---------- camera ----------
const fitBox = b => ({ c: b.getCenter(new THREE.Vector3()).toArray(), r: Math.max(b.getSize(new THREE.Vector3()).length() / 2, 25) });
function fitView(body) {
  const [min, max] = body ? body.boundingBox.bounds : [[-30, -30, 0], [30, 30, 20]];
  const c = min.map((v, i) => (v + max[i]) / 2);
  const r = Math.max(Math.hypot(...max.map((v, i) => v - min[i])) / 2, 25);
  return { c, r };
}
// Height of the view at the target: both cameras show the same, so switching keeps the framing.
const viewHeight = () => (camera === ortho ? (ortho.top - ortho.bottom) / ortho.zoom : 2 * TAN * camera.position.distanceTo(controls.target));
function aim(target, dir, dist) {
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir.normalize(), dist);
  if (camera === ortho) {
    Object.assign(ortho, { top: TAN * dist, bottom: -TAN * dist, left: -TAN * dist * aspect, right: TAN * dist * aspect, zoom: 1 });
    ortho.updateProjectionMatrix();
  }
  controls.update();
  draw();
}
function useOrtho(on) {
  if (on !== (camera === ortho)) {
    const dir = camera.position.clone().sub(controls.target), h = viewHeight();
    (on ? ortho : persp).up.copy(camera.up);
    camera = controls.object = on ? ortho : persp;
    camera.add(sun);
    aim(controls.target.clone(), dir, h / 2 / TAN);
  }
  $('#proj').innerHTML = PROJ_ICON[+on];
  $('#proj').title = t(on ? 'view.ortho' : 'view.persp');
}
const PROJ_ICON = ['M3 9h12v12H3zM10 4h10v10H10M3 9l7-5M15 9l5-5M15 21l5-7', 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9']
  .map(d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="${d}"/></svg>`);
function home() {
  const { c, r } = asm ? fitBox(new THREE.Box3().setFromObject(asmGroup))
    : printMode && shown ? fitBox(new THREE.Box3().setFromObject(shownGroup)) : fitView(built.body);
  camera.up.set(0, 0, 1);
  // The print view looks from low down, to see the undersides that need support.
  aim(V(c), new THREE.Vector3(1, -1.3, printMode ? 0.3 : 1), r * 3.6);
}
function lookAtPlane(pl) {
  const { c, r } = fitView(sketch.before.body);
  const k = dot(c.map((v, i) => v - pl.o[i]), pl.n);
  const target = c.map((v, i) => v - k * pl.n[i]); // body center, dropped onto the sketch plane
  camera.up.copy(V(pl.v));
  aim(V(target), V(pl.n), Math.max(r, 40) * 3.6);
}
// Leaving a sketch goes back to the view the kid had picked for the model.
function sketchControls(on) {
  const flat = on && !sketch?.picking; // picking a new plane needs orbiting to reach every face
  controls.enableRotate = !flat;
  controls.mouseButtons.LEFT = !flat ? THREE.MOUSE.ROTATE : sketch?.tool ? null : THREE.MOUSE.PAN;
  if (!on) useOrtho(modelOrtho);
}
$('#home').onclick = () => (sketch ? lookAtPlane(sketch.plane) : home());
$('#proj').onclick = () => {
  useOrtho(camera !== ortho);
  if (!sketch) modelOrtho = camera === ortho;
};
useOrtho(false);

// ---------- timeline actions ----------
// Timeline names like Fusion: Sketch1, Extrude2... in the current language.
// A kid can name a feature (Name field in its panel); without one it is Sketch1, Extrude2...
const autoName = (i, type) => t(`feature.${type}`) + (features.slice(0, i).filter(f => f.type === type).length + 1);
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const nameAt = (i, f) => esc(f.name || autoName(i, f.type));
const nameField = (name, auto) => `<label>${t('dlg.name')}<input type="text" data-k="name" maxlength="30" value="${esc(name || '')}" placeholder="${esc(auto)}"></label>`;
const pushUndo = () => { undoStack.push(structuredClone(asm ? asm.joints : features)); if (undoStack.length > 50) undoStack.shift(); };

function rebuildAll() {
  built = cad.rebuild(features);
  if (lesson) compare();
  drawDiff();
  refresh();
}

function compare() {
  Object.assign(lesson, cad.compare(built.body, lesson.goalBody, showDiff));
}

function drawDiff() {
  clear(diffGroup);
  for (const kind of showDiff ? ['missing', 'extra'] : []) {
    const shape = lesson?.diff?.[kind];
    if (!shape) continue;
    const o = bodyObjects(shape);
    o.lines.geometry.dispose();
    o.mesh.material = M[kind];
    o.mesh.renderOrder = 5;
    diffGroup.add(o.mesh);
  }
  if (lesson?.goalBody) renderLearn();
}

function undoLast() {
  if (!undoStack.length) return;
  sketch = cmd = acmd = null;
  pickingPlane = false;
  sketchControls(false);
  if (asm) asm.joints = undoStack.pop();
  else features = undoStack.pop();
  rebuildAll();
}

// Features whose material a pattern can copy, with their timeline index.
const patternable = index => features.slice(0, index).map((f, i) => [f, i]).filter(([f]) => ['extrude', 'revolve', 'hole'].includes(f.type));

function defaultSketch(index) {
  const prior = features.slice(0, index);
  const used = new Set(prior.filter(f => (f.type === 'extrude' || f.type === 'revolve')).map(f => f.sketch));
  const sketches = prior.filter(f => f.type === 'sketch');
  return (sketches.findLast(f => !used.has(f.id)) || sketches.at(-1))?.id || '';
}

const DEFAULTS = {
  extrude: i => ({ sketch: defaultSketch(i), distance: 10, op: 'join' }),
  fillet: () => ({ edges: [], r: 2 }),
  chamfer: () => ({ edges: [], r: 1 }),
  hole: () => ({ face: null, x: 0, y: 0, d: 6, depth: 0 }),
  thread: () => ({ face: null, pitch: 2 }),
  revolve: i => ({ sketch: defaultSketch(i), axis: 'v', angle: 360, op: 'join' }),
  pattern: i => ({ of: patternable(i).at(-1)?.[0].id || '', kind: 'rect', nx: 2, dx: 10, ny: 1, dy: 10, nz: 1, dz: 10, n: 6 }),
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
  if (!cmd || inputError() || cmd.preview.errors[cmd.feature.id]) return;
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
  sketch = { index, feature: structuredClone(feature), plane, before, tool: null, pts: [], cursor: null, sel: -1, picking: false };
  sketchControls(true);
  useOrtho(true);
  lookAtPlane(plane);
  refresh();
}

// Delete is finishSketch(false). A new sketch with nothing drawn is dropped either way.
function finishSketch(keep = true) {
  if (keep && inputError()) return;
  const { index, feature } = sketch;
  const isNew = index === features.length, add = keep && (feature.shapes.length || !isNew) ? [feature] : [];
  if (add.length || !isNew) {
    pushUndo();
    features.splice(index, isNew ? 0 : 1, ...add);
  }
  sketch = null;
  sketchControls(false);
  rebuildAll();
  home();
}

// Redefine Sketch Plane: back to the 3D view to click another plane or face. The shapes keep their sketch coordinates.
function replane(on) {
  Object.assign(sketch, { picking: on, tool: null, pts: [] });
  hover = null;
  sketchControls(true);
  on ? home() : lookAtPlane(sketch.plane);
  refresh();
}

function editFeature(i) {
  const f = features[i];
  pickingPlane = false;
  cmd = null;
  if (f.type === 'sketch') enterSketch(i, f);
  else startCommand(f.type, i, f);
}

// STL is for the 3D printer; STEP opens in Fusion (File → Open) to keep designing there.
// Save writes the timeline itself (Open reads it back); STL and STEP only carry the shape.
function exportFile(kind) {
  const a = document.createElement('a');
  // STEP keeps the design position (to keep designing in Fusion); STL is placed on the bed, ready to print.
  a.href = URL.createObjectURL(kind === 'save' ? new Blob([JSON.stringify({ app: 'cad-teacher', version: 1, features })], { type: 'application/json' })
    : kind === 'step' ? cad.stepOf(built.body) : cad.stlOf(cad.onBed(built.body, printDown)));
  a.download = `${lesson?.def.id || 'my-design'}.${kind === 'save' ? 'cadteacher.json' : kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (kind !== 'stl') flash(t(kind === 'step' ? 'hint.stepSaved' : 'hint.saved'), 8000);
}

const TYPES = ['sketch', 'extrude', 'revolve', 'fillet', 'chamfer', 'hole', 'thread', 'pattern'];
const validId = id => typeof id === 'string' && /^[\w-]+$/.test(id) && !Object.hasOwn(Object.prototype, id);
function validImport(features) {
  if (!Array.isArray(features)) return false;
  const types = new Map();
  for (const f of features) {
    if (!f || !TYPES.includes(f.type) || !validId(f.id) || types.has(f.id)) return false;
    types.set(f.id, f.type);
  }
  return features.every(f => {
    const ref = f.type === 'extrude' || f.type === 'revolve' ? 'sketch' : f.type === 'pattern' ? 'of' : null;
    const allowed = ref === 'sketch' ? ['sketch'] : ['extrude', 'revolve', 'hole'];
    // Deleting a referenced feature leaves a red timeline item that can still be saved and opened.
    return !ref || (validId(f[ref]) && (!types.has(f[ref]) || allowed.includes(types.get(f[ref]))));
  });
}
async function openFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== 'cad-teacher' || !validImport(data.features)) throw 0;
  } catch { return flash(t('err.badFile')); }
  if (lesson) openFree();
  // Bad values show as red features, like in any timeline; anything worse is undone.
  try { replaceDesign(data.features); } catch { undoLast(); flash(t('err.badFile')); }
}
// New and Open replace the free design; Ctrl+Z brings the old one back.
function replaceDesign(list) {
  sketch = cmd = null;
  pickingPlane = false;
  sketchControls(false);
  pushUndo();
  features = list;
  bumpUid(features);
  rebuildAll();
  home();
}

function act(id, fromKey = false) {
  if (asm) return asmAct(id);
  if (sketch) {
    if (sketch.picking) replane(false);
    if (id === 'finish') return finishSketch();
    sketch.tool = sketch.tool === id && !fromKey ? null : id;
    sketch.pts = [];
    sketchControls(true);
    return refresh();
  }
  if (id === 'undo') return undoLast();
  if (id === 'stl' || id === 'step' || id === 'save') return exportFile(id);
  if (id === 'open') return $('#open-file').click();
  if (id === 'new') return replaceDesign([]);
  cmd = null;
  hover = null;
  printMode = id === 'print' && !printMode;
  if (id === 'print') { pickingPlane = false; refresh(); return home(); }
  pickingPlane = id === 'sketch';
  if (pickingPlane) return refresh();
  startCommand(id);
}

function escape() {
  if (sketch?.picking) return replane(false);
  if (sketch) {
    if (sketch.pts.length) sketch.pts = [];
    else sketch.tool = null;
    sketchControls(true);
  } else {
    cmd = acmd = null;
    pickingPlane = false;
    if (printMode) { printMode = false; refresh(); return home(); }
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
  const axes = revolveAxes();
  if (axes.length) {
    setRay(e);
    const tol = viewHeight() * 0.016;
    const near = axes.map(a => ({ id: a.id, d: ray.ray.distanceSqToSegment(V(a.pos.slice(0, 3)), V(a.pos.slice(3))) })).sort((a, b) => a.d - b.d)[0];
    return near.d < tol * tol ? { kind: 'axis', id: near.id } : null;
  }
  const choosing = pickingPlane || sketch?.picking;
  const threading = cmd?.feature.type === 'thread';
  const wantEdge = !!cmd?.sel, wantFace = choosing || printMode || threading || cmd?.feature.type === 'hole';
  if (!wantEdge && !wantFace) return null;
  setRay(e);
  const meshHit = picker && ray.intersectObject(picker.mesh)[0];
  if (wantEdge) {
    if (!picker) return null;
    const tol = (ray.params.Line.threshold = viewHeight() * 0.016);
    // Of the visible edges near the cursor, take the one closest to it (short edges meet long ones at corners).
    const h = ray.intersectObject(picker.lines)
      .filter(h => !meshHit || h.distance <= meshHit.distance + tol)
      .sort((a, b) => ray.ray.distanceSqToPoint(a.point) - ray.ray.distanceSqToPoint(b.point))[0];
    if (!h) return null;
    const g = picker.m.edges.edgeGroups.find(g => h.index >= g.start && h.index < g.start + g.count);
    return g && { kind: 'edge', id: g.edgeId };
  }
  // The part's faces win over the see-through origin planes in front of them.
  if (!meshHit) {
    const planeHit = choosing && ray.intersectObjects(originPlanes)[0];
    return planeHit ? { kind: 'plane', id: planeHit.object.userData.base } : null;
  }
  const tri = meshHit.faceIndex * 3;
  const g = picker.m.faces.faceGroups.find(g => tri >= g.start && tri < g.start + g.count);
  const ref = g && (threading ? cad.cylRef(picker.body, g.faceId) : faceRefOf(g.faceId));
  return ref && { kind: 'face', id: g.faceId, ref, point: meshHit.point.toArray() };
}

function modelClick(e) {
  const h = pick(e);
  if (!h) return;
  if (printMode) { printDown = h.ref.n; hover = null; refresh(); return home(); } // lay this face on the bed
  if (h.kind === 'axis') { cmd.feature.axis = h.id; updatePreview(); return refresh(); }
  const plane = h.kind === 'plane' ? { base: h.id } : { face: h.ref };
  if (pickingPlane) return enterSketch(features.length, { type: 'sketch', id: 'u' + ++uid, plane, shapes: [] });
  if (sketch) {
    sketch.feature.plane = plane;
    sketch.plane = cad.resolvePlane(plane, sketch.before.body);
    return replane(false);
  }
  if (h.kind === 'edge') {
    if (cmd.sel.has(h.id)) cmd.sel.delete(h.id);
    else cmd.sel.set(h.id, cad.edgeRef(picker.body, h.id));
    cmd.feature.edges = [...cmd.sel.values()];
  } else if (cmd.feature.type === 'thread') {
    cmd.feature.face = h.ref;
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
    : `${c[0]}, ${c[1]} · ${fmt(Math.hypot(c[0] - sketch.pts.at(-1)[0], c[1] - sketch.pts.at(-1)[1]))} mm`;
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
  } else if (!moved && (!sketch || sketch.picking)) (asm ? asmClick(e) : modelClick(e));
});
canvas.addEventListener('pointermove', e => {
  if (sketch && !sketch.picking) {
    if (!sketch.tool) return;
    sketchCursor(e);
    drawSketches();
    draw();
    return;
  }
  const h = asm ? (acmd?.kind === 'joint' ? pickRim(e) : null) : pick(e);
  canvas.style.cursor = h ? 'pointer' : '';
  if (h?.kind !== hover?.kind || h?.id !== hover?.id || h?.comp !== hover?.comp) {
    hover = h;
    asm ? drawAssembly() : drawHighlights();
    draw();
  }
});
canvas.addEventListener('pointerleave', () => { $('#readout').hidden = true; });

addEventListener('keydown', e => {
  if (e.target.closest?.('input, select')) {
    if (e.key === 'Enter' && cmd) commitCommand();
    if (e.key === 'Enter' && acmd) commitAsm();
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.key === 'Escape') return escape();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undoLast(); }
  if ((e.ctrlKey || e.metaKey) && 'so'.includes(e.key.toLowerCase()) && !asm && !sketch) { e.preventDefault(); return act(e.key.toLowerCase() === 's' ? 'save' : 'open'); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Same shortcuts as Fusion 360.
  const id = (asm ? { j: 'joint' } : sketch ? { l: 'line', r: 'rect', c: 'circle' } : { e: 'extrude', h: 'hole', f: 'fillet' })[e.key.toLowerCase()];
  const b = id && document.querySelector(`[data-tool="${id}"]`);
  if (b && !b.disabled) act(id, true);
});

// ---------- panels ----------
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
const ICON = {
  sketch: svg('<rect x="3" y="7" width="12" height="12" rx="1"/><path d="M13 13l7-7 2 2-7 7-3 1z"/>'),
  extrude: svg('<path d="M3 16l9 4 9-4-9-4z"/><path d="M12 14V3M8.5 6.5L12 3l3.5 3.5"/>'),
  hole: svg('<path d="M3 9l9-4 9 4-9 4z"/><path d="M3 9v7l9 4 9-4V9"/><ellipse cx="12" cy="9" rx="3" ry="1.4" fill="currentColor"/>'),
  thread: svg('<path d="M8 3h8v18H8z"/><path d="M8 8l8-3M8 12l8-3M8 16l8-3M8 20l8-3"/>'),
  fillet: svg('<path d="M4 21V12a8 8 0 0 1 8-8h9"/>'),
  chamfer: svg('<path d="M4 21v-9l8-8h9"/>'),
  line: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12"/><circle cx="4" cy="6" r="1.5"/><circle cx="20" cy="18" r="1.5"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  finish: svg('<path d="M4 12.5l5 5L20 6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  new: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/>'),
  open: svg('<path d="M3 6h6l2 2h10v11H3z"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  stl: svg('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>'),
  step: svg('<path d="M12 3v9M8 8l4 4 4-4"/><path d="M4 14l8 4 8-4M4 14v4l8 4 8-4v-4"/>'),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><path d="M7 14h10v7H7z"/><path d="M10 17h4" stroke-width="2"/>'),
  revolve: svg('<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M12 6c5 0 7 2 7 6s-2 6-7 6"/><path d="M8 16l-2 2 2 2"/><path d="M6 18h6"/>'),
  pattern: svg('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1" opacity=".55"/><rect x="3" y="15" width="6" height="6" rx="1" opacity=".55"/><rect x="15" y="15" width="6" height="6" rx="1" opacity=".55"/>'),
  joint: svg('<circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><circle cx="7" cy="12" r="1" fill="currentColor"/><path d="M11 12h2"/>'),
  drive: svg('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 2v4h-4"/><circle cx="12" cy="12" r="2"/>'),
};

const toolBtn = (id, { on = false, disabled = false, key = '' } = {}) =>
  `<button class="tool${on ? ' on' : ''}" data-tool="${id}"${disabled ? ' disabled' : ''} title="${t(`tool.${id}`)}${key ? ` (${key})` : ''}">${ICON[id]}<span>${t(`tool.${id}`)}</span></button>`;
const group = (id, items) => `<div class="group"><div class="row">${items.join('')}</div><div class="glabel">${t(`group.${id}`)}</div></div>`;

function renderToolbar() {
  $('#tab').textContent = t(sketch ? 'tab.sketch' : 'tab.solid');
  if (asm) {
    $('#tools').innerHTML = group('assemble', [
      toolBtn('joint', { on: acmd?.kind === 'joint', key: 'J' }),
      toolBtn('drive', { on: acmd?.kind === 'drive', disabled: !asm.joints.some(j => j.type === 'revolute') }),
    ]) + group('file', [toolBtn('undo', { disabled: !undoStack.length, key: 'Ctrl+Z' })]);
    return;
  }
  const type = cmd?.feature.type, body = !!built.body;
  $('#tools').innerHTML = sketch
    ? group('create', [
      toolBtn('line', { on: sketch.tool === 'line', key: 'L' }),
      toolBtn('rect', { on: sketch.tool === 'rect', key: 'R' }),
      toolBtn('circle', { on: sketch.tool === 'circle', key: 'C' }),
    ]) + group('finish', [toolBtn('finish')])
    : group('create', [
      toolBtn('sketch', { on: pickingPlane }),
      toolBtn('extrude', { on: type === 'extrude', disabled: !features.some(f => f.type === 'sketch'), key: 'E' }),
      toolBtn('revolve', { on: type === 'revolve', disabled: !features.some(f => f.type === 'sketch') }),
      toolBtn('hole', { on: type === 'hole', disabled: !body, key: 'H' }),
      toolBtn('thread', { on: type === 'thread', disabled: !body }),
      toolBtn('pattern', { on: type === 'pattern', disabled: !patternable(features.length).length }),
    ]) + group('modify', [
      toolBtn('fillet', { on: type === 'fillet', disabled: !body, key: 'F' }),
      toolBtn('chamfer', { on: type === 'chamfer', disabled: !body }),
    ]) + group('print', [toolBtn('print', { on: printMode, disabled: !body })]) + group('file', [
      toolBtn('undo', { disabled: !undoStack.length, key: 'Ctrl+Z' }),
      ...(lesson ? [] : [toolBtn('new', { disabled: !features.length })]),
      toolBtn('open', { key: 'Ctrl+O' }),
      toolBtn('save', { disabled: !features.length, key: 'Ctrl+S' }),
      toolBtn('stl', { disabled: !body }),
      toolBtn('step', { disabled: !body }),
    ]);
}
$('#tools').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) act(b.dataset.tool);
});

// Text fields, not type=number: kids type "3,5" in fr/es/de, and number inputs drop that in some browsers.
const showNum = v => Number(v).toLocaleString(lang, { useGrouping: false, maximumFractionDigits: 3 });
const num = (label, value, attrs) => `<label>${t(label)}<input type="text" inputmode="decimal" value="${showNum(value)}" ${attrs}></label>`;
const inputError = () => $('#dialog input:invalid')?.validationMessage || '';
function numberValue(el) {
  const value = el.value.trim().replace(',', '.');
  const n = value ? Number(value) : NaN;
  el.setCustomValidity(Number.isFinite(n) ? '' : t('err.numberFinite'));
  return n;
}
const select = (label, k, value, options) =>
  `<label>${t(label)}<select data-k="${k}">${options.map(([v, text]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
const SHAPE_FIELDS = {
  rect: [['x', 'field.cx'], ['y', 'field.cy'], ['w', 'field.w'], ['h', 'field.h']],
  circle: [['x', 'field.cx'], ['y', 'field.cy'], ['d', 'field.d']],
  poly: [],
};

function renderDialog() {
  const el = $('#dialog');
  el.hidden = !sketch && !cmd && !acmd;
  if (acmd) return renderAsmDialog(el);
  if (sketch) {
    const rows = sketch.feature.shapes.map((s, i) =>
      `<fieldset data-i="${i}"${i === sketch.sel ? ' class="sel"' : ''}><legend>${t(`shape.${s.kind}`)} ${i + 1}<button data-act="del-shape" data-i="${i}" title="${t('dlg.delete')}">✕</button></legend>` +
      SHAPE_FIELDS[s.kind].map(([k, label]) => num(label, s[k], `data-i="${i}" data-k="${k}"`)).join('') +
      (s.kind === 'poly' ? `<p class="note">${t('sketch.corners', { n: s.pts.length })}</p>` : '') + '</fieldset>').join('');
    el.innerHTML = `<div class="dh">${t('tab.sketch')}<small>${nameAt(sketch.index, sketch.feature)}</small></div>
      <div class="db">${nameField(sketch.feature.name, autoName(sketch.index, 'sketch'))}<button data-act="replane" class="wide${sketch.picking ? ' on' : ''}">${t(sketch.picking ? 'dlg.cancel' : 'sketch.replane')}</button>
      ${rows || `<p class="note">${t('sketch.empty')}</p>`}<p class="err" id="cmderr"></p></div>
      <div class="df"><button data-act="delete" class="danger">${t('dlg.delete')}</button><span></span><button data-act="finish" class="ok">${t('tool.finish')}</button></div>`;
    return;
  }
  if (!cmd) return;
  const f = cmd.feature;
  let body = '';
  const sketches = features.slice(0, cmd.index).map((g, i) => [g, i]).filter(([g]) => g.type === 'sketch');
  const profile = () => select('extrude.profile', 'sketch', f.sketch, sketches.map(([g, i]) => [g.id, nameAt(i, g)]));
  const operation = () => select('extrude.operation', 'op', f.op, [['join', t('extrude.join')], ['cut', t('extrude.cut')]]);
  if (f.type === 'extrude') {
    body = profile() + num('extrude.distance', f.distance, 'data-k="distance"') + operation();
  } else if (f.type === 'revolve') {
    body = profile() + select('revolve.axis', 'axis', f.axis, [['v', t('revolve.axisV')], ['h', t('revolve.axisH')]]) +
      num('revolve.angle', f.angle, 'data-k="angle"') + operation();
  } else if (f.type === 'pattern') {
    body = select('pattern.of', 'of', f.of, patternable(cmd.index).map(([g, i]) => [g.id, nameAt(i, g)])) +
      select('pattern.kind', 'kind', f.kind, [['rect', t('pattern.rect')], ['circle', t('pattern.circle')]]) +
      (f.kind === 'circle'
        ? `<p class="note">${t('pattern.circleNote')}</p>` + num('pattern.n', f.n, 'data-k="n"')
        : num('pattern.nx', f.nx, 'data-k="nx"') + num('pattern.dx', f.dx, 'data-k="dx"') + num('pattern.ny', f.ny, 'data-k="ny"') + num('pattern.dy', f.dy, 'data-k="dy"') +
          num('pattern.nz', f.nz ?? 1, 'data-k="nz"') + num('pattern.dz', f.dz ?? 10, 'data-k="dz"'));
  } else if (f.type === 'thread') {
    body = `<p class="note">${t(f.face ? 'thread.picked' : 'thread.pick')}</p>` + num('thread.pitch', f.pitch, 'data-k="pitch" step="0.5"');
  } else if (f.type === 'hole') {
    body = `<p class="note">${t(f.face ? 'hole.picked' : 'hole.pick')}</p>` +
      num('hole.x', f.x, 'data-k="x"') + num('hole.y', f.y, 'data-k="y"') +
      num('hole.d', f.d, 'data-k="d"') + num('hole.depth', f.depth, 'data-k="depth"');
  } else {
    body = `<p class="note">${tn('edges.picked', cmd.sel.size)}</p>` + num(`${f.type}.r`, f.r, 'data-k="r" step="0.5"');
  }
  const isNew = cmd.index === features.length;
  el.innerHTML = `<div class="dh">${t(`feature.${f.type}`).toLocaleUpperCase(lang)}<small>${nameAt(cmd.index, f)}</small></div>
    <div class="db">${nameField(f.name, autoName(cmd.index, f.type))}${body}<p class="err" id="cmderr"></p></div>
    <div class="df">${isNew ? '' : `<button data-act="delete" class="danger">${t('dlg.delete')}</button>`}<span></span><button data-act="cancel">${t('dlg.cancel')}</button><button data-act="ok" class="ok" id="okbtn">${t('dlg.ok')}</button></div>`;
  updateCmdError();
}
function updateCmdError() {
  if (acmd) return updateAsmError();
  if (sketch) {
    $('#cmderr').textContent = inputError();
    $('#dialog [data-act="finish"]').disabled = !!inputError();
    return;
  }
  if (!cmd) return;
  const err = cmd.preview.errors[cmd.feature.id];
  $('#cmderr').textContent = inputError() || (err ? t(err) : '');
  $('#okbtn').disabled = !!inputError() || !!err;
}

$('#dialog').addEventListener('input', e => {
  if (acmd) return asmInput(e.target);
  const el = e.target, k = el.dataset.k;
  if (!k) return;
  const text = el.tagName === 'SELECT' || k === 'name';
  const v = text ? el.value.trim() : numberValue(el);
  if (!text && !Number.isFinite(v)) return updateCmdError(); // keep the last preview while half-typed
  if (k === 'name') return void ((sketch || cmd).feature.name = v);
  if (sketch) {
    sketch.feature.shapes[+el.dataset.i][k] = v;
    updateCmdError();
    drawSketches();
    checkLesson();
    draw();
    return;
  }
  cmd.feature[k] = v;
  updatePreview();
  refresh(k === 'kind'); // switching pattern type shows other fields
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
  if (acmd) return a && asmDialogAct(a);
  if (a === 'finish') finishSketch();
  else if (a === 'del-shape') { sketch.feature.shapes.splice(+b.dataset.i, 1); sketch.sel = -1; refresh(); }
  else if (a === 'ok') commitCommand();
  else if (a === 'cancel') { cmd = null; refresh(); }
  else if (a === 'replane') replane(!sketch.picking);
  else if (a === 'delete') sketch ? finishSketch(false) : deleteFeature(cmd.index);
});

function renderTimeline() {
  if (asm) return renderJointTimeline();
  const active = sketch?.index ?? cmd?.index ?? -1;
  $('#chips').innerHTML = features.map((f, i) => {
    const err = built.errors[f.id], name = nameAt(i, f);
    const cls = ['chip', err && 'err', i === active && 'on', active >= 0 && i > active && 'rolled'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-i="${i}" title="${name}${err ? ': ' + t(err) : ''} (${t('timeline.edit')})">${ICON[f.type]}<span>${name}</span></button>`;
  }).join('') || `<span class="empty">${t('timeline.empty')}</span>`;
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (sketch) return flash(t('timeline.finishFirst'));
  if (asm) return editJoint(+b.dataset.i);
  editFeature(+b.dataset.i);
});

function hintText() {
  if (acmd) return t(acmd.kind === 'drive' ? 'hint.drive' : `hint.joint${[acmd.joint.moving, acmd.joint.fixed].filter(Boolean).length}`);
  if (asm) return t('hint.assembly');
  if (printMode) return `${printArea >= 1 ? t('print.area', { n: Math.round(printArea) }) : t('print.none')} · ${t('hint.print')}`;
  if (pickingPlane || sketch?.picking) return t('hint.plane');
  if (sketch) return t(sketch.tool ? `hint.${sketch.tool}${sketch.pts.length ? 1 : 0}` : 'hint.sketch');
  return t(cmd ? `hint.${cmd.feature.type}` : 'hint.model');
}
let flashTimer = 0;
const renderHint = () => { if (!flashTimer) $('#hint').textContent = hintText(); };
function flash(msg, ms = 2500) {
  $('#hint').textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashTimer = 0; renderHint(); }, ms);
}

// ---------- lessons ----------
// Menu and "Next" order: course by course, lessons first, then that course's challenges.
const ALL = COURSES.flatMap(c => [
  ...LESSONS.filter(d => d.course === c).map(def => ({ def, challenge: false })),
  ...CHALLENGES.filter(d => d.course === c).map(def => ({ def, challenge: true })),
]);
const DONE_KEY = 'cad-teacher-done';
const doneIds = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch { return []; } };
const markDone = id => { try { localStorage.setItem(DONE_KEY, JSON.stringify([...new Set([...doneIds(), id])])); } catch { /* private mode */ } };

// Each lesson's work is kept in this browser, so a reload or coming back later picks up where the kid was.
// Outside lessons the kid has one free design, kept the same way under 'free'.
const workKey = id => 'cad-teacher-work:' + id;
const loadWork = id => { try { return JSON.parse(localStorage.getItem(workKey(id))); } catch { return null; } };
let freeLoaded = false; // the screen draws before the engine loads: don't save that empty design over the kept one
function saveWork() {
  if (!lesson && !freeLoaded) return;
  try { localStorage.setItem(workKey(lesson?.def.id || 'free'), JSON.stringify({ features, joints: asm?.joints, step: lesson?.step, lessonVersion: lesson?.def.version, printDown })); } catch { /* storage full or blocked */ }
}
// New ids must not collide with restored ones (u3, j2...).
const bumpUid = list => { for (const x of list) uid = Math.max(uid, +String(x.id).replace(/^\D+/, '') || 0); };

function openFree(saved = loadWork('free')) {
  sketch = cmd = acmd = lesson = null;
  pickingPlane = printMode = false;
  sketchControls(false);
  undoStack.length = 0;
  features = saved?.features || [];
  printDown = saved?.printDown || null;
  bumpUid(features);
  freeLoaded = true;
  $('#tip').hidden = true;
  clear(goalGroup);
  clear(diffGroup);
  setAssembly(null);
  rebuildAll();
  renderLearn();
  home();
}

function openLesson(def, challenge, fresh = false) {
  sketch = cmd = acmd = null;
  pickingPlane = false;
  sketchControls(false);
  undoStack.length = 0;
  const saved = !fresh && loadWork(def.id);
  printMode = false;
  printDown = saved?.printDown || null;
  features = structuredClone(saved?.features || def.start || []);
  clear(goalGroup);
  setAssembly(def.assembly);
  if (asm && saved?.joints) asm.joints = saved.joints;
  bumpUid([...features, ...(asm?.joints || [])]);
  const goalBody = def.goal && cad.rebuild(def.goal).body;
  if (goalBody) goalGroup.add(fat(cad.meshOf(goalBody).edges.lines, M.goal));
  goalGroup.visible = showGoal;
  const steps = def.steps || [s => s.match];
  lesson = { def, challenge, steps, step: saved?.lessonVersion === def.version ? saved?.step || 0 : 0, startCount: (def.start || []).length, goal: goalBody && cad.metrics(goalBody), goalBody };
  rebuildAll();
  renderLearn();
  home();
}

function checkLesson() {
  if (!lesson) return;
  const s = {
    introAcknowledged: lesson.introAcknowledged, viewDirection: lesson.viewDirection, features, mode: sketch ? 'sketch' : 'model', draft: sketch?.feature.shapes, sketchOnFace: !!sketch?.feature.plane.face, sketchBase: sketch?.feature.plane.base,
    dialog: acmd?.kind ?? cmd?.feature.type, selected: cmd?.sel?.size || 0, holeFace: !!cmd?.feature.face, match: lesson.match, startCount: lesson.startCount,
    print: { on: printMode, area: printArea }, asm, picked: acmd?.kind === 'joint' ? [acmd.joint.moving, acmd.joint.fixed].filter(Boolean).length : 0, driven: !!asm?.driven,
  };
  const before = lesson.step;
  while (lesson.step < lesson.steps.length && lesson.steps[lesson.step](s)) lesson.step++;
  if (lesson.step === lesson.steps.length && before < lesson.step) markDone(lesson.def.id);
  if (lesson.step !== before || lesson.challenge) renderLearn();
}

const sizeOf = m => (m ? [0, 1, 2].map(i => fmt(m.max[i] - m.min[i])).join(' × ') : '-');
const volOf = m => (m ? Math.round(m.volume).toLocaleString(lang) + ' mm³' : '-');
// Text of a lesson or challenge ({ def, challenge }) from the locale files.
const ltKey = (x, k) => `${x.challenge ? 'challenge' : 'lesson'}.${x.def.id}.${k}`;
const lt = (x, k) => t(ltKey(x, k));
// Teach the CAD wording and pair it with a concrete explanation using the same terms.
// Array entries let lesson steps use the same dual format as introductions and glossary words.
const openSimple = new Set();
const explain = (key, cls = '', index) => {
  const text = suffix => index === undefined ? t(key + suffix) : t(key + suffix)[index];
  const id = index === undefined ? key : `${key}.${index}`;
  const tag = index === undefined ? 'p' : 'div';
  return `<${tag}${cls ? ` class="${cls}"` : ''}>${text('')}</${tag}>` + (has(key + '.simple')
    ? `<details class="simple" data-simple="${id}"${openSimple.has(id) ? ' open' : ''}><summary>${t('learn.simpleToggle')}</summary><${tag} class="simple-copy">${text('.simple')}</${tag}></details>`
    : '');
};

// Courses fold open like <details>. Only the course being worked on starts open, so every course title fits.
const openCourses = new Set();
function renderLearn() {
  const el = $('#learn');
  if (!lesson) {
    const done = doneIds(), next = ALL.find(x => !done.includes(x.def.id));
    if (!openCourses.size) openCourses.add((next || ALL[0]).def.course);
    const badge = (x, i) => (done.includes(x.def.id) ? '✅' : x.challenge ? `<b class="star" title="${t('learn.challengeBadge')}">★</b>` : `<b>${i + 1}</b>`);
    const item = (x, i) => `<li><button data-open="${x.def.id}"${x === next ? ' class="next"' : ''}>${badge(x, i)} ${lt(x, 'title')}</button></li>`;
    el.innerHTML = COURSES.map((c, ci) => {
      const items = ALL.filter(x => x.def.course === c), n = items.filter(x => done.includes(x.def.id)).length;
      const start = ci === 0 && !done.length ? ` <em class="tag">${t('learn.startHere')}</em>` : '';
      return `<details class="course-card" data-course="${c}"${openCourses.has(c) ? ' open' : ''}>
        <summary><span>${t(`course.${c}.title`)}${start}</span><small>${n}/${items.length}</small></summary>
        ${explain(`course.${c}.intro`, 'tip')}<ol class="menu">${items.map(item).join('')}</ol></details>`;
    }).join('') + `<p class="tip">${t('learn.tip')}</p>`;
    return;
  }
  const { def, challenge, steps, step } = lesson;
  const won = step >= steps.length;
  const next = ALL[ALL.findIndex(x => x.def === def) + 1];
  const introContent = def.id === 'intro' ? `<h2>${lt(lesson, 'title')}</h2>${explain(ltKey(lesson, 'intro'), 'tip')}
    ${won ? '' : `<section class="intro-step" aria-labelledby="intro-step-title">
      <small>${t('learn.step', { n: step + 1, total: steps.length })}</small>
      <h3 id="intro-step-title">${lt(lesson, 'stepTitles')[step]}</h3>
      ${explain(ltKey(lesson, 'steps'), '', step)}
      <div class="intro-nav">
        ${step > 0 && step <= def.concepts.length && !sketch ? `<button class="btn" data-act="intro-previous">${t('learn.previous')}</button>` : ''}
        ${step < def.concepts.length ? `<button class="btn primary" data-act="intro-continue">${t('learn.continue')}</button>` : ''}
      </div>
    </section>`}` : '';
  el.innerHTML = `<button class="back" data-act="back">${t('learn.back')}</button>
    <div class="course">${t(`course.${def.course}.title`)}</div>
    ${challenge
      ? `<h2>${t('learn.challenge', { title: lt(lesson, 'title') })}</h2>
        <p>${t('learn.build')}</p><ul class="brief">${lt(lesson, 'brief').map(b => `<li>${b}</li>`).join('')}</ul>
        <table class="cmp"><tr><th></th><th>${t('learn.yours')}</th><th>${t('learn.goal')}</th></tr>
        <tr><td>${t('learn.size')}</td><td>${sizeOf(lesson.mine)}</td><td>${sizeOf(lesson.goal)}</td></tr>
        <tr><td>${t('learn.volume')}</td><td>${volOf(lesson.mine)}</td><td>${volOf(lesson.goal)}</td></tr></table>`
      : def.id === 'intro' ? introContent : `<h2>${lt(lesson, 'title')}</h2>${explain(ltKey(lesson, 'intro'))}
        <ol class="steps">${lt(lesson, 'steps').map((text, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}">${text}</li>`).join('')}</ol>`}
    ${won ? `<div class="win"><b>${t('learn.win')}</b>${challenge ? '' : explain(ltKey(lesson, 'outro'))}${next ? `<button class="btn" data-act="next">${t('learn.next', { title: lt(next, 'title') })}</button>` : ''}</div>` : ''}
    ${lesson.goal ? `<label class="check"><input type="checkbox" data-act="goal"${showGoal ? ' checked' : ''}> ${t('learn.showGoal')}</label>
      <label class="check"><input type="checkbox" data-act="diff"${showDiff ? ' checked' : ''}> ${t('learn.showDiff')}</label>
      ${showDiff || lesson.diff?.failed ? `<p class="tip">${lesson.diff?.failed ? t('learn.diffFailed')
        : !lesson.diff ? t('learn.diffUnavailable')
        : lesson.match ? t('learn.diffNone')
        : lesson.diff.missing || lesson.diff.extra ? `<i class="sw miss"></i>${t('learn.diffMissing')} &nbsp; <i class="sw extra"></i>${t('learn.diffExtra')}`
        : t('learn.diffDifferent')}</p>` : ''}` : ''}
    <button class="btn" data-act="restart">${t('learn.restart')}</button>`;
}
$('#learn').addEventListener('click', e => {
  const el = e.target.closest('[data-open], [data-act]');
  if (!el) return;
  if (el.dataset.open) {
    const x = ALL.find(x => x.def.id === el.dataset.open);
    return openLesson(x.def, x.challenge);
  }
  const a = el.dataset.act;
  if (a === 'back') {
    // Reopen this lesson's course, or (once it is all done) let the menu open the next unfinished one.
    const c = lesson.def.course, done = doneIds();
    openCourses.clear();
    if (ALL.some(x => x.def.course === c && !done.includes(x.def.id))) openCourses.add(c);
    openFree();
  }
  else if (a === 'next') { const x = ALL[ALL.findIndex(x => x.def === lesson.def) + 1]; openLesson(x.def, x.challenge); }
  else if (a === 'intro-continue' && lesson.def.id === 'intro' && lesson.step < lesson.def.concepts.length) {
    lesson.introAcknowledged = lesson.step;
    lesson.viewDirection = undefined;
    refresh();
  }
  else if (a === 'intro-previous' && lesson.def.id === 'intro' && lesson.step > 0 && lesson.step <= lesson.def.concepts.length && !sketch) {
    lesson.step--;
    lesson.introAcknowledged = lesson.viewDirection = undefined;
    renderLearn();
    refresh();
    home();
  }
  else if (a === 'restart') openLesson(lesson.def, lesson.challenge, true);
});
// Glossary: hovering a <dfn data-term> word in the lesson text shows what it means.
$('#learn').addEventListener('mouseover', e => {
  const d = e.target.closest('[data-term]'), tip = $('#tip');
  if (!d) return;
  const k = `term.${d.dataset.term}.def`;
  tip.innerHTML = `<b>${t(`term.${d.dataset.term}.name`)}</b>${t(k)}${has(k + '.simple') ? `<i>${t('learn.simpleToggle')}: ${t(k + '.simple')}</i>` : ''}`;
  tip.hidden = false;
  const r = d.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  tip.style.top = (r.bottom + 6 + h < innerHeight ? r.bottom + 6 : r.top - h - 6) + 'px';
});
$('#learn').addEventListener('mouseout', e => { if (e.target.closest('[data-term]')) $('#tip').hidden = true; });
$('#learn').addEventListener('scroll', () => { $('#tip').hidden = true; });

// <details> toggle events don't bubble: listen in the capture phase to remember what the kid opened.
$('#learn').addEventListener('toggle', e => {
  const { course: c, simple } = e.target.dataset || {};
  if (c) e.target.open ? openCourses.add(c) : openCourses.delete(c);
  if (simple) e.target.open ? openSimple.add(simple) : openSimple.delete(simple);
}, true);
$('#learn').addEventListener('change', e => {
  if (e.target.dataset.act === 'goal') showGoal = goalGroup.visible = e.target.checked;
  if (e.target.dataset.act === 'diff') { showDiff = e.target.checked; compare(); drawDiff(); }
  draw();
});

// ---------- assembly ----------
// Components are other lessons' finished parts. Joints snap hole rims together (see assembly.js).
const asmGroup = new THREE.Group();
scene.add(asmGroup);
const compMats = [0xb9c4cc, 0xf0a04b, 0x7cc47f, 0xb48ae0, 0x6fb7e9].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
const parts = new Map(); // part id -> { body, objs, rims }, built once per session
function partOf(id) {
  if (!parts.has(id)) {
    const body = cad.rebuild(LESSONS.find(l => l.id === id).goal).body;
    parts.set(id, { body, objs: bodyObjects(body), rims: new Map() });
  }
  return parts.get(id);
}
function rimOf(part, edgeId) {
  const p = partOf(part);
  if (!p.rims.has(edgeId)) p.rims.set(edgeId, cad.rimRef(p.body, edgeId));
  return p.rims.get(edgeId);
}

function setAssembly(comps) {
  clear(asmGroup);
  asm = comps && { components: structuredClone(comps), joints: [], driven: false };
  if (!asm) return;
  asm.objs = asm.components.map((c, i) => {
    const p = partOf(c.part), g = new THREE.Group();
    const mesh = new THREE.Mesh(p.objs.mesh.geometry, compMats[i % compMats.length]);
    const lines = new THREE.LineSegments(p.objs.lines.geometry, M.edge);
    mesh.userData.keep = lines.userData.keep = true; // shared part geometry
    g.matrixAutoUpdate = false;
    g.userData.comp = c;
    g.add(mesh, lines, new THREE.Group());
    asmGroup.add(g);
    return g;
  });
}

// Two copies of the same part get numbered: "Arm link 1", "Arm link 2".
function compName(id) {
  const c = asm.components.find(c => c.id === id), same = asm.components.filter(x => x.part === c.part);
  return t(`lesson.${c.part}.title`) + (same.length > 1 ? ` ${same.indexOf(c) + 1}` : '');
}
const jointName = i => esc(asm.joints[i]?.name || t('feature.joint') + (i + 1));

// Joints as shown right now: the committed ones, plus the joint being edited or the angles being driven.
function shownJoints() {
  if (acmd?.kind === 'drive') return asm.joints.map(j => ({ ...j, angle: acmd.angles[j.id] ?? j.angle }));
  const js = [...asm.joints];
  if (acmd?.kind === 'joint') js.splice(acmd.index, acmd.index < asm.joints.length ? 1 : 0, acmd.joint);
  return js;
}

function drawAssembly() {
  const { T, errors } = poses(asm.components, shownJoints());
  asm.errors = errors;
  for (const g of asm.objs) {
    g.matrix.copy(T.get(g.userData.comp.id));
    g.matrixWorldNeedsUpdate = true;
    clear(g.children[2]);
  }
  const mark = (pick, mat) => {
    if (!pick) return;
    const g = asm.objs.find(g => g.userData.comp.id === pick.comp), m = partOf(g.userData.comp.part).objs.m;
    const grp = m.edges.edgeGroups.find(x => x.edgeId === pick.edge);
    if (grp) g.children[2].add(fat(m.edges.lines.slice(grp.start * 3, (grp.start + grp.count) * 3), mat));
  };
  if (acmd?.kind === 'joint') { mark(acmd.joint.moving, M.selEdge); mark(acmd.joint.fixed, M.selEdge); }
  mark(hover, M.hoverEdge);
  $('#parts').hidden = false;
  $('#parts').innerHTML = `<b>${t('asm.components')}</b>` + asm.components.map((c, i) =>
    `<div><i style="background:#${compMats[i % compMats.length].color.getHexString()}"></i>${compName(c.id)}${c.grounded ? ` <span title="${t('asm.grounded')}">📌</span>` : ''}</div>`).join('');
}

// The rim (circular edge on a flat face) under the cursor, on any component.
function pickRim(e) {
  setRay(e);
  scene.updateMatrixWorld();
  const tol = (ray.params.Line.threshold = viewHeight() * 0.016);
  const meshHit = ray.intersectObjects(asm.objs.map(g => g.children[0]), false)[0];
  const hits = ray.intersectObjects(asm.objs.map(g => g.children[1]), false)
    .filter(h => !meshHit || h.distance <= meshHit.distance + tol)
    .sort((a, b) => ray.ray.distanceSqToPoint(a.point) - ray.ray.distanceSqToPoint(b.point));
  for (const h of hits) {
    const comp = h.object.parent.userData.comp, m = partOf(comp.part).objs.m;
    const grp = m.edges.edgeGroups.find(x => h.index >= x.start && h.index < x.start + x.count);
    const rim = grp && rimOf(comp.part, grp.edgeId);
    if (rim) return { kind: 'rim', id: grp.edgeId, comp: comp.id, edge: grp.edgeId, rim };
  }
  return null;
}

function asmClick(e) {
  if (acmd?.kind !== 'joint') return;
  const h = pickRim(e);
  if (!h) return;
  const j = acmd.joint, pickRec = { comp: h.comp, edge: h.edge, rim: h.rim };
  // First pick = the part that moves (like Fusion). Clicking that part again re-picks it.
  if (!j.moving || h.comp === j.moving.comp) j.moving = pickRec;
  else j.fixed = pickRec;
  refresh();
}

function asmAct(id) {
  if (id === 'undo') return undoLast();
  hover = null;
  if (id === 'joint') acmd = { kind: 'joint', index: asm.joints.length, joint: { id: 'j' + ++uid, type: 'rigid', angle: 0, moving: null, fixed: null } };
  if (id === 'drive') acmd = { kind: 'drive', angles: {} };
  refresh();
}
function editJoint(i) {
  acmd = { kind: 'joint', index: i, joint: structuredClone(asm.joints[i]) };
  refresh();
}

function commitAsm() {
  if (inputError()) return;
  if (acmd.kind === 'joint') {
    if (asm.errors[acmd.joint.id]) return;
    pushUndo();
    asm.joints.splice(acmd.index, acmd.index < asm.joints.length ? 1 : 0, acmd.joint);
  } else {
    pushUndo();
    asm.joints = shownJoints();
  }
  acmd = null;
  refresh();
}
function asmDialogAct(a) {
  if (a === 'ok') return commitAsm();
  if (a === 'delete') { pushUndo(); asm.joints.splice(acmd.index, 1); }
  acmd = null;
  refresh();
}

const slider = (value, attrs) => `<input type="range" class="slider" min="-180" max="180" step="1" value="${value}" ${attrs}>`;
function renderAsmDialog(el) {
  let body;
  if (acmd.kind === 'drive') {
    const rev = asm.joints.map((j, i) => [j, i]).filter(([j]) => j.type === 'revolute');
    body = rev.map(([j, i]) => `<label>${jointName(i)} · ${compName(j.moving.comp)}</label>${slider(acmd.angles[j.id] ?? j.angle, `data-j="${j.id}"`)}`).join('');
  } else {
    const j = acmd.joint, who = p => (p ? `${compName(p.comp)} ✓` : `<i>${t('joint.pick')}</i>`);
    body = nameField(j.name, t('feature.joint') + (acmd.index + 1)) + `<p class="note">1. ${t('joint.moving')}: ${who(j.moving)}<br>2. ${t('joint.fixed')}: ${who(j.fixed)}</p>` +
      select('joint.type', 'type', j.type, [['rigid', t('joint.rigid')], ['revolute', t('joint.revolute')]]) +
      num('joint.angle', j.angle, 'data-k="angle"') + slider(j.angle, 'data-k="angle"');
  }
  const isNew = acmd.kind === 'drive' || acmd.index === asm.joints.length;
  const title = acmd.kind === 'drive' ? t('tool.drive').toLocaleUpperCase(lang) : `${t('feature.joint').toLocaleUpperCase(lang)}<small>${jointName(acmd.index)}</small>`;
  el.innerHTML = `<div class="dh">${title}</div>
    <div class="db">${body}<p class="err" id="cmderr"></p></div>
    <div class="df">${isNew ? '' : `<button data-act="delete" class="danger">${t('dlg.delete')}</button>`}<span></span><button data-act="cancel">${t('dlg.cancel')}</button><button data-act="ok" class="ok" id="okbtn">${t('dlg.ok')}</button></div>`;
  updateAsmError();
}
function updateAsmError() {
  const err = acmd.kind === 'joint' && asm.errors?.[acmd.joint.id];
  $('#cmderr').textContent = inputError() || (err && err !== 'err.jointPick' ? t(err) : ''); // still picking: the note says what to do
  $('#okbtn').disabled = !!inputError() || !!err;
}
function asmInput(el) {
  const text = el.tagName === 'SELECT' || el.dataset.k === 'name';
  const v = text ? el.value.trim() : numberValue(el);
  if (!text && !Number.isFinite(v)) return updateAsmError();
  if (el.dataset.j) {
    acmd.angles[el.dataset.j] = v;
    asm.driven = true;
  } else {
    acmd.joint[el.dataset.k] = v;
    // Keep the angle box and its slider in step.
    if (el.dataset.k === 'angle') $('#dialog').querySelectorAll('[data-k="angle"]').forEach(x => { if (x !== el) { x.value = x.type === 'range' ? v : showNum(v); x.setCustomValidity(''); } });
  }
  drawAssembly();
  renderHint();
  updateAsmError();
  checkLesson();
  draw();
}

function renderJointTimeline() {
  const active = acmd?.kind === 'joint' ? acmd.index : -1;
  $('#chips').innerHTML = asm.joints.map((j, i) => {
    const err = asm.errors?.[j.id], name = jointName(i);
    const cls = ['chip', err && 'err', i === active && 'on'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-i="${i}" title="${name}: ${compName(j.moving.comp)} → ${compName(j.fixed.comp)}${err ? ' · ' + t(err) : ''} (${t('timeline.edit')})">${ICON.joint}<span>${name}</span></button>`;
  }).join('') || `<span class="empty">${t('timeline.empty')}</span>`;
}

// ---------- print check ----------
// The part laid on the bed (printDown face down, or as designed), with every surface that would print
// in thin air painted red. The part, its highlights and the overlay share one placement matrix.
function drawPrint() {
  clear(printGroup);
  const m = printMode && shown ? printMatrix(shown.m.faces, printDown) : new THREE.Matrix4();
  for (const g of [shownGroup, hlGroup, printGroup]) { g.matrix.copy(m); g.matrixWorldNeedsUpdate = true; g.updateMatrixWorld(true); }
  bed.visible = printMode;
  for (const g of [goalGroup, sketchGroup]) g.visible = !printMode && (g !== goalGroup || showGoal);
  printArea = 0;
  if (!printMode || !shown) return;
  const { tris, area } = overhangs(shown.m.faces, m);
  printArea = area;
  if (!tris.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(shown.m.faces.vertices, 3));
  geo.setIndex(tris);
  const red = new THREE.Mesh(geo, M.overhang);
  red.renderOrder = 6;
  printGroup.add(red);
}

// ---------- refresh ----------
function refresh(full = true) {
  if (cmd || sketch || pickingPlane || asm || !built.body) printMode = false; // print check is for the finished part
  setShown(cmd ? cmd.preview.body : sketch ? sketch.before.body : built.body);
  setPicker(cmd ? cmd.before.body : sketch ? (sketch.picking ? sketch.before.body : null) : pickingPlane || printMode ? built.body : null);
  grid.visible = !sketch;
  diffGroup.visible = !sketch && !cmd && !printMode; // differences are about the finished part, not a preview
  drawPrint();
  originPlanes.forEach(p => (p.visible = pickingPlane || !!sketch?.picking || (lesson?.def.id === 'intro' && !sketch)));
  canvas.style.cursor = sketch?.tool ? 'crosshair' : '';
  if (!sketch?.tool) $('#readout').hidden = true;
  drawSketches();
  drawHighlights();
  if (asm) drawAssembly();
  else $('#parts').hidden = true;
  renderToolbar();
  renderTimeline();
  renderHint();
  if (full) renderDialog();
  else updateCmdError();
  checkLesson();
  saveWork();
  draw();
}

// ---------- language ----------
function applyLang() {
  document.documentElement.lang = lang;
  $('#lang').title = t('app.language');
  $('#home').title = t('app.home');
  $('#proj').title = t(camera === ortho ? 'view.ortho' : 'view.persp');
  $('#timeline-label').textContent = t('app.timeline');
  $('#version').title = t('app.version');
  $('#loading')?.replaceChildren(t('app.loading'));
}
$('#lang').innerHTML = Object.entries(LANGS).map(([k, d]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${d['lang.name']}</option>`).join('');
$('#lang').addEventListener('change', e => {
  setLang(e.target.value);
  applyLang();
  renderLearn();
  refresh();
});

// Which commit this page runs (stamped at deploy), linked to it on GitHub.
$('#version').textContent = VERSION;
if (VERSION !== 'dev') $('#version').href = `https://github.com/pgrandin/cad-teacher/commit/${VERSION}`;

$('#open-file').addEventListener('change', e => {
  if (e.target.files[0]) openFile(e.target.files[0]);
  e.target.value = '';
});

applyLang();
renderLearn();
refresh();
home();
try {
  await cad.init();
  $('#loading').remove();
  openFree();
} catch (e) {
  $('#loading').textContent = t('app.loadFailed', { msg: e?.message || e });
}
