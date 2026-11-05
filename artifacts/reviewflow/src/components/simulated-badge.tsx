export function SimulatedBadge({ mode }: { mode: "demo" | "live" }) {
  if (mode !== "demo") return null;
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] bg-warn-wash text-warn"
      title="Proposal mode: demo"
    >
      Simulated
    </span>
  );
}
