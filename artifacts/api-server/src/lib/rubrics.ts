import { FactoryError } from "./factory-engine";
import {
  canonical,
  contentHash,
  rubricHash,
  validateRubric,
  validateScores,
  type Audit,
  type Decision,
  type RubricState,
} from "./rubric-engine";

type RecordRow = {
  id: string;
  kind: string;
  itemId: string | null;
  actor: string;
  payload: unknown;
};
type ItemRow = {
  id: string;
  rubricId: string;
  content: string;
  contentHash: string;
  version: number;
  state: unknown;
};
type SpecRow = { id: string; hash: string; definition: unknown };
/** Release reads immutable decision lineage, not just the mutable queue projection. */
export function verifyRubricLineage(
  item: ItemRow,
  spec: SpecRow,
  records: RecordRow[],
): RubricState {
  const fail = (): never => {
    throw new FactoryError(
      `Release blocked: ${item.id} has missing or inconsistent immutable provenance`,
    );
  };
  const state = item.state as RubricState;
  const rubric = validateRubric(spec.definition);
  if (
    item.rubricId !== spec.id ||
    contentHash(item.content) !== item.contentHash ||
    rubricHash(rubric) !== spec.hash ||
    !state.decision
  )
    return fail();
  const imports = records.filter((r) => r.kind === "import");
  if (
    !imports.some((r) => {
      const p = r.payload as any;
      return (
        p.rubricId === spec.id &&
        p.rubricHash === spec.hash &&
        Array.isArray(p.items) &&
        p.items.some(
          (i: any) => i.id === item.id && i.contentHash === item.contentHash,
        )
      );
    })
  )
    return fail();
  const source = records.filter((r) => r.itemId === item.id);
  const decisions = source.filter((r) =>
    ["review", "adjudication"].includes(r.kind),
  );
  const finalized = decisions.filter((r) => (r.payload as any).scores);
  const last = finalized.sort(
    (a, b) =>
      Number((b.payload as any).sourceVersion) -
      Number((a.payload as any).sourceVersion),
  )[0];
  if (!last || last.id !== state.decision.id) return fail();
  const p = last.payload as any;
  if (
    last.kind === "adjudication" &&
    source.some(
      (r) =>
        r.id !== last.id &&
        r.actor === last.actor &&
        ["review", "adjudication", "audit"].includes(r.kind) &&
        (r.payload as any).sourceVersion < p.sourceVersion,
    )
  )
    return fail();
  const validIdentity = (payload: any) =>
    payload.rubricId === spec.id &&
    payload.rubricHash === spec.hash &&
    payload.contentHash === item.contentHash &&
    Number.isInteger(payload.sourceVersion) &&
    payload.sourceVersion > 0 &&
    payload.sourceVersion < item.version;
  if (
    !validIdentity(p) ||
    p.actor !== last.actor ||
    p.privacyReviewed !== true ||
    p.kind !== last.kind
  )
    return fail();
  const scores = validateScores(p.scores, rubric);
  const decision: Decision = {
    id: last.id,
    actor: last.actor,
    scores,
    reason: p.reason,
    privacyReviewed: true,
    kind: last.kind as Decision["kind"],
  };
  if (canonical(state.decision) !== canonical(decision)) return fail();
  if (
    decisions.some(
      (r) =>
        (r.payload as any).action === "escalate" &&
        (r.payload as any).sourceVersion > p.sourceVersion,
    )
  )
    return fail();
  const contributors = [...new Set(decisions.map((r) => r.actor))];
  const audits: Audit[] = source
    .filter((r) => r.kind === "audit")
    .map((r) => {
      const a = r.payload as any;
      if (
        !validIdentity(a) ||
        a.actor !== r.actor ||
        a.independentHuman !== true
      )
        return fail();
      const checkedScores = validateScores(a.scores, rubric);
      if (
        a.decisionId === last.id &&
        (a.pass !== (canonical(checkedScores) === canonical(scores)) ||
          contributors.includes(r.actor))
      )
        return fail();
      return {
        id: r.id,
        actor: r.actor,
        decisionId: a.decisionId,
        pass: a.pass,
        independentHuman: true,
        scores: checkedScores,
        reason: a.reason,
      };
    });
  const byId = (a: Audit, b: Audit) => a.id.localeCompare(b.id);
  if (
    canonical([...audits].sort(byId)) !==
    canonical([...state.audits].sort(byId))
  )
    return fail();
  const quarantine = source
    .filter((r) => r.kind === "quarantine")
    .sort(
      (a, b) =>
        Number((b.payload as any).sourceVersion) -
        Number((a.payload as any).sourceVersion),
    )[0];
  if (
    state.quarantined !==
    (quarantine ? (quarantine.payload as any).quarantined : false)
  )
    return fail();
  return { ...state, decision, audits, contributors };
}
