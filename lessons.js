// Lessons are a list of step checks; the last one is usually "your part matches the goal".
// Challenges only have a goal. Goals are feature lists, built by the same engine as the kid's part.
// The words live in locales/*.js under lesson.<id>.* and challenge.<id>.* (one step text per check).

const rect = (x, y, w, h) => ({ kind: 'rect', x, y, w, h });
const circle = (x, y, d) => ({ kind: 'circle', x, y, d });
const top = z => ({ n: [0, 0, 1], c: [0, 0, z] });
// The 4 standing-up edges of a centered w×h box that is t tall.
const cornerEdges = (w, h, t) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => ({ m: [a * w / 2, b * h / 2, t / 2], g: 'LINE' }));

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
const matches = s => s.match;

export const LESSONS = [
  {
    id: 'block',
    start: [],
    goal: block(),
    steps: [sketching, drew('rect'), drew('rect', { x: 0, y: 0, w: 40, h: 20 }), added('sketch'), matches],
  },
  {
    id: 'fillet',
    start: block(),
    goal: [...block(), { type: 'fillet', id: 'f1', edges: cornerEdges(40, 20, 10), r: 5 }],
    steps: [opened('fillet'), s => s.selected >= 4, matches],
  },
  {
    id: 'hole',
    start: block(),
    goal: [...block(), { type: 'hole', id: 'h1', face: top(10), x: 0, y: 0, d: 8, depth: 0 }],
    steps: [opened('hole'), s => s.holeFace, matches],
  },
  {
    id: 'stack',
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
];

export const CHALLENGES = [
  {
    id: 'tag',
    goal: [
      ...block(50, 20, 4),
      { type: 'fillet', id: 'f1', edges: cornerEdges(50, 20, 4), r: 5 },
      { type: 'hole', id: 'h1', face: top(4), x: -18, y: 0, d: 5, depth: 0 },
    ],
  },
  {
    id: 'washer',
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 30)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      { type: 'hole', id: 'h1', face: top(3), x: 0, y: 0, d: 12, depth: 0 },
    ],
  },
  {
    id: 'brick',
    goal: [
      ...block(32, 16, 10),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(-8, 0, 10), circle(8, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
    ],
  },
  {
    id: 'bracket',
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
    goal: [
      ...block(60, 40, 30),
      { type: 'fillet', id: 'f1', edges: cornerEdges(60, 40, 30), r: 5 },
      { type: 'sketch', id: 's2', plane: { face: top(30) }, shapes: [rect(0, 0, 50, 30)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -25, op: 'cut' },
    ],
  },
];
