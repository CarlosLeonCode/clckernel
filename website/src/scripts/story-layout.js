// Shared layout of Fig. 01 (world units, track along +x, floor at y = 0).
// Used by the WebGL scene and by the static SVG panels so both tell the same
// story in the same places.
export const TOKEN = { w: 0.78, h: 0.38, d: 0.56 };
export const PLATE = 0.018;
export const TOKEN_Y = PLATE + TOKEN.h / 2;

export const RULEBOOK = { x: -8.4, z: 0, w: 1.8, d: 1.25, h: 0.14, y: 0.36 };
export const NODE_Y = 1.0;
export const NODE_R = 0.34;
export const NODES = [
  { x: -5.75, z: -2.2, name: 'Claude Code' },
  { x: -5.95, z: -1.1, name: 'Cursor' },
  { x: -6.05, z: 0, name: 'Copilot' },
  { x: -5.95, z: 1.1, name: 'Gemini' },
  { x: -5.75, z: 2.2, name: 'Antigravity' },
];

export const TRACK = { start: -4.6, end: 5.9, half: 0.42 };
export const CHAMBER = { x: -2.6, w: 1.0, d: 1.0, h: 0.92 };
export const ARCH = { outer: 0.9, top: 2.05, inner: 0.66, innerTop: 1.7, depth: 0.26, bevel: 0.035 };
// Reject bay: three slots 0.96 apart (a tile is 0.78 wide), so even a tile
// turned slightly keeps a clear gap to its neighbour.
export const BAY = [
  { x: -1.3, z: -1.1 },
  { x: -2.26, z: -1.1 },
  { x: -3.22, z: -1.1 },
];
// The post stands at the near end of the approval bay, clear of the first
// waiting slot; slots keep a gap of at least 15% of a tile.
export const APPROVAL = {
  post: { x: 1.05, z: 1.3 },
  slots: [
    { x: 2.15, z: 1.3 },
    { x: 3.07, z: 1.3 },
    { x: 3.99, z: 1.3 },
  ],
};
// Saved queue: a flat 3 x 2 grid (no stacking), gaps >= 15% of a tile.
export const QUEUE = { x0: 3.55, step: 0.92, cols: 3, rows: [-0.37, 0.37], slots: 6 };
export const queueSlot = (i) => ({
  x: QUEUE.x0 + (QUEUE.cols - 1 - (i % QUEUE.cols)) * QUEUE.step,
  z: QUEUE.rows[Math.floor(i / QUEUE.cols) % QUEUE.rows.length],
});

// Camera per chapter: 0 = overview (hero), 1..4 = the story.
// keys are the points that must stay in frame.
export const SHOTS = [
  {
    yaw: 0.28, elev: 0.5,
    keys: [[-9.3, 0, -1.3], [-9.3, 0, 1.3], [-8.4, 0.7, 0], [-5.8, 1.5, -2.5], [-5.8, 1.5, 2.5], [0, 2.1, -0.9], [0, 2.1, 0.9], [5.9, 0.8, 0], [4.2, 0, 1.7], [-3.1, 0, -1.4]],
  },
  {
    yaw: 0.55, elev: 0.42,
    keys: [[-9.4, 0, -1.4], [-9.4, 0, 1.4], [-8.4, 1.0, 0], [-5.6, 1.6, -2.6], [-5.6, 1.6, 2.6], [-5.6, 0, -2.6], [-5.6, 0, 2.6]],
  },
  {
    yaw: 0.5, elev: 0.36,
    keys: [[-6.2, 1.6, -2.5], [-6.2, 1.6, 2.5], [-6.2, 0, 2.4], [-2.0, 1.1, 0.6], [-2.0, 0, -0.6], [-4.6, 0, 0.4]],
  },
  {
    yaw: 0.62, elev: 0.3,
    keys: [[-3.3, 1.1, 0.6], [-3.5, 0, -1.45], [0, 2.1, -0.9], [0, 2.1, 0.9], [0, 0, 0.9], [1.0, 0, 0.3], [-0.8, 0.5, -1.4]],
  },
  {
    yaw: -0.45, elev: 0.42,
    keys: [[0, 2.1, -0.9], [0, 0, 0.9], [1.05, 1.95, 1.6], [0.6, 0, 1.6], [-0.6, 0, 0.9], [4.4, 0.9, 1.7], [5.9, 0.7, 0.7], [5.9, 0, -0.7], [0.5, 0, -0.6]],
  },
];

export const SKY = '#04b8f7';
export const AMBER = '#f0c048';
export const RUST = '#c06018';
export const RED = '#ff5b5b';
export const GREEN = '#35d07f';
