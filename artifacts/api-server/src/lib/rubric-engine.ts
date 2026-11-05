import { createHash } from "node:crypto";
import { FactoryError } from "./factory-engine";

export type Criterion = { id: string; label: string } & (
  | { kind: "score"; min: number; max: number }
  | { kind: "option"; options: string[] }
);
export type Rubric = {
  schemaVersion: 1;
  name: string;
  criteria: Criterion[];
  minimumAudits: number;
};
export type Scores = Record<string, number | string>;
export type Decision = {
  id: string;
  actor: string;
  scores: Scores;
  reason: string;
  privacyReviewed: true;
  kind: "review" | "adjudication";
};
export type Audit = {
  id: string;
  actor: string;
  decisionId: string;
  pass: boolean;
  independentHuman: true;
  scores: Scores;
  reason: string;
};
export type RubricState = {
  status: "pending" | "escalated" | "reviewed";
  quarantined: boolean;
  quarantineReason?: string;
  assignedTo?: string;
  claimToken?: string;
  expiresAt?: string;
  decision?: Decision;
  audits: Audit[];
  contributors: string[];
  escalationReason?: string;
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
export function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new FactoryError(`${name} must contain 1–${max} characters`, 400);
  return value.trim();
}
export function validateRubric(value: unknown): Rubric {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    Object.keys(value).some(
      (k) =>
        !["schemaVersion", "name", "criteria", "minimumAudits"].includes(k),
    )
  )
    throw new FactoryError("Invalid rubric schema version or fields", 400);
  const name = boundedText(value.name, "Rubric name", 120);
  if (
    !Number.isInteger(value.minimumAudits) ||
    Number(value.minimumAudits) < 1 ||
    Number(value.minimumAudits) > 5
  )
    throw new FactoryError(
      "Independent audit minimum must be 1–5 per item",
      400,
    );
  if (
    !Array.isArray(value.criteria) ||
    !value.criteria.length ||
    value.criteria.length > 12
  )
    throw new FactoryError("A rubric needs 1–12 criteria", 400);
  const ids = new Set<string>();
  const criteria = value.criteria.map((c): Criterion => {
    if (!object(c)) throw new FactoryError("Invalid criterion", 400);
    const id = boundedText(c.id, "Criterion ID", 40),
      label = boundedText(c.label, "Criterion label", 240);
    if (
      !/^[a-z][a-z0-9_]*$/.test(id) ||
      ["constructor", "prototype", "__proto__"].includes(id) ||
      ids.has(id)
    )
      throw new FactoryError(
        "Criterion IDs must be unique safe lowercase identifiers",
        400,
      );
    ids.add(id);
    if (
      c.kind === "score" &&
      Object.keys(c).every((k) =>
        ["id", "label", "kind", "min", "max"].includes(k),
      ) &&
      Number.isInteger(c.min) &&
      Number.isInteger(c.max) &&
      Number(c.min) >= 0 &&
      Number(c.max) <= 100 &&
      Number(c.min) < Number(c.max)
    )
      return {
        id,
        label,
        kind: "score",
        min: Number(c.min),
        max: Number(c.max),
      };
    if (
      c.kind === "option" &&
      Object.keys(c).every((k) =>
        ["id", "label", "kind", "options"].includes(k),
      ) &&
      Array.isArray(c.options) &&
      c.options.length >= 2 &&
      c.options.length <= 20
    ) {
      const options = c.options.map((v) => boundedText(v, "Option", 100));
      if (new Set(options).size === options.length)
        return { id, label, kind: "option", options };
    }
    throw new FactoryError(
      "Score bounds must be integers 0–100; options must contain 2–20 unique values",
      400,
    );
  });
  return {
    schemaVersion: 1,
    name,
    criteria,
    minimumAudits: Number(value.minimumAudits),
  };
}
export function validateScores(value: unknown, rubric: Rubric): Scores {
  if (!object(value) || Object.keys(value).length !== rubric.criteria.length)
    throw new FactoryError("Provide exactly one value for each criterion", 400);
  const result: Scores = {};
  for (const c of rubric.criteria) {
    const v = value[c.id];
    if (
      !Object.hasOwn(value, c.id) ||
      (c.kind === "score"
        ? !Number.isInteger(v) || Number(v) < c.min || Number(v) > c.max
        : typeof v !== "string" || !c.options.includes(v))
    )
      throw new FactoryError(`Invalid score for ${c.id}`, 400);
    result[c.id] = v as number | string;
  }
  return result;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const rubricHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const contentHash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
export function independentAuditCount(state: RubricState): number {
  return new Set(
    state.audits
      .filter(
        (a) =>
          a.pass &&
          a.independentHuman &&
          a.decisionId === state.decision?.id &&
          !state.contributors.includes(a.actor) &&
          a.actor !== state.decision?.actor,
      )
      .map((a) => a.actor),
  ).size;
}
export function releaseProblems(
  items: { id: string; state: RubricState; rubric: Rubric }[],
): string[] {
  if (!items.length) return ["Import at least one item before release"];
  return items.flatMap(({ id, state, rubric }) => {
    if (state.quarantined) return [`${id}: quarantined`];
    if (state.status !== "reviewed" || !state.decision?.privacyReviewed)
      return [`${id}: human review/adjudication and privacy review required`];
    if (
      state.audits.some((a) => a.decisionId === state.decision?.id && !a.pass)
    )
      return [`${id}: failed audit requires adjudication and a new audit`];
    return independentAuditCount(state) < rubric.minimumAudits
      ? [`${id}: ${rubric.minimumAudits} independent human audit(s) required`]
      : [];
  });
}
