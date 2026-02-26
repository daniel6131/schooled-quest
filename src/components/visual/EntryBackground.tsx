'use client';

import { useEffect, useRef } from 'react';

/*──────────────────────────────────────────────────────────────────────
  Cosmic Nebula Background
  ─────────────────────────
  Canvas-based spinning galaxy with orbiting stars + breathing nebulae.
  Desktop: mouse parallax.  Mobile: zero parallax (no touch/scroll).
──────────────────────────────────────────────────────────────────────*/

interface Star {
  angle: number;
  radius: number;
  size: number;
  brightness: number;
  speed: number;
  phase: number;
  layer: number;
  rgb: [number, number, number];
}

const STAR_TINTS: [number, number, number][] = [
  [255, 255, 255],
  [220, 225, 255],
  [255, 230, 200],
  [200, 210, 255],
  [255, 210, 240],
  [200, 255, 245],
];

const NEBULAE = [
  { cx: 0.28, cy: 0.3, rFrac: 0.45, hue: 270, sat: 75, alpha: 0.08, bs: 0.4, bp: 0 },
  { cx: 0.72, cy: 0.25, rFrac: 0.35, hue: 190, sat: 65, alpha: 0.06, bs: 0.3, bp: 1.5 },
  { cx: 0.5, cy: 0.75, rFrac: 0.5, hue: 320, sat: 60, alpha: 0.06, bs: 0.35, bp: 3 },
  { cx: 0.15, cy: 0.7, rFrac: 0.3, hue: 45, sat: 50, alpha: 0.04, bs: 0.25, bp: 2 },
];

export default function EntryBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const timeRef = useRef(0);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const c = cvs.getContext('2d', { alpha: false });
    if (!c) return;

    const canvas = cvs;
    const ctx = c;

    const prefersReduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    let stars: Star[] = [];
    let W = 0;
    let H = 0;
    let dpr = 1;
    let prevPW = 0;
    let prevPH = 0;

    function buildStars(w: number, h: number) {
      stars = [];
      const diag = Math.hypot(w, h);
      const count = Math.min(450, Math.max(160, Math.floor((w * h) / 4500)));
      const layers = [
        { frac: 0.55, sz: [0.4, 1.1], sp: 0.15, br: [0.2, 0.5] },
        { frac: 0.3, sz: [0.8, 1.8], sp: 0.35, br: [0.4, 0.7] },
        { frac: 0.15, sz: [1.4, 2.8], sp: 0.6, br: [0.6, 1.0] },
      ];
      for (let li = 0; li < layers.length; li++) {
        const l = layers[li];
        const n = Math.floor(count * l.frac);
        for (let i = 0; i < n; i++) {
          stars.push({
            angle: Math.random() * Math.PI * 2,
            radius: Math.sqrt(Math.random()) * diag * 0.6,
            size: l.sz[0] + Math.random() * (l.sz[1] - l.sz[0]),
            brightness: l.br[0] + Math.random() * (l.br[1] - l.br[0]),
            speed: l.sp * (0.7 + Math.random() * 0.6),
            phase: Math.random() * Math.PI * 2,
            layer: li,
            rgb: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
          });
        }
      }
    }

    // Only rebuild if pixel size actually changed (blocks iOS bounce jitter)
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      const pw = Math.floor(W * dpr);
      const ph = Math.floor(H * dpr);
      if (pw === prevPW && ph === prevPH) return;
      prevPW = pw;
      prevPH = ph;
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      buildStars(pw, ph);
    }

    resize();

    // Desktop-only mouse parallax
    function onMouseMove(e: MouseEvent) {
      if (isTouchDevice) return;
      mouseRef.current.x = e.clientX / W;
      mouseRef.current.y = e.clientY / H;
    }

    function draw(t: number) {
      const rawDt = t - timeRef.current;
      timeRef.current = t;
      const dt = Math.min(rawDt, 60); // cap prevents huge jumps
      const sec = t * 0.001;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.5;
      const cy = h * 0.45;

      // Mobile: zero parallax. Desktop: gentle mouse offset.
      const mx = isTouchDevice ? 0 : (mouseRef.current.x - 0.5) * 16 * dpr;
      const my = isTouchDevice ? 0 : (mouseRef.current.y - 0.5) * 10 * dpr;

      ctx.fillStyle = '#050510';
      ctx.fillRect(0, 0, w, h);

      // Nebulae
      ctx.globalCompositeOperation = 'screen';
      for (const neb of NEBULAE) {
        const breath = 1 + 0.12 * Math.sin(sec * neb.bs + neb.bp);
        const nx = neb.cx * w + mx * 0.12;
        const ny = neb.cy * h + my * 0.12;
        const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, neb.rFrac * w * breath);
        const a = neb.alpha * (0.8 + 0.2 * Math.sin(sec * neb.bs * 0.7 + neb.bp));
        grad.addColorStop(0, `hsla(${neb.hue},${neb.sat}%,55%,${a})`);
        grad.addColorStop(0.4, `hsla(${neb.hue},${neb.sat}%,40%,${a * 0.5})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';

      // Vignette
      const vig = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(0.7, 'rgba(5,5,16,0.15)');
      vig.addColorStop(1, 'rgba(5,5,16,0.65)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // Stars
      const rotBase = prefersReduced ? 0 : 0.00008;
      for (const s of stars) {
        if (!prefersReduced) s.angle += s.speed * rotBase * dt;
        const tw = 0.6 + 0.4 * Math.sin(sec * (1.5 + s.phase * 0.5) + s.phase);
        const alpha = s.brightness * tw;
        const pm = 0.1 + s.layer * 0.2;
        const px = cx + Math.cos(s.angle) * s.radius + mx * pm;
        const py = cy + Math.sin(s.angle) * s.radius * 0.6 + my * pm;
        if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;
        const r = s.size * dpr;

        if (s.layer >= 1 && alpha > 0.5) {
          ctx.beginPath();
          ctx.arc(px, py, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]},${alpha * 0.08})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]},${alpha})`;
        ctx.fill();
      }

      // Core glow
      const cg = ctx.createRadialGradient(
        cx + mx * 0.05,
        cy + my * 0.05,
        0,
        cx,
        cy,
        Math.min(w, h) * 0.25
      );
      cg.addColorStop(0, 'rgba(124,58,237,0.04)');
      cg.addColorStop(0.5, 'rgba(167,139,250,0.02)');
      cg.addColorStop(1, 'transparent');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    // ONLY window resize — NO visualViewport scroll, NO touchmove
    window.addEventListener('resize', resize);
    if (!isTouchDevice) {
      window.addEventListener('mousemove', onMouseMove);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ background: '#050510' }}
    />
  );
}
