import { signal } from '@preact/signals';

export interface Season {
  name: string;
  endsAt: number;
  wikiSlug: string;
}

export const currentSeason: Season = {
  name: 'Saison 1',
  endsAt: Date.UTC(2026, 10, 30, 23, 0, 0),
  wikiSlug: 'fin-de-saison',
};

export const now = signal(Date.now());

setInterval(() => {
  now.value = Date.now();
}, 1000);

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownTo(endsAt: number, at: number): Countdown | null {
  const left = endsAt - at;
  if (left <= 0) return null;
  return {
    days: Math.floor(left / 86_400_000),
    hours: Math.floor(left / 3_600_000) % 24,
    minutes: Math.floor(left / 60_000) % 60,
    seconds: Math.floor(left / 1000) % 60,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatCountdown(countdown: Countdown, withSeconds: boolean): string {
  const base = `${countdown.days} j ${pad(countdown.hours)} h`;
  return withSeconds ? `${base} ${pad(countdown.minutes)} min ${pad(countdown.seconds)} s` : base;
}
