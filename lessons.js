// Lessons are steps with a done(s) check; the last step is usually "your part matches the goal".
// Challenges only have a goal. Goals are feature lists, built by the same engine as the kid's part.

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
    title: 'Your first block',
    intro: 'Real CAD parts start as a flat drawing called a <b>sketch</b>. Then you pull it up into 3D. That pull is called an <b>extrude</b>.',
    start: [],
    goal: block(),
    steps: [
      { text: 'Click <b>Create Sketch</b>, then click the flat <b>XY</b> plane on the floor.', done: sketching },
      { text: 'Pick <b>Rectangle</b>. Click one corner on the grid, then the opposite corner.', done: drew('rect') },
      { text: 'In the panel on the right, set Center <b>0</b>, <b>0</b>, Width <b>40</b> and Height <b>20</b>.', done: drew('rect', { x: 0, y: 0, w: 40, h: 20 }) },
      { text: 'Click <b>Finish Sketch</b>.', done: added('sketch') },
      { text: 'Click <b>Extrude</b>. Set Distance to <b>10</b> and click <b>OK</b>.', done: matches },
    ],
    outro: 'In Fusion 360, Create Sketch and Extrude are the first buttons under SOLID → CREATE. Same idea, same names.',
  },
  {
    id: 'fillet',
    title: 'Round the corners',
    intro: 'A <b>fillet</b> rounds a sharp edge. A fillet is a feature too: it sits on top of the extrude.',
    start: block(),
    goal: [...block(), { type: 'fillet', id: 'f1', edges: cornerEdges(40, 20, 10), r: 5 }],
    steps: [
      { text: 'Click <b>Fillet</b>.', done: opened('fillet') },
      { text: 'Click the <b>4 edges that stand up</b> at the corners. Picked edges turn blue. One hides at the back: left-drag to spin the part around.', done: s => s.selected >= 4 },
      { text: 'Set Radius to <b>5</b> and click <b>OK</b>.', done: matches },
    ],
    outro: 'Look at the timeline at the bottom: Sketch → Extrude → Fillet. Fusion keeps the same list, in the same order.',
  },
  {
    id: 'hole',
    title: 'Drill a hole',
    intro: 'The <b>Hole</b> tool drills into a face. You pick the face, then say where the hole goes and how big it is.',
    start: block(),
    goal: [...block(), { type: 'hole', id: 'h1', face: top(10), x: 0, y: 0, d: 8, depth: 0 }],
    steps: [
      { text: 'Click <b>Hole</b>.', done: opened('hole') },
      { text: 'Click the <b>top face</b> of the block.', done: s => s.holeFace },
      { text: 'Set X <b>0</b>, Y <b>0</b>, Diameter <b>8</b> and Depth <b>0</b> (0 means all the way through). Click <b>OK</b>.', done: matches },
    ],
    outro: 'In Fusion, the Hole tool can also make countersinks for screws. Find it under SOLID → CREATE → Hole.',
  },
  {
    id: 'stack',
    title: 'Build on top',
    intro: 'You can sketch on any flat face of your part. New features grow out of old ones.',
    start: block(),
    goal: [
      ...block(),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(0, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 15, op: 'join' },
    ],
    steps: [
      { text: 'Click <b>Create Sketch</b>, then click the <b>top face</b> of the block.', done: onFace },
      { text: 'Pick <b>Circle</b>. Click the center, then click again to set the size.', done: drew('circle') },
      { text: 'Set Center <b>0</b>, <b>0</b> and Diameter <b>10</b>. Click <b>Finish Sketch</b>.', done: added('sketch') },
      { text: 'Click <b>Extrude</b>. Distance <b>15</b>, Operation <b>Join</b>. Click <b>OK</b>.', done: matches },
    ],
    outro: '"Join" glues the new shape onto the body. Fusion picks Join for you when the new shape touches the body.',
  },
  {
    id: 'pocket',
    title: 'Cut a pocket',
    intro: 'Extrude can also take material away. That is a <b>Cut</b>. A negative distance pushes down into the part.',
    start: block(),
    goal: [
      ...block(),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [rect(0, 0, 24, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -5, op: 'cut' },
    ],
    steps: [
      { text: 'Create a sketch on the <b>top face</b> of the block.', done: onFace },
      { text: 'Draw a rectangle with Center <b>0</b>, <b>0</b>, Width <b>24</b>, Height <b>10</b>. Click <b>Finish Sketch</b>.', done: added('sketch') },
      { text: 'Click <b>Extrude</b>. Distance <b>-5</b>, Operation <b>Cut</b>. Click <b>OK</b>.', done: matches },
    ],
    outro: 'In Fusion you can also drag the arrow down into the part. It switches to Cut by itself.',
  },
  {
    id: 'change',
    title: 'Change your mind',
    intro: 'This is the superpower of Fusion and SolidWorks. Every feature remembers its numbers. Change an early feature and everything after it updates.',
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
    steps: [
      { text: 'In the timeline at the bottom, click <b>Sketch1</b>.', done: sketching },
      { text: 'Change Width from 40 to <b>60</b>. Click <b>Finish Sketch</b>.', done: s => s.mode === 'model' && s.features[0].shapes[0]?.w === 60 },
      { text: 'The fillets and the hole moved with it! Now click <b>Extrude1</b>, change Distance to <b>15</b>, and click <b>OK</b>.', done: matches },
    ],
    outro: 'This is why you name features and keep the timeline tidy in Fusion. Your future self will edit it.',
  },
];

export const CHALLENGES = [
  {
    id: 'tag',
    title: 'Keychain tag',
    brief: ['Plate 50 × 20, 4 thick, centered on the origin', 'Round the 4 corners: radius 5', 'Hole Ø5 all the way through, at X -18, Y 0'],
    goal: [
      ...block(50, 20, 4),
      { type: 'fillet', id: 'f1', edges: cornerEdges(50, 20, 4), r: 5 },
      { type: 'hole', id: 'h1', face: top(4), x: -18, y: 0, d: 5, depth: 0 },
    ],
  },
  {
    id: 'washer',
    title: 'Washer',
    brief: ['Disc Ø30, 3 thick, centered on the origin', 'Hole Ø12 through the middle'],
    goal: [
      { type: 'sketch', id: 's1', plane: { base: 'XY' }, shapes: [circle(0, 0, 30)] },
      { type: 'extrude', id: 'e1', sketch: 's1', distance: 3, op: 'join' },
      { type: 'hole', id: 'h1', face: top(3), x: 0, y: 0, d: 12, depth: 0 },
    ],
  },
  {
    id: 'brick',
    title: 'Toy brick',
    brief: ['Block 32 × 16, 10 tall, centered on the origin', 'Two round studs on top: Ø10, 4 tall', 'Studs at X -8 and X 8 (Y 0)'],
    goal: [
      ...block(32, 16, 10),
      { type: 'sketch', id: 's2', plane: { face: top(10) }, shapes: [circle(-8, 0, 10), circle(8, 0, 10)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: 4, op: 'join' },
    ],
  },
  {
    id: 'bracket',
    title: 'L-bracket',
    brief: ['Base 40 × 30, 5 thick, centered on the origin', 'A wall along the back edge: 40 wide, 5 thick (Y from 10 to 15), 25 tall on top of the base', 'Two Ø5 holes through the base at X -12 and X 12, Y -5'],
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
    title: 'Pencil cup',
    brief: ['Box 60 × 40, 30 tall, centered on the origin', 'Round the 4 standing edges: radius 5', 'Hollow it from the top: a 50 × 30 pocket, 25 deep'],
    goal: [
      ...block(60, 40, 30),
      { type: 'fillet', id: 'f1', edges: cornerEdges(60, 40, 30), r: 5 },
      { type: 'sketch', id: 's2', plane: { face: top(30) }, shapes: [rect(0, 0, 50, 30)] },
      { type: 'extrude', id: 'e2', sketch: 's2', distance: -25, op: 'cut' },
    ],
  },
];
