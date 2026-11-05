/** Preserve unknown versus a measured zero in every dashboard presentation. */
export function metricNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "N/A"
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
export function metricDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (value < 1000) return `${metricNumber(value)} ms`;
  if (value < 60_000) return `${metricNumber(value / 1000)} s`;
  if (value < 3_600_000) return `${metricNumber(value / 60_000)} min`;
  return `${metricNumber(value / 3_600_000)} h`;
}
export function metricPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "N/A"
    : `${metricNumber(value * 100)}%`;
}
