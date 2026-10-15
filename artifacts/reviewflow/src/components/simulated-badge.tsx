export function SimulatedBadge({ mode }: { mode: "demo" | "live" }) {
  if (mode !== "demo") return null;
  return (
    <span
      className="inline-flex items-center h-6 rounded-full px-2.5 text-caption font-medium bg-warn-wash text-warn"
      title="Proposal mode: demo. Output comes from the simulator, not a live model."
    >
      Simulated
    </span>
  );
}
