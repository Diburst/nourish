import { kgToLb, kcalToKj, round1 } from '@/lib/units';

export function formatDateLong(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateShort(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function displayWeight(valueKg: number, unit: 'LB' | 'KG'): string {
  return unit === 'LB' ? `${round1(kgToLb(valueKg))} lb` : `${round1(valueKg)} kg`;
}

export function weightNumber(valueKg: number, unit: 'LB' | 'KG'): number {
  return unit === 'LB' ? round1(kgToLb(valueKg)) : round1(valueKg);
}

export function displayEnergy(kcal: number, unit: 'KCAL' | 'KJ'): string {
  return unit === 'KJ' ? `${Math.round(kcalToKj(kcal))} kJ` : `${Math.round(kcal)} kcal`;
}

export function energyNumber(kcal: number, unit: 'KCAL' | 'KJ'): number {
  return unit === 'KJ' ? Math.round(kcalToKj(kcal)) : Math.round(kcal);
}

export function energyUnitLabel(unit: 'KCAL' | 'KJ'): string {
  return unit === 'KJ' ? 'kJ' : 'kcal';
}
