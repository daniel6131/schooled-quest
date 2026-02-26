'use client';

import { useSyncExternalStore } from 'react';

export const LOCAL_STORAGE_EVENT = 'sq:localstorage';

export function setLocalStorageString(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

export function useLocalStorageString(key: string, fallback = '') {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => cb();
      window.addEventListener('storage', handler);
      window.addEventListener(LOCAL_STORAGE_EVENT, handler);
      return () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener(LOCAL_STORAGE_EVENT, handler);
      };
    },
    () => (typeof window === 'undefined' ? fallback : (localStorage.getItem(key) ?? fallback)),
    () => fallback
  );
}

export function cleanRoomCode(raw: string) {
  return raw
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 5);
}
