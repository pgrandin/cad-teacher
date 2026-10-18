// Geometry engine: a feature list in, a solid out. No DOM, so it also runs in Node (test.mjs).
import opencascade from './vendor/replicad_single.js';
import * as R from './vendor/replicad.js';

export async function init(wasm = new URL('./vendor/replicad_single.wasm', import.meta.url).href) {
  R.setOC(await opencascade({ locateFile: () => wasm }));
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => a.map((x, i) => x + k * b[i]);
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const BASE_PLANES = { XY: [0, 0, 1], XZ: [0, -1, 0], YZ: [1, 0, 0] };

// Sketch frame for a plane with normal n at offset d. Origin is the world origin projected
// onto the plane, so sketch coordinates line up with world X/Y like in Fusion.
export function planeFrom(n, d = 0) {
  const u = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : unit(cross([0, 0, 1], n));
  return { o: n.map(x => x * d), u, v: cross(n, u), n };
}

// Faces and edges are stored by geometry (normal + center, midpoint) and re-found after every
// rebuild, so editing an early feature keeps later ones attached.
// ponytail: nearest-match "topological naming"; big edits can grab the wrong edge, like real CAD does.
function findFace(body, ref) {
  let best = null, bestD = Infinity;
  for (const f of body.faces) {
    if (f.geomType !== 'PLANE' || dot(f.normalAt().toTuple(), ref.n) < 0.999) continue;
    const d = dist(f.center.toTuple(), ref.c);
    if (d < bestD) { best = f; bestD = d; }
  }
  if (!best) throw new Error('err.noFace');
  return best;
}

export function resolvePlane(spec, body) {
  if (spec.base) return planeFrom(BASE_PLANES[spec.base]);
  if (!body) throw new Error('err.noBodyToSketch');
  return planeFrom(spec.face.n, dot(spec.face.n, findFace(body, spec.face).center.toTuple()));
}

export function faceRef(body, faceId) {
  const f = body.faces.find(f => f.hashCode === faceId);
  if (!f || f.geomType !== 'PLANE') return null;
  return { n: f.normalAt().toTuple().map(x => Math.round(x * 1e6) / 1e6), c: f.center.toTuple() };
}

export function edgeRef(body, edgeId) {
  const e = body.edges.find(e => e.hashCode === edgeId);
  return e && { m: e.pointAt(0.5).toTuple(), g: e.geomType };
}

function findEdges(body, refs) {
  if (!refs.length) throw new Error('err.pickEdge');
  const edges = body.edges.map(e => [e, e.pointAt(0.5).toTuple(), e.geomType]);
  return refs.map(r => {
    let best = null, bestD = Infinity;
    for (const [e, m, g] of edges) if (g === r.g && dist(m, r.m) < bestD) { best = e; bestD = dist(m, r.m); }
    if (!best) throw new Error('err.noEdges');
    return best;
  });
}

// Edge ids (as in meshEdges) of the stored edges, so the UI can highlight them.
export const matchEdges = (body, refs) => (refs.length ? findEdges(body, refs).map(e => e.hashCode) : []);

function drawingOf(s) {
  if (s.kind === 'rect') return R.drawRectangle(s.w, s.h).translate(s.x, s.y);
  if (s.kind === 'circle') return R.drawCircle(s.d / 2).translate(s.x, s.y);
  let pen = R.draw(s.pts[0]);
  for (const p of s.pts.slice(1)) pen = pen.lineTo(p);
  return pen.close();
}

// Merge coplanar faces left by booleans, so fused shapes have no seam lines and fillets see whole faces.
const clean = shape => { try { return shape.simplify(); } catch { return shape; } };

// ponytail: every closed shape in a sketch becomes solid (union); no Fusion-style profile picking.
function extrudeSketch(sk, pl, distance) {
  if (!sk.shapes.length) throw new Error('err.emptySketch');
  if (!distance) throw new Error('err.zeroDistance');
  return sk.shapes
    .map(s => drawingOf(s).sketchOnPlane(new R.Plane(pl.o, pl.u, pl.n)).extrude(distance))
    .reduce((a, b) => clean(a.fuse(b)));
}

// Revolve spins each shape around the sketch's vertical ('v', sketch Y) or horizontal ('h', sketch X) axis.
// A shape that crosses the axis keeps only the half on its center's side, so a circle centered on the
// axis turns into a ball instead of a broken solid.
function revolveSketch(sk, pl, axis, angle) {
  if (!sk.shapes.length) throw new Error('err.emptySketch');
  if (!angle) throw new Error('err.zeroAngle');
  const v = axis === 'v';
  return sk.shapes.map(s => {
    const pts = s.kind === 'poly' ? s.pts : [[s.x, s.y]];
    const side = Math.sign(pts.reduce((sum, p) => sum + p[v ? 0 : 1], 0)) || 1;
    const half = v ? R.drawRectangle(2000, 4000).translate(1000 * side, 0) : R.drawRectangle(4000, 2000).translate(0, 1000 * side);
    return drawingOf(s).intersect(half).sketchOnPlane(new R.Plane(pl.o, pl.u, pl.n)).revolve(v ? pl.v : pl.u, { origin: pl.o, angle });
  }).reduce((a, b) => clean(a.fuse(b)));
}

// Pattern copies the material another feature added or removed: in a grid along world X/Y, or around
// the vertical axis through the origin.
// ponytail: fixed pattern directions (X/Y, Z axis); Fusion lets you pick any edge or axis.
function patternCopies(tool, f) {
  const copies = [];
  if (f.kind === 'circle') {
    const n = Math.round(f.n);
    if (!(n >= 2)) throw new Error('err.patternCount');
    for (let k = 1; k < n; k++) copies.push(tool.clone().rotate(360 * k / n, [0, 0, 0], [0, 0, 1]));
  } else {
    const nx = Math.round(f.nx), ny = Math.round(f.ny);
    if (!(nx >= 1 && ny >= 1 && nx * ny >= 2)) throw new Error('err.patternCount');
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (i || j) copies.push(tool.clone().translate([i * f.dx, j * f.dy, 0]));
  }
  return copies.reduce((a, b) => a.fuse(b));
}

// Errors are i18n keys (see locales/). OpenCascade's own failures map to one per feature type.
const FAIL = { extrude: 'err.extrudeFailed', revolve: 'err.revolveFailed', fillet: 'err.filletFailed', chamfer: 'err.chamferFailed', hole: 'err.holeFailed', pattern: 'err.patternFailed' };

// Replays the timeline. A failing feature is skipped and reported, like a red item in Fusion.
export function rebuild(features) {
  let body = null;
  const errors = {}, planes = {}, tools = {};
  const patterned = new Set(features.filter(f => f.type === 'pattern').map(f => f.of));
  // Booleans consume their inputs, so keep a copy of the tool when a pattern will need it later.
  const apply = (f, solid, op) => {
    if (patterned.has(f.id)) tools[f.id] = { solid: solid.clone(), op };
    if (op === 'cut') {
      if (!body) throw new Error('err.nothingToCut');
      body = clean(body.cut(solid));
    } else body = body ? clean(body.fuse(solid)) : solid;
  };
  for (const f of features) {
    try {
      if (f.type === 'sketch') {
        planes[f.id] = resolvePlane(f.plane, body);
      } else if (f.type === 'extrude' || f.type === 'revolve') {
        const sk = features.find(s => s.id === f.sketch);
        if (!sk || !planes[sk.id]) throw new Error('err.pickSketch');
        apply(f, f.type === 'extrude' ? extrudeSketch(sk, planes[sk.id], f.distance) : revolveSketch(sk, planes[sk.id], f.axis, f.angle), f.op);
      } else if (f.type === 'pattern') {
        if (!tools[f.of]) throw new Error('err.patternPick');
        if (!body) throw new Error('err.nothingToCut');
        apply(f, patternCopies(tools[f.of].solid, f), tools[f.of].op);
      } else if (f.type === 'fillet' || f.type === 'chamfer') {
        if (!body) throw new Error('err.nothingToRound');
        if (!(f.r > 0)) throw new Error('err.sizePositive');
        const chosen = findEdges(body, f.edges);
        body = body[f.type](e => (chosen.some(c => c.isSame(e)) ? f.r : null));
      } else if (f.type === 'hole') {
        if (!body) throw new Error('err.nothingToDrill');
        if (!f.face) throw new Error('err.pickFace');
        if (!(f.d > 0)) throw new Error('err.diameterPositive');
        const pl = resolvePlane({ face: f.face }, body);
        const p = add(add(pl.o, pl.u, f.x), pl.v, f.y);
        const depth = f.depth > 0 ? f.depth : 1000; // 0 = through all
        apply(f, R.makeCylinder(f.d / 2, depth + 1, add(p, pl.n, 1), pl.n.map(x => -x)), 'cut');
      }
    } catch (e) {
      errors[f.id] = e instanceof Error && e.message.startsWith('err.') ? e.message : FAIL[f.type] || 'err.failed';
    }
  }
  return { body, errors, planes };
}

export function metrics(body) {
  if (!body) return null;
  const [min, max] = body.boundingBox.bounds;
  return { volume: R.measureVolume(body), min, max };
}

// ponytail: same volume + same bounding box counts as "same part"; enough for lessons.
// Tight on volume: the kid's part and the goal come from the same engine, and a small fillet is only ~0.5%.
export function sameShape(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.volume - b.volume) <= Math.max(0.05, 1e-4 * b.volume) &&
    [0, 1, 2].every(i => Math.abs(a.min[i] - b.min[i]) < 0.1 && Math.abs(a.max[i] - b.max[i]) < 0.1);
}

// What separates a part from its goal: material the goal has and the part lacks (missing), and the
// reverse (extra). Works on copies, since booleans consume their inputs. Rounding slivers are ignored.
export function diff(mine, goal) {
  const keep = shape => (shape && R.measureVolume(shape) > 0.5 ? shape : null);
  const cut = (a, b) => { try { return keep(b ? a.clone().cut(b.clone()) : a.clone()); } catch { return null; } };
  return { missing: cut(goal, mine), extra: mine ? cut(mine, goal) : null };
}

// A part matches its goal when size and volume agree and nothing is missing or extra. Size and
// volume alone are fooled by a hole in the wrong place.
export function matches(mine, goal, d = diff(mine, goal)) {
  return sameShape(metrics(mine), metrics(goal)) && !d.missing && !d.extra;
}

export const meshOf = body => ({
  faces: body.mesh({ tolerance: 0.05, angularTolerance: 0.2 }),
  edges: body.meshEdges({ tolerance: 0.05, angularTolerance: 0.2 }),
});

export const stlOf = body => body.blobSTL({ binary: true });
export const stepOf = body => body.blobSTEP();

// A hole rim for joints: a circular edge on a flat face. Returns its center and the face's outward
// normal (part coordinates), or null when the edge is not a rim.
export function rimRef(body, edgeId) {
  const e = body.edges.find(e => e.hashCode === edgeId);
  if (!e || e.geomType !== 'CIRCLE') return null;
  const face = body.faces.find(f => f.geomType === 'PLANE' && f.edges.some(x => x.isSame(e)));
  if (!face) return null;
  // Circle center from three points on it.
  const [a, b, c] = [0, 1 / 3, 2 / 3].map(t => e.pointAt(t).toTuple());
  const ab = add(b, a, -1), ac = add(c, a, -1), n = cross(ab, ac);
  const k = 1 / (2 * dot(n, n));
  const p = add(cross(n, ab).map(x => x * dot(ac, ac) * k), cross(ac, n).map(x => x * dot(ab, ab) * k));
  const r6 = x => Math.round(x * 1e6) / 1e6 + 0; // + 0 turns -0 into 0
  return { c: add(a, p).map(r6), n: face.normalAt().toTuple().map(r6) };
}
