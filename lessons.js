// Lessons are a list of step checks; the last one is usually "your part matches the goal".
// Challenges only have a goal. Goals are feature lists, built by the same engine as the kid's part.
// The words live in locales/*.js under lesson.<id>.* and challenge.<id>.* (one step text per check).
// Every lesson and challenge belongs to a course; the menu shows courses in this order.
export const COURSES = ['basics', 'robot', 'elf'];

const rect = (x, y, w, h) => ({ kind: 'rect', x, y, w, h });
const circle = (x, y, d) => ({ kind: 'circle', x, y, d });
const top = z => ({ n: [0, 0, 1], c: [0, 0, z] });
const poly = (...pts) => ({ kind: 'poly', pts });
// The 4 standing-up edges of a w×h box, t tall, centered on (x, y), sitting at height z.
const cornerEdges = (w, h, t, x = 0, y = 0, z = 0) =>
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => ({ m: [x + a * w / 2, y + b * h / 2, z + t / 2], g: 'LINE' }));
const edge = (x, y, z) => ({ m: [x, y, z], g: 'LINE' });
// A bar with round ends and a hole at each end: the robot arm link.
const link = (span, w, t) => [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, span, w), circle(-span / 2, 0, w), circle(span / 2, 0, w)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: t, op: 'join' },
  { type: 'hole', id: 'h1', face: top(t), x: -span / 2, y: 0, d: 3.5, depth: 0 },
  { type: 'hole', id: 'h2', face: top(t), x: span / 2, y: 0, d: 3.5, depth: 0 },
];

const block = (w = 40, h = 20, t = 10) => [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, w, h)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: t, op: 'join' },
];

// Step checks
const sketching = s => s.mode === 'sketch';
const onFace = s => s.mode === 'sketch' && s.sketchOnFace;
const opened = type => s => s.dialog === type;
const added = type => s => s.mode === 'model' && s.features.slice(s.startCount).some(f => f.type === type);
const drew = (kind, p = {}) => s => (s.draft || []).some(x => x.kind === kind && Object.entries(p).every(([k, v]) => x[k] === v));
const drewMany = (kind, n) => s => (s.draft || []).filter(x => x.kind === kind).length >= n;
const made = (type, n) => s => s.mode === 'model' && s.features.slice(s.startCount).filter(f => f.type === type).length >= n;
const matches = s => s.match;
// Assembly checks look at the committed joints: which parts they connect and how.
const partsOf = (s, j) => [j.moving, j.fixed].map(p => s.asm.components.find(c => c.id === p?.comp)?.part).sort().join('+');
const joined = (a, b, type = 'revolute') => s => !!s.asm?.joints.some(j => j.type === type && partsOf(s, j) === [a, b].sort().join('+'));

export const LESSONS = [
  {
    id: 'block',
    course: 'basics',
    start: [],
    goal: block(),
    steps: [sketching, drew('rect'), drew('rect', { x: 0, y: 0, w: 40, h: 20 }), added('sketch'), matches],
  },
  {
    id: 'fillet',
    course: 'basics',
    start: block(),
    goal: [...block(), { type: 'fillet', id: 'f1', edges: cornerEdges(40, 20, 10), r: 5 }],
    steps: [opened('fillet'), s => s.selected >= 4, matches],
  },
  {
    id: 'hole',
    course: 'basics',
    start: block(),
    goal: [...block(), { type: 'hole', id: 'h1', face: top(10), x: 0, y: 0, d: 8, depth: 0 }],
    steps: [opened('hole'), s => s.holeFace, matches],
  },
  {
    id: 'stack',
    course: 'basics',
    start: block(),
    goal: [
      ...block(),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(0, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 15, op: 'join' },
    ],
    steps: [onFace, drew('circle'), added('sketch'), matches],
  },
  {
    id: 'pocket',
    course: 'basics',
    start: block(),
    goal: [
      ...block(),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [rect(0, 0, 24, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -5, op: 'cut' },
    ],
    steps: [onFace, added('sketch'), matches],
  },
  {
    id: 'change',
    course: 'basics',
    start: [
      ...block(),
      { type: 'fillet', id: 'f1', edges: cornerEdges(40, 20, 10), r: 3 },
      { type: 'hole', id: 'h1', face: top(10), x: 0, y: 0, d: 6, depth: 0 },
    ],
    goal: [
      ...block(60, 20, 15),
      { type: 'fillet', id: 'f1', edges: cornerEdges(60, 20, 15), r: 3 },
      { type: 'hole', id: 'h1', face: top(15), x: 0, y: 0, d: 6, depth: 0 },
    ],
    steps: [sketching, s => s.mode === 'model' && s.features[0].shapes[0]?.w === 60, matches],
  },
  {
    id: 'robot-base',
    course: 'robot',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 60)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 6, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: top(6) }, shapes: [rect(-6, 0, 4, 20), rect(6, 0, 4, 20)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 24, op: 'join' },
      // On a side face, sketch Y is height: the pivot is 24 mm up, through both tabs.
      { type: 'hole', id: 'h1', face: { n: [1, 0, 0], c: [8, 0, 18] }, x: 0, y: 24, d: 3.5, depth: 0 },
    ],
    steps: [drew('circle', { x: 0, y: 0, d: 60 }), made('extrude', 1), made('sketch', 2), made('extrude', 2), matches],
  },
  {
    id: 'robot-link',
    course: 'robot',
    start: [],
    goal: link(48, 12, 6),
    steps: [drew('rect', { x: 0, y: 0, w: 48, h: 12 }), made('sketch', 1), made('extrude', 1), matches],
  },
  {
    id: 'robot-finger',
    course: 'robot',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [poly([-20, -14], [-14, -14], [-14, 0], [20, 0], [20, 6], [-20, 6])] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 5, op: 'join' },
      { type: 'hole', id: 'h1', face: top(5), x: 14, y: 3, d: 3.5, depth: 0 },
      { type: 'fillet', id: 'f1', edges: [edge(-14, 0, 2.5)], r: 2 },
    ],
    steps: [drew('poly'), made('extrude', 1), made('hole', 1), matches],
  },
  {
    // Assembly lessons load other lessons' goals as components. The first one is grounded.
    id: 'robot-joint',
    course: 'robot',
    assembly: [
      { id: 'base', part: 'robot-base', grounded: true },
      { id: 'link', part: 'robot-link', at: [0, -60, 0] },
    ],
    steps: [opened('joint'), s => s.picked >= 1, s => s.picked >= 2, s => s.asm.joints.length >= 1,
      s => !s.dialog && joined('robot-base', 'robot-link')(s) && s.asm.joints.some(j => j.angle)],
  },
  {
    id: 'robot-assembly',
    course: 'robot',
    assembly: [
      { id: 'base', part: 'robot-base', grounded: true },
      { id: 'link1', part: 'robot-link', at: [0, -60, 0] },
      { id: 'link2', part: 'robot-link', at: [0, -90, 0] },
      { id: 'finger', part: 'robot-finger', at: [0, -125, 0] },
    ],
    steps: [joined('robot-base', 'robot-link'), joined('robot-link', 'robot-link'), joined('robot-finger', 'robot-link'), s => s.driven],
  },
  {
    id: 'elf-table',
    course: 'elf',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(-35, -20, 6), circle(35, -20, 6), circle(35, 20, 6), circle(-35, 20, 6)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 40, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: { n: [0, 0, 1], c: [35, 20, 40] } }, shapes: [rect(0, 0, 80, 50)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
      { type: 'fillet', id: 'f1', edges: cornerEdges(80, 50, 4, 0, 0, 40), r: 5 },
    ],
    steps: [drewMany('circle', 4), made('extrude', 1), made('sketch', 2), made('extrude', 2), matches],
  },
  {
    id: 'elf-chair',
    course: 'elf',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(-13, -13, 4, 4), rect(13, -13, 4, 4), rect(13, 13, 4, 4), rect(-13, 13, 4, 4)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 25, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: { n: [0, 0, 1], c: [13, 13, 25] } }, shapes: [rect(0, 0, 30, 30)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 3, op: 'join' },
      { type: 'sketch', id: 's3', plane: { face: top(28) }, shapes: [rect(0, 13.5, 30, 3)] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: 30, op: 'join' },
      { type: 'fillet', id: 'f1', edges: [edge(15, 13.5, 58), edge(-15, 13.5, 58)], r: 5 },
    ],
    steps: [made('extrude', 1), made('extrude', 2), made('extrude', 3), matches],
  },
  {
    id: 'elf-shelf',
    course: 'elf',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, 50, 20)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 70, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: { n: [0, -1, 0], c: [0, -10, 35] } }, shapes: [rect(0, 13, 44, 18), rect(0, 35, 44, 18), rect(0, 57, 44, 18)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -16, op: 'cut' },
    ],
    steps: [made('extrude', 1), made('sketch', 2), matches],
  },
];

export const CHALLENGES = [
  {
    id: 'tag',
    course: 'basics',
    goal: [
      ...block(50, 20, 4),
      { type: 'fillet', id: 'f1', edges: cornerEdges(50, 20, 4), r: 5 },
      { type: 'hole', id: 'h1', face: top(4), x: -18, y: 0, d: 5, depth: 0 },
    ],
  },
  {
    id: 'washer',
    course: 'basics',
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 30)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      { type: 'hole', id: 'h1', face: top(3), x: 0, y: 0, d: 12, depth: 0 },
    ],
  },
  {
    id: 'brick',
    course: 'basics',
    goal: [
      ...block(32, 16, 10),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(-8, 0, 10), circle(8, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
    ],
  },
  {
    id: 'bracket',
    course: 'basics',
    goal: [
      ...block(40, 30, 5),
      { type: 'sketch', id: 's2', plane: { face: top(5) }, shapes: [rect(0, 12.5, 40, 5)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 25, op: 'join' },
      { type: 'hole', id: 'h1', face: { n: [0, 0, 1], c: [0, -2.5, 5] }, x: -12, y: -5, d: 5, depth: 0 },
      { type: 'hole', id: 'h2', face: { n: [0, 0, 1], c: [0, -2.5, 5] }, x: 12, y: -5, d: 5, depth: 0 },
    ],
  },
  {
    id: 'cup',
    course: 'basics',
    goal: [
      ...block(60, 40, 30),
      { type: 'fillet', id: 'f1', edges: cornerEdges(60, 40, 30), r: 5 },
      { type: 'sketch', id: 's2', plane: { face: top(30) }, shapes: [rect(0, 0, 50, 30)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -25, op: 'cut' },
    ],
  },
  { id: 'robot-longlink', course: 'robot', goal: link(80, 12, 6) },
  {
    id: 'elf-bed',
    course: 'elf',
    goal: [
      ...block(40, 70, 8),
      { type: 'sketch', id: 's2', plane: { face: top(8) }, shapes: [rect(0, 33, 40, 4)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 25, op: 'join' },
      { type: 'sketch', id: 's3', plane: { face: top(8) }, shapes: [rect(0, 22, 24, 10)] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: 4, op: 'join' },
      { type: 'fillet', id: 'f1', edges: cornerEdges(24, 10, 4, 0, 22, 8), r: 3 },
    ],
  },
];
