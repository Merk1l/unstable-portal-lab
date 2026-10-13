import type { Portal } from '../types';

export const STORAGE_KEY = 'portal-control-system:v1';

export function loadPortals(seed: Portal[]): Portal[] {
  if (typeof window === 'undefined') {
    return seed;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return seed;
    }

    const parsed = JSON.parse(raw) as Portal[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : seed;
  } catch (error) {
    console.warn('Failed to load portals from storage.', error);
    return seed;
  }
}

export function savePortals(portals: Portal[]): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(portals));
    return true;
  } catch (error) {
    console.warn('Failed to save portals to storage.', error);
    return false;
  }
}
