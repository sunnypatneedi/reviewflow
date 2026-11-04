import { useState } from "react";
import { projectHeaders } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

type Advice = {
  effectiveLane: string;
  recommendedLane: string;
  source: string;
  latencyMs: number;
  fallback: string | null;
};
export function RoutingAdvice({
  taskId,
  version,
}: {
  taskId: string;
  version: number;
}) {
  const [provider, setProvider] = useState("rules");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState("");
  async function preview() {
    setBusy(true);
    setError("");
    setAdvice(null);
    try {
      const response = await fetch(
        `/api/reviewflow/tasks/${encodeURIComponent(taskId)}/routing-advice`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            ...projectHeaders(),
            "Content-Type": "application/json",
            "x-reviewflow-csrf": "1",
          },
          body: JSON.stringify({
            provider,
            expectedVersion: version,
            allowOutbound: approved,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Routing unavailable");
      setAdvice(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Routing unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-medium">Routing preview</summary>
      <div className="pt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Policy rules control the lane. Optional model advice can suggest
          escalation; it never submits a review or accepts an item. Provider
          quality is unqualified.
        </p>
        <label className="block text-sm">
          Routing source
          <select
            className="border rounded p-2 block mt-1"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setAdvice(null);
              setApproved(false);
            }}
          >
            <option value="rules">Policy rules · no provider call</option>
            <option value="simulator">
              Synthetic simulator · no provider call
            </option>
            <option value="jev">
              Jev · requires project approval & call budget
            </option>
          </select>
        </label>
        {provider === "jev" && (
          <label className="flex gap-2 text-sm items-start">
            <input
              type="checkbox"
              className="mt-1"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve sending this question, evidence and candidate answer to
            Jev. One potentially billed attempt; two-second provider deadline,
            no retries.
          </label>
        )}
        <Button
          variant="outline"
          disabled={busy || (provider === "jev" && !approved)}
          onClick={preview}
        >
          {busy ? "Checking route…" : "Preview routing"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {advice && (
          <div role="status" className="text-sm space-y-1">
            <p>
              Policy lane:{" "}
              <strong>{advice.effectiveLane.replaceAll("_", " ")}</strong> ·
              Suggested lane:{" "}
              <strong>{advice.recommendedLane.replaceAll("_", " ")}</strong>
            </p>
            <p className="text-muted-foreground">
              {advice.source} · {advice.latencyMs} ms observed for this request
              {advice.fallback
                ? " · Provider unavailable; policy fallback used"
                : ""}
              . No change applied.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
