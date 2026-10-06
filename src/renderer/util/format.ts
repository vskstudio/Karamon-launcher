const NUMBER = new Intl.NumberFormat('fr-FR');
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(Math.round(bytes / 1024))} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatShortDate(ts: number): string {
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('fr-FR', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dayLabel(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  return formatShortDate(ts);
}

export function formatDayTime(ts: number): string {
  return `${dayLabel(ts)}, ${formatTime(ts)}`;
}

export function formatDuration(ms: number): string {
  if (!ms) return '0 min';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m.toString().padStart(2, '0')}`;
}

export function formatRelative(ts: number | null, now = Date.now()): string {
  if (!ts) return 'Jamais';
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'À l’instant';
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Il y a ${d} j`;
  return formatShortDate(ts);
}

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
