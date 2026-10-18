// node test.mjs — builds every lesson/challenge goal and checks the engine end to end.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as cad from './cad.js';
import { readFileSync } from 'node:fs';
import { LESSONS, CHALLENGES, COURSES } from './lessons.js';
import { LANGS } from './i18n.js';
import { poses } from './assembly.js';
import { Vector3 } from './vendor/three.module.js';

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
  'robot-base': PI * 900 * 6 + 2 * 4 * 20 * 24 - 2 * PI * 1.75 ** 2 * 4,
  'robot-link': 48 * 12 * 6 + PI * 36 * 6 - 2 * PI * 1.75 ** 2 * 6,
  'robot-finger': (40 * 6 + 6 * 14) * 5 + (4 - PI) * 5 - PI * 1.75 ** 2 * 5,
  'robot-longlink': 80 * 12 * 6 + PI * 36 * 6 - 2 * PI * 1.75 ** 2 * 6,
  'elf-table': 4 * PI * 9 * 40 + 80 * 50 * 4 - 4 * (25 - 25 * PI / 4) * 4,
  'elf-chair': 4 * 16 * 25 + 30 * 30 * 3 + 30 * 3 * 30 - 2 * (25 - 25 * PI / 4) * 3,
  'elf-shelf': 50 * 20 * 70 - 3 * 44 * 18 * 16,
  'elf-bed': 40 * 70 * 8 + 40 * 4 * 25 + 24 * 10 * 4 - 4 * (9 - 9 * PI / 4) * 4,
};

for (const l of [...LESSONS, ...CHALLENGES]) {
  assert.ok(COURSES.includes(l.course), `${l.id}: unknown course`);
  if (l.assembly) { // components are other lessons' parts
    for (const c of l.assembly) assert.ok(LESSONS.find(x => x.id === c.part)?.goal, `${l.id}: part ${c.part}`);
    continue;
  }
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

// A part that only misses its small fillets must not count as done.
const chair = LESSONS.find(l => l.id === 'elf-chair').goal;
assert.ok(!cad.sameShape(cad.metrics(cad.rebuild(chair.slice(0, -1)).body), cad.metrics(cad.rebuild(chair).body)), 'chair without fillets');

// A fillet that is too big fails cleanly instead of crashing, with a translatable error.
const bad = [...LESSONS[0].goal, { type: 'fillet', id: 'x', edges: LESSONS[1].goal[2].edges, r: 50 }];
assert.equal(cad.rebuild(bad).errors.x, 'err.filletFailed');
near(cad.metrics(cad.rebuild(bad).body).volume, 8000);

// Sketch on a side face (normal -Y) and a closed polyline.
const side = [...LESSONS[0].goal,
  { type: 'sketch', id: 'p', plane: { face: { n: [0, -1, 0], c: [0, -10, 5] } }, shapes: [{ kind: 'poly', pts: [[-5, 2], [5, 2], [0, 8]] }] },
  { type: 'extrude', id: 'q', sketch: 'p', distance: 4, op: 'join' }];
near(vol(side), 8000 + 0.5 * 10 * 6 * 4);
const m = cad.metrics(cad.rebuild(side).body);
assert.ok(Math.abs(m.min[1] + 14) < 0.1, 'side extrude should grow toward -Y');

assert.ok((await cad.stlOf(cad.rebuild(LESSONS[0].goal).body).arrayBuffer()).byteLength > 84);
assert.ok((await cad.stepOf(cad.rebuild(LESSONS[0].goal).body).text()).startsWith('ISO-10303-21;'), 'STEP export');
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
for (const l of LESSONS) assert.equal(en[`lesson.${l.id}.steps`].length, l.steps.length, `${l.id}: one text per step`);
for (const c of CHALLENGES) assert.ok(en[`challenge.${c.id}.brief`], `${c.id}: brief`);
for (const c of COURSES) assert.ok(en[`course.${c}.title`], `course ${c}: title`);
for (const file of ['./cad.js', './assembly.js'])
  for (const [k] of readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/err\.\w+/g)) assert.ok(k in en, `missing ${k}`);
console.log('ok');
