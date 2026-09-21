// Authored scripted fixture. These are not claims of actual model execution.
const context = {
  complete: true,
  messages: [
    { role: "system", content: "Answer only from the provided observation. Do not run tools." },
    { role: "user", content: "The local fixture reports: file_count=3. How many files were observed?" },
  ],
  tools: [],
  parameters: {},
};

export const traceSample = {
  schemaVersion: 1,
  runs: [
    {
      id: "synthetic-scripted-count-a", scenarioId: "synthetic-file-count", groupId: "synthetic-file-count-family",
      task: "Report the observed file count", decisionPoint: "answer-1", context,
      response: "The provided observation reports 3 files.",
      events: [{ id: "fixture-observation", type: "observation", content: "Scripted fixture text: file_count=3; no filesystem scan executed." }],
      provenance: { source: "ReviewFlow authored synthetic fixture", capture: "scripted; not a real model run" },
      candidateIdentity: "scripted-response-one", kind: "scripted",
    },
    {
      id: "synthetic-scripted-count-b", scenarioId: "synthetic-file-count", groupId: "synthetic-file-count-family",
      task: "Report the observed file count", decisionPoint: "answer-1", context,
      response: "The provided observation reports 5 files.",
      events: [{ id: "fixture-observation", type: "observation", content: "Scripted fixture text: file_count=3; no filesystem scan executed." }],
      provenance: { source: "ReviewFlow authored synthetic fixture", capture: "scripted; not a real model run" },
      candidateIdentity: "scripted-response-two", kind: "scripted",
    },
    {
      id: "synthetic-partial-telemetry", scenarioId: "synthetic-telemetry-only", groupId: "synthetic-telemetry-family",
      task: "Partial telemetry without a captured decision context", decisionPoint: "unknown",
      events: [{ id: "partial-event", type: "observation", content: "Authored example of incomplete telemetry; no security event was executed." }],
      provenance: { source: "ReviewFlow authored partial fixture" }, kind: "telemetry",
    },
  ],
};