'use client';

import { Particles } from '@/components/visual/Particles';
import { useMemo } from 'react';

function isTouchDevice() {
  return (
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}

/**
 * Candycode-ish universe background:
 * - layered nebula orbs
 * - slow spinning conic “rings”
 * - MagicUI-style particles
 * - vignette + subtle grain
 */
export default function EntryBackground() {
  const touch = typeof window === 'undefined' ? false : isTouchDevice();
  const quantity = useMemo(() => (touch ? 110 : 170), [touch]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base void */}
      <div className="absolute inset-0" style={{ background: '#050510' }} />

      {/* Nebula orbs (uses your existing .orb styles in globals.css) */}
      <div className="orb orb-violet absolute top-8 -left-24 h-110 w-110 opacity-90" />
      <div className="orb orb-pink absolute top-24 -right-28 h-130 w-130 opacity-80" />
      <div className="orb orb-cyan absolute top-[60%] left-1/2 h-130 w-130 -translate-x-1/2 opacity-70" />

      {/* Spinning universe rings */}
      <div
        className="animate-spin-slow absolute top-1/2 left-1/2 h-215 w-215 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-35 blur-[1px]"
        style={{
          background:
            'conic-gradient(from 90deg, rgba(124,58,237,0.0), rgba(124,58,237,0.45), rgba(236,72,153,0.3), rgba(6,182,212,0.25), rgba(245,158,11,0.22), rgba(124,58,237,0.0))',
          maskImage:
            'radial-gradient(circle, transparent 58%, rgba(0,0,0,1) 62%, rgba(0,0,0,1) 74%, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(circle, transparent 58%, rgba(0,0,0,1) 62%, rgba(0,0,0,1) 74%, transparent 78%)',
        }}
      />
      <div
        className="animate-spin-slow absolute top-1/2 left-1/2 h-275 w-275 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-[2px]"
        style={{
          animationDuration: '120s',
          background:
            'conic-gradient(from 0deg, rgba(236,72,153,0), rgba(236,72,153,0.35), rgba(6,182,212,0.25), rgba(124,58,237,0.18), rgba(236,72,153,0))',
          maskImage:
            'radial-gradient(circle, transparent 66%, rgba(0,0,0,1) 69%, rgba(0,0,0,1) 80%, transparent 84%)',
          WebkitMaskImage:
            'radial-gradient(circle, transparent 66%, rgba(0,0,0,1) 69%, rgba(0,0,0,1) 80%, transparent 84%)',
        }}
      />

      {/* Particles */}
      <div className="absolute inset-0 opacity-90">
        <Particles
          className="absolute inset-0"
          quantity={quantity}
          staticity={touch ? 95 : 70}
          ease={touch ? 120 : 90}
          size={0.55}
          color="#ffffff"
          vx={0.02}
          vy={0.01}
        />
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.7) 100%)',
        }}
      />

      {/* Grain (no CSS needed) */}
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '3px 3px',
          mixBlendMode: 'overlay',
          filter: 'blur(0.35px)',
          transform: 'scale(1.4)',
        }}
      />
    </div>
  );
}
