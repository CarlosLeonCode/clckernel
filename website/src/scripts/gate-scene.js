// Fig. 01, "the gate": a 3x3x3 cluster of rounded blocks in neutral tones.
// One block, in the accent colour, slides out, lights up ("change checked")
// and slides back in. Loaded on demand by home.js; the static SVG stays as
// the fallback underneath the canvas.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  HemisphereLight,
  DirectionalLight,
  Object3D,
  Color,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';

const ACCENT = '#b8f03f';
const NEUTRALS = ['#5f5e59', '#7d7b75', '#9a988f'];
const ACCENT_SLOT = [2, 0, 2]; // same slot as the SVG fallback (i, j, k)
const BASE_TILT = 0.6;
const BASE_YAW = -Math.PI / 4;

export function mountGate(figure) {
  const stage = figure.querySelector('[data-gate-stage]');
  if (!stage) return;
  const readout = {
    x: figure.querySelector('[data-readout="x"]'),
    y: figure.querySelector('[data-readout="y"]'),
    r: figure.querySelector('[data-readout="r"]'),
    n: figure.querySelector('[data-readout="n"]'),
  };
  const dot = figure.querySelector('[data-gate-dot]');

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 10.2);

  scene.add(new HemisphereLight(0xf2efe8, 0x141412, 1.5));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 7, 6);
  scene.add(key);
  const rim = new DirectionalLight(0xb8c4ff, 0.5);
  rim.position.set(-6, -2, -5);
  scene.add(rim);

  const cluster = new Group();
  cluster.rotation.set(BASE_TILT, BASE_YAW, 0);
  scene.add(cluster);

  const geometry = new RoundedBoxGeometry(0.86, 0.86, 0.86, 3, 0.11);
  const neutral = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.05 });
  const blocks = new InstancedMesh(geometry, neutral, 26);
  const dummy = new Object3D();
  const tint = new Color();
  let index = 0;
  let accentHome = new Vector3();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        const pos = new Vector3(i - 1, k - 1, j - 1);
        if (i === ACCENT_SLOT[0] && j === ACCENT_SLOT[1] && k === ACCENT_SLOT[2]) {
          accentHome = pos;
          continue;
        }
        dummy.position.copy(pos);
        dummy.updateMatrix();
        blocks.setMatrixAt(index, dummy.matrix);
        blocks.setColorAt(index, tint.set(NEUTRALS[(i * 7 + j * 3 + k * 5) % NEUTRALS.length]));
        index++;
      }
    }
  }
  cluster.add(blocks);

  const accentMaterial = new MeshStandardMaterial({
    color: ACCENT,
    emissive: ACCENT,
    emissiveIntensity: 0.12,
    roughness: 0.45,
    metalness: 0.0,
  });
  const accent = new Mesh(geometry, accentMaterial);
  accent.position.copy(accentHome);
  cluster.add(accent);
  const outward = accentHome.clone().normalize().multiplyScalar(0.55);

  // Pointer parallax through a proxy object and quickTo (one tween reused).
  const pointer = { x: 0, y: 0 };
  const toX = gsap.quickTo(pointer, 'x', { duration: 1.2, ease: 'power3.out' });
  const toY = gsap.quickTo(pointer, 'y', { duration: 1.2, ease: 'power3.out' });
  const onPointer = (event) => {
    const rect = figure.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    toX(Math.max(-1, Math.min(1, nx)));
    toY(Math.max(-1, Math.min(1, ny)));
  };

  // The check cycle.
  let checks = 1;
  const pad = (n) => String(n).padStart(3, '0');
  const cycle = gsap.timeline({ repeat: -1, repeatDelay: 1.4, delay: 0.8, paused: true });
  cycle
    .to(accent.position, {
      x: accentHome.x + outward.x,
      y: accentHome.y + outward.y,
      z: accentHome.z + outward.z,
      duration: 0.9,
      ease: 'expo.inOut',
    })
    .to(accentMaterial, { emissiveIntensity: 1.1, duration: 0.14, ease: 'power2.out' })
    .call(() => {
      checks = checks >= 999 ? 1 : checks + 1;
      if (readout.n) readout.n.textContent = pad(checks);
      if (dot) gsap.fromTo(dot, { scale: 2.2 }, { scale: 1, duration: 0.7, ease: 'expo.out' });
    })
    .to(accentMaterial, { emissiveIntensity: 0.12, duration: 0.9, ease: 'power2.out' })
    .to(accent.position, { x: accentHome.x, y: accentHome.y, z: accentHome.z, duration: 0.9, ease: 'expo.inOut' }, '-=0.5');

  // Size.
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // Render loop on GSAP's ticker; readouts throttled to ~12 fps.
  let yaw = 0;
  let lastReadout = 0;
  const fmt = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(3)}`;
  const tick = (time, deltaMs) => {
    yaw += (deltaMs / 1000) * 0.14;
    cluster.rotation.y = BASE_YAW + yaw + pointer.x * 0.35;
    cluster.rotation.x = BASE_TILT + pointer.y * 0.22;
    renderer.render(scene, camera);
    if (time - lastReadout > 0.08) {
      lastReadout = time;
      if (readout.x) readout.x.textContent = fmt(pointer.x);
      if (readout.y) readout.y.textContent = fmt(-pointer.y);
      if (readout.r) {
        const deg = ((((cluster.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
        readout.r.textContent = deg.toFixed(1).padStart(5, '0');
      }
    }
  };

  let running = false;
  let visible = true;
  const play = () => {
    if (running || !visible || document.hidden) return;
    running = true;
    gsap.ticker.add(tick);
    cycle.play();
    window.addEventListener('pointermove', onPointer, { passive: true });
  };
  const pause = () => {
    if (!running) return;
    running = false;
    gsap.ticker.remove(tick);
    cycle.pause();
    window.removeEventListener('pointermove', onPointer);
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) play();
    else pause();
  });
  io.observe(figure);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    pause();
    io.disconnect();
    ro.disconnect();
    figure.classList.remove('is-live');
  });

  renderer.render(scene, camera);
  requestAnimationFrame(() => figure.classList.add('is-live'));
  play();
}
