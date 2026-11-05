/** Bounded transport and typed primitives shared by both Jev adapters. */
export async function readProviderJson(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        throw new Error("Response exceeds limit");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

export function validProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function validDistribution(
  value: any,
  keys: readonly string[],
): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) => Object.hasOwn(value, key) && validProbability(value[key]),
    ) &&
    Math.abs(keys.reduce((sum, key) => sum + value[key], 0) - 1) <= 0.02
  );
}

export function validChoice(answer: any, keys: readonly string[]): boolean {
  return (
    keys.includes(answer?.choice) &&
    validProbability(answer?.confidence) &&
    validDistribution(answer?.probabilities, keys) &&
    keys.every(
      (key) => answer.probabilities[answer.choice] >= answer.probabilities[key],
    )
  );
}

export function validMetadata(raw: any): boolean {
  // Usage may be unavailable. Never invent it or coerce malformed counters.
  return (
    typeof raw?.model === "string" &&
    raw.model.trim().length > 0 &&
    (raw.usage == null ||
      (typeof raw.usage === "object" &&
        !Array.isArray(raw.usage) &&
        [raw.usage.input_tokens, raw.usage.output_tokens].every(
          (value) =>
            value == null || (Number.isSafeInteger(value) && value >= 0),
        )))
  );
}
