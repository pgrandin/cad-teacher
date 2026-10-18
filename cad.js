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

// ponytail: every closed shape in a sketch becomes solid (union); no Fusion-style profile picking.
function extrudeSketch(sk, pl, distance) {
  if (!sk.shapes.length) throw new Error('err.emptySketch');
  if (!distance) throw new Error('err.zeroDistance');
  return sk.shapes
    .map(s => drawingOf(s).sketchOnPlane(new R.Plane(pl.o, pl.u, pl.n)).extrude(distance))
    .reduce((a, b) => a.fuse(b));
}

// Errors are i18n keys (see locales/). OpenCascade's own failures map to one per feature type.
const FAIL = { extrude: 'err.extrudeFailed', fillet: 'err.filletFailed', chamfer: 'err.chamferFailed', hole: 'err.holeFailed' };

// Replays the timeline. A failing feature is skipped and reported, like a red item in Fusion.
export function rebuild(features) {
  let body = null;
  const errors = {}, planes = {};
  for (const f of features) {
    try {
      if (f.type === 'sketch') {
        planes[f.id] = resolvePlane(f.plane, body);
      } else if (f.type === 'extrude') {
        const sk = features.find(s => s.id === f.sketch);
        if (!sk || !planes[sk.id]) throw new Error('err.pickSketch');
        const solid = extrudeSketch(sk, planes[sk.id], f.distance);
        if (f.op === 'cut') {
          if (!body) throw new Error('err.nothingToCut');
          body = body.cut(solid);
        } else body = body ? body.fuse(solid) : solid;
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
        body = body.cut(R.makeCylinder(f.d / 2, depth + 1, add(p, pl.n, 1), pl.n.map(x => -x)));
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
export function sameShape(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.volume - b.volume) <= 0.005 * b.volume &&
    [0, 1, 2].every(i => Math.abs(a.min[i] - b.min[i]) < 0.1 && Math.abs(a.max[i] - b.max[i]) < 0.1);
}

export const meshOf = body => ({
  faces: body.mesh({ tolerance: 0.05, angularTolerance: 0.2 }),
  edges: body.meshEdges({ tolerance: 0.05, angularTolerance: 0.2 }),
});

export const stlOf = body => body.blobSTL({ binary: true });
