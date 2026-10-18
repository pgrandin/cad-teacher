// node test.mjs — builds every lesson/challenge goal and checks the engine end to end.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as cad from './cad.js';
import { LESSONS, CHALLENGES } from './lessons.js';

await cad.init(fileURLToPath(new URL('./vendor/replicad_single.wasm', import.meta.url)));
const PI = Math.PI;
const vol = fs => cad.metrics(cad.rebuild(fs).body).volume;
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01 * b, `${a} != ${b}`);

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
};

for (const l of [...LESSONS, ...CHALLENGES]) {
  const r = cad.rebuild(l.goal);
  assert.deepEqual(r.errors, {}, `${l.id} goal has errors`);
  near(vol(l.goal), expected[l.id]);
  if (l.start) assert.deepEqual(cad.rebuild(l.start).errors, {}, `${l.id} start has errors`);
}

// Parametric edit: change the first sketch and extrude of the "change" lesson start, later features must follow.
const edited = structuredClone(LESSONS.find(l => l.id === 'change').start);
edited[0].shapes[0].w = 60;
edited[1].distance = 15;
const goal = cad.metrics(cad.rebuild(LESSONS.find(l => l.id === 'change').goal).body);
assert.ok(cad.sameShape(cad.metrics(cad.rebuild(edited).body), goal), 'edited timeline should match goal');

// A fillet that is too big fails cleanly instead of crashing.
const bad = [...LESSONS[0].goal, { type: 'fillet', id: 'x', edges: LESSONS[1].goal[2].edges, r: 50 }];
assert.ok(cad.rebuild(bad).errors.x);
near(cad.metrics(cad.rebuild(bad).body).volume, 8000);

// Sketch on a side face (normal -Y) and a closed polyline.
const side = [...LESSONS[0].goal,
  { type: 'sketch', id: 'p', plane: { face: { n: [0, -1, 0], c: [0, -10, 5] } }, shapes: [{ kind: 'poly', pts: [[-5, 2], [5, 2], [0, 8]] }] },
  { type: 'extrude', id: 'q', sketch: 'p', distance: 4, op: 'join' }];
near(vol(side), 8000 + 0.5 * 10 * 6 * 4);
const m = cad.metrics(cad.rebuild(side).body);
assert.ok(Math.abs(m.min[1] + 14) < 0.1, 'side extrude should grow toward -Y');

assert.ok((await cad.stlOf(cad.rebuild(LESSONS[0].goal).body).arrayBuffer()).byteLength > 84);
console.log('ok');
