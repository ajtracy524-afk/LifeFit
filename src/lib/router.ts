import { useSyncExternalStore } from 'react';

/**
 * Minimal hash router: `#/nutrition?date=2026-09-25&view=week`.
 * Hash routing keeps the browser/Android back button working without a library.
 */
export type Tab = 'today' | 'nutrition' | 'training' | 'shopping' | 'progress';
export type Path = Tab | 'profile' | 'session' | 'workout' | 'exercises' | 'routine' | 'programs' | 'history' | 'onboarding';

export interface Route {
  path: Path;
  params: URLSearchParams;
}

const PATHS: Path[] = ['today', 'nutrition', 'training', 'shopping', 'progress', 'profile', 'session', 'workout', 'exercises', 'routine', 'programs', 'history', 'onboarding'];

function parse(hash: string): Route {
  const [rawPath = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const path = (PATHS as string[]).includes(rawPath) ? (rawPath as Path) : 'today';
  return { path, params: new URLSearchParams(query) };
}

let current = parse(window.location.hash);
let currentHash = window.location.hash;

function subscribe(listener: () => void) {
  const handler = () => {
    if (window.location.hash !== currentHash) {
      currentHash = window.location.hash;
      current = parse(currentHash);
      window.scrollTo(0, 0);
    }
    listener();
  };
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

export function href(path: Path, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) q.set(k, v);
  const qs = q.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: Path, params?: Record<string, string | undefined>, options?: { replace?: boolean }): void {
  const target = href(path, params);
  if (options?.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}
