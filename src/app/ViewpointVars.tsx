'use client';

import { useEffect } from 'react';

/**
 * Keeps --sq-vh/--sq-vw accurate on mobile (incl. iOS address bar behavior).
 */
export default function ViewportVars() {
  useEffect(() => {
    const set = () => {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      const w = vv?.width ?? window.innerWidth;
      document.documentElement.style.setProperty('--sq-vh', `${h * 0.01}px`);
      document.documentElement.style.setProperty('--sq-vw', `${w * 0.01}px`);
    };

    set();
    window.addEventListener('resize', set);
    window.addEventListener('orientationchange', set);
    window.visualViewport?.addEventListener('resize', set);

    return () => {
      window.removeEventListener('resize', set);
      window.removeEventListener('orientationchange', set);
      window.visualViewport?.removeEventListener('resize', set);
    };
  }, []);

  return null;
}
