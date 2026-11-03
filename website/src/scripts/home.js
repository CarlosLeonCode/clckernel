// Home page motion: hero entrance, word-by-word statement reveal, and the
// lazy-loaded 3D gate. Everything is visible without this script.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const mm = gsap.matchMedia();

mm.add(
  { motion: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)' },
  (ctx) => {
    const { motion } = ctx.conditions;
    if (!motion) {
      root.classList.remove('js');
      return;
    }
    root.classList.add('motion-ok');

    // One authored entrance: the two headline lines rise out of their masks.
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .to('.hero-line > span', { y: 0, duration: 1.1, stagger: 0.12 })
      .to('.hero-fade', { opacity: 1, duration: 0.8, stagger: 0.08 }, '-=0.7');

    // The statement is read word by word as it scrolls through the viewport.
    document.querySelectorAll('[data-reveal]').forEach((block) => {
      const words = block.querySelectorAll('.w');
      gsap.fromTo(
        words,
        { opacity: 0.16 },
        {
          opacity: 1,
          ease: 'none',
          stagger: 0.1,
          scrollTrigger: { trigger: block, start: 'top 80%', end: 'bottom 55%', scrub: 0.6 },
        },
      );
    });
  },
);

// ---- 3D gate: loaded only when useful and visible ----
const figure = document.querySelector('[data-gate]');

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function shouldLoad3D() {
  if (!figure) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = navigator.connection;
  if (conn && conn.saveData) return false;
  return webglAvailable();
}

function whenIdle(fn) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 1800 });
  else setTimeout(fn, 300);
}

// ---- Story: the chapter in view picks the camera shot ----
// The figure sticks (CSS) only once the scene is live; until then, and
// without WebGL, every chapter shows its own static panel.
function startStory(api) {
  const story = document.querySelector('[data-story]');
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  if (!story || !chapters.length) return;
  story.classList.add('is-live');
  const triggers = [];
  const activate = (n) => {
    chapters.forEach((el, i) => el.classList.toggle('is-active', i + 1 === n));
    api.setChapter(n);
  };
  // On phones the figure covers the top of the screen, so a chapter counts as
  // "in view" lower down.
  const line = window.matchMedia('(min-width: 1024px)').matches ? 62 : 85;
  chapters.forEach((el, i) => {
    triggers.push(ScrollTrigger.create({
      trigger: el,
      start: `top ${line}%`,
      end: `bottom ${line}%`,
      onEnter: () => activate(i + 1),
      onEnterBack: () => activate(i + 1),
      onLeaveBack: i === 0 ? () => activate(0) : undefined,
    }));
  });
  api.onLost = () => {
    triggers.forEach((t) => t.kill());
    story.classList.remove('is-live');
    chapters.forEach((el) => el.classList.remove('is-active'));
    ScrollTrigger.refresh();
  };
  ScrollTrigger.refresh();
  const current = chapters.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight * (line / 100) && r.bottom > window.innerHeight * (line / 100);
  });
  activate(current + 1);
}

if (shouldLoad3D()) {
  const start = () => {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      import('./gate-scene.js')
        .then((mod) => {
          const api = mod.mountGate(figure);
          if (api) startStory(api);
        })
        .catch(() => { /* keep the static figure and panels */ });
    }, { rootMargin: '200px' });
    io.observe(figure);
  };
  if (document.readyState === 'complete') whenIdle(start);
  else window.addEventListener('load', () => whenIdle(start), { once: true });
}
