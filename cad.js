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

// A whole round face, the outside of a shaft or the inside of a hole: its axis (point q, direction a),
// radius r, span t0..t1 along the axis from q, and out = material inside (a shaft). Null for other faces,
// and for part of a cylinder like a fillet.
function cylinderOf(f) {
  if (f.geomType !== 'CYLINDRE') return null;
  const { uMin, uMax } = f.UVBounds;
  if (uMax - uMin < 2 * Math.PI - 1e-6) return null;
  const [p1, p2] = [0, 0.25].map(u => f.pointOnSurface(u, 0.5).toTuple());
  const [n1, n2] = [p1, p2].map(p => unit(f.normalAt(p).toTuple()));
  const dn = add(n1, n2, -1), s = dot(add(p1, p2, -1), dn) / dot(dn, dn); // p - s·n is on the axis
  const a = unit(cross(n1, n2)), q = add(p1, n1, -s);
  const [t0, t1] = [0, 1].map(v => dot(add(f.pointOnSurface(0, v).toTuple(), q, -1), a)).sort((x, y) => x - y);
  return { q, a, r: Math.abs(s), out: s > 0, t0, t1, seam: p1 };
}

// Stored like faces: by geometry (middle of the axis, direction, radius), re-found after every rebuild.
// The axis is saved pointing to +X, +Y or +Z, whichever way the face was made.
export function cylRef(body, faceId) {
  const f = body.faces.find(f => f.hashCode === faceId), c = f && cylinderOf(f);
  if (!c) return null;
  const r6 = x => Math.round(x * 1e6) / 1e6 + 0, k = Math.sign(c.a[c.a.map(Math.abs).indexOf(Math.max(...c.a.map(Math.abs)))]);
  return { c: add(c.q, c.a, (c.t0 + c.t1) / 2).map(r6), a: c.a.map(x => r6(k * x)), r: r6(c.r) };
}

function findCylinder(body, ref) {
  let best = null, bestD = Infinity;
  for (const f of body.faces) {
    const c = f.geomType === 'CYLINDRE' && cylinderOf(f);
    if (!c || Math.abs(dot(c.a, ref.a)) < 0.999) continue;
    const d = dist(add(c.q, c.a, (c.t0 + c.t1) / 2), ref.c) + Math.abs(c.r - ref.r);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) throw new Error('err.noFace');
  return best;
}

// Thread (Fusion: Create → Thread, Modeled): a helical V-groove cut into the round face, pitch p apart.
// Its sides are 45° (printable, see the print course) and it is 0.4·p deep: a 10 mm screw and a nut
// drilled 9 mm, both pitch 2, fit with 0.3 mm of clearance.
// ponytail: one profile for every size; Fusion picks ISO/UNC sizes from a table.
function cutThread(body, c, p) {
  const k = 0.4 * p, e = 0.05 * p, len = c.t1 - c.t0;
  // Triangle in the XZ plane at the helix start, tip into the material, a bit less than p tall so the turns
  // don't touch. Inside a hole the points go the other way round, or the swept solid comes out inside out.
  const pts = c.out ? [[e, -(k + e)], [-k, 0], [e, k + e]] : [[-e, k + e], [k, 0], [-e, -(k + e)]];
  const profile = R.draw(pts[0]).lineTo(pts[1]).lineTo(pts[2]).close().sketchOnPlane(new R.Plane([c.r, 0, -p], [1, 0, 0], [0, -1, 0]));
  let g = R.genericSweep(profile.wire, R.makeHelix(p, len + 2 * p, c.r, [0, 0, -p], [0, 0, 1]), { frenet: true });
  // The helix runs one turn past each end, so the groove is open there; boxes trim it to the face.
  const w = c.r + 10, h = 3 * p + 1;
  g = g.cut(R.makeBox([-w, -w, -h], [w, w, 0])).cut(R.makeBox([-w, -w, len], [w, w, len + h]));
  // OpenCascade often gets a helical groove against a cylinder wrong (cuts nothing, or too much), depending
  // on how the two line up. So the groove never meets the kid's part directly: it is cut into (or added to)
  // a plain cylinder built here along Z, where the seams line up the way that works, and that threaded
  // cylinder is swapped in, its seam on the face's seam. A shaft loses its plain core and gets the threaded
  // one; a hole is filled, then cut again with the threaded tool. What the groove removes is known exactly
  // (its triangle, spun around), so the volume tells whether it worked; other start angles are the fallback.
  // ponytail: a hollow shaft or a cross hole through it gets filled in, fails the check, and errors.
  const core = R.makeCylinder(c.r, len, [0, 0, 0], [0, 0, 1]);
  // Z onto the axis, turned so the cylinder's seam (local +X) lies on the face's seam.
  const axis = cross([0, 0, 1], c.a), sin = Math.hypot(...axis), ax = axis.map(x => x / (sin || 1));
  let x = [1, 0, 0];
  if (sin > 1e-9) x = add(add(x.map(v => v * c.a[2]), cross(ax, x), sin), ax, dot(ax, x) * (1 - c.a[2])); // Rodrigues
  const toSeam = add(c.seam, c.q, -1), seam = Math.atan2(dot(cross(x, toSeam), c.a), dot(x, toSeam)) * 180 / Math.PI;
  const place = s => {
    s = s.rotate(seam, [0, 0, 0], [0, 0, 1]);
    if (sin > 1e-9) s = s.rotate(Math.atan2(sin, c.a[2]) * 180 / Math.PI, [0, 0, 0], ax);
    else if (c.a[2] < 0) s = s.rotate(180, [0, 0, 0], [1, 0, 0]);
    return s.translate(add(c.q, c.a, c.t0));
  };
  const want = k * k * 2 * Math.PI * (c.r + (c.out ? -k : k) / 3) * len / p, before = R.measureVolume(body);
  const plain = place(core.clone());
  // ponytail: 5 tries at most (each takes a second or more); lessons need one or two.
  for (let deg = 0; deg < 360; deg += 72) {
    try {
      const turned = g.clone().rotate(deg, [0, 0, 0], [0, 0, 1]);
      const threaded = place(c.out ? core.clone().cut(turned) : core.clone().fuse(turned));
      const b = c.out ? body.clone().cut(plain.clone()).fuse(threaded) : body.clone().fuse(plain.clone()).cut(threaded);
      if (Math.abs(before - R.measureVolume(b) - want) < 1e-3 * want) return clean(b);
    } catch { /* try the next angle */ }
  }
  throw new Error('err.threadFailed');
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

// Pattern copies the material another feature added or removed: in a grid along world X/Y/Z, or around
// the vertical axis through the origin.
// ponytail: fixed pattern directions (X/Y/Z, Z axis); Fusion lets you pick any edge or axis.
function patternCopies(tool, f) {
  const counts = f.kind === 'circle' ? [f.n] : [f.nx, f.ny, f.nz === undefined ? 1 : f.nz]; // older designs have no Z
  if (!counts.every(n => Number.isSafeInteger(n) && n >= 1)) throw new Error('err.patternCount');
  const total = counts.reduce((a, b) => a * b, 1);
  if (total < 2) throw new Error('err.patternCount');
  if (total > 100) throw new Error('err.patternLimit');
  if (f.kind !== 'circle' && ![f.dx, f.dy, f.dz === undefined ? 0 : f.dz].every(Number.isFinite)) throw new Error('err.numberFinite');
  const copies = [];
  if (f.kind === 'circle') {
    const [n] = counts;
    for (let k = 1; k < n; k++) copies.push(tool.clone().rotate(360 * k / n, [0, 0, 0], [0, 0, 1]));
  } else {
    const [nx, ny, nz] = counts;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++)
      if (i || j || k) copies.push(tool.clone().translate([i * f.dx, j * f.dy, k * (f.dz || 0)]));
  }
  return copies.reduce((a, b) => a.fuse(b));
}

// Errors are i18n keys (see locales/). OpenCascade's own failures map to one per feature type.
const FAIL = { extrude: 'err.extrudeFailed', revolve: 'err.revolveFailed', fillet: 'err.filletFailed', chamfer: 'err.chamferFailed', hole: 'err.holeFailed', pattern: 'err.patternFailed', thread: 'err.threadFailed' };

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
    } else body = clean(body ? body.fuse(solid) : solid); // a lone cylinder comes in two halves until cleaned
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
      } else if (f.type === 'thread') {
        if (!body) throw new Error('err.nothingToCut');
        if (!f.face) throw new Error('err.pickCylinder');
        // Under 0.5 mm the groove is too fine to print and slow to build.
        if (!(f.pitch >= 0.5)) throw new Error('err.threadPitch');
        body = cutThread(body, findCylinder(body, f.face), f.pitch);
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

// A fast preliminary check; equal volume and bounds do not prove that two parts match.
// Tight on volume: the kid's part and the goal come from the same engine, and a small fillet is only ~0.5%.
export function sameShape(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.volume - b.volume) <= Math.max(0.05, 1e-4 * b.volume) &&
    [0, 1, 2].every(i => Math.abs(a.min[i] - b.min[i]) < 0.1 && Math.abs(a.max[i] - b.max[i]) < 0.1);
}

// What separates a part from its goal: material the goal has and the part lacks (missing), and the
// reverse (extra). Works on copies, since booleans consume their inputs. Rounding slivers are ignored.
export function diff(mine, goal) {
  const cut = (a, b) => {
    const shape = b ? a.clone().cut(b.clone()) : a.clone();
    const volume = R.measureVolume(shape);
    if (!Number.isFinite(volume) || volume < -0.5) throw new Error('Invalid difference volume');
    return volume > 0.5 ? shape : null;
  };
  try {
    return { missing: cut(goal, mine), extra: mine ? cut(mine, goal) : null, failed: false };
  } catch {
    return { missing: null, extra: null, failed: true };
  }
}

// A part matches its goal when size and volume agree and nothing is missing or extra. Size and
// volume alone are fooled by a hole in the wrong place.
export function matches(mine, goal, d = diff(mine, goal)) {
  return sameShape(metrics(mine), metrics(goal)) && d?.failed === false && !d.missing && !d.extra;
}

// Booleans are expensive, so compare geometry only when the preliminary check passes or the
// learner asks to see differences. A skipped or failed comparison can never award completion.
export function compare(mine, goal, showDiff = false) {
  const measured = metrics(mine), same = sameShape(measured, metrics(goal));
  const d = goal && (same || showDiff) ? diff(mine, goal) : null;
  return { mine: measured, match: same && d?.failed === false && !d.missing && !d.extra, diff: d };
}

export const meshOf = body => ({
  faces: body.mesh({ tolerance: 0.05, angularTolerance: 0.2 }),
  edges: body.meshEdges({ tolerance: 0.05, angularTolerance: 0.2 }),
});

// The body as it sits on the printer bed: the face with outward normal n down (if given), centered,
// resting on z = 0. Exported STL files use this, so they open in the slicer ready to print.
export function onBed(body, n) {
  let b = body.clone();
  if (n) {
    const axis = cross(n, [0, 0, -1]), sin = Math.hypot(...axis), cos = -n[2];
    if (sin > 1e-9) b = b.rotate(Math.atan2(sin, cos) * 180 / Math.PI, [0, 0, 0], axis.map(x => x / sin));
    else if (cos < 0) b = b.rotate(180, [0, 0, 0], [1, 0, 0]);
  }
  const [min, max] = b.boundingBox.bounds;
  return b.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]);
}

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
