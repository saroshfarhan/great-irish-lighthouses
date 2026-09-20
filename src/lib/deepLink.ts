/**
 * Station deep links: `#/fastnet` opens Fastnet.
 *
 * Pulled forward from the polish milestone because it is genuinely load-bearing:
 * without it there is no way to address a particular lighthouse — not to share
 * one, not to reload onto one, and not to drive one directly when testing.
 *
 * The hash is treated as a mirror of `selectedId`, never as a second source of
 * truth: the store decides what is selected, and this keeps the URL in step.
 */

import { useEffect, useRef } from 'react';

import { stationsById } from './stations';
import { useApp } from '../state/store';

function idFromHash(): string | null {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;
  return stationsById.has(raw) ? raw : null;
}

export function useDeepLink(): void {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);

  // Open whatever the URL names, on load and on back/forward.
  useEffect(() => {
    const apply = () => select(idFromHash());
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [select]);

  // Mirror the selection back into the URL. `replaceState` rather than
  // assigning `location.hash`, so browsing the map does not bury the back
  // button under one history entry per lighthouse.
  //
  // The guard matters: on mount this effect runs while `selectedId` is still
  // null — the `select()` above has not been committed yet — so without it the
  // mirror wipes the very hash we were asked to open, and loading
  // `#/hook-head` lands on an empty map.
  const mirrored = useRef(false);

  useEffect(() => {
    if (!mirrored.current) {
      mirrored.current = true;
      if (selectedId === null && idFromHash() !== null) return;
    }

    const next = selectedId ? `#/${selectedId}` : '';
    if (window.location.hash === next) return;
    window.history.replaceState(null, '', selectedId ? next : window.location.pathname);
  }, [selectedId]);
}
