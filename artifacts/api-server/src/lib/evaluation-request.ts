import { MODEL, type EvaluationMode } from "../evaluation";
import type { EvaluationConfiguration } from "./evaluation-identity";
import { FactoryError } from "./factory-engine";

/** Public version names must describe an implemented evaluator, not arbitrary labels. */
export function parseEvaluationConfiguration(body: unknown, mode: EvaluationMode): EvaluationConfiguration {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FactoryError("Invalid evaluation configuration", 400);
  const value = body as Record<string, unknown>;
  const supported = { questionVersion: "evidence-v1", contextPreparationVersion: "raw-evidence-v1", requestedModel: mode === "demo" ? "demo-simulator-v1" : MODEL };
  for (const [key, expected] of Object.entries(supported)) {
    if (value[key] !== undefined && value[key] !== expected) throw new FactoryError(`Unsupported ${key}`, 400);
  }
  if (value.experimentRunId !== undefined && (typeof value.experimentRunId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.experimentRunId))) {
    throw new FactoryError("experimentRunId must be 1–128 letters, digits, dots, underscores, colons or hyphens", 400);
  }
  return { ...supported, ...(value.experimentRunId === undefined ? {} : { experimentRunId: value.experimentRunId as string }) };
}
