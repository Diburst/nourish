/** Storage units: kg for weight, kcal for energy. Display converts. */

export const KG_PER_LB = 0.45359237;
export const KJ_PER_KCAL = 4.184;

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function kcalToKj(kcal: number): number {
  return kcal * KJ_PER_KCAL;
}

export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Convert an incoming weight payload value to kg. unit defaults to the user's display unit. */
export function weightToKg(value: number, unit: 'LB' | 'KG'): number {
  return unit === 'LB' ? lbToKg(value) : value;
}

export function formatWeight(valueKg: number, unit: 'LB' | 'KG'): string {
  return unit === 'LB' ? `${round1(kgToLb(valueKg))} lb` : `${round1(valueKg)} kg`;
}

export function formatEnergy(kcal: number, unit: 'KCAL' | 'KJ'): string {
  return unit === 'KJ' ? `${Math.round(kcalToKj(kcal))} kJ` : `${Math.round(kcal)} kcal`;
}
