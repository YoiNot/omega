/**
 * @omega/bench — deterministic summary statistics.
 *
 * Pure functions over an array of numbers. No sorting by locale, no float
 * jitter: the median/min/max/mean of the same input are bit-identical across
 * platforms, which is what makes a benchmark result reproducible.
 */

/** Smallest value in `values` (NaN when empty). */
export function min(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] < m) m = values[i];
  return m;
}

/** Largest value in `values` (NaN when empty). */
export function max(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

/** Arithmetic mean of `values` (NaN when empty). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Median of `values`. For an even count we average the two central elements
 * (the standard "mean of middles" median). The array is copied before sorting
 * so the caller's data is never mutated.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}
