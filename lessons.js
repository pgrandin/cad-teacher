// Lessons are a list of step checks; the last one is usually "your part matches the goal".
// Challenges only have a goal. Goals are feature lists, built by the same engine as the kid's part.
// The words live in locales/*.js under lesson.<id>.* and challenge.<id>.* (one step text per check).
// Every lesson and challenge belongs to a course; the menu shows courses in this order.
export const COURSES = ['basics', 'robot', 'elf', 'spin', 'print', 'advanced'];

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
const onPlane = base => s => s.mode === 'sketch' && s.sketchBase === base;
const opened = type => s => s.dialog === type;
const added = type => s => s.mode === 'model' && s.features.slice(s.startCount).some(f => f.type === type);
const drew = (kind, p = {}) => s => (s.draft || []).some(x => x.kind === kind && Object.entries(p).every(([k, v]) => x[k] === v));
const drewMany = (kind, n) => s => (s.draft || []).filter(x => x.kind === kind).length >= n;
const made = (type, n) => s => s.mode === 'model' && s.features.slice(s.startCount).filter(f => f.type === type).length >= n;
const matches = s => s.match;
// Print checks: the print view is on, and nothing would print in thin air.
const printOn = s => !!s.print?.on;
const printClean = s => !!s.print?.on && s.print.area < 1;
// Assembly checks look at the committed joints: which parts they connect and how.
const partsOf = (s, j) => [j.moving, j.fixed].map(p => s.asm.components.find(c => c.id === p?.comp)?.part).sort().join('+');
const joined = (a, b, type = 'revolute') => s => !!s.asm?.joints.some(j => j.type === type && partsOf(s, j) === [a, b].sort().join('+'));

const TABLE = [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(-35, -20, 6), circle(35, -20, 6), circle(35, 20, 6), circle(-35, 20, 6)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: 40, op: 'join' },
  { type: 'sketch', id: 's2', plane: { face: { n: [0, 0, 1], c: [35, 20, 40] } }, shapes: [rect(0, 0, 80, 50)] },
  { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
  { type: 'fillet', id: 'f1', edges: cornerEdges(80, 50, 4, 0, 0, 40), r: 5 },
];
const SHELF = [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, 50, 20)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: 70, op: 'join' },
  { type: 'sketch', id: 's2', plane: { face: { n: [0, -1, 0], c: [0, -10, 35] } }, shapes: [rect(0, 13, 44, 18), rect(0, 35, 44, 18), rect(0, 57, 44, 18)] },
  { type: 'extrude', id: 'e2', sketch: 's2', distance: -16, op: 'cut' },
];
// A T: a post with a top plate whose two arms stick straight out (10 mm each side).
const T_SHAPE = [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, 10, 10)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: 20, op: 'join' },
  { type: 'sketch', id: 's2', plane: { face: top(20) }, shapes: [rect(0, 0, 30, 10)] },
  { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
];
const FRONT = c => ({ face: { n: [0, -1, 0], c } });
const SIDE_BLOCK = block(30, 10, 20);
// Hex for the screw head: drawn with Line on the 1 mm grid, so nearly (not exactly) regular.
const HEX = poly([9, 0], [5, 8], [-5, 8], [-9, 0], [-5, -8], [5, -8]);
// A circle edge, found by a point near it.
const arc = (x, y, z) => ({ m: [x, y, z], g: 'CIRCLE' });
// A gear: a disc, one tooth poking out of it patterned around, a hub on top, an axle hole through both.
const gear = (d, n, hub) => [
  { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, d)] },
  { type: 'extrude', id: 'e1', sketch: 's1', distance: 5, op: 'join' },
  { type: 'sketch', id: 's2', plane: { base: 'XY' }, shapes: [poly([d / 2 - 1, -2], [d / 2 + 3, -1], [d / 2 + 3, 1], [d / 2 - 1, 2])] },
  { type: 'extrude', id: 'e2', sketch: 's2', distance: 5, op: 'join' },
  { type: 'pattern', id: 'p1', of: 'e2', kind: 'circle', n },
  { type: 'sketch', id: 's3', plane: { face: top(5) }, shapes: [circle(0, 0, hub)] },
  { type: 'extrude', id: 'e3', sketch: 's3', distance: 3, op: 'join' },
  { type: 'hole', id: 'h1', face: top(8), x: 0, y: 0, d: 5, depth: 0 },
];
const TOP_HOLE = { type: 'hole', id: 'h1', face: top(20), x: 10, y: 0, d: 6, depth: 0 };

export const LESSONS = [
  {
    id: 'intro',
    version: 2,
    concepts: ['X', 'Y', 'Z', 'origin', 'XY', 'XZ', 'YZ'],
    course: 'basics',
    start: [],
    steps: [
      ...Array.from({ length: 7 }, (_, i) => s => s.introAcknowledged === i),
      s => s.viewDirection?.join(',') === '0,0,1',
      s => s.viewDirection?.filter(Boolean).length === 2,
      onPlane('XY'), onPlane('XZ'), onPlane('YZ'),
      s => s.mode === 'model',
    ],
  },
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
    goal: TABLE,
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
    goal: SHELF,
    steps: [made('extrude', 1), made('sketch', 2), matches],
  },
  {
    // Revolve: half a pawn drawn on the back wall (XZ), spun around the vertical axis.
    id: 'spin-pawn',
    course: 'spin',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XZ' }, shapes: [rect(6, 2, 12, 4), rect(2.5, 12, 5, 16), circle(0, 25, 12)] },
      { type: 'revolve', id: 'r1', sketch: 's1', axis: 'v', angle: 360, op: 'join' },
    ],
    steps: [onPlane('XZ'), made('sketch', 1), matches],
  },
  {
    // Revolve a hub and a rim, add one spoke, pattern it around, drill the axle hole.
    id: 'spin-wheel',
    course: 'spin',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XZ' }, shapes: [rect(3, 3, 6, 6), rect(15, 3, 6, 6)] },
      { type: 'revolve', id: 'r1', sketch: 's1', axis: 'v', angle: 360, op: 'join' },
      { type: 'sketch', id: 's2', plane: { base: 'XY' }, shapes: [rect(9, 0, 8, 3)] },
      { type: 'extrude', id: 'e1', sketch: 's2', distance: 4, op: 'join' },
      { type: 'pattern', id: 'p1', of: 'e1', kind: 'circle', n: 6 },
      { type: 'hole', id: 'h1', face: top(6), x: 0, y: 0, d: 3.5, depth: 0 },
    ],
    steps: [made('revolve', 1), made('extrude', 1), made('pattern', 1), matches],
  },
  {
    // One stud, then a rectangular pattern: 4 × 2 studs, 8 mm apart like the real thing.
    id: 'spin-brick',
    course: 'spin',
    start: [],
    goal: [
      ...block(32, 16, 10),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(-12, -4, 5)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 2, op: 'join' },
      { type: 'pattern', id: 'p1', of: 'e2', kind: 'rect', nx: 4, dx: 8, ny: 2, dy: 8 },
    ],
    steps: [made('extrude', 1), made('extrude', 2), matches],
  },
  {
    // 45° rule: standing, the T's arms overhang; laid on its front it prints clean. Orientation first.
    id: 'print-rule',
    course: 'print',
    start: T_SHAPE,
    goal: T_SHAPE,
    steps: [printOn, printClean],
  },
  {
    // Orientation: the table upside down needs no supports.
    id: 'print-flip',
    course: 'print',
    start: TABLE,
    goal: TABLE,
    steps: [printOn, printClean],
  },
  {
    // Holes in two directions: whichever way it lies, one is sideways, so turning can't help.
    // The sideways one becomes a diamond (only 45° walls), which prints clean in any direction.
    id: 'print-holes',
    course: 'print',
    start: [...SIDE_BLOCK, TOP_HOLE, { type: 'hole', id: 'h2', face: FRONT([0, -5, 10]).face, x: 0, y: 10, d: 10, depth: 0 }],
    goal: [
      ...SIDE_BLOCK,
      TOP_HOLE,
      { type: 'sketch', id: 's2', plane: FRONT([0, -5, 10]), shapes: [poly([5, 10], [0, 15], [-5, 10], [0, 5])] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -10, op: 'cut' },
    ],
    steps: [printOn, s => !s.print?.on,
      s => s.mode === 'model' && s.features.filter(f => f.type === 'hole').length === 1 && s.features.filter(f => f.type === 'sketch').length >= 2,
      s => s.match && printClean(s)],
  },
  {
    // Find the face to lay the bookshelf on (its back) so no shelf has a ceiling.
    id: 'print-shelf',
    course: 'print',
    start: SHELF,
    goal: SHELF,
    steps: [printOn, printClean],
  },
  {
    // Revolve a base with a sloped skirt, draw the head with Line on the same wall, extrude it both ways so
    // it is centered, then drill the eye through and round the nose.
    id: 'adv-knight',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XZ' }, shapes: [poly([0, 0], [16, 0], [16, 3], [13, 5], [11, 5], [11, 7], [0, 7])] },
      { type: 'revolve', id: 'r1', sketch: 's1', axis: 'v', angle: 360, op: 'join' },
      { type: 'sketch', id: 's2', plane: { base: 'XZ' }, shapes: [poly([-9, 7], [9, 7], [6, 15], [14, 22], [15, 27], [6, 34], [3, 40], [-1, 35], [-7, 30], [-10, 18])] },
      { type: 'extrude', id: 'e1', sketch: 's2', distance: 5, op: 'join' },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -5, op: 'join' },
      // On the head's front side, sketch X is world X and sketch Y is height.
      { type: 'hole', id: 'h1', face: { n: [0, -1, 0], c: [2, -5, 23] }, x: 8, y: 29, d: 2.5, depth: 0 },
      { type: 'fillet', id: 'f1', edges: [edge(15, 0, 27)], r: 2 },
    ],
    steps: [made('revolve', 1), drew('poly'), made('extrude', 1), made('extrude', 2), made('hole', 1), matches],
  },
  {
    // Lies flat to print: one sketch of overlapping shapes, then only top-side details (chamfer, fuller,
    // grip grooves), so the bottom stays flat on the bed.
    id: 'adv-sword',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [poly([-3, 10], [3, 10], [3, 70], [0, 78], [-3, 70]), rect(0, 8, 24, 4), rect(0, -2, 4, 16), circle(0, -12, 8)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 4, op: 'join' },
      { type: 'chamfer', id: 'c1', edges: [edge(3, 40, 4), edge(-3, 40, 4), edge(1.5, 74, 4), edge(-1.5, 74, 4)], r: 1.5 },
      { type: 'sketch', id: 's2', plane: { face: top(4) }, shapes: [rect(0, 40, 1, 48)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -1, op: 'cut' },
      { type: 'fillet', id: 'f1', edges: [edge(12, 6, 2), edge(12, 10, 2), edge(-12, 6, 2), edge(-12, 10, 2)], r: 1.5 },
      { type: 'hole', id: 'h1', face: top(4), x: 0, y: -12, d: 3, depth: 0 },
      { type: 'sketch', id: 's3', plane: { face: { n: [0, 0, 1], c: [0, -2, 4] } }, shapes: [rect(0, -8, 4, 0.8)] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: -0.6, op: 'cut' },
      { type: 'pattern', id: 'p1', of: 'e3', kind: 'rect', nx: 1, dx: 10, ny: 6, dy: 2.4 },
    ],
    steps: [drew('poly'), made('extrude', 1), made('chamfer', 1), made('extrude', 2), made('fillet', 1), made('hole', 1), matches],
  },
  {
    // A town house standing up, printed as it stands. Windows and door have 45° pointed tops and the roof
    // is a 45° gable, so nothing overhangs: the lesson ends with a clean print check.
    id: 'adv-building',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(0, 0, 40, 24)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 60, op: 'join' },
      // On the front face, sketch X is world X and sketch Y is height.
      { type: 'sketch', id: 's2', plane: FRONT([0, -12, 30]), shapes: [poly([-14, 16], [-10, 16], [-10, 22], [-12, 24], [-14, 22])] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -2, op: 'cut' },
      { type: 'pattern', id: 'p1', of: 'e2', kind: 'rect', nx: 4, dx: 8, ny: 1, dy: 10, nz: 3, dz: 12 },
      { type: 'sketch', id: 's3', plane: FRONT([0, -12, 30]), shapes: [poly([-3, 0], [3, 0], [3, 9], [0, 12], [-3, 9])] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: -2, op: 'cut' },
      // On the YZ wall, sketch X is world Y: the gable roof and a 45° ledge along the front, both ways from the middle.
      { type: 'sketch', id: 's4', plane: { base: 'YZ' }, shapes: [poly([-12, 60], [12, 60], [0, 72]), poly([-12, 51], [-12, 54], [-15, 54])] },
      { type: 'extrude', id: 'e4', sketch: 's4', distance: 20, op: 'join' },
      { type: 'extrude', id: 'e5', sketch: 's4', distance: -20, op: 'join' },
      { type: 'sketch', id: 's5', plane: { base: 'XY' }, shapes: [rect(10, 6, 4, 4)] },
      { type: 'extrude', id: 'e6', sketch: 's5', distance: 76, op: 'join' },
    ],
    steps: [made('extrude', 1), made('extrude', 2), made('pattern', 1), made('extrude', 3), made('extrude', 5), made('extrude', 6), s => s.match && printClean(s)],
  },
  {
    // Big gear: hub, keyed axle hole, and 4 holes patterned around to make it lighter.
    id: 'adv-gear',
    course: 'advanced',
    start: [],
    goal: [
      ...gear(30, 12, 12),
      { type: 'sketch', id: 's4', plane: { face: top(8) }, shapes: [rect(0, 3, 2, 2)] },
      { type: 'extrude', id: 'e4', sketch: 's4', distance: -8, op: 'cut' },
      { type: 'hole', id: 'h2', face: top(5), x: 9, y: 0, d: 5, depth: 0 },
      { type: 'pattern', id: 'p2', of: 'h2', kind: 'circle', n: 4 },
    ],
    steps: [made('extrude', 1), drew('poly'), made('pattern', 1), made('extrude', 3), made('hole', 1), made('extrude', 4), matches],
  },
  {
    id: 'adv-screw',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [HEX] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 6, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: top(6) }, shapes: [circle(0, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 20, op: 'join' },
      // Rounding the inside corner under the head makes the screw much stronger; the 45° chamfer on the
      // bed edges stops the first layer from squishing out (elephant's foot).
      { type: 'fillet', id: 'f1', edges: [arc(-5, 0, 6)], r: 1 },
      { type: 'chamfer', id: 'c1', edges: [edge(7, 4, 0), edge(0, 8, 0), edge(-7, 4, 0), edge(-7, -4, 0), edge(0, -8, 0), edge(7, -4, 0)], r: 1 },
      { type: 'thread', id: 't1', face: { c: [0, 0, 16.5], a: [0, 0, 1], r: 5 }, pitch: 2 },
    ],
    steps: [drew('poly'), made('extrude', 1), made('extrude', 2), made('fillet', 1), made('chamfer', 1), opened('thread'), matches],
  },
  {
    // A wing nut turns by hand. Hub + two wings (Line on the XZ wall, extruded both ways), a 9 mm hole:
    // the screw's thread is 0.8 deep (5 → 4.2 mm radius), so that leaves 0.3 mm of clearance all round.
    id: 'adv-nut',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 16)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 8, op: 'join' },
      { type: 'sketch', id: 's2', plane: { base: 'XZ' }, shapes: [poly([6, 0], [14, 0], [17, 12], [12, 12], [6, 8]), poly([-6, 0], [-6, 8], [-12, 12], [-17, 12], [-14, 0])] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 1.5, op: 'join' },
      { type: 'extrude', id: 'e3', sketch: 's2', distance: -1.5, op: 'join' },
      { type: 'fillet', id: 'f1', edges: [edge(17, 0, 12), edge(-17, 0, 12)], r: 2 },
      { type: 'hole', id: 'h1', face: top(8), x: 0, y: 0, d: 9, depth: 0 },
      { type: 'thread', id: 't1', face: { c: [0, 0, 4], a: [0, 0, 1], r: 4.5 }, pitch: 2 },
    ],
    steps: [made('extrude', 1), drew('poly'), made('extrude', 3), made('fillet', 1), made('hole', 1), opened('thread'), matches],
  },
  {
    // A leaf: plate + a knuckle tube along its edge, two slots cut out of the tube, a pin hole through,
    // rounded corners and two countersunk screw holes. Two identical leaves interlock (next lesson).
    id: 'adv-hinge',
    course: 'advanced',
    start: [],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [rect(20, -10, 40, 20)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      // On the YZ wall, sketch X is world Y and sketch Y is height.
      { type: 'sketch', id: 's2', plane: { base: 'YZ' }, shapes: [circle(0, 3, 6)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 40, op: 'join' },
      { type: 'sketch', id: 's3', plane: { base: 'XY' }, shapes: [rect(15, 0, 11, 8)] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: 10, op: 'cut' },
      { type: 'pattern', id: 'p1', of: 'e3', kind: 'rect', nx: 2, dx: 20, ny: 1, dy: 10 },
      { type: 'hole', id: 'h1', face: { n: [-1, 0, 0], c: [0, -8, 2] }, x: 0, y: 3, d: 3.5, depth: 0 },
      { type: 'fillet', id: 'f1', edges: [edge(0, -20, 1.5), edge(40, -20, 1.5)], r: 4 },
      { type: 'hole', id: 'h2', face: top(3), x: 10, y: -12, d: 3.5, depth: 0 },
      { type: 'pattern', id: 'p2', of: 'h2', kind: 'rect', nx: 2, dx: 20, ny: 1, dy: 10 },
      // Countersinks, so flat screw heads sit flush.
      { type: 'chamfer', id: 'c1', edges: [arc(8.25, -12, 3), arc(28.25, -12, 3)], r: 1 },
    ],
    steps: [made('extrude', 1), made('extrude', 2), made('extrude', 3), made('pattern', 1), made('hole', 1), made('fillet', 1), made('pattern', 2), matches],
  },
  {
    id: 'adv-hinge-joint',
    course: 'advanced',
    assembly: [
      { id: 'leaf1', part: 'adv-hinge', grounded: true },
      { id: 'leaf2', part: 'adv-hinge', at: [0, -40, 0] },
    ],
    steps: [opened('joint'), joined('adv-hinge', 'adv-hinge'), s => s.driven],
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
  {
    id: 'spin-button',
    course: 'spin',
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 20)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      { type: 'hole', id: 'h1', face: top(3), x: 4, y: 0, d: 2, depth: 0 },
      { type: 'pattern', id: 'p1', of: 'h1', kind: 'circle', n: 4 },
    ],
  },
  {
    // A heater shield: Line outline, a cross on its front, a round boss in the middle.
    id: 'adv-shield',
    course: 'advanced',
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [poly([-20, 20], [20, 20], [20, -5], [12, -20], [0, -28], [-12, -20], [-20, -5])] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      { type: 'sketch', id: 's2', plane: { face: top(3) }, shapes: [rect(0, 0, 6, 30), rect(0, 6, 24, 6)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 1.5, op: 'join' },
      { type: 'sketch', id: 's3', plane: { face: top(3) }, shapes: [circle(0, 0, 10)] },
      { type: 'extrude', id: 'e3', sketch: 's3', distance: 2.5, op: 'join' },
    ],
  },
  // Same tooth, fewer of them: it meshes with the 12-tooth gear and turns 1.5 times faster.
  { id: 'adv-gear-small', course: 'advanced', goal: gear(20, 8, 10) },
];
