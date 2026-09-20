/**
 * Chart controls: what is lit, and how fast time runs.
 *
 * The speed control is the one that earns its place. At 1x the coast is a slow,
 * mostly-dark scatter; at 60x the whole network pulses at once and you can
 * actually see that Fastnet, Hook Head and Tuskar are keeping different time.
 */

import { setRate } from '../lib/clock';
import { ALL_COASTS, type Coast, useApp } from '../state/store';
import { Legend } from './Legend';

const RATES = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '60×', value: 60 },
];

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        // 44px minimum on coarse pointers (WCAG 2.5.5); 32px is fine for a
        // mouse and keeps the chart from being swamped by chrome on desktop.
        'chart-figure flex min-h-11 items-center rounded-sm border px-3 uppercase transition-colors sm:min-h-8',
        active
          ? 'border-brass/70 bg-brass/15 text-brass'
          : 'border-edge bg-ink-900/70 text-paper-faint hover:text-paper-dim',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function MapControls() {
  const {
    rate,
    coasts,
    reduceMotion,
    motionOverride,
    setRate: setStoreRate,
    setMotionOverride,
    toggleCoast,
  } = useApp();

  const changeRate = (value: number) => {
    setStoreRate(value);
    setRate(value);
  };

  return (
    // In normal flow, not absolutely positioned: the parent column places it
    // below the masthead on a phone and beside it on a wider screen.
    <div className="pointer-events-auto flex flex-wrap gap-1.5 sm:flex-col sm:items-end sm:gap-3">
      <div className="flex gap-1.5">
        {RATES.map((option) => (
          <Chip
            key={option.value}
            active={rate === option.value}
            onClick={() => changeRate(option.value)}
            title={option.value === 1 ? 'Real time' : `${option.value} times real time`}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex gap-1.5">
        {ALL_COASTS.map((coast: Coast) => (
          <Chip
            key={coast}
            active={coasts.has(coast)}
            onClick={() => toggleCoast(coast)}
            title={`${coast} coast`}
          >
            {coast.slice(0, 1)}
          </Chip>
        ))}
      </div>

      {/* Shown only to viewers whose system asks for reduced motion. The lights
          are held steady for them by default; this offers the rhythms back
          rather than deciding on their behalf that they cannot have them. */}
      {reduceMotion ? (
        <Chip
          active={motionOverride}
          onClick={() => setMotionOverride(!motionOverride)}
          title="Your system asks for reduced motion, so the lights are held steady. Turn this on to see them blink."
        >
          {motionOverride ? 'Blinking on' : 'Blinking off'}
        </Chip>
      ) : null}

      <Legend />
    </div>
  );
}
