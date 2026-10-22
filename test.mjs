// node test.mjs — builds every lesson/challenge goal and checks the engine end to end.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as cad from './cad.js';
import { readFileSync } from 'node:fs';
import { LESSONS, CHALLENGES, COURSES } from './lessons.js';
import { LANGS } from './i18n.js';
import { poses } from './assembly.js';
import { overhangs, printMatrix } from './print.js';
import { Matrix4, Plane, Ray, Vector3 } from './vendor/three.module.js';
import { CUBE_VIEWS } from './view-cube.js';
import { Solid } from './vendor/replicad.js';

await cad.init(fileURLToPath(new URL('./vendor/replicad_single.wasm', import.meta.url)));
const PI = Math.PI;
const vol = fs => cad.metrics(cad.rebuild(fs).body).volume;
const integrate = (f, a, b, n = 1000) => { const h = (b - a) / n; let s = 0; for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h) * h; return s; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01 * b, `${a} != ${b}`);
const area = pts => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
// A gear tooth (Line shape from 1 mm inside a disc of radius r, 4 long, 4 → 2 wide): the part outside the disc.
const toothOut = r => integrate(x => { const w = 2 - (x - r + 1) / 4; return 2 * w - 2 * Math.min(w, Math.sqrt(Math.max(0, r * r - x * x))); }, r - 1, r + 3);
// Revolve volume of a profile drawn right of the axis (Pappus: area × the distance its centroid travels).
const revolved = pts => 2 * PI * Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p[0] + q[0]) * (p[0] * q[1] - q[0] * p[1]); }, 0)) / 6;
// Area a fillet of radius r takes off the corner b of an outline a → b → c.
const filletCut = (a, b, c, r) => {
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  const th = Math.acos((u[0] * v[0] + u[1] * v[1]) / Math.hypot(...u) / Math.hypot(...v));
  return r * r / Math.tan(th / 2) - r * r * (PI - th) / 2;
};
const KNIGHT_HEAD = [[-9, 7], [9, 7], [6, 15], [14, 22], [15, 27], [6, 34], [3, 40], [-1, 35], [-7, 30], [-10, 18]];
// Material a thread removes: a triangle 0.4·p deep and 0.8·p wide, spun around at its centroid, len/p turns.
const threadCut = (r, p, len, out) => (0.4 * p) ** 2 * 2 * PI * (r + (out ? -1 : 1) * 0.4 * p / 3) * len / p;

// Frames preserve the standard sketch axes and stay orthonormal for shallow/near-axis normals.
const V = a => new Vector3(...a);
for (const [base, u, v] of [['XY', [1, 0, 0], [0, 1, 0]], ['XZ', [1, 0, 0], [0, 0, 1]], ['YZ', [0, 1, 0], [0, 0, 1]]]) {
  const pl = cad.resolvePlane({ base });
  assert.ok(V(pl.u).distanceTo(V(u)) < 1e-12 && V(pl.v).distanceTo(V(v)) < 1e-12, `${base} orientation`);
}
for (const n of [...Object.values(cad.BASE_PLANES), [0, 0, -1], [2, 0, 10], [-2, 1, 10], [2, -1, -10],
  [1e-12, -1e-12, 1], [1e-12, 1, -1e-12], [-1, 1e-12, 1e-12]]) {
  const pl = cad.planeFrom(n, 7), axes = [pl.u, pl.v, pl.n].map(V);
  for (const axis of axes) assert.ok(Math.abs(axis.length() - 1) < 1e-12, `unit axis for ${n}`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(axes[i].dot(axes[(i + 1) % 3])) < 1e-12, `perpendicular axes for ${n}`);
  assert.ok(axes[0].clone().cross(axes[1]).distanceTo(axes[2]) < 1e-12, `right-handed frame for ${n}`);
  const point = V(pl.o).addScaledVector(axes[0], 20).addScaledVector(axes[1], 7);
  assert.ok(Math.abs(point.dot(axes[2]) - 7) < 1e-12, `sketch point stays on plane for ${n}`);
}

// Real wedges in both slope directions: drawing/picking and the CAD kernel share the same frame.
for (const slope of [1, -1]) {
  const wedge = [
    { type: 'sketch', id: 'w', plane: { base: 'XZ' }, shapes: [{ kind: 'poly', pts: [[0, 0], [20, 0], [20, 10 - 2 * slope], [0, 10 + 2 * slope]] }] },
    { type: 'extrude', id: 'e', sketch: 'w', distance: 10, op: 'join' },
  ];
  const before = cad.rebuild(wedge);
  assert.deepEqual(before.errors, {});
  const face = before.body.faces.find(f => f.normalAt().toTuple()[2] > 0.9);
  const ref = cad.faceRef(before.body, face.hashCode), pl = cad.resolvePlane({ face: ref }, before.body);
  const n = V(face.normalAt().toTuple()), center = V(face.center.toTuple());
  assert.ok(V(pl.n).distanceTo(n) < 1e-12, 'use the actual face normal, not the rounded saved reference');
  const matrix = new Matrix4().makeBasis(V(pl.u), V(pl.v), V(pl.n)).setPosition(V(pl.o)); // planeGroup
  const point = new Vector3(8, -5, 0).applyMatrix4(matrix);
  assert.ok(Math.abs(point.clone().sub(center).dot(n)) < 1e-9, 'rendered sketch stays on the face');
  const hit = new Ray(point.clone().addScaledVector(n, 30), n.clone().negate())
    .intersectPlane(new Plane(V(pl.n), -V(pl.n).dot(V(pl.o))), new Vector3()).sub(V(pl.o)); // sketchCursor
  assert.ok(Math.abs(hit.dot(V(pl.u)) - 8) < 1e-9 && Math.abs(hit.dot(V(pl.v)) + 5) < 1e-9, 'cursor recovers sketch coordinates');
  const raised = cad.rebuild([...wedge,
    { type: 'sketch', id: 's', plane: { face: ref }, shapes: [{ kind: 'rect', x: 8, y: -5, w: 4, h: 4 }] },
    { type: 'extrude', id: 'r', sketch: 's', distance: 3, op: 'join' },
  ]);
  assert.deepEqual(raised.errors, {});
  assert.ok(Math.abs(cad.metrics(raised.body).volume - cad.metrics(before.body).volume - 48) < 1e-6, 'sloped extrusion adds the full rectangle volume');
  const vertices = cad.meshOf(raised.body).faces.vertices;
  for (const x of [6, 10]) for (const y of [-7, -3]) {
    const corner = new Vector3(x, y, 3).applyMatrix4(matrix);
    let distance = Infinity;
    for (let i = 0; i < vertices.length; i += 3) distance = Math.min(distance, corner.distanceTo(V(vertices.slice(i, i + 3))));
    assert.ok(distance < 1e-6, 'extruded corner agrees with the rendered sketch');
  }
  const drilled = cad.rebuild([...wedge, { type: 'hole', id: 'h', face: ref, x: 8, y: -5, d: 2, depth: 2 }]);
  assert.deepEqual(drilled.errors, {});
  assert.ok(Math.abs(cad.metrics(before.body).volume - cad.metrics(drilled.body).volume - 2 * PI) < 1e-6, 'hole depth follows the face normal');
  assert.ok(drilled.body.edges.some(e => {
    const rim = cad.rimRef(drilled.body, e.hashCode);
    return rim && V(rim.c).distanceTo(point) < 1e-6;
  }), 'hole placement agrees with the picked sketch coordinates');
}

const expected = {
  block: 8000,
  fillet: 8000 - 4 * (25 - 25 * PI / 4) * 10,
  hole: 8000 - PI * 16 * 10,
  stack: 8000 + PI * 25 * 15,
  pocket: 8000 - 24 * 10 * 5,
  change: 60 * 20 * 15 - 4 * (9 - 9 * PI / 4) * 15 - PI * 9 * 15,
  tag: 50 * 20 * 4 - 4 * (25 - 25 * PI / 4) * 4 - PI * 6.25 * 4,
  washer: PI * (225 - 36) * 3,
  brick: 32 * 16 * 10 + 2 * PI * 25 * 4,
  bracket: 40 * 30 * 5 + 40 * 5 * 25 - 2 * PI * 6.25 * 5,
  cup: (60 * 40 - 4 * (25 - 25 * PI / 4)) * 30 - 50 * 30 * 25,
  'robot-base': PI * 900 * 6 + 2 * 4 * 20 * 24 - 2 * PI * 1.75 ** 2 * 4,
  'robot-link': 48 * 12 * 6 + PI * 36 * 6 - 2 * PI * 1.75 ** 2 * 6,
  'robot-finger': (40 * 6 + 6 * 14) * 5 + (4 - PI) * 5 - PI * 1.75 ** 2 * 5,
  'robot-longlink': 80 * 12 * 6 + PI * 36 * 6 - 2 * PI * 1.75 ** 2 * 6,
  'elf-table': 4 * PI * 9 * 40 + 80 * 50 * 4 - 4 * (25 - 25 * PI / 4) * 4,
  'elf-chair': 4 * 16 * 25 + 30 * 30 * 3 + 30 * 3 * 30 - 2 * (25 - 25 * PI / 4) * 3,
  'elf-shelf': 50 * 20 * 70 - 3 * 44 * 18 * 16,
  'elf-bed': 40 * 70 * 8 + 40 * 4 * 25 + 24 * 10 * 4 - 4 * (9 - 9 * PI / 4) * 4,
  // base + body cylinders + ball head, minus the 1 mm cap of the ball that sits inside the body
  'spin-pawn': PI * 144 * 4 + PI * 25 * 16 + 4 / 3 * PI * 216 - PI * 17 / 3,
  // hub + rim + 6 spokes (the part between hub and rim) - axle hole
  'spin-wheel': PI * 36 * 6 + PI * (324 - 144) * 6 + 6 * 4 * integrate(y => Math.sqrt(144 - y * y) - Math.sqrt(36 - y * y), -1.5, 1.5) - PI * 1.75 ** 2 * 6,
  'spin-brick': 32 * 16 * 10 + 8 * PI * 2.5 ** 2 * 2,
  'spin-button': PI * 100 * 3 - 4 * PI * 1 * 3,
  'print-rule': 10 * 10 * 20 + 30 * 10 * 4,
  'print-flip': 4 * PI * 9 * 40 + 80 * 50 * 4 - 4 * (25 - 25 * PI / 4) * 4,
  'print-holes': 30 * 10 * 20 - PI * 9 * 20 - 50 * 10,
  'print-shelf': 50 * 20 * 70 - 3 * 44 * 18 * 16,
  // revolved base (Pappus), the head outline extruded 5 mm each way, minus the eye and the rounded nose tip
  'adv-knight': revolved([[0, 0], [16, 0], [16, 3], [13, 5], [11, 5], [11, 7], [0, 7]]) + 10 * area(KNIGHT_HEAD) - PI * 1.25 ** 2 * 10 - 10 * filletCut([14, 22], [15, 27], [6, 34], 2),
  // blade + guard + grip + pommel (minus where it overlaps the grip), 4 thick; chamfer triangles along the
  // 4 blade edges (ignores the small corner overlaps, ~0.2%); fuller, 4 rounded guard corners, lanyard hole,
  // 6 grip grooves
  'adv-sword': (384 + 96 + 64 + 16 * PI - integrate(x => Math.max(0, Math.sqrt(16 - x * x) - 2), -2, 2)) * 4 - 1.5 ** 2 / 2 * (120 + 2 * Math.hypot(3, 8))
    - 48 * 1 - 4 * (1 - PI / 4) * 1.5 ** 2 * 4 - PI * 1.5 ** 2 * 4 - 6 * 4 * 0.8 * 0.6,
  // walls - 12 pointed windows - pointed door (2 deep) + 45° gable roof and front ledge (40 long) + the
  // chimney above the walls, minus the part of it inside the roof (roof top is 72 - y over y = 4..8)
  'adv-building': 40 * 24 * 60 - 12 * 28 * 2 - 63 * 2 + 144 * 40 + 4.5 * 40 + 4 * 4 * 16 - 4 * integrate(y => 12 - y, 4, 8),
  // gear: disc, teeth, hub; minus axle, keyway (the part outside the axle), 4 lightening holes
  'adv-gear': PI * 225 * 5 + 12 * toothOut(15) * 5 + PI * 36 * 3 - PI * 6.25 * 8
    - 8 * (4 - integrate(x => Math.max(0, Math.sqrt(6.25 - x * x) - 2), -1, 1)) - 4 * PI * 6.25 * 5,
  'adv-gear-small': PI * 100 * 5 + 8 * toothOut(10) * 5 + PI * 25 * 3 - PI * 6.25 * 8,
  // hex head + shaft + the fillet ring under the head (spandrel spun at its centroid) - bed chamfers
  // (ignoring the corner overlaps) - the thread on the 19 mm left above the fillet
  'adv-screw': 224 * 6 + PI * 25 * 20 + (1 - PI / 4) * 2 * PI * (5 + 0.2234) - 0.5 * (4 * Math.hypot(4, 8) + 2 * 10) - threadCut(5, 2, 19, true),
  // hub + 2 wings 3 thick (minus where they sit inside the hub) - rounded wing tips - hole - thread
  'adv-nut': PI * 64 * 8 + 2 * 3 * area([[6, 0], [14, 0], [17, 12], [12, 12], [6, 8]]) - 2 * 8 * integrate(y => Math.sqrt(64 - y * y) - 6, -1.5, 1.5)
    - 2 * 3 * filletCut([14, 0], [17, 12], [12, 12], 2) - PI * 4.5 ** 2 * 8 - threadCut(4.5, 2, 8, false),
  // plate + the 3/4 of the knuckle tube outside it, minus the 2 slots (21.5 mm of it), the pin hole, 2 rounded
  // corners, 2 screw holes and their countersinks (1 mm triangle spun around)
  'adv-hinge': 40 * 20 * 3 + 40 * 6.75 * PI - 21.5 * (12 + 6.75 * PI) - PI * 1.75 ** 2 * 18.5
    - 2 * (16 - 4 * PI) * 3 - 2 * PI * 1.75 ** 2 * 3 - 2 * 0.5 * 2 * PI * (1.75 + 1 / 3),
  // outline + cross + boss (minus where the boss stands on the cross)
  'adv-shield': area([[-20, 20], [20, 20], [20, -5], [12, -20], [0, -28], [-12, -20], [-20, -5]]) * 3 + (6 * 30 + 24 * 6 - 36) * 1.5
    + PI * 25 * 2.5 - 1.5 * integrate(x => { const s = Math.sqrt(25 - x * x); return Math.abs(x) <= 3 ? 2 * s : Math.max(0, Math.min(9, s) - 3); }, -5, 5),
};

for (const l of [...LESSONS, ...CHALLENGES]) {
  assert.ok(COURSES.includes(l.course), `${l.id}: unknown course`);
  if (l.assembly) { // components are other lessons' parts
    for (const c of l.assembly) assert.ok(LESSONS.find(x => x.id === c.part)?.goal, `${l.id}: part ${c.part}`);
    continue;
  }
  if (l.id === 'intro') { assert.deepEqual(l.start, []); assert.equal(l.goal, undefined); continue; }
  const r = cad.rebuild(l.goal);
  assert.deepEqual(r.errors, {}, `${l.id} goal has errors`);
  near(vol(l.goal), expected[l.id]);
  if (l.start) assert.deepEqual(cad.rebuild(l.start).errors, {}, `${l.id} start has errors`);
}

// The view cube covers every standard direction and its hit regions lie on the cube.
assert.equal(new Set(CUBE_VIEWS.map(v => v.direction.join(','))).size, 26);
for (const [kind, count] of [['face', 6], ['edge', 12], ['corner', 8]]) {
  const views = CUBE_VIEWS.filter(v => v.kind === kind);
  assert.equal(views.length, count);
  for (const v of views) for (const p of v.points) {
    assert.ok(p.every(n => Math.abs(n) === 1));
    assert.ok(v.direction.every((n, i) => !n || n === p[i]));
  }
}
const intro = LESSONS[0];
assert.equal(intro.id, 'intro');
assert.deepEqual(intro.concepts, ['X', 'Y', 'Z', 'origin', 'XY', 'XZ', 'YZ']);
const tour = [
  ...intro.concepts.map((_, introAcknowledged) => ({ introAcknowledged })),
  { viewDirection: [0, 0, 1] }, { viewDirection: [1, 0, 1] },
  ...['XY', 'XZ', 'YZ'].map(sketchBase => ({ mode: 'sketch', sketchBase })), { mode: 'model' },
];
intro.steps.forEach((check, i) => {
  assert.equal(check(tour[i]), true, `intro step ${i + 1} accepts its action`);
  assert.ok(!check(tour[(i + 1) % tour.length]), `intro step ${i + 1} waits for its action`);
});

// Threads are cut exactly as deep as their pitch says, on a shaft or in a hole drilled from either side.
const nut = LESSONS.find(l => l.id === 'adv-nut').goal;
const fromBelow = nut.map(f => (f.type === 'hole' ? { ...f, face: { n: [0, 0, -1], c: [0, 0, 0] } } : f));
near(vol(fromBelow), expected['adv-nut']);
near(vol(nut.map(f => (f.type === 'thread' ? { ...f, pitch: 1.5 } : f))), expected['adv-nut'] + threadCut(4.5, 2, 8, false) - threadCut(4.5, 1.5, 8, false));
assert.equal(cad.rebuild(nut.map(f => (f.type === 'thread' ? { ...f, pitch: 0.2 } : f))).errors.t1, 'err.threadPitch');
const drilled = cad.rebuild(nut.slice(0, -1)).body;
assert.deepEqual(drilled.faces.map(f => cad.cylRef(drilled, f.hashCode)).find(r => r?.r === 4.5), nut.at(-1).face, 'a hole drilled down is saved pointing up');
// A lone extruded cylinder (OpenCascade makes it in two halves) can still be threaded.
const rod = [{ type: 'sketch', id: 's', plane: { base: 'XY' }, shapes: [{ kind: 'circle', x: 0, y: 0, d: 10 }] }, { type: 'extrude', id: 'e', sketch: 's', distance: -20, op: 'join' }];
near(vol([...rod, { type: 'thread', id: 't', face: { c: [0, 0, -10], a: [0, 0, 1], r: 5 }, pitch: 2 }]), PI * 25 * 20 - threadCut(5, 2, 20, true));

// Parametric edit: change the first sketch and extrude of the "change" lesson start, later features must follow.
const edited = structuredClone(LESSONS.find(l => l.id === 'change').start);
edited[0].shapes[0].w = 60;
edited[1].distance = 15;
const goal = cad.metrics(cad.rebuild(LESSONS.find(l => l.id === 'change').goal).body);
assert.ok(cad.sameShape(cad.metrics(cad.rebuild(edited).body), goal), 'edited timeline should match goal');

// A part that only misses its small fillets must not count as done.
const chair = LESSONS.find(l => l.id === 'elf-chair').goal;
assert.ok(!cad.sameShape(cad.metrics(cad.rebuild(chair.slice(0, -1)).body), cad.metrics(cad.rebuild(chair).body)), 'chair without fillets');

// Differences: a block 2 mm too short misses 1600 mm³; a misplaced hole shows up on both sides.
const blockGoal = LESSONS.find(l => l.id === 'block').goal;
const goalBlock = cad.rebuild(blockGoal).body;
const short = cad.rebuild([blockGoal[0], { ...blockGoal[1], distance: 8 }]).body;
let d = cad.diff(short, goalBlock);
near(cad.metrics(d.missing).volume, 1600);
assert.equal(d.extra, null);
const holeGoal = cad.rebuild(LESSONS.find(l => l.id === 'hole').goal).body;
const holeMoved = cad.rebuild(LESSONS.find(l => l.id === 'hole').goal.map(f => (f.type === 'hole' ? { ...f, x: 10 } : f))).body;
d = cad.diff(holeMoved, holeGoal);
near(cad.metrics(d.missing).volume, PI * 16 * 10);
near(cad.metrics(d.extra).volume, PI * 16 * 10);
assert.deepEqual(cad.diff(goalBlock, goalBlock), { missing: null, extra: null });
assert.ok(cad.sameShape(cad.metrics(holeMoved), cad.metrics(holeGoal)), 'size+volume alone cannot see a moved hole');
assert.ok(!cad.matches(holeMoved, holeGoal), 'a moved hole must not match');
assert.ok(cad.matches(holeGoal, holeGoal));
near(cad.metrics(goalBlock).volume, 8000); // inputs survive

// A fillet that is too big fails cleanly instead of crashing, with a translatable error.
const bad = [...blockGoal, { type: 'fillet', id: 'x', edges: LESSONS.find(l => l.id === 'fillet').goal[2].edges, r: 50 }];
assert.equal(cad.rebuild(bad).errors.x, 'err.filletFailed');
near(cad.metrics(cad.rebuild(bad).body).volume, 8000);

// Invalid imported pattern counts fail before any copies; the clone guard also keeps a regression bounded.
const invalidPatterns = [];
for (const n of [Infinity, -Infinity, NaN, 0, -1, 1.5, null, '2', Number.MAX_VALUE]) {
  invalidPatterns.push([{ kind: 'circle', n }, 'err.patternCount']);
  for (const axis of ['nx', 'ny', 'nz']) invalidPatterns.push([{ kind: 'rect', nx: 2, ny: 1, nz: 1, [axis]: n }, 'err.patternCount']);
}
invalidPatterns.push(
  [{ kind: 'circle', n: 1 }, 'err.patternCount'],
  [{ kind: 'rect', nx: 1, ny: 1, nz: 1 }, 'err.patternCount'],
  ...[101, 1e9].map(n => [{ kind: 'circle', n }, 'err.patternLimit']),
  [{ kind: 'rect', nx: 5, ny: 5, nz: 5 }, 'err.patternLimit'],
  [{ kind: 'rect', nx: 100, ny: 100, nz: 100 }, 'err.patternLimit'],
  [{ kind: 'rect', nx: 2, ny: 1, dx: Infinity }, 'err.numberFinite'],
  [{ kind: 'rect', nx: 2, ny: 1, dz: null }, 'err.numberFinite'],
);
const cloneSolid = Solid.prototype.clone;
try {
  for (const [params, error] of invalidPatterns) {
    let clones = 0;
    Solid.prototype.clone = function () {
      if (++clones > 1) throw Error('pattern copy attempted before validation');
      return cloneSolid.call(this); // first clone saves the source feature, before reaching the pattern
    };
    const result = cad.rebuild([...blockGoal, { type: 'pattern', id: 'p', of: blockGoal[1].id, dx: 50, dy: 50, ...params }]);
    assert.deepEqual(result.errors, { p: error });
    assert.equal(clones, 1, 'invalid pattern must not allocate copies');
    near(cad.metrics(result.body).volume, 8000);
  }
} finally { Solid.prototype.clone = cloneSolid; }
// Old rectangular designs omit Z; their default is still one layer.
near(vol([...blockGoal, { type: 'pattern', id: 'p', of: blockGoal[1].id, kind: 'rect', nx: 2, ny: 1, dx: 50, dy: 50 }]), 16000);
// The upper bound is inclusive in both modes. Coincident cylinder copies keep this check cheap.
for (const params of [{ kind: 'circle', n: 100 }, { kind: 'rect', nx: 5, ny: 5, nz: 4, dx: 0, dy: 0, dz: 0 }]) {
  const result = cad.rebuild([...rod, { type: 'pattern', id: 'p', of: 'e', ...params }]);
  assert.deepEqual(result.errors, {});
  near(cad.metrics(result.body).volume, PI * 25 * 20);
}

// Sketch on a side face (normal -Y) and a closed polyline.
const side = [...blockGoal,
  { type: 'sketch', id: 'p', plane: { face: { n: [0, -1, 0], c: [0, -10, 5] } }, shapes: [{ kind: 'poly', pts: [[-5, 2], [5, 2], [0, 8]] }] },
  { type: 'extrude', id: 'q', sketch: 'p', distance: 4, op: 'join' }];
near(vol(side), 8000 + 0.5 * 10 * 6 * 4);
const m = cad.metrics(cad.rebuild(side).body);
assert.ok(Math.abs(m.min[1] + 14) < 0.1, 'side extrude should grow toward -Y');

assert.ok((await cad.stlOf(cad.rebuild(blockGoal).body).arrayBuffer()).byteLength > 84);
assert.ok((await cad.stepOf(cad.rebuild(blockGoal).body).text()).startsWith('ISO-10303-21;'), 'STEP export');
// Assembly: a revolute joint puts the link's hole on the base pivot, faces touching, turning about the hole.
const rimsOf = id => { const b = cad.rebuild([...LESSONS, ...CHALLENGES].find(l => l.id === id).goal).body; return b.edges.map(e => cad.rimRef(b, e.hashCode)).filter(Boolean); };
const linkRim = rimsOf('robot-link').find(r => r.c[0] === -24 && r.n[2] === 1);
const pivot = rimsOf('robot-base').find(r => r.c[0] === 4);
assert.deepEqual([linkRim.c, pivot.c, pivot.n], [[-24, 0, 6], [4, 0, 24], [-1, 0, 0]]);
const comps = [{ id: 'base', grounded: true }, { id: 'link' }];
const near3 = (v, w, msg) => assert.ok(v.distanceTo(new Vector3(...w)) < 1e-9, `${msg}: ${v.toArray()}`);
const tips = [0, 90].map(angle => {
  const { T, errors } = poses(comps, [{ id: 'j', type: 'revolute', angle, moving: { comp: 'link', rim: linkRim }, fixed: { comp: 'base', rim: pivot } }]);
  assert.deepEqual(errors, {});
  near3(new Vector3(...linkRim.c).applyMatrix4(T.get('link')), [4, 0, 24], 'hole centers meet');
  near3(new Vector3(...linkRim.n).transformDirection(T.get('link')), [1, 0, 0], 'faces touch');
  return new Vector3(24, 0, 3).applyMatrix4(T.get('link'));
});
assert.ok(Math.abs(tips[0].distanceTo(tips[1]) - 48 * Math.SQRT2) < 1e-9, 'other end swings 90° around the pivot');
near3(tips[0], [1, 0, 24 + 48], 'at 0° the link stands straight up');
assert.equal(poses(comps, [{ id: 'j', moving: { comp: 'base', rim: pivot }, fixed: { comp: 'base', rim: pivot } }]).errors.j, 'err.jointSamePart');
const twice = [1, 2].map(i => ({ id: 'j' + i, angle: 0, moving: { comp: 'link', rim: linkRim }, fixed: { comp: 'base', rim: pivot } }));
assert.deepEqual(poses(comps, twice).errors, { j2: 'err.jointPlaced' });

// Hinge: two copies of the same leaf. Joining a knuckle end of one to the facing end inside the other's gap
// slides it by 11 mm, so its knuckles (0–9.5, 20.5–29.5) land in the gaps (9.5–20.5, 29.5–40.5).
const leafRims = rimsOf('adv-hinge');
const leafRim = (x, nx) => leafRims.find(r => r.c[0] === x && r.n[0] === nx);
const leaves = [{ id: 'a', grounded: true }, { id: 'b' }];
const hinge = angle => poses(leaves, [{ id: 'j', type: 'revolute', angle, moving: { comp: 'b', rim: leafRim(9.5, 1) }, fixed: { comp: 'a', rim: leafRim(20.5, -1) } }]).T.get('b');
near3(new Vector3(0, 0, 3).applyMatrix4(hinge(0)), [11, 0, 3], 'the loose leaf slides into the gaps');
near3(new Vector3(20, -10, 3).applyMatrix4(hinge(180)), [31, 10, 3], 'at 180° it lies open on the other side');

// Printing: overhang area for a part laid on the bed with face normal n down (or as designed).
const goalOf = id => LESSONS.find(l => l.id === id);
const TABLE_GOAL = () => goalOf('elf-table').goal;
const hang = (fs, n) => { const f = cad.meshOf(cad.rebuild(fs).body).faces; return overhangs(f, printMatrix(f, n)).area; };
near(hang(goalOf('print-rule').start), 200);                 // the T's arms, standing up
assert.ok(hang(goalOf('print-rule').start, [0, -1, 0]) < 0.01, 'T lying on its front prints clean');
assert.ok(hang(goalOf('print-flip').start) > 3000, 'table on its legs: whole top overhangs');
assert.ok(hang(goalOf('print-flip').start, [0, 0, 1]) < 0.01, 'table upside down prints clean');
const twoHoles = goalOf('print-holes');
assert.ok(hang(twoHoles.start) > 50, 'standing: the front hole is sideways');
assert.ok(hang(twoHoles.start, [0, -1, 0]) > 20, 'on its front: now the top hole is sideways');
assert.ok(hang(twoHoles.start, [0, 0, 1]) > 50, 'upside down: the front hole is sideways again');
assert.ok(hang(twoHoles.goal) < 0.01 && hang(twoHoles.goal, [0, 0, 1]) < 0.01, 'with a diamond it prints clean');
assert.ok(hang(goalOf('print-shelf').start, [0, 1, 0]) < 0.01, 'bookshelf on its back prints clean');
assert.ok(hang(goalOf('print-shelf').start, [0, -1, 0]) > 1000, 'bookshelf on its front does not');
// Exported STL placement: upside-down table rests on z = 0 with its top down.
const upside = cad.metrics(cad.onBed(cad.rebuild(TABLE_GOAL()).body, [0, 0, 1]));
assert.ok(Math.abs(upside.min[2]) < 1e-6 && Math.abs(upside.max[2] - 44) < 1e-6, 'onBed rests the part on z = 0');

// Language selection: URL, saved choice, browser preference list, single-language fallback, English.
const languageGlobals = ['navigator', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
try {
  const cases = [
    { search: '?lang=fr', saved: 'de', languages: ['es-ES'], expected: 'fr' },
    { saved: 'fr', languages: ['en-US'], expected: 'fr' },
    { languages: ['fr-CA', 'en-US'], expected: 'fr' },
    { languages: ['de-DE', 'fr-FR'], expected: 'de' },
    { languages: ['it-IT', 'es-MX', 'en-US'], expected: 'es' },
    { languages: ['FR-fr'], expected: 'fr' },
    { search: '?lang=it', saved: 'it', languages: ['de-DE'], expected: 'de' },
    { language: 'fr-FR', expected: 'fr' },
    { languages: [], language: 'de-AT', expected: 'de' },
    { languages: ['ja-JP'], language: 'ja-JP', expected: 'en' },
    { blocked: true, languages: ['es-ES'], expected: 'es' },
    { expected: 'en' },
  ];
  for (const [i, c] of cases.entries()) {
    const values = { navigator: { languages: c.languages, language: c.language }, location: { search: c.search || '' },
      localStorage: { getItem() { if (c.blocked) throw Error('Storage blocked'); return c.saved; } } };
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const selected = await import(`./i18n.js?language-test=${i}`);
    assert.equal(selected.lang, c.expected, `language selection case ${i}`);
  }
} finally {
  for (const [key, descriptor] of languageGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

// i18n: every language has every English key, with the same shape and placeholders.
const { en } = LANGS;
// Glossary words (<dfn data-term>) must be the same in every language.
const terms = v => JSON.stringify([...[].concat(v).join(' ').matchAll(/data-term="([\w-]+)"/g)].map(m => m[1]).sort());
const holes = v => JSON.stringify([...String(v).matchAll(/\{\w+\}/g)].map(m => m[0]).sort());
for (const [code, d] of Object.entries(LANGS)) {
  assert.deepEqual(Object.keys(d).sort(), Object.keys(en).sort(), `${code}: keys differ from en`);
  for (const [k, v] of Object.entries(en)) {
    assert.equal(Array.isArray(d[k]), Array.isArray(v), `${code}: ${k} shape`);
    if (Array.isArray(v)) assert.equal(d[k].length, v.length, `${code}: ${k} length`);
    else assert.equal(holes(d[k]), holes(v), `${code}: ${k} placeholders`);
    assert.equal(terms(d[k]), terms(v), `${code}: ${k} glossary words`);
  }
}
for (const [, k] of Object.values(en).join(' ').matchAll(/data-term="([\w-]+)"/g)) assert.ok(en[`term.${k}.def`], `glossary: ${k}`);
assert.equal(en['lesson.intro.stepTitles'].length, intro.steps.length);
for (const [code, words] of Object.entries(LANGS)) {
  assert.equal(words['lesson.intro.steps.simple'].length, intro.steps.length, `${code}: every intro step has both explanations`);
  words['lesson.intro.steps.simple'].forEach((text, i) => {
    assert.ok(text.trim(), `${code}: intro step ${i} needs a simple explanation`);
    assert.notEqual(text, words['lesson.intro.steps'][i], `${code}: intro step ${i} needs its own simple explanation`);
  });
}
for (const l of LESSONS) assert.equal(en[`lesson.${l.id}.steps`].length, l.steps.length, `${l.id}: one text per step`);
for (const c of CHALLENGES) assert.ok(en[`challenge.${c.id}.brief`], `${c.id}: brief`);
for (const c of COURSES) assert.ok(en[`course.${c}.title`], `course ${c}: title`);
// Technical explanations keep a companion in simple words so kids learn the same terms.
for (const k of Object.keys(en).filter(k => /^(course\.\w+\.intro|lesson\.[\w-]+\.(intro|outro)|term\.\w+\.def)$/.test(k))) assert.ok(en[k + '.simple'], `simple words: ${k}`);
for (const file of ['./cad.js', './assembly.js'])
  for (const [k] of readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/err\.\w+/g)) assert.ok(k in en, `missing ${k}`);
console.log('ok');
