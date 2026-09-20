/**
 * Station photographs.
 *
 * These are the images the tower profiles were authored from, so showing them
 * alongside the 3D model lets a reader check our work — which matters more here
 * than it might elsewhere, given Rule 6.
 *
 * Served from irishlights.ie rather than self-hosted (TD-6). They are lazily
 * loaded and individually fault-tolerant: a photo that fails removes itself
 * rather than leaving a broken frame in the strip.
 */

import { useEffect, useState } from 'react';

interface Props {
  photos: string[];
  name: string;
}

export function StationPhotos({ photos, name }: Props) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  // Reset when switching station, or the previous station's failures persist.
  useEffect(() => {
    setFailed(new Set());
    setOpen(null);
  }, [photos]);

  const visible = photos.filter((url) => !failed.has(url));
  if (visible.length === 0) return null;

  return (
    <div className="border-t border-graticule px-5 py-5 sm:px-6">
      <h3 className="chart-figure text-paper-faint uppercase">
        Photographs ({visible.length})
      </h3>

      <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto pb-1">
        {visible.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(url)}
            className="shrink-0 overflow-hidden rounded-sm border border-graticule transition-colors hover:border-brass-dim"
            aria-label={`View photograph of ${name}`}
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-20 w-28 object-cover"
              onError={() => setFailed((prev) => new Set(prev).add(url))}
            />
          </button>
        ))}
      </div>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/92 p-6"
          onClick={() => setOpen(null)}
          aria-label="Close photograph"
        >
          <img
            src={open}
            alt={`${name} lighthouse`}
            className="max-h-full max-w-full rounded-sm object-contain"
          />
        </button>
      ) : null}

      <p className="chart-figure mt-2 text-paper-faint">Photographs © Irish Lights</p>
    </div>
  );
}
