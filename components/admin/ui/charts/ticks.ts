/**
 * "Nice" axis ticks on a 1-2-5 step.
 *
 * Local copy of `niceTicks` from `lib/generation/figures/chart.ts`: admin code
 * must not import the generation engine (it would pull server-side modules
 * into the admin bundle). Keep the two in sync if the algorithm ever changes.
 */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; lo: number; hi: number } {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { ticks, lo, hi };
}
