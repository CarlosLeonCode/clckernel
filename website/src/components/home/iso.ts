// Tiny orthographic renderer for the static Fig. 01 panels: projects the same
// world layout the WebGL scene uses (story-layout.js) with a chapter's yaw and
// elevation, and returns SVG markup. Painter's order, no dependencies.
export type V3 = [number, number, number];
export type Shade = [string, string, string]; // top, front/back, sides

export type Item =
  | { t: 'box'; c: V3; s: V3; fill: Shade; glyph?: string; glow?: string; shadow?: boolean; edge?: string }
  | { t: 'disc'; c: V3; r: number; h: number; fill: string; side: string; ring?: string; shadow?: boolean }
  | { t: 'poly'; pts: V3[]; fill: string; opacity?: number; floor?: boolean; depthAt?: V3; glow?: boolean }
  | { t: 'line'; pts: V3[]; color: string; width?: number; opacity?: number; glow?: boolean; floor?: boolean; depthAt?: V3; dash?: string }
  | { t: 'label'; at: V3; text: string; kind: 'tag' | 'plain' | 'pill' | 'node'; side?: number };

export interface IsoOptions {
  yaw: number;
  elev: number;
  scale?: number;
  grid?: { x0: number; x1: number; z0: number; z1: number; step?: number; center: V3; radius: number };
  pad?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => n.toFixed(1);

const FACES: { n: V3; shade: 0 | 1 | 2; corners: V3[] }[] = [
  { n: [0, 1, 0], shade: 0, corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, 1], shade: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], shade: 1, corners: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] },
  { n: [1, 0, 0], shade: 2, corners: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [-1, 0, 0], shade: 2, corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
];

export function isoSvg(items: Item[], opts: IsoOptions, idPrefix: string) {
  const S = opts.scale ?? 40;
  const cy = Math.cos(opts.yaw), sy = Math.sin(opts.yaw);
  const ce = Math.cos(opts.elev), se = Math.sin(opts.elev);
  const rot = ([x, y, z]: V3): V3 => [x * cy + z * sy, y, -x * sy + z * cy];
  const proj = (p: V3): [number, number] => {
    const [rx, ry, rz] = rot(p);
    return [rx * S, -(ry * ce - rz * se) * S];
  };
  const depth = (p: V3) => {
    const [, ry, rz] = rot(p);
    return rz * ce + ry * se;
  };
  const facing = (n: V3) => {
    const [, ny, nz] = rot(n);
    return ny * se + nz * ce > 0.001;
  };
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => {
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
    b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  };
  const pt = (p: V3, count = true) => {
    const [x, y] = proj(p);
    if (count) grow(x, y);
    return `${f(x)},${f(y)}`;
  };

  const floor: string[] = [];
  const shadows: string[] = [];
  const solids: { d: number; svg: string }[] = [];
  const top: string[] = [];
  const font = 'font-family="Geist Mono, ui-monospace, monospace"';

  for (const it of items) {
    if (it.t === 'box') {
      const faces = FACES.filter((fc) => facing(fc.n)).map((fc) => {
        const pts = fc.corners.map(([dx, dy, dz]) => pt([it.c[0] + (dx * it.s[0]) / 2, it.c[1] + (dy * it.s[1]) / 2, it.c[2] + (dz * it.s[2]) / 2])).join(' ');
        return `<polygon points="${pts}" fill="${it.fill[fc.shade]}" stroke="#0e0e0c" stroke-width="0.6" stroke-linejoin="round"/>`;
      });
      const [tx, ty] = proj([it.c[0], it.c[1] + it.s[1] / 2, it.c[2]]);
      let svg = '';
      if (it.glow) svg += `<ellipse cx="${f(tx)}" cy="${f(ty)}" rx="${f(it.s[0] * S * 0.7)}" ry="${f(it.s[2] * S * 0.55)}" fill="${it.glow}" opacity="0.4" filter="url(#${idPrefix}-glow)"/>`;
      svg += faces.join('');
      if (it.edge) {
        const e = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dz]) => pt([it.c[0] + (dx * it.s[0]) / 2, it.c[1] + it.s[1] / 2, it.c[2] + (dz * it.s[2]) / 2], false)).join(' ');
        svg += `<polygon points="${e}" fill="none" stroke="${it.edge}" stroke-width="1.4" stroke-linejoin="round"/>`;
      }
      if (it.glyph) svg += `<text x="${f(tx)}" y="${f(ty + 2.6)}" text-anchor="middle" fill="${it.glyph}" ${font} font-size="${f(S * 0.19)}" font-weight="600">&lt;/&gt;</text>`;
      solids.push({ d: depth(it.c), svg });
      if (it.shadow !== false && it.c[1] - it.s[1] / 2 < 0.2) {
        const [sx, sy2] = proj([it.c[0], 0, it.c[2]]);
        shadows.push(`<ellipse cx="${f(sx)}" cy="${f(sy2)}" rx="${f(it.s[0] * S * 0.62)}" ry="${f(it.s[2] * S * 0.4)}"/>`);
      }
    } else if (it.t === 'disc') {
      const [x, y] = proj(it.c);
      const [, yb] = proj([it.c[0], it.c[1] - it.h, it.c[2]]);
      const rx = it.r * S;
      const ry = it.r * S * se;
      grow(x - rx, y - ry); grow(x + rx, yb + ry);
      let svg = `<path d="M${f(x - rx)},${f(y)} L${f(x - rx)},${f(yb)} A${f(rx)},${f(ry)} 0 0 0 ${f(x + rx)},${f(yb)} L${f(x + rx)},${f(y)} Z" fill="${it.side}"/>`;
      svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${it.fill}" stroke="#0e0e0c" stroke-width="0.6"/>`;
      if (it.ring) {
        svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.98)}" ry="${f(ry * 0.98)}" fill="none" stroke="${it.ring}" stroke-width="5" opacity="0.4" filter="url(#${idPrefix}-glow)"/>`;
        svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.98)}" ry="${f(ry * 0.98)}" fill="none" stroke="${it.ring}" stroke-width="1.2"/>`;
        svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.42)}" ry="${f(ry * 0.42)}" fill="none" stroke="${it.ring}" stroke-width="1" opacity="0.8"/>`;
        svg += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.12)}" ry="${f(ry * 0.12)}" fill="${it.ring}"/>`;
      }
      solids.push({ d: depth(it.c), svg });
      if (it.shadow) {
        const [sx, sy2] = proj([it.c[0], 0, it.c[2]]);
        shadows.push(`<ellipse cx="${f(sx)}" cy="${f(sy2)}" rx="${f(rx * 0.8)}" ry="${f(ry * 0.8)}" opacity="0.6"/>`);
      }
    } else if (it.t === 'poly') {
      const pts = it.pts.map((p) => pt(p, !it.floor)).join(' ');
      const svg = `<polygon points="${pts}" fill="${it.fill}" opacity="${it.opacity ?? 1}"${it.glow ? ` filter="url(#${idPrefix}-glow)"` : ''}/>`;
      if (it.floor) floor.push(svg);
      else solids.push({ d: depth(it.depthAt ?? it.pts[0]), svg });
    } else if (it.t === 'line') {
      const d = `M${it.pts.map((p) => pt(p, !it.floor)).join(' L')}`;
      const w = it.width ?? 1.2;
      let svg = '';
      if (it.glow) svg += `<path d="${d}" stroke="${it.color}" stroke-width="${f(w * 4)}" fill="none" opacity="0.45" filter="url(#${idPrefix}-glow)" stroke-linejoin="round" stroke-linecap="round"/>`;
      svg += `<path d="${d}" stroke="${it.color}" stroke-width="${w}" fill="none" opacity="${it.opacity ?? 1}" stroke-linejoin="round" stroke-linecap="round"${it.dash ? ` stroke-dasharray="${it.dash}"` : ''}/>`;
      if (it.floor) floor.push(svg);
      else if (it.depthAt) solids.push({ d: depth(it.depthAt), svg });
      else top.push(svg);
    } else if (it.t === 'label') {
      const [px, y] = proj(it.at);
      const fs = it.kind === 'plain' ? 9 : it.kind === 'node' ? 9 : 10;
      const w = it.text.length * fs * 0.62 + (it.kind === 'plain' || it.kind === 'node' ? 0 : 16);
      const h = fs + 8;
      // side: place the label to the right of the point, offset in world units.
      const x = it.side ? px + it.side * S + w / 2 : px;
      grow(x - w / 2, y - h - 2); grow(x + w / 2, y + 2);
      const text = esc(it.text);
      if (it.kind === 'tag') {
        top.push(`<g transform="translate(${f(x)} ${f(y)})"><rect x="${f(-w / 2)}" y="${f(-h)}" width="${f(w)}" height="${f(h)}" rx="3" fill="#0e0e0c" stroke="#f0c048"/><text x="0" y="${f(-h / 2 + fs * 0.36)}" text-anchor="middle" fill="#f0c048" ${font} font-size="${fs}">${text}</text></g>`);
      } else if (it.kind === 'pill') {
        top.push(`<g transform="translate(${f(x)} ${f(y)})"><rect x="${f(-w / 2)}" y="${f(-h)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="#04b8f7"/><text x="0" y="${f(-h / 2 + fs * 0.36)}" text-anchor="middle" fill="#0e0e0c" ${font} font-size="${fs}" font-weight="600">${text}</text></g>`);
      } else {
        const color = it.kind === 'node' ? '#f2efe8' : '#a5a198';
        top.push(`<text x="${f(x)}" y="${f(y)}" text-anchor="middle" fill="${color}" ${font} font-size="${fs}" letter-spacing="0.3">${text}</text>`);
      }
    }
  }

  let gridSvg = '';
  if (opts.grid) {
    const g = opts.grid;
    const step = g.step ?? 0.5;
    const lines: string[] = [];
    for (let x = g.x0; x <= g.x1 + 1e-6; x += step) lines.push(`M${pt([x, 0, g.z0], false)} L${pt([x, 0, g.z1], false)}`);
    for (let z = g.z0; z <= g.z1 + 1e-6; z += step) lines.push(`M${pt([g.x0, 0, z], false)} L${pt([g.x1, 0, z], false)}`);
    const [cx, cy2] = proj(g.center);
    gridSvg = `<defs><radialGradient id="${idPrefix}-fade" cx="${f(cx)}" cy="${f(cy2)}" r="${f(g.radius * S)}" gradientUnits="userSpaceOnUse"><stop offset="0.3" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="${idPrefix}-mask"><rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#${idPrefix}-fade)"/></mask></defs><g mask="url(#${idPrefix}-mask)"><path d="${lines.join(' ')}" stroke="#3d424b" stroke-width="0.6" fill="none"/>${floor.join('')}</g>`;
  } else {
    gridSvg = floor.join('');
  }

  const defs = `<defs><filter id="${idPrefix}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter><filter id="${idPrefix}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>`;
  const body = defs + gridSvg
    + `<g filter="url(#${idPrefix}-soft)" fill="#000" opacity="0.7">${shadows.join('')}</g>`
    + solids.sort((a, c) => a.d - c.d).map((s) => s.svg).join('')
    + top.join('');
  const p = opts.pad ?? 12;
  const viewBox = `${f(b.x0 - p)} ${f(b.y0 - p)} ${f(b.x1 - b.x0 + p * 2)} ${f(b.y1 - b.y0 + p * 2)}`;
  return { viewBox, body };
}
