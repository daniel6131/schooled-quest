'use client';

import React, { useEffect, useMemo, useRef } from 'react';

type ParticlesProps = React.HTMLAttributes<HTMLDivElement> & {
  quantity?: number;
  staticity?: number;
  ease?: number;
  size?: number;
  refresh?: boolean;
  color?: string;
  vx?: number;
  vy?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  targetAlpha: number;
  magnetism: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim();
  const norm =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6);
  const num = parseInt(norm, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function isTouchDevice() {
  return (
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}

/**
 * MagicUI-style particles (manual implementation).
 * Mobile: no pointer magnetism, no “scroll makes stars go insane”.
 */
export function Particles({
  className = '',
  quantity = 140,
  staticity = 70,
  ease = 90,
  size = 0.6,
  refresh = false,
  color = '#ffffff',
  vx = 0,
  vy = 0,
  ...props
}: ParticlesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const lastTRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, active: false });

  const rgb = useMemo(() => hexToRgb(color), [color]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const touch = isTouchDevice();
    dprRef.current = Math.min(window.devicePixelRatio || 1, 2);

    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      sizeRef.current = { w, h };

      canvas.width = Math.floor(w * dprRef.current);
      canvas.height = Math.floor(h * dprRef.current);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    };

    const spawn = (): Particle => {
      const { w, h } = sizeRef.current;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18 + vx,
        vy: (Math.random() - 0.5) * 0.18 + vy,
        r: Math.random() * 1.6 + size,
        alpha: 0,
        targetAlpha: clamp(Math.random() * 0.55 + 0.12, 0.12, 0.75),
        magnetism: 0.25 + Math.random() * 3.5,
      };
    };

    const init = () => {
      resize();
      particlesRef.current = [];
      const count = prefersReduced ? Math.min(50, quantity) : quantity;
      for (let i = 0; i < count; i++) particlesRef.current.push(spawn());
    };

    const onMove = (ev: PointerEvent) => {
      if (touch) return;
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ev.clientX - rect.left;
      mouseRef.current.y = ev.clientY - rect.top;
      mouseRef.current.active = true;
    };

    const onLeave = () => {
      mouseRef.current.active = false;
    };

    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => init());
    ro.observe(container);

    const tick = (t: number) => {
      const dtMs = t - lastTRef.current;
      lastTRef.current = t;
      const dt = clamp(dtMs, 0, 40);

      clear();

      const { w, h } = sizeRef.current;
      const [r, g, b] = rgb;

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];

        p.alpha = Math.min(p.targetAlpha, p.alpha + 0.02);

        if (mouseRef.current.active && !touch) {
          const dx = mouseRef.current.x - p.x;
          const dy = mouseRef.current.y - p.y;
          p.vx += (dx / (staticity / p.magnetism) - p.vx) / ease;
          p.vy += (dy / (staticity / p.magnetism) - p.vy) / ease;
        }

        p.x += p.vx * (dt * 0.06);
        p.y += p.vy * (dt * 0.06);

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`;
        ctx.fill();
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    init();
    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
    };
  }, [quantity, staticity, ease, size, refresh, color, vx, vy, rgb]);

  return (
    <div ref={containerRef} className={className} {...props}>
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
    </div>
  );
}
