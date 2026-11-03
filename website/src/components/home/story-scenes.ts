// Static versions of Fig. 01 (the overview shown before WebGL loads or
// without it, and one panel per story chapter), built from the same layout
// as the WebGL scene.
import { isoSvg, type Item, type Shade, type V3 } from './iso';
import {
  TOKEN, TOKEN_Y, RULEBOOK, NODES, NODE_Y, NODE_R, TRACK, CHAMBER, ARCH, BAY, APPROVAL, QUEUE, SHOTS, queueSlot,
} from '../../scripts/story-layout.js';

const GRAPHITE: Shade = ['#4a4e56', '#2b2e34', '#383b42'];
const CERAMIC: Shade = ['#8a8d94', '#5d6066', '#6c6f76'];
const BLUE: Shade = ['#6fd6fb', '#04b8f7', '#0a9bd0'];
const AMBER: Shade = ['#fec55a', '#d99f32', '#f0c048'];
const RUST: Shade = ['#d9823a', '#a5501a', '#c06018'];
const TS: V3 = [TOKEN.w, TOKEN.h, TOKEN.d];

const token = (x: number, z: number, kind: 'grey' | 'blue' | 'amber' | 'rust' | 'wait', layer = 0): Item => ({
  t: 'box',
  c: [x, TOKEN_Y + layer * (TOKEN.h + 0.02), z],
  s: TS,
  fill: kind === 'blue' ? BLUE : kind === 'amber' ? AMBER : kind === 'rust' ? RUST : CERAMIC,
  glyph: kind === 'blue' ? '#ffffff' : kind === 'amber' || kind === 'rust' ? '#0e0e0c' : '#34363b',
  glow: kind === 'blue' && layer === 1 ? '#04b8f7' : kind === 'amber' ? '#f0c048' : kind === 'wait' ? '#bdf1fe' : undefined,
  edge: kind === 'amber' ? '#fec55a' : kind === 'wait' ? '#bdf1fe' : undefined,
});

const floorItems = (x0: number, x1: number): Item[] => [
  { t: 'poly', floor: true, fill: '#16171b', pts: [[Math.max(x0, TRACK.start), 0, -TRACK.half], [Math.min(x1, TRACK.end), 0, -TRACK.half], [Math.min(x1, TRACK.end), 0, TRACK.half], [Math.max(x0, TRACK.start), 0, TRACK.half]] },
  { t: 'line', floor: true, color: '#59616c', width: 0.8, pts: [[Math.max(x0, TRACK.start), 0, -TRACK.half], [Math.min(x1, TRACK.end), 0, -TRACK.half]] },
  { t: 'line', floor: true, color: '#59616c', width: 0.8, pts: [[Math.max(x0, TRACK.start), 0, TRACK.half], [Math.min(x1, TRACK.end), 0, TRACK.half]] },
];

const rulebookItems = (labels: string[]): Item[] => {
  const r = RULEBOOK;
  const items: Item[] = [
    { t: 'box', c: [r.x, r.y / 2, r.z], s: [r.w * 0.7, r.y, r.d * 0.7], fill: GRAPHITE },
    { t: 'box', c: [r.x, r.y + r.h / 2, r.z], s: [r.w, r.h, r.d], fill: ['#5a5f68', '#2b2e34', '#383b42'], edge: '#04b8f7', shadow: false },
    { t: 'label', at: [r.x, r.y + r.h + 0.12, r.z], text: labels[0], kind: 'node' },
  ];
  for (const n of NODES) {
    const from: V3 = [r.x, r.y + r.h, r.z];
    const to: V3 = [n.x, NODE_Y, n.z];
    const mid: V3 = [(from[0] + to[0]) / 2, 1.7, (from[2] + to[2]) / 2];
    const curve: V3[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      curve.push([0, 1, 2].map((k) => (1 - u) * (1 - u) * from[k] + 2 * (1 - u) * u * mid[k] + u * u * to[k]) as V3);
    }
    items.push({ t: 'line', pts: curve, color: '#04b8f7', width: 1, opacity: 0.8, glow: true, depthAt: [n.x - 1, 0.5, n.z * 0.6] });
  }
  return items;
};

const nodeItems = (labels = true): Item[] => NODES.flatMap((n): Item[] => [
  { t: 'disc', c: [n.x, NODE_Y, n.z], r: NODE_R, h: 0.08, fill: '#3a3e46', side: '#202328', ring: '#04b8f7', shadow: true },
  ...(labels ? [{ t: 'label', at: [n.x, NODE_Y + 0.05, n.z], text: n.name, kind: 'plain', side: NODE_R + 0.15 } as Item] : []),
]);

const chamberItems = (light: string): Item[] => {
  const c = CHAMBER;
  const posts: Item[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dz]) => ({
    t: 'box', c: [c.x + (dx * c.w) / 2, c.h / 2, (dz * c.d) / 2], s: [0.06, c.h, 0.06], fill: GRAPHITE, shadow: false,
  }));
  return [
    ...posts,
    { t: 'box', c: [c.x, c.h + 0.04, 0], s: [c.w + 0.06, 0.08, c.d + 0.06], fill: [light, '#2b2e34', '#383b42'], glow: light, shadow: false },
  ];
};

const gateItems = (side: 1 | -1 = -1): Item[] => {
  const a = ARCH;
  const postZ = (a.outer + a.inner) / 2;
  const postW = a.outer - a.inner;
  const rx = side * (a.depth / 2 + 0.004);
  const rimZ = a.inner - a.bevel;
  const rimTop = a.innerTop - a.bevel;
  return [
    { t: 'box', c: [0, a.top / 2, -postZ], s: [a.depth, a.top, postW], fill: GRAPHITE },
    { t: 'box', c: [0, a.top / 2, postZ], s: [a.depth, a.top, postW], fill: GRAPHITE },
    { t: 'box', c: [0, (a.top + a.innerTop) / 2, 0], s: [a.depth, a.top - a.innerTop, a.outer * 2], fill: GRAPHITE, shadow: false },
    { t: 'poly', fill: '#04b8f7', opacity: 0.12, pts: [[0, 0.03, -rimZ], [0, rimTop, -rimZ], [0, rimTop, rimZ], [0, 0.03, rimZ]], depthAt: [0.05, 1, 0] },
    { t: 'line', color: '#7fdcff', width: 1.3, glow: true, pts: [[rx, 0.03, -rimZ], [rx, rimTop, -rimZ], [rx, rimTop, rimZ], [rx, 0.03, rimZ]], depthAt: [side * 0.3, 1.2, 0] },
  ];
};

const approvalItems = (label: string): Item[] => {
  const p = APPROVAL.post;
  return [
    { t: 'box', c: [p.x, 0.6, p.z], s: [0.12, 1.2, 0.12], fill: GRAPHITE },
    { t: 'box', c: [p.x, 1.32, p.z], s: [0.08, 0.5, 0.56], fill: ['#5a5f68', '#bdf1fe', '#3a3e46'], shadow: false },
    { t: 'label', at: [(p.x + APPROVAL.slots[0].x) / 2 + 0.2, 1.75, p.z], text: label, kind: 'plain' },
  ];
};

const queueItems = (count: number, label?: string): Item[] => {
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const q = queueSlot(i);
    items.push(token(q.x, q.z, 'blue'));
  }
  if (label) items.push({ t: 'label', at: [QUEUE.x0 + QUEUE.step, TOKEN_Y + TOKEN.h + 0.45, QUEUE.rows[0]], text: label, kind: 'plain' });
  return items;
};

const shot = (i: number) => ({ yaw: SHOTS[i].yaw, elev: SHOTS[i].elev });

export function storyScenes(labels: string[], reason: string, approve: string) {
  const [, tests, guards, approval, saved] = labels;
  const overview = isoSvg([
    ...floorItems(-10, 10),
    ...rulebookItems(labels),
    ...nodeItems(false),
    token(-4.2, 0, 'grey'),
    ...chamberItems('#35d07f'),
    { t: 'label', at: [CHAMBER.x, CHAMBER.h + 0.35, 0], text: tests, kind: 'plain' },
    ...gateItems(),
    { t: 'label', at: [0, ARCH.top + 0.3, 0], text: guards, kind: 'plain' },
    token(BAY[0].x, BAY[0].z, 'amber'),
    { t: 'label', at: [BAY[0].x, TOKEN_Y + 0.55, BAY[0].z], text: reason, kind: 'tag' },
    ...approvalItems(approval),
    token(APPROVAL.slots[0].x, APPROVAL.slots[0].z, 'wait'),
    ...queueItems(4, saved),
  ], { ...shot(0), scale: 30, grid: { x0: -10, x1: 7, z0: -3, z1: 3, center: [-1.5, 0, 0], radius: 9 } }, 'fig0');

  const p1 = isoSvg([
    ...rulebookItems(labels),
    ...nodeItems(),
  ], { ...shot(1), scale: 34, grid: { x0: -10, x1: -4.5, z0: -3, z1: 3, center: [-7, 0, 0], radius: 4.5 } }, 'fig1');

  const p2 = isoSvg([
    ...floorItems(-4.8, -1.8),
    ...nodeItems(false),
    token(-4.2, 0, 'grey'),
    token(-3.3, 0, 'grey'),
    ...chamberItems('#3a3e46'),
  ], { ...shot(2), scale: 36, grid: { x0: -7, x1: -1.5, z0: -3, z1: 3, center: [-4.5, 0, 0], radius: 4 } }, 'fig2');

  const p3 = isoSvg([
    ...floorItems(-3.6, 1.2),
    ...chamberItems('#35d07f'),
    token(CHAMBER.x, 0, 'blue'),
    { t: 'label', at: [CHAMBER.x, CHAMBER.h + 0.35, 0], text: tests, kind: 'plain' },
    ...gateItems(),
    { t: 'label', at: [0, ARCH.top + 0.3, 0], text: guards, kind: 'plain' },
    { t: 'poly', floor: true, fill: '#241c10', pts: [[-3.6, 0, -1.48], [-0.85, 0, -1.48], [-0.85, 0, -0.72], [-3.6, 0, -0.72]] },
    token(BAY[0].x, BAY[0].z, 'amber'),
    token(BAY[1].x, BAY[1].z, 'rust'),
    { t: 'label', at: [BAY[0].x, TOKEN_Y + 0.55, BAY[0].z], text: reason, kind: 'tag' },
  ], { ...shot(3), scale: 44, grid: { x0: -4, x1: 1.5, z0: -2, z1: 1.5, center: [-1.5, 0, 0], radius: 3.6 } }, 'fig3');

  const s = APPROVAL.slots[0];
  const p4 = isoSvg([
    ...floorItems(-0.4, 6.2),
    ...gateItems(1),
    ...approvalItems(approval),
    token(s.x, s.z, 'wait'),
    { t: 'label', at: [s.x, TOKEN_Y + 0.6, s.z], text: approve, kind: 'pill' },
    ...queueItems(5, saved),
  ], { ...shot(4), scale: 38, grid: { x0: -0.5, x1: 6.5, z0: -1.5, z1: 2.8, center: [3, 0, 0.5], radius: 4.5 } }, 'fig4');

  return { overview, panels: [p1, p2, p3, p4] };
}
