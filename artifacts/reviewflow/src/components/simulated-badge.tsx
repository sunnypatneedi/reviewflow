export function SimulatedBadge({ mode }: { mode: 'demo' | 'live' }) {
  if (mode !== 'demo') return null;
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-amber-100 text-amber-800 border border-amber-200 uppercase animate-pulse-subtle">
      Simulated
    </span>
  );
}
