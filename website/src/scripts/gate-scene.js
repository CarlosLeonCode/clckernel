// Fig. 01, "how a change travels": one WebGL scene that tells the whole
// product, shot by shot as the story scrolls (home.js calls setChapter):
//   0 overview · 1 one rulebook (AGENTS.md lit lines to five assistants)
//   2 your AI works (assistants emit changes onto the track)
//   3 every change is checked (test chamber red→green, then the gate scan)
//   4 you approve what matters (an approval bay that waits for a person)
// Visitors send their own: click or tap the figure (Enter/Space when it is
// focused) and pick "Good change" / "Risky change" / "Needs approval".
// Waiting changes are never approved by the scene; only the Approve button.
// No post-processing: glow is additive planes and sprites, the reflection is a
// mirrored second pass under a glossy floor.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  Sprite,
  SpriteMaterial,
  Points,
  PointsMaterial,
  BufferGeometry,
  BufferAttribute,
  PlaneGeometry,
  CylinderGeometry,
  TorusGeometry,
  ExtrudeGeometry,
  TubeGeometry,
  Shape,
  CurvePath,
  LineCurve3,
  QuadraticBezierCurve3,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  CanvasTexture,
  HemisphereLight,
  DirectionalLight,
  PMREMGenerator,
  Color,
  Vector2,
  Vector3,
  Raycaster,
  AdditiveBlending,
  DoubleSide,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  MathUtils,
  Plane,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import {
  TOKEN, PLATE, TOKEN_Y, RULEBOOK, NODES, NODE_Y, NODE_R, TRACK, CHAMBER, ARCH, BAY, APPROVAL, QUEUE, SHOTS, queueSlot,
  SKY as SKY_HEX, AMBER as AMBER_HEX, RUST as RUST_HEX, RED as RED_HEX, GREEN as GREEN_HEX,
} from './story-layout.js';

const SKY = new Color(SKY_HEX);
const AMBER = new Color(AMBER_HEX);
const RUST = new Color(RUST_HEX);
const RED = new Color(RED_HEX);
const GREEN = new Color(GREEN_HEX);
const CERAMIC = new Color('#7a7d84');
const WAIT = new Color('#bdf1fe');
const BLACK = new Color('#000000');
const WHITE = new Color('#ffffff');
const INK = new Color('#0e0e0c');
const IDLE_LIGHT = new Color('#3a3e46');

const FOV = 32;
const DRIFT = MathUtils.degToRad(2);
const ORBIT = MathUtils.degToRad(8);

// Motion along the track (units per second).
const CRUISE = 2.0;
const SLOW = 0.75;
const SCAN_SPEED = 0.8;
const EXIT_SPEED = 2.4;
const CH_IN = CHAMBER.x - 0.45;
const CH_OUT = CHAMBER.x + 0.35;
const SLOW_AT = -1.5;
const SCAN_IN = -0.42;
const SCAN_OUT = 0.42;
const OUT_X = 1.1;
const STOP_X = -0.4; // front face meets the scan sheet
const MIN_GAP = 1.5; // seconds between two changes entering the track
const AUTO_GAP = 1.6; // idle cadence
const QUEUE_MAX = 3;
const POOL_SIZE = 22;

// Position ease from speed v0 to v1 over distance D (constant acceleration).
const ramp = (v0, v1, D) => {
  const T = (2 * D) / (v0 + v1);
  const a = (v1 - v0) / T;
  return { duration: T, ease: (p) => (v0 * T * p + 0.5 * a * T * T * p * p) / D };
};

const canvasTexture = (w, h, draw) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
};

export function mountGate(figure) {
  const stage = figure.querySelector('[data-gate-stage]');
  if (!stage) return null;
  const low = window.matchMedia('(max-width: 640px)').matches || (window.devicePixelRatio || 1) < 1.25;
  const data = figure.dataset;
  const reasons = (data.reasons || 'leaked key').split('|');
  const chapterCaptions = (data.chapters || '').split('|');
  const msg = {
    passed: data.passed || 'Change passed',
    stopped: data.stopped || 'Change stopped',
    approved: data.approved || 'Change approved and saved',
    waiting: data.waiting || 'Change waiting for your approval',
  };
  const readout = {
    x: figure.querySelector('[data-readout="x"]'),
    y: figure.querySelector('[data-readout="y"]'),
    checked: figure.querySelector('[data-readout="checked"]'),
    stopped: figure.querySelector('[data-readout="stopped"]'),
    approved: figure.querySelector('[data-readout="approved"]'),
  };
  const dot = figure.querySelector('[data-gate-dot]');
  const dotStop = figure.querySelector('[data-gate-dot-stop]');
  const dotOk = figure.querySelector('[data-gate-dot-ok]');
  const controls = figure.querySelector('[data-gate-controls]');
  const hit = figure.querySelector('[data-gate-hit]');
  const liveRegion = figure.querySelector('[data-gate-live]');
  const chapterEl = figure.querySelector('[data-gate-chapter]');
  const tagEls = [...figure.querySelectorAll('.gate__tag')];
  const approveEls = [...figure.querySelectorAll('[data-approve]')];
  const nodeLabels = [...figure.querySelectorAll('[data-node-label]')];
  const stationLabels = [...figure.querySelectorAll('[data-station-label]')];
  const options = [...figure.querySelectorAll('.gate__opt')];

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  // Full-bleed canvas: cap the pixel ratio harder on large screens.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth >= 768 ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.35;
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  pmrem.dispose();

  const camera = new PerspectiveCamera(FOV, 1, 0.5, 120);

  // Light: warm low key from the front left, cool rim from behind.
  scene.add(new HemisphereLight(0xcfd8e6, 0x08080a, 0.22));
  const key = new DirectionalLight(0xffd6a8, 2.4);
  key.position.set(-5, 2.2, 6);
  scene.add(key);
  const rim = new DirectionalLight(0x6fd0ff, 2.6);
  rim.position.set(3, 4.5, -6);
  scene.add(rim);
  const fill = new DirectionalLight(0x9fb4ff, 0.35);
  fill.position.set(6, 1, 3);
  scene.add(fill);

  const world = new Group();
  scene.add(world);
  const noReflect = [];

  const radial = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const additive = (opts) => new MeshBasicMaterial({
    transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, ...opts,
  });

  // ---- Glossy floor ----
  const floorMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uInk: { value: INK.clone() },
      uLine: { value: new Color('#3d424b') },
      uLane: { value: new Color('#16171b') },
      uEdge: { value: new Color('#59616c') },
      uPad: { value: new Color('#241c10') },
      uWait: { value: new Color('#121a20') },
      uGloss: { value: low ? 1.0 : 0.86 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = vec2(position.x, -position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk; uniform vec3 uLine; uniform vec3 uLane; uniform vec3 uEdge; uniform vec3 uPad; uniform vec3 uWait; uniform float uGloss;
      varying vec2 vP;
      float grid(vec2 p, float s) {
        vec2 q = p / s;
        vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      float box(vec2 p, vec2 c, vec2 h, float soft) {
        vec2 d = abs(p - c) - h;
        return 1.0 - smoothstep(0.0, soft, max(d.x, d.y));
      }
      void main() {
        vec2 p = vP;
        float dist = length((p - vec2(-1.5, 0.0)) * vec2(0.5, 0.9));
        float near = 1.0 - smoothstep(5.0, 16.0, dist);
        float g = grid(p, 0.5) * 0.6 * near + grid(p, 0.1) * 0.1 * (1.0 - smoothstep(2.0, 6.0, dist));
        float lane = box(p, vec2(${((TRACK.start + TRACK.end) / 2).toFixed(2)}, 0.0), vec2(${((TRACK.end - TRACK.start) / 2).toFixed(2)}, ${TRACK.half.toFixed(2)}), 0.05);
        float pad = box(p, vec2(${((BAY[0].x + BAY[2].x) / 2).toFixed(2)}, ${BAY[0].z.toFixed(2)}), vec2(${((BAY[0].x - BAY[2].x) / 2 + 0.55).toFixed(2)}, 0.38), 0.08);
        float wait = box(p, vec2(${((APPROVAL.slots[0].x + APPROVAL.slots[2].x) / 2).toFixed(2)}, ${APPROVAL.slots[0].z.toFixed(2)}), vec2(${((APPROVAL.slots[2].x - APPROVAL.slots[0].x) / 2 + 0.55).toFixed(2)}, 0.38), 0.08);
        float saved = box(p, vec2(4.47, 0.0), vec2(1.4, 0.72), 0.08);
        float edgeW = fwidth(p.y) * 1.5;
        float edge = (1.0 - smoothstep(0.0, edgeW, abs(abs(p.y) - ${TRACK.half.toFixed(2)}))) * box(p, vec2(${((TRACK.start + TRACK.end) / 2).toFixed(2)}, 0.0), vec2(${((TRACK.end - TRACK.start) / 2).toFixed(2)}, 1.0), 0.05);
        vec3 col = uInk;
        col = mix(col, uLane, max(lane, saved));
        col = mix(col, uPad, pad);
        col = mix(col, uWait, wait);
        col = mix(col, uLine, g * 0.8);
        col = mix(col, uEdge, edge * 0.85);
        float a = mix(uGloss, 1.0, smoothstep(2.0, 8.0, dist));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const floor = new Mesh(new PlaneGeometry(240, 240), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -3;
  world.add(floor);
  noReflect.push(floor);

  const blob = (w, d, x, z, opacity) => {
    const m = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: radial, color: BLACK, transparent: true, opacity, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, 0.004, z);
    m.renderOrder = -2;
    world.add(m);
    noReflect.push(m);
    return m;
  };
  const floorGlow = (color, x, z, w, d, opacity) => {
    const mat = additive({ map: radial, color: color.clone(), opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new Mesh(new PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, 0.008, z);
    m.renderOrder = -1;
    world.add(m);
    noReflect.push(m);
    return mat;
  };

  const graphite = new MeshPhysicalMaterial({
    color: 0x30333a, metalness: 0.6, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.28,
  });
  const rb = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);

  // ---- 1. The rulebook and the assistants ----
  const rulebook = new Group();
  rulebook.position.set(RULEBOOK.x, 0, RULEBOOK.z);
  world.add(rulebook);
  const pedestal = new Mesh(rb(RULEBOOK.w * 0.7, RULEBOOK.y, RULEBOOK.d * 0.7, 0.03), graphite);
  pedestal.position.y = RULEBOOK.y / 2;
  rulebook.add(pedestal);
  const slab = new Mesh(rb(RULEBOOK.w, RULEBOOK.h, RULEBOOK.d, 0.04), new MeshPhysicalMaterial({
    color: 0x3b3f47, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12,
  }));
  slab.position.y = RULEBOOK.y + RULEBOOK.h / 2;
  rulebook.add(slab);
  const pageTex = canvasTexture(512, 360, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '600 46px ui-monospace, "SFMono-Regular", Menlo, monospace';
    g.fillText('AGENTS.md', 40, 80);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(40, 130 + i * 34, [400, 330, 380, 260, 360, 300][i], 10);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
  });
  const pageMat = additive({ map: pageTex, color: SKY.clone(), opacity: 0.75 });
  const page = new Mesh(new PlaneGeometry(RULEBOOK.w * 0.92, RULEBOOK.d * 0.9), pageMat);
  page.rotation.x = -Math.PI / 2;
  page.position.y = RULEBOOK.y + RULEBOOK.h + 0.003;
  rulebook.add(page);
  blob(RULEBOOK.w * 1.2, RULEBOOK.d * 1.3, RULEBOOK.x, RULEBOOK.z, 0.8);
  const rulebookGlow = floorGlow(SKY, RULEBOOK.x, RULEBOOK.z, 3.4, 2.6, 0.12);

  const nodeGlyph = canvasTexture(128, 128, (g, w, h) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath(); g.arc(w / 2, h / 2, 40, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.arc(w / 2, h / 2, 20, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(w / 2, h / 2, 7, 0, Math.PI * 2); g.fill();
  });
  const discGeo = new CylinderGeometry(NODE_R, NODE_R, 0.08, 48);
  const ringGeo = new TorusGeometry(NODE_R, 0.012, 8, 64);
  const lineMat = additive({ color: SKY.clone(), opacity: 0.3 });
  const nodes = NODES.map((n, i) => {
    const g = new Group();
    g.position.set(n.x, NODE_Y, n.z);
    world.add(g);
    g.add(new Mesh(discGeo, graphite));
    const ringMat = additive({ color: SKY.clone(), opacity: 0.8 });
    const ring = new Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
    const glyphMat = additive({ map: nodeGlyph, color: SKY.clone(), opacity: 0.55 });
    const glyph = new Mesh(new PlaneGeometry(NODE_R * 1.5, NODE_R * 1.5), glyphMat);
    glyph.rotation.x = -Math.PI / 2;
    glyph.position.y = 0.042;
    g.add(glyph);
    blob(0.8, 0.8, n.x, n.z, 0.22);
    const from = new Vector3(RULEBOOK.x, RULEBOOK.y + RULEBOOK.h, RULEBOOK.z);
    const to = new Vector3(n.x, NODE_Y, n.z);
    const curve = new QuadraticBezierCurve3(from, new Vector3((from.x + to.x) / 2, 1.7, (from.z + to.z) / 2), to);
    world.add(new Mesh(new TubeGeometry(curve, 40, 0.008, 5, false), lineMat));
    const spark = new Sprite(new SpriteMaterial({
      map: radial, color: SKY.clone(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    spark.scale.setScalar(0.22);
    world.add(spark);
    noReflect.push(spark);
    return { g, ringMat, glyphMat, curve, spark, phase: i * 0.19, out: new Vector3(n.x + 0.2, NODE_Y - 0.12, n.z) };
  });

  // ---- 3a. Test chamber ----
  const chamber = new Group();
  chamber.position.x = CHAMBER.x;
  world.add(chamber);
  const postGeo = rb(0.06, CHAMBER.h, 0.06, 0.01);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dz]) => {
    const p = new Mesh(postGeo, graphite);
    p.position.set((dx * CHAMBER.w) / 2, CHAMBER.h / 2, (dz * CHAMBER.d) / 2);
    chamber.add(p);
  });
  const topFrame = new Mesh(rb(CHAMBER.w + 0.08, 0.07, CHAMBER.d + 0.08, 0.015), graphite);
  topFrame.position.y = CHAMBER.h + 0.035;
  chamber.add(topFrame);
  const statusMat = new MeshBasicMaterial({ color: IDLE_LIGHT.clone(), toneMapped: false });
  const status = new Mesh(new PlaneGeometry(CHAMBER.w - 0.1, CHAMBER.d - 0.1), statusMat);
  status.rotation.x = -Math.PI / 2;
  status.position.y = CHAMBER.h + 0.072;
  chamber.add(status);
  const glass = new MeshPhysicalMaterial({
    color: 0x9fd8ff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.07, clearcoat: 1, depthWrite: false, side: DoubleSide,
  });
  [-1, 1].forEach((s) => {
    const pane = new Mesh(new PlaneGeometry(CHAMBER.w, CHAMBER.h), glass);
    pane.position.set(0, CHAMBER.h / 2, (s * CHAMBER.d) / 2);
    chamber.add(pane);
  });
  const chamberGlowMat = additive({ map: radial, color: IDLE_LIGHT.clone(), opacity: 0 });
  const chamberGlow = new Mesh(new PlaneGeometry(1, 1), chamberGlowMat);
  chamberGlow.rotation.x = -Math.PI / 2;
  chamberGlow.scale.set(2.2, 1.8, 1);
  chamberGlow.position.set(CHAMBER.x, 0.005, 0);
  world.add(chamberGlow);
  noReflect.push(chamberGlow);
  [-1, 1].forEach((s) => blob(0.4, 0.4, CHAMBER.x + (s * CHAMBER.w) / 2, 0, 0.5));

  // ---- 3b. The gate ----
  const archShape = new Shape();
  {
    const { outer: o, top: t, inner: i, innerTop: it } = ARCH;
    const ro = 0.22;
    const ri = 0.12;
    archShape.moveTo(-o, 0);
    archShape.lineTo(-o, t - ro);
    archShape.quadraticCurveTo(-o, t, -o + ro, t);
    archShape.lineTo(o - ro, t);
    archShape.quadraticCurveTo(o, t, o, t - ro);
    archShape.lineTo(o, 0);
    archShape.lineTo(i, 0);
    archShape.lineTo(i, it - ri);
    archShape.quadraticCurveTo(i, it, i - ri, it);
    archShape.lineTo(-i + ri, it);
    archShape.quadraticCurveTo(-i, it, -i, it - ri);
    archShape.lineTo(-i, 0);
    archShape.closePath();
  }
  const core = ARCH.depth - ARCH.bevel * 2;
  const archGeo = new ExtrudeGeometry(archShape, {
    depth: core, bevelEnabled: true, bevelThickness: ARCH.bevel, bevelSize: ARCH.bevel, bevelSegments: 4, curveSegments: 12,
  });
  archGeo.translate(0, 0, -core / 2);
  const gate = new Group();
  gate.rotation.y = Math.PI / 2; // arch plane spans the track
  world.add(gate);
  gate.add(new Mesh(archGeo, graphite));
  const plate = new Mesh(rb(1.6, PLATE, 0.4, 0.007), graphite);
  plate.position.y = PLATE / 2;
  gate.add(plate);
  const hairMat = new MeshBasicMaterial({ color: SKY.clone(), toneMapped: false });
  const hair = new Mesh(new PlaneGeometry(1.32, 0.016), hairMat);
  hair.rotation.x = -Math.PI / 2;
  hair.position.y = PLATE + 0.001;
  gate.add(hair);

  const rimInset = ARCH.inner - ARCH.bevel - 0.006;
  const rimTop = ARCH.innerTop - ARCH.bevel - 0.006;
  const RIM_R = 0.12;
  const rimCurve = (z) => {
    const path = new CurvePath();
    const P = (u, v) => new Vector3(u, v, z);
    path.add(new LineCurve3(P(-rimInset, 0.02), P(-rimInset, rimTop - RIM_R)));
    path.add(new QuadraticBezierCurve3(P(-rimInset, rimTop - RIM_R), P(-rimInset, rimTop), P(-rimInset + RIM_R, rimTop)));
    path.add(new LineCurve3(P(-rimInset + RIM_R, rimTop), P(rimInset - RIM_R, rimTop)));
    path.add(new QuadraticBezierCurve3(P(rimInset - RIM_R, rimTop), P(rimInset, rimTop), P(rimInset, rimTop - RIM_R)));
    path.add(new LineCurve3(P(rimInset, rimTop - RIM_R), P(rimInset, 0.02)));
    return path;
  };
  const rimMat = new MeshBasicMaterial({ color: SKY.clone(), toneMapped: false });
  gate.add(new Mesh(new TubeGeometry(rimCurve(0), 140, 0.013, 6, false), rimMat));
  gate.add(new Mesh(new TubeGeometry(rimCurve(-ARCH.depth / 2 + 0.012), 140, 0.009, 6, false), rimMat));

  const HALO_W = 2.3;
  const HALO_H = 2.5;
  const haloTex = canvasTexture(256, 280, (g, w, h) => {
    const X = (u) => ((u + HALO_W / 2) / HALO_W) * w;
    const Y = (v) => ((HALO_H - 0.2 - v) / HALO_H) * h;
    g.strokeStyle = '#ffffff';
    g.shadowColor = '#ffffff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      g.moveTo(X(-rimInset), Y(0.02));
      g.lineTo(X(-rimInset), Y(rimTop - RIM_R));
      g.quadraticCurveTo(X(-rimInset), Y(rimTop), X(-rimInset + RIM_R), Y(rimTop));
      g.lineTo(X(rimInset - RIM_R), Y(rimTop));
      g.quadraticCurveTo(X(rimInset), Y(rimTop), X(rimInset), Y(rimTop - RIM_R));
      g.lineTo(X(rimInset), Y(0.02));
    };
    [[24, 5, 0.5], [10, 3, 0.8]].forEach(([blur, width, alpha]) => {
      g.globalAlpha = alpha;
      g.shadowBlur = blur;
      g.lineWidth = width;
      path();
      g.stroke();
    });
  });
  const haloMat = additive({ map: haloTex, color: SKY.clone(), opacity: 0.55, side: DoubleSide });
  const halo = new Mesh(new PlaneGeometry(HALO_W, HALO_H), haloMat);
  halo.position.y = HALO_H / 2 - 0.2;
  gate.add(halo);

  const beamTex = canvasTexture(256, 128, (g, w, h) => {
    const hor = g.createLinearGradient(0, 0, w, 0);
    hor.addColorStop(0, 'rgba(255,255,255,0)');
    hor.addColorStop(0.42, 'rgba(255,255,255,0.55)');
    hor.addColorStop(0.5, 'rgba(255,255,255,1)');
    hor.addColorStop(0.58, 'rgba(255,255,255,0.55)');
    hor.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hor;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const ver = g.createLinearGradient(0, 0, 0, h);
    ver.addColorStop(0, 'rgba(0,0,0,0)');
    ver.addColorStop(0.25, 'rgba(0,0,0,0.6)');
    ver.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = ver;
    g.fillRect(0, 0, w, h);
  });
  const beamMat = additive({ map: beamTex, color: SKY.clone(), opacity: 0.16, side: DoubleSide });
  const beam = new Mesh(new PlaneGeometry(3.6, rimTop), beamMat);
  beam.position.set(0, rimTop / 2, 0);
  world.add(beam);
  const beam2 = new Mesh(new PlaneGeometry(3.6, rimTop * 0.55), beamMat);
  beam2.rotation.x = Math.PI / 2;
  beam2.position.set(0, 0.06, 0);
  world.add(beam2);

  const scanMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uSweep: { value: 0 }, uLevel: { value: 0 }, uColor: { value: SKY.clone() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFres;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFres = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uSweep; uniform float uLevel; uniform vec3 uColor;
      varying vec2 vUv; varying float vFres;
      void main() {
        vec2 q = vUv * vec2(14.0, 18.0);
        vec2 gg = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        float grid = 1.0 - min(min(gg.x, gg.y), 1.0);
        float scan = 0.5 + 0.5 * sin(vUv.y * 150.0 - uTime * 2.4);
        float band = exp(-pow((vUv.y - (1.08 - uSweep * 1.16)) * 9.0, 2.0)) * step(0.001, uSweep) * (1.0 - step(0.999, uSweep));
        float border = smoothstep(0.38, 0.5, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
        float lift = 1.0 - vUv.y * 0.6;
        float a = (0.035 + grid * 0.08 + scan * 0.02 + vFres * 0.12 + border * 0.1) * lift;
        a *= 0.75 + uLevel * 2.4;
        a += band * 0.85;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const scanH = rimTop - 0.04;
  const scan = new Mesh(new PlaneGeometry(rimInset * 2 - 0.02, scanH), scanMat);
  scan.position.y = 0.03 + scanH / 2;
  gate.add(scan);
  noReflect.push(scan);

  const markTex = canvasTexture(512, 48, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.font = '500 26px ui-monospace, "SFMono-Regular", Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = '6px';
    g.fillText('CLC KERNEL · GATE 01', w / 2, h / 2 + 1);
  });
  const mark = new Mesh(
    new PlaneGeometry(1.04, 0.098),
    new MeshBasicMaterial({ map: markTex, color: 0xa3aab4, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  mark.rotation.y = Math.PI;
  mark.position.set(0, (ARCH.top + ARCH.innerTop) / 2 + 0.01, -ARCH.depth / 2 - 0.003);
  gate.add(mark);
  blob(0.9, 0.7, 0, -ARCH.outer + 0.12, 0.85);
  blob(0.9, 0.7, 0, ARCH.outer - 0.12, 0.85);
  blob(1.1, 2.4, 0, 0, 0.4);
  const poolMat = floorGlow(SKY, 0, 0, 3.4, 2.4, 0.2);

  // ---- 4. Approval post ----
  const post = new Group();
  post.position.set(APPROVAL.post.x, 0, APPROVAL.post.z);
  world.add(post);
  const pillar = new Mesh(rb(0.12, 1.2, 0.12, 0.02), graphite);
  pillar.position.y = 0.6;
  post.add(pillar);
  const sign = new Mesh(rb(0.06, 0.5, 0.56, 0.02), graphite);
  sign.position.y = 1.35;
  post.add(sign);
  const personTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(w / 2, 40, 18, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(26, 108); g.quadraticCurveTo(w / 2, 46, w - 26, 108); g.closePath(); g.fill();
  });
  const signMat = additive({ map: personTex, color: WAIT.clone(), opacity: 0.8, side: DoubleSide });
  [-1, 1].forEach((s) => {
    const face = new Mesh(new PlaneGeometry(0.42, 0.42), signMat);
    face.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    face.position.set(s * 0.032, 1.35, 0);
    post.add(face);
  });
  blob(0.5, 0.5, APPROVAL.post.x, APPROVAL.post.z, 0.6);
  const waitGlow = floorGlow(WAIT, (APPROVAL.slots[0].x + APPROVAL.slots[2].x) / 2, APPROVAL.slots[0].z, 3.6, 1.4, 0.06);

  // ---- Change tiles: an object pool, created once and reused ----
  const glyphTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.font = '600 70px ui-monospace, "SFMono-Regular", Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('</>', w / 2, h / 2 + 4);
  });
  glyphTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const edgeTex = canvasTexture(128, 96, (g, w, h) => {
    g.strokeStyle = '#ffffff';
    g.shadowColor = '#ffffff';
    g.shadowBlur = 12;
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(18, 18, w - 36, h - 36, 14);
    g.stroke();
  });
  const tokenGeo = new RoundedBoxGeometry(TOKEN.w, TOKEN.h, TOKEN.d, 4, 0.11);
  const glyphGeo = new PlaneGeometry(0.42, 0.21);
  const edgeGeo = new PlaneGeometry(TOKEN.w + 0.2, TOKEN.d + 0.16);
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new MeshPhysicalMaterial({
      color: CERAMIC.clone(), roughness: 0.4, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.18,
      envMapIntensity: 0.6, emissive: SKY.clone(), emissiveIntensity: 0, transparent: true,
    });
    const mesh = new Mesh(tokenGeo, mat);
    mesh.visible = false;
    const glyphMat = new MeshBasicMaterial({
      map: glyphTex, color: 0x34363b, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const glyph = new Mesh(glyphGeo, glyphMat);
    glyph.rotation.x = -Math.PI / 2;
    glyph.position.y = TOKEN.h / 2 + 0.002;
    mesh.add(glyph);
    const edgeMat = additive({ map: edgeTex, color: AMBER.clone(), opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const edge = new Mesh(edgeGeo, edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = TOKEN.h / 2 + 0.004;
    mesh.add(edge);
    let glow = null;
    if (!low) {
      glow = new Sprite(new SpriteMaterial({
        map: radial, color: SKY.clone(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      glow.scale.set(1.8, 1.1, 1);
      mesh.add(glow);
    }
    world.add(mesh);
    noReflect.push(mesh);
    const shadow = blob(1.15, 0.85, 0, 0, 0);
    shadow.visible = false;
    pool.push({ mesh, mat, glyphMat, edgeMat, glow, shadow, busy: false, tl: null, held: -1, wait: -1, reason: '' });
  }
  const acquire = () => pool.find((t) => !t.busy) || null;
  const release = (t) => {
    if (t.tl) { live.delete(t.tl); t.tl.kill(); }
    t.tl = null;
    t.busy = false;
    t.mesh.visible = false;
    t.shadow.visible = false;
    if (t.held >= 0 && heldBy[t.held] === t) { heldBy[t.held] = null; hideTag(t.held); }
    heldBy.forEach((h, i) => { if (h === t) heldBy[i] = null; });
    queueBy.forEach((q, i) => { if (q === t) queueBy[i] = null; });
    t.held = -1;
    t.wait = -1;
    t.waiting = false;
  };

  // ---- Dust ----
  const DUST = low ? 14 : 44;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = MathUtils.randFloat(-9, 6);
    dustPos[i * 3 + 1] = MathUtils.randFloat(0.1, 2.6);
    dustPos[i * 3 + 2] = MathUtils.randFloat(-2.5, 2.5);
    dustSeed[i] = Math.random() * 6.28;
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
  const dust = new Points(dustGeo, new PointsMaterial({
    map: radial, color: 0xbdf1fe, size: 0.05, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  world.add(dust);
  noReflect.push(dust);

  // Every running tween is tracked so the scene can pause as a whole.
  const live = new Set();
  const track = (tl) => {
    live.add(tl);
    tl.eventCallback('onComplete', () => live.delete(tl));
    if (!running) tl.pause();
    return tl;
  };
  const tint = (tl, color, target, duration, at, ease = 'power2.out') =>
    tl.to(color, { r: target.r, g: target.g, b: target.b, duration, ease }, at);
  const setColor = (tl, color, target, at) => tl.set(color, { r: target.r, g: target.g, b: target.b }, at);

  // Counters and announcements.
  const count = { checked: 3, stopped: 1, approved: 0 };
  const pad = (n) => String(n % 1000).padStart(3, '0');
  const bump = (name, el) => {
    count[name]++;
    if (readout[name]) readout[name].textContent = pad(count[name]);
    if (el) track(gsap.fromTo(el, { scale: 2.2 }, { scale: 1, duration: 0.7, ease: 'expo.out' }));
  };
  let lastAnnounce = 0;
  let pendingAnnounce = 0;
  const announce = (text) => {
    if (!liveRegion) return;
    const say = () => { lastAnnounce = performance.now(); liveRegion.textContent = text; };
    clearTimeout(pendingAnnounce);
    const wait = 1200 - (performance.now() - lastAnnounce);
    if (wait <= 0) say();
    else pendingAnnounce = setTimeout(say, wait);
  };

  // Test chamber: red while the test runs without the change, then green.
  const testRun = (tdd, at, tl, duration) => {
    const red = tdd ? RED : AMBER;
    setColor(tl, statusMat.color, red, at);
    setColor(tl, chamberGlowMat.color, red, at);
    tl.to(chamberGlowMat, { opacity: 0.55, duration: 0.15 }, at);
    if (tdd) {
      setColor(tl, statusMat.color, GREEN, at + duration * 0.5);
      setColor(tl, chamberGlowMat.color, GREEN, at + duration * 0.5);
    }
    tl.to(chamberGlowMat, { opacity: 0, duration: 0.8, ease: 'power2.out' }, at + duration);
    tint(tl, statusMat.color, IDLE_LIGHT, 0.8, at + duration);
  };

  // Gate reaction: the sweep runs while the tile is inside.
  const scanU = scanMat.uniforms;
  const check = (color, duration) => {
    const tl = gsap.timeline();
    tl.set(scanU.uSweep, { value: 0 })
      .set(scanU.uColor.value, { r: color.r, g: color.g, b: color.b })
      .to(scanU.uSweep, { value: 1, duration, ease: 'sine.inOut' }, 0)
      .to(scanU.uLevel, { value: 1, duration: 0.18, ease: 'power2.out' }, 0)
      .to(scanU.uLevel, { value: 0, duration: 0.9, ease: 'power2.out' }, duration * 0.6)
      .to(haloMat, { opacity: 1, duration: 0.18, ease: 'power2.out' }, 0)
      .to(haloMat, { opacity: 0.55, duration: 1.0, ease: 'power2.out' }, duration * 0.6)
      .to(beamMat, { opacity: 0.42, duration: 0.2, ease: 'power2.out' }, 0)
      .to(beamMat, { opacity: 0.16, duration: 1.1, ease: 'power2.out' }, duration * 0.6)
      .to(poolMat, { opacity: 0.45, duration: 0.2, ease: 'power2.out' }, 0)
      .to(poolMat, { opacity: 0.2, duration: 1.1, ease: 'power2.out' }, duration * 0.6)
      .to(rim, { intensity: 4.2, duration: 0.2, ease: 'power2.out' }, 0)
      .to(rim, { intensity: 2.6, duration: 1.0, ease: 'power2.out' }, duration * 0.6);
    if (color !== SKY) {
      [rimMat.color, haloMat.color, hairMat.color, beamMat.color, poolMat.color].forEach((c) => {
        setColor(tl, c, color, 0);
        tint(tl, c, SKY, 1.0, 0.5);
      });
      tint(tl, scanU.uColor.value, SKY, 0.8, 0.6);
    }
    track(tl);
  };

  // Hop to a floor slot: the tile rises above its neighbours (bottom higher
  // than a resting tile's top), travels, and drops only over its own slot,
  // so it never cuts through a tile already sitting nearby.
  const HOP_Y = TOKEN_Y + TOKEN.h + 0.14;
  const hop = (t, tl, to, at, duration = 0.85, rotY = 0) => {
    tl.to(t.mesh.position, { x: to.x, z: to.z, duration, ease: 'power2.inOut' }, at)
      .to(t.mesh.rotation, { y: rotY, duration, ease: 'power2.inOut' }, at)
      .to(t.mesh.position, {
        keyframes: [
          { y: HOP_Y, duration: duration * 0.35, ease: 'power2.out' },
          { y: HOP_Y, duration: duration * 0.47 },
          { y: TOKEN_Y, duration: duration * 0.18, ease: 'power2.in' },
          { y: TOKEN_Y + 0.03, duration: 0.08, ease: 'power1.out' },
          { y: TOKEN_Y, duration: 0.1, ease: 'power1.in' },
        ],
      }, at);
    return at + duration;
  };

  // Saved queue: a flat grid with reserved slots, so two tiles never share a
  // place. When every slot is taken, the landed batch lifts away first.
  const queueBy = new Array(QUEUE.slots).fill(null);
  const flushQueue = () => {
    let i = 0;
    queueBy.forEach((t, slot) => {
      if (!t || !t.landed) return;
      queueBy[slot] = null;
      if (t.tl) live.delete(t.tl);
      const tl = gsap.timeline({ delay: 0.2 + i++ * 0.06, onComplete: () => release(t) })
        .to(t.mesh.position, { y: '+=0.35', duration: 0.6, ease: 'power2.in' }, 0)
        .to([t.mat, t.glyphMat, t.edgeMat], { opacity: 0, duration: 0.6, ease: 'power2.in' }, 0);
      if (t.glow) tl.to(t.glow.material, { opacity: 0.6, duration: 0.2 }, 0).to(t.glow.material, { opacity: 0, duration: 0.4 }, 0.2);
      t.tl = track(tl);
    });
  };
  const reserveQueue = (t) => {
    let slot = queueBy.findIndex((q) => !q);
    if (slot < 0) {
      flushQueue();
      slot = queueBy.findIndex((q) => !q);
    }
    if (slot < 0) return -1;
    queueBy[slot] = t;
    t.landed = false;
    return slot;
  };
  // Drop a tile into a reserved queue slot (from wherever it is).
  const toQueue = (t, tl, at) => {
    const slot = reserveQueue(t);
    if (slot < 0) {
      tl.to([t.mat, t.glyphMat, t.edgeMat], { opacity: 0, duration: 0.5 }, at).call(() => release(t), null, at + 0.5);
      return;
    }
    hop(t, tl, queueSlot(slot), at);
    tl.to(t.mat, { emissiveIntensity: 0.14, duration: 1.4, ease: 'power2.out' }, at + 0.76);
    if (t.glow) tl.to(t.glow.material, { opacity: 0, duration: 1.4, ease: 'power2.out' }, at + 0.76);
    tl.call(() => {
      t.landed = true;
      if (queueBy.every((q) => q && q.landed)) flushQueue();
    }, null, at + 0.98);
  };

  // Reject bay and approval bay.
  const heldBy = [null, null, null];
  // A free bay slot, or the oldest occupant fades out early to make room
  // before the new change arrives (never two tiles in one place).
  const reserveBay = (t) => {
    let slot = heldBy.findIndex((h) => !h);
    if (slot < 0) {
      let oldest = Infinity;
      heldBy.forEach((h, i) => { if (h.heldAt < oldest) { oldest = h.heldAt; slot = i; } });
      const old = heldBy[slot];
      hideTag(slot);
      if (old.tl) live.delete(old.tl);
      old.held = -1;
      old.tl = track(gsap.timeline({ onComplete: () => release(old) })
        .to([old.mat, old.glyphMat, old.edgeMat], { opacity: 0, duration: 0.4, ease: 'power2.in' }));
    }
    heldBy[slot] = t;
    t.heldAt = performance.now();
    return slot;
  };
  const waitBy = [null, null, null];
  let waitReserved = 0;
  let hovered = -1;
  const tagShown = [false, false, false];
  const showTag = (slot, on) => {
    if (on) tagShown.forEach((v, i) => { if (v && i !== slot) showTag(i, false); });
    tagShown[slot] = on;
    tagEls[slot]?.classList.toggle('is-on', on || hovered === slot);
  };
  const hideTag = (slot) => showTag(slot, false);

  // The shared path: out of an assistant, onto the track, through the test
  // chamber, up to the gate. Returns the time the tile reaches SLOW_AT.
  let nodeIndex = 0;
  const entry = (t, tl, tdd) => {
    const n = nodes[nodeIndex++ % nodes.length];
    const from = n.out.clone();
    const to = new Vector3(TRACK.start, TOKEN_Y, 0);
    const ctrl = new Vector3((from.x + to.x) / 2 + 0.3, Math.max(from.y, to.y) + 0.35, from.z * 0.25);
    const path = new QuadraticBezierCurve3(from, ctrl, to);
    t.mesh.position.copy(from);
    t.mesh.scale.setScalar(0.55);
    const u = { v: 0 };
    tl.to(t.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.6)' }, 0)
      .to([t.mat, t.glyphMat], { opacity: 1, duration: 0.4, ease: 'power1.out' }, 0)
      .to(u, { v: 1, duration: 1.0, ease: 'power1.inOut', onUpdate: () => path.getPoint(u.v, t.mesh.position) }, 0)
      .to(n.ringMat, { opacity: 1, duration: 0.12 }, 0)
      .to(n.ringMat, { opacity: 0.8, duration: 0.8 }, 0.12);
    let at = 1.0;
    const c1 = ramp(1.0, CRUISE, CH_IN - 0.8 - TRACK.start);
    tl.to(t.mesh.position, { x: CH_IN - 0.8, duration: c1.duration, ease: c1.ease }, at);
    at += c1.duration;
    const s1 = ramp(CRUISE, SLOW, 0.8);
    tl.to(t.mesh.position, { x: CH_IN, duration: s1.duration, ease: s1.ease }, at);
    at += s1.duration;
    const crawl = (CH_OUT - CH_IN) / SLOW;
    tl.to(t.mesh.position, { x: CH_OUT, duration: crawl, ease: 'none' }, at);
    testRun(tdd, at, tl, crawl);
    at += crawl;
    const a1 = ramp(SLOW, CRUISE, SLOW_AT - CH_OUT);
    tl.to(t.mesh.position, { x: SLOW_AT, duration: a1.duration, ease: a1.ease }, at);
    return at + a1.duration;
  };

  let reasonIndex = 0;
  const send = (kind, byUser) => {
    if (kind === 'approval' && waitReserved >= waitBy.length) return true; // bay full: drop it
    const t = acquire();
    if (!t) return false;
    t.busy = true;
    t.held = -1;
    t.wait = -1;
    t.waiting = false;
    const risky = kind === 'risky';
    t.reason = risky ? reasons[reasonIndex++ % reasons.length] : '';
    const tdd = !(risky && reasons.indexOf(t.reason) === 1); // "no failing test"
    t.mesh.visible = true;
    t.shadow.visible = true;
    t.mesh.rotation.set(0, 0, 0);
    t.mat.color.copy(CERAMIC);
    t.mat.emissive.copy(SKY);
    t.mat.emissiveIntensity = 0;
    t.mat.opacity = 0;
    t.glyphMat.color.set(0x34363b);
    t.glyphMat.opacity = 0;
    t.edgeMat.opacity = 0;
    t.edgeMat.color.copy(AMBER);
    if (t.glow) { t.glow.material.color.copy(SKY); t.glow.material.opacity = 0; }

    const tl = gsap.timeline();
    const cruiseEnd = entry(t, tl, tdd);

    if (!risky) {
      const inn = ramp(CRUISE, SCAN_SPEED, SCAN_IN - SLOW_AT);
      const crawl = (SCAN_OUT - SCAN_IN) / SCAN_SPEED;
      const out = ramp(SCAN_SPEED, EXIT_SPEED, OUT_X - SCAN_OUT);
      const at = cruiseEnd + inn.duration;
      tl.to(t.mesh.position, { x: SCAN_IN, duration: inn.duration, ease: inn.ease }, cruiseEnd)
        .to(t.mesh.position, { x: SCAN_OUT, duration: crawl, ease: 'none' }, at)
        .to(t.mesh.position, { x: OUT_X, duration: out.duration, ease: out.ease }, at + crawl)
        .call(() => check(SKY, crawl), null, at)
        .call(() => {
          bump('checked', dot);
          if (byUser && kind === 'good') announce(msg.passed);
        }, null, at + crawl * 0.5);
      const after = at + crawl + out.duration;
      if (kind === 'good') {
        tint(tl, t.mat.color, SKY, crawl * 0.8, at + crawl * 0.2, 'sine.inOut');
        tint(tl, t.glyphMat.color, WHITE, crawl * 0.8, at + crawl * 0.2, 'sine.inOut');
        tl.to(t.mat, { emissiveIntensity: 0.65, duration: crawl * 0.8, ease: 'sine.inOut' }, at + crawl * 0.2);
        if (t.glow) tl.to(t.glow.material, { opacity: 0.8, duration: crawl * 0.8, ease: 'sine.inOut' }, at + crawl * 0.2);
        toQueue(t, tl, after);
      } else {
        // Needs approval: it passes the checks, then waits for a person.
        waitReserved++;
        const slot = waitBy.findIndex((w) => !w);
        const spot = APPROVAL.slots[slot >= 0 ? slot : 0];
        waitBy[slot] = t;
        t.wait = slot;
        setColor(tl, t.mat.emissive, WAIT, at);
        setColor(tl, t.edgeMat.color, WAIT, at);
        hop(t, tl, spot, after, 0.9);
        tl.to(t.mat, { emissiveIntensity: 0.25, duration: crawl, ease: 'sine.inOut' }, at)
          .to(t.edgeMat, { opacity: 0.7, duration: 0.4 }, after + 0.6)
          .call(() => {
            t.waiting = true;
            t.since = elapsed;
            if (byUser) announce(msg.waiting);
          }, null, after + 0.9);
      }
    } else {
      const inn = ramp(CRUISE, SCAN_SPEED, STOP_X - SLOW_AT);
      const at = cruiseEnd + inn.duration;
      const slot = reserveBay(t);
      const spot = BAY[slot];
      tl.to(t.mesh.position, { x: STOP_X, duration: inn.duration, ease: inn.ease }, cruiseEnd)
        .call(() => check(AMBER, 0.5), null, at - 0.05)
        .call(() => {
          bump('checked');
          bump('stopped', dotStop);
          if (byUser) announce(`${msg.stopped}: ${t.reason}`);
          t.held = slot;
          if (tagEls[slot]) tagEls[slot].textContent = t.reason;
        }, null, at);
      setColor(tl, t.mat.emissive, AMBER, at);
      tint(tl, t.mat.color, AMBER, 0.1, at);
      tint(tl, t.glyphMat.color, INK, 0.1, at);
      tl.to(t.mat, { emissiveIntensity: 0.9, duration: 0.08, ease: 'power2.out' }, at)
        .to(t.mat, { emissiveIntensity: 0.1, duration: 1.0, ease: 'power2.out' }, at + 0.2)
        .to(t.edgeMat, { opacity: 1, duration: 0.08 }, at)
        .to(t.edgeMat, { opacity: 0.55, duration: 0.8, ease: 'power2.out' }, at + 0.25);
      if (t.glow) {
        setColor(tl, t.glow.material.color, AMBER, at);
        tl.to(t.glow.material, { opacity: 0.9, duration: 0.08 }, at)
          .to(t.glow.material, { opacity: 0, duration: 1.0, ease: 'power2.out' }, at + 0.2);
      }
      tl.to(t.mesh.position, { x: STOP_X - 0.18, duration: 0.3, ease: 'elastic.out(1, 0.4)' }, at)
        .to(t.mesh.rotation, { z: 0.07, duration: 0.1, yoyo: true, repeat: 1, ease: 'power1.inOut' }, at);
      hop(t, tl, spot, at + 0.3, 0.9, -0.05);
      tl
        .call(() => showTag(slot, true), null, at + 1.25)
        .call(() => showTag(slot, false), null, at + 3.9);
      tint(tl, t.mat.color, RUST, 1.6, at + 1.0);
      tint(tl, t.edgeMat.color, RUST, 1.6, at + 1.0);
      tl.to(t.edgeMat, { opacity: 0.25, duration: 1.6 }, at + 1.0)
        .to([t.mat, t.glyphMat, t.edgeMat], { opacity: 0, duration: 0.7, ease: 'power2.in' }, at + 6.6)
        .call(() => release(t));
    }
    t.tl = track(tl);
    return true;
  };

  // A person approves: only this ever moves a waiting change on.
  const approve = (slot) => {
    const t = waitBy[slot];
    if (!t || !t.waiting) return;
    t.waiting = false;
    waitBy[slot] = null;
    waitReserved = Math.max(0, waitReserved - 1);
    if (approveEls[slot]) approveEls[slot].hidden = true;
    if (t.tl) live.delete(t.tl);
    const tl = gsap.timeline();
    tl.to(t.edgeMat, { opacity: 0, duration: 0.3 }, 0);
    setColor(tl, t.mat.emissive, SKY, 0);
    tint(tl, t.mat.color, SKY, 0.4, 0);
    tint(tl, t.glyphMat.color, WHITE, 0.4, 0);
    tl.to(t.mat, { emissiveIntensity: 0.7, duration: 0.3, ease: 'power2.out' }, 0)
      .to(signMat, { opacity: 1, duration: 0.15 }, 0)
      .to(signMat, { opacity: 0.8, duration: 0.8 }, 0.15);
    if (t.glow) tl.to(t.glow.material, { opacity: 0.8, duration: 0.3 }, 0);
    toQueue(t, tl, 0.25);
    t.tl = track(tl);
    bump('approved', dotOk);
    announce(msg.approved);
  };
  approveEls.forEach((el, i) => el.addEventListener('click', (event) => {
    event.stopPropagation();
    approve(i);
  }));

  // Input: kind toggle, click/tap/keys to send, pointer orbit and hover.
  let kind = 'good';
  options.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      kind = ['good', 'risky', 'approval'].includes(btn.dataset.kind) ? btn.dataset.kind : 'good';
      options.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });
  const queue = [];
  const enqueue = () => {
    if (queue.length < QUEUE_MAX) queue.push(kind);
  };
  const onClick = (event) => {
    if (controls && controls.contains(event.target)) return;
    if (event.target.closest && event.target.closest('[data-approve]')) return;
    enqueue();
  };
  const onKey = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      enqueue();
    }
  };
  if (hit) {
    hit.tabIndex = 0;
    hit.setAttribute('role', 'button');
    hit.setAttribute('aria-label', data.stageLabel || 'Send a change through the gate');
    hit.addEventListener('keydown', onKey);
  }
  figure.addEventListener('click', onClick);
  if (controls) controls.hidden = false;

  const pointer = { x: 0, y: 0 };
  const toX = gsap.quickTo(pointer, 'x', { duration: 1.4, ease: 'power3.out' });
  const toY = gsap.quickTo(pointer, 'y', { duration: 1.4, ease: 'power3.out' });
  const ndc = new Vector2(9, 9);
  let hoverDirty = false;
  let canvasRect = canvas.getBoundingClientRect();
  const onPointer = (event) => {
    const rect = figure.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    if (Math.abs(nx) <= 1.2 && Math.abs(ny) <= 1.2) {
      toX(MathUtils.clamp(nx, -1, 1));
      toY(MathUtils.clamp(ny, -1, 1));
    }
    const c = canvasRect;
    ndc.set(((event.clientX - c.left) / c.width) * 2 - 1, -((event.clientY - c.top) / c.height) * 2 + 1);
    hoverDirty = true;
  };
  const raycaster = new Raycaster();
  const updateHover = () => {
    hoverDirty = false;
    const targets = heldBy.filter(Boolean).map((t) => t.mesh);
    let next = -1;
    if (targets.length && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
      raycaster.setFromCamera(ndc, camera);
      const h = raycaster.intersectObjects(targets, false)[0];
      if (h) next = heldBy.findIndex((t) => t && t.mesh === h.object);
    }
    if (next === hovered) return;
    const prev = hovered;
    hovered = next;
    if (next >= 0) tagShown.forEach((v, i) => { if (v && i !== next) showTag(i, false); });
    if (prev >= 0) showTag(prev, tagShown[prev]);
    if (next >= 0) showTag(next, tagShown[next]);
  };

  // ---- Framing: one shot per chapter, fitted to the stage on resize ----
  const target = new Vector3();
  const camDir = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const probe = new Vector3();
  const Y_AXIS = new Vector3(0, 1, 0);
  let frameBox = { x0: -0.92, x1: 0.92, y0: -0.6, y1: 0.86 };
  const placeCamera = (tgt, elev, dist, orbit = 0) => {
    camDir.set(Math.sin(orbit) * Math.cos(elev), Math.sin(elev), Math.cos(orbit) * Math.cos(elev));
    camera.position.copy(tgt).addScaledVector(camDir, dist);
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  };
  const fitShot = (shot) => {
    const pts = shot.keys.map(([x, y, z]) => new Vector3(x, y, z).applyAxisAngle(Y_AXIS, shot.yaw));
    const bounds = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        probe.copy(p).project(camera);
        x0 = Math.min(x0, probe.x); x1 = Math.max(x1, probe.x);
        y0 = Math.min(y0, probe.y); y1 = Math.max(y1, probe.y);
      }
      return { x0, x1, y0, y1 };
    };
    const tgt = new Vector3();
    pts.forEach((p) => tgt.add(p));
    tgt.divideScalar(pts.length);
    let dist = 12;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 1.5;
      let hi = 120;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        placeCamera(tgt, shot.elev, mid);
        const b = bounds();
        const fits = b.x0 >= frameBox.x0 && b.x1 <= frameBox.x1 && b.y0 >= frameBox.y0 && b.y1 <= frameBox.y1;
        if (fits) hi = mid; else lo = mid;
      }
      dist = hi;
      placeCamera(tgt, shot.elev, dist);
      const b = bounds();
      const halfTan = Math.tan(MathUtils.degToRad(FOV / 2));
      const dx = ((b.x0 + b.x1) / 2 - (frameBox.x0 + frameBox.x1) / 2) * dist * halfTan * camera.aspect;
      const dy = ((b.y0 + b.y1) / 2 - (frameBox.y0 + frameBox.y1) / 2) * dist * halfTan;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      tgt.addScaledVector(right, dx).addScaledVector(up, dy);
    }
    // Express the target in world-group space so the yaw can be animated.
    const local = tgt.clone().applyAxisAngle(Y_AXIS, -shot.yaw);
    return { yaw: shot.yaw, elev: shot.elev, tx: local.x, ty: local.y, tz: local.z, dist };
  };
  let shots = [];
  let chapter = 0;
  const cam = { yaw: SHOTS[0].yaw, elev: SHOTS[0].elev, tx: 0, ty: 0, tz: 0, dist: 12 };
  let camTween = null;

  let stageW = 1;
  let stageH = 1;
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    stageW = width;
    stageH = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const cr = controls && !controls.hidden ? controls.getBoundingClientRect() : null;
    const sr = stage.getBoundingClientRect();
    const reserved = cr && cr.height ? Math.max(0, sr.bottom - cr.top + 10) : 16;
    // Full-bleed on wide screens: the action sits in the right ~55% and the
    // left stays calm behind the copy. Phones use the whole band.
    const wide = width >= 1024;
    const top = wide ? 0.62 : 0.7;
    frameBox = { x0: wide ? -0.1 : -0.9, x1: wide ? 0.9 : 0.9, y0: Math.min(-1 + (2 * reserved) / height, top - 0.9), y1: top };
    shots = SHOTS.map(fitShot);
    if (camTween) camTween.kill();
    Object.assign(cam, shots[chapter]);
    canvasRect = canvas.getBoundingClientRect();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  const onScroll = () => { canvasRect = canvas.getBoundingClientRect(); };
  window.addEventListener('scroll', onScroll, { passive: true });

  const setChapter = (n) => {
    const next = MathUtils.clamp(Math.round(n), 0, SHOTS.length - 1);
    if (next === chapter && camTween) return;
    chapter = next;
    if (chapterEl) chapterEl.textContent = chapter > 0 ? chapterCaptions[chapter - 1] || '' : '';
    if (!shots.length) return;
    if (camTween) { live.delete(camTween); camTween.kill(); }
    camTween = track(gsap.to(cam, { ...shots[chapter], duration: 1.8, ease: 'power3.inOut' }));
  };

  // ---- Screen-space overlays ----
  const tmp = new Vector3();
  const toScreen = (v) => {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * stageW, y: (-tmp.y * 0.5 + 0.5) * stageH, in: tmp.z < 1 && Math.abs(tmp.x) < 0.98 && Math.abs(tmp.y) < 0.98 };
  };
  const stationPoints = [
    new Vector3(RULEBOOK.x, RULEBOOK.y + RULEBOOK.h + 0.25, RULEBOOK.z),
    new Vector3(CHAMBER.x, CHAMBER.h + 0.32, 0),
    new Vector3(0, ARCH.top + 0.25, 0),
    new Vector3(APPROVAL.slots[0].x + 0.35, 1.3, APPROVAL.slots[0].z),
    new Vector3(QUEUE.x0 + QUEUE.step, TOKEN_Y + TOKEN.h + 0.45, QUEUE.rows[0]),
  ];
  // Overlay rectangles (screen px) for a simple collision pass: station
  // labels stay put, reason tags move up out of their way, and a station label
  // that still collides with a tag or the Approve button is hidden.
  const sizes = new WeakMap();
  const sizeOf = (el) => {
    let sz = sizes.get(el);
    if (!sz || sz.text !== el.textContent || !sz.w) {
      sz = { w: el.offsetWidth, h: el.offsetHeight, text: el.textContent };
      sizes.set(el, sz);
    }
    return sz;
  };
  const above = (el, s) => {
    const { w, h } = sizeOf(el);
    return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - h, y1: s.y };
  };
  const hits = (a, b) => a.x0 < b.x1 + 4 && a.x1 > b.x0 - 4 && a.y0 < b.y1 + 3 && a.y1 > b.y0 - 3;
  const setAbove = (el, x, y) => { el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`; };
  const worldPoint = new Vector3();
  const placeOverlays = () => {
    world.updateMatrixWorld();
    nodeLabels.forEach((el, i) => {
      // Beside the disc, on the side away from the rulebook.
      worldPoint.set(NODES[i].x, NODE_Y + 0.04, NODES[i].z).applyMatrix4(world.matrixWorld);
      const c = toScreen(worldPoint);
      worldPoint.set(NODES[i].x + NODE_R, NODE_Y + 0.04, NODES[i].z).applyMatrix4(world.matrixWorld);
      const e = toScreen(worldPoint);
      worldPoint.set(NODES[i].x, NODE_Y + 0.04, NODES[i].z + NODE_R).applyMatrix4(world.matrixWorld);
      const e2 = toScreen(worldPoint);
      const reach = Math.max(Math.abs(e.x - c.x), Math.abs(e2.x - c.x));
      const on = (chapter === 1 || chapter === 2) && c.in;
      el.classList.toggle('is-on', on);
      if (on) el.style.transform = `translate(${(c.x + reach + 6).toFixed(1)}px, ${c.y.toFixed(1)}px) translate(0, -50%)`;
    });
    const stations = [];
    stationLabels.forEach((el, i) => {
      worldPoint.copy(stationPoints[i]).applyMatrix4(world.matrixWorld);
      const s = toScreen(worldPoint);
      // Wide screens keep the left side calm behind the copy: no labels there.
      if (!s.in || (stageW >= 1024 && s.x < stageW * 0.42)) { el.classList.remove('is-on'); return; }
      setAbove(el, s.x, s.y);
      stations.push({ el, r: above(el, s), keep: true });
    });
    const blockers = [];
    for (let i = 0; i < tagEls.length; i++) {
      const t = heldBy[i];
      const el = tagEls[i];
      if (!t || t.held !== i || !(tagShown[i] || hovered === i)) { el.classList.remove('is-on'); continue; }
      t.mesh.getWorldPosition(worldPoint);
      worldPoint.y += TOKEN.h / 2 + 0.16;
      const s = toScreen(worldPoint);
      if (!s.in) { el.classList.remove('is-on'); continue; }
      let r = above(el, s);
      for (const st of stations) {
        if (hits(r, st.r)) {
          const dy = r.y1 - (st.r.y0 - 6);
          s.y -= dy;
          r = above(el, s);
        }
      }
      setAbove(el, s.x, s.y);
      el.classList.add('is-on');
      blockers.push(r);
    }
    // One Approve button at a time, over the change that has waited longest.
    let first = -1;
    let oldest = Infinity;
    waitBy.forEach((w, i) => { if (w && w.waiting && w.since < oldest) { oldest = w.since; first = i; } });
    for (let i = 0; i < approveEls.length; i++) {
      const t = waitBy[i];
      const el = approveEls[i];
      const show = i === first;
      if (el.hidden === show) el.hidden = !show;
      if (!show) continue;
      t.mesh.getWorldPosition(worldPoint);
      worldPoint.y += TOKEN.h / 2 + 0.42;
      const s = toScreen(worldPoint);
      el.style.visibility = s.in ? 'visible' : 'hidden';
      setAbove(el, s.x, s.y);
      if (s.in) blockers.push(above(el, s));
    }
    for (const st of stations) {
      st.el.classList.toggle('is-on', !blockers.some((b) => hits(b, st.r)));
    }
  };

  const placeShadows = () => {
    for (let i = 0; i < pool.length; i++) {
      const t = pool[i];
      if (!t.busy) continue;
      const lift = Math.max(0, t.mesh.position.y - TOKEN_Y);
      t.shadow.position.x = t.mesh.position.x;
      t.shadow.position.z = t.mesh.position.z;
      const s = (1 + lift * 1.1) * t.mesh.scale.x;
      t.shadow.scale.set(1.15 * s, 0.85 * s, 1);
      t.shadow.material.opacity = 0.85 * t.mat.opacity * Math.max(0, 1 - lift * 1.8);
    }
  };

  // Two passes: the mirrored scene under a glossy floor, then the scene.
  // The mirrored pass is clipped at the floor (nothing pokes above y = 0)
  // and the glossy floor fades it with distance.
  const reflect = !low;
  const belowFloor = [new Plane(new Vector3(0, -1, 0), 0)];
  const render = () => {
    renderer.clear();
    if (reflect) {
      world.scale.y = -1;
      noReflect.forEach((o) => { o.userData.v = o.visible; o.visible = false; });
      renderer.clippingPlanes = belowFloor;
      renderer.render(scene, camera);
      renderer.clippingPlanes = [];
      noReflect.forEach((o) => { o.visible = o.userData.v; });
      world.scale.y = 1;
      renderer.clearDepth();
    }
    renderer.render(scene, camera);
  };

  // Render loop on GSAP's ticker; readouts throttled to ~12 fps.
  let clock = AUTO_GAP - 0.4;
  let autoCount = 0;
  let lastReadout = 0;
  let elapsed = 0;
  const camTarget = new Vector3();
  const fmt = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(3)}`;
  const AUTO = ['good', 'good', 'risky', 'good', 'approval', 'good', 'risky'];
  const tick = (time, deltaMs) => {
    const dt = Math.min(deltaMs, 100) / 1000;
    elapsed += dt;
    clock += dt;
    if (queue.length && clock >= MIN_GAP) {
      if (send(queue[0], true)) queue.shift();
      clock = 0;
    } else if (!queue.length && clock >= AUTO_GAP) {
      let k = AUTO[autoCount++ % AUTO.length];
      if (k === 'approval' && waitReserved >= waitBy.length) k = 'good';
      send(k, false);
      clock = 0;
    }
    scanU.uTime.value = elapsed;
    // Rulebook pulses travel to every assistant; brighter in chapter 1.
    const focus1 = chapter === 1 ? 1 : 0.45;
    lineMat.opacity = 0.18 + focus1 * 0.22;
    pageMat.opacity = 0.5 + focus1 * 0.35;
    rulebookGlow.opacity = 0.06 + focus1 * 0.12;
    nodes.forEach((n, i) => {
      const u = (elapsed * 0.42 + n.phase) % 1;
      n.curve.getPoint(u, n.spark.position);
      n.spark.material.opacity = Math.sin(u * Math.PI) * (0.5 + focus1 * 0.5);
      n.g.position.y = NODE_Y + Math.sin(elapsed * 1.1 + i) * 0.03;
    });
    const waiting = waitBy.some((w) => w && w.waiting);
    waitGlow.opacity = waiting ? 0.08 + 0.05 * Math.sin(elapsed * 2.4) : 0.04;
    for (const w of waitBy) {
      if (w && w.waiting) {
        w.mat.emissiveIntensity = 0.18 + 0.14 * Math.sin(elapsed * 2.4);
        w.edgeMat.opacity = 0.45 + 0.3 * Math.sin(elapsed * 2.4);
      }
    }
    for (let i = 0; i < DUST; i++) {
      const k = i * 3 + 1;
      dustPos[k] += dt * (0.05 + (i % 5) * 0.012);
      if (dustPos[k] > 2.7) dustPos[k] = 0.05;
      dustPos[i * 3] += Math.sin(elapsed * 0.3 + dustSeed[i]) * dt * 0.04;
    }
    dustGeo.attributes.position.needsUpdate = true;

    world.rotation.y = cam.yaw;
    camTarget.set(cam.tx, cam.ty, cam.tz).applyAxisAngle(Y_AXIS, cam.yaw);
    placeCamera(
      camTarget,
      cam.elev + Math.sin(elapsed * 0.11) * DRIFT * 0.5 - pointer.y * MathUtils.degToRad(3),
      cam.dist,
      Math.sin(elapsed * 0.13) * DRIFT + pointer.x * ORBIT,
    );
    // Depth range fitted to the shot: better precision, no z-fighting.
    camera.near = Math.max(0.5, cam.dist * 0.25);
    camera.far = cam.dist * 3 + 40;
    camera.updateProjectionMatrix();
    placeShadows();
    if (hoverDirty) updateHover();
    render();
    placeOverlays();
    if (time - lastReadout > 0.08) {
      lastReadout = time;
      if (readout.x) readout.x.textContent = fmt(pointer.x);
      if (readout.y) readout.y.textContent = fmt(-pointer.y);
    }
  };

  let running = false;
  let visible = true;
  const play = () => {
    if (running || !visible || document.hidden) return;
    running = true;
    gsap.ticker.add(tick);
    live.forEach((tl) => tl.resume());
    window.addEventListener('pointermove', onPointer, { passive: true });
  };
  const pause = () => {
    if (!running) return;
    running = false;
    gsap.ticker.remove(tick);
    live.forEach((tl) => tl.pause());
    window.removeEventListener('pointermove', onPointer);
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) play();
    else pause();
  });
  io.observe(figure);
  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);

  const teardown = () => {
    pause();
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('scroll', onScroll);
    figure.removeEventListener('click', onClick);
    if (hit) {
      hit.removeEventListener('keydown', onKey);
      hit.removeAttribute('tabindex');
      hit.removeAttribute('role');
      hit.removeAttribute('aria-label');
    }
    if (controls) controls.hidden = true;
    approveEls.forEach((el) => { el.hidden = true; });
    [...tagEls, ...nodeLabels, ...stationLabels].forEach((el) => el.classList.remove('is-on'));
    figure.classList.remove('is-live');
    api.onLost?.();
  };
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    teardown();
  });

  // Run tick once so the first frame is framed and populated.
  world.rotation.y = cam.yaw;
  render();
  requestAnimationFrame(() => figure.classList.add('is-live'));
  play();
  const api = { setChapter, onLost: null };
  return api;
}
