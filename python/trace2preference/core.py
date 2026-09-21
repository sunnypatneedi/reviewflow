"""Canonical comparisons preserve observations, not inferred agent internals."""
import copy
import hashlib
import itertools
import json
import math
from collections import Counter, defaultdict

OUTCOMES = ("a", "b", "tie", "both_unacceptable", "insufficient_evidence", "escalation")
REFERENCE_KEYS = {"referenceanswer", "referenceanswers", "groundtruth", "goldanswer",
                  "goldanswers", "expectedanswer", "expectedanswers", "humandecision",
                  "humandecisions", "priorjudgment", "priorjudgement"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def identifier(value):
    return isinstance(value, str) and 0 < len(value) <= 256


def context_known(context):
    return (isinstance(context, dict) and context.get("complete") is True
            and isinstance(context.get("messages"), list) and len(context["messages"]) > 0
            and all(isinstance(m, dict) and identifier(m.get("role"))
                    and isinstance(m.get("content"), str) for m in context["messages"])
            and isinstance(context.get("tools"), list)
            and isinstance(context.get("parameters"), dict))


def contains_reference(value):
    """Conservative structured-field guard, not a semantic free-text detector."""
    if isinstance(value, dict):
        return any("".join(c for c in key.lower() if c.isalnum()) in REFERENCE_KEYS
                   or contains_reference(child) for key, child in value.items())
    if isinstance(value, list):
        return any(contains_reference(child) for child in value)
    return False


def validate(data):
    if data.get("schemaVersion") != 1 or isinstance(data.get("schemaVersion"), bool):
        raise ValueError("schemaVersion must be 1")
    runs = data.get("runs")
    if not isinstance(runs, list) or len(runs) > 500:
        raise ValueError("runs must be an array of at most 500 runs")
    if len(canonical(data).encode()) > 8 * 1024 * 1024:
        raise ValueError("input exceeds 8 MiB")
    issues, groups, flags = [], defaultdict(list), {}
    for index, run in enumerate(runs):
        if not isinstance(run, dict):
            raise ValueError("each run must be an object")
        for key in ("id", "scenarioId", "groupId", "decisionPoint"):
            if not identifier(run.get(key)):
                raise ValueError(f"run {index}: {key} must be a nonempty string <=256 chars")
        if not isinstance(run.get("task"), str):
            raise ValueError(f"run {index}: task must be a string")
        if run.get("kind") not in ("scripted", "real_model", "telemetry"):
            raise ValueError(f"run {index}: unsupported kind")
        if not isinstance(run.get("events", []), list) or not isinstance(run.get("provenance", {}), dict):
            raise ValueError(f"run {index}: invalid events or provenance")
        if run.get("response") is not None and not isinstance(run["response"], str):
            raise ValueError(f"run {index}: response must be string or null")
        reasons = []
        if not context_known(run.get("context")):
            reasons.append("context_incomplete")
        if not isinstance(run.get("response"), str) or not run["response"].strip():
            reasons.append("response_missing")
        if run["kind"] == "telemetry":
            reasons.append("telemetry_only")
        trajectory_markers = {str(run.get(key, "")).lower().replace("-", "_").replace(" ", "_")
                              for key in ("decisionPoint", "comparisonType", "scope")}
        if trajectory_markers & {"trajectory", "whole_trajectory", "full_trajectory"}:
            reasons.append("whole_trajectory_unsupported")
        if contains_reference(run):
            reasons.append("reference_material_present")
        flags[index] = reasons
        groups[(run["scenarioId"], run["decisionPoint"])].append(index)
    counts = Counter(r["id"] for r in runs)
    for index, run in enumerate(runs):
        if counts[run["id"]] > 1:
            flags[index].append("duplicate_run_id")
        issues.extend({"runId": run["id"], "code": code} for code in flags[index])
    comparisons = []
    def side(run):
        if run is None:
            return None
        return {"runId": run["id"], **{k: copy.deepcopy(run.get(k)) for k in
                ("response", "events", "provenance", "candidateIdentity", "kind")}}
    for key in sorted(groups):
        indexes = sorted(groups[key], key=lambda i: (runs[i]["id"], i))
        pairs = [(indexes[0], None)] if len(indexes) == 1 else itertools.combinations(indexes, 2)
        for ia, ib in pairs:
            if len(comparisons) >= 2000:
                raise ValueError("more than 2000 comparisons; partition the import")
            a, b = runs[ia], runs[ib] if ib is not None else None
            reasons = list(flags[ia])
            if b is None:
                reasons.append("counterpart_missing")
            else:
                reasons += flags[ib]
                if a["groupId"] != b["groupId"]:
                    reasons.append("group_mismatch")
                if a["task"] != b["task"]:
                    reasons.append("task_mismatch")
                if canonical(a.get("context")) != canonical(b.get("context")):
                    reasons.append("context_mismatch")
                if isinstance(a.get("response"), str) and a.get("response") == b.get("response"):
                    reasons.append("duplicate_response")
            reasons = sorted(set(reasons))
            comparisons.append({
                "id": digest([key, a["id"], b["id"] if b else None]),
                "scenarioId": a["scenarioId"], "groupId": a["groupId"], "task": a["task"],
                "decisionPoint": a["decisionPoint"], "context": copy.deepcopy(a.get("context")),
                "contextHash": digest(a["context"]) if context_known(a.get("context")) else None,
                "a": side(a), "b": side(b), "eligible": not reasons, "reasons": reasons})
    return {"schemaVersion": 1, "runs": copy.deepcopy(runs), "comparisons": comparisons, "issues": issues,
            "eligibilityBasis": "Structurally matching exporter-attested complete context; capture completeness is not independently verified."}


def checked_validation(data):
    validation = data.get("validation")
    if not isinstance(validation, dict):
        raise ValueError("validation is required")
    # Recompute eligibility rather than trusting editable comparison flags.
    return validate({"schemaVersion": 1, "runs": validation.get("runs")})


def export_dataset(data):
    validation = checked_validation(data)
    salt = data.get("salt")
    if not isinstance(salt, str) or not salt:
        raise ValueError("nonempty salt required")
    def pseudonym(value):
        return digest([salt, value])[:24]
    decisions = defaultdict(list)
    for d in data.get("decisions", []):
        decisions[d["comparisonId"]].append(d)
    complete, training = [], []
    for comparison in validation["comparisons"]:
        c = copy.deepcopy(comparison)
        ds = decisions[c["id"]]
        decision = ds[0] if len(ds) == 1 else None
        reasons = list(c["reasons"])
        if len(ds) > 1:
            reasons.append("competing_decisions")
        if decision is None or decision.get("finalized") is not True:
            reasons.append("human_unresolved")
        if decision and decision.get("qualityChecksPassed") is not True:
            reasons.append("quality_checks_unresolved")
        if decision and decision.get("reviewMode") not in ("human_only", "model_assisted"):
            reasons.append("review_mode_missing")
        outcome = decision.get("outcome") if decision else None
        if outcome not in ("a", "b"):
            reasons.append("nonbinary_or_missing_decision")
        # Never publish arbitrary imported identity/provenance attributes. Their
        # digest preserves correlation to the private source retained by importer.
        c["id"] = pseudonym(c["id"])
        c["scenarioId"] = pseudonym(c["scenarioId"])
        c["groupId"] = pseudonym(c["groupId"])
        for side in ("a", "b"):
            if c[side]:
                c[side]["runId"] = pseudonym(c[side]["runId"])
                c[side].pop("candidateIdentity", None)
                c[side]["provenance"] = {"sourceDigest": pseudonym(c[side].get("provenance"))}
        split_bucket = int(digest([salt, comparison["groupId"]])[:8], 16) % 100
        c["split"] = "train" if split_bucket < 80 else "validation" if split_bucket < 90 else "test"
        c["decision"] = None if decision is None else {
            k: copy.deepcopy(decision[k]) for k in
            ("outcome", "finalized", "reviewMode", "qualityChecksPassed", "evidenceReferences")
            if k in decision}
        if decision is not None:
            references = decision.get("evidenceRefs", decision.get("evidenceReferences", []))
            if not isinstance(references, list) or any(not isinstance(ref, str) for ref in references):
                raise ValueError("evidenceRefs must be an array of strings")
            c["decision"]["evidenceRefs"] = copy.deepcopy(references)
            c["decision"]["evidenceReferences"] = copy.deepcopy(references)
        c["includedInTraining"] = not reasons
        c["exclusionReasons"] = sorted(set(reasons))
        complete.append(c)
        if not reasons:
            preferred = c[outcome]
            rejected = c["b" if outcome == "a" else "a"]
            training.append({"id": c["id"], "groupId": c["groupId"], "split": c["split"],
                             "prompt": c["context"]["messages"], "context": c["context"],
                             "chosen": preferred["response"], "rejected": rejected["response"],
                             "decision": c["decision"]})
    return {"schemaVersion": 1, "complete": complete, "training": training,
            "summary": {"total": len(complete), "included": len(training),
                        "excluded": len(complete) - len(training)},
            "privacyNotice": "Identifiers are pseudonymized. Review free text and events for private data before sharing."}


LS_CHOICES = {"A preferred": "a", "B preferred": "b", "Tie": "tie",
              "Both unacceptable": "both_unacceptable", "Insufficient evidence": "insufficient_evidence",
              "Escalation": "escalation"}
LS_CONFIG = ('<View><Header value="Compare actual responses against observable context. '
             'Do not infer hidden reasoning."/><Text name="task" value="$task"/>'
             '<Text name="context" value="$context"/><Header value="Candidate A"/>'
             '<Text name="a" value="$response_a"/><Header value="Candidate B"/>'
             '<Text name="b" value="$response_b"/><Text name="evidence" value="$evidence"/>'
             '<Choices name="preference" toName="a" choice="single" required="true">'
             + "".join(f'<Choice value="{choice}"/>' for choice in LS_CHOICES) + '</Choices></View>')
LS_ASSISTED_CONFIG = LS_CONFIG.replace(
    '<Choices name="preference"',
    '<Choices name="assistance" toName="a" choice="single">'
    '<Choice value="Reveal model proposal"/></Choices>'
    '<View visibleWhen="choice-selected" whenTagName="assistance" whenChoiceValue="Reveal model proposal">'
    '<Header value="Model proposal, not a human decision or accuracy estimate"/>'
    '<Text name="proposal" value="$proposal"/></View><Choices name="preference"')


def labelstudio(data):
    validation = checked_validation(data)
    condition = data.get("condition", "human_only")
    if condition not in ("human_only", "model_assisted"):
        raise ValueError("condition must be human_only or model_assisted")
    tasks, manifest = [], []
    proposals = {p["comparisonId"]: p for p in data.get("proposals", [])}
    for c in validation["comparisons"]:
        if not c["eligible"]:
            continue
        reverse = int(c["id"][:2], 16) % 2 == 1
        mapping = {"a": "b" if reverse else "a", "b": "a" if reverse else "b"}
        task_id = len(tasks) + 1
        task_data = {"comparison_id": c["id"], "task": c["task"],
                     "context": canonical(c["context"]),
                     "response_a": c[mapping["a"]]["response"], "response_b": c[mapping["b"]]["response"],
                     "evidence": canonical({"a": c[mapping["a"]]["events"], "b": c[mapping["b"]]["events"]})}
        if condition == "model_assisted":
            proposal = proposals.get(c["id"])
            if proposal and proposal.get("outcome") in OUTCOMES:
                outcome = proposal["outcome"]
                display_outcome = next((display for display, actual in mapping.items() if actual == outcome), outcome)
                # Strict allowlist: no generated explanation, response replacement,
                # confidence-as-accuracy, reference answer or reviewer identity.
                task_data["proposal"] = canonical({"outcome": display_outcome,
                    "provider": str(proposal.get("provider", "unspecified")),
                    "simulated": proposal.get("simulated") is True})
            else:
                task_data["proposal"] = "Unavailable: no typed model proposal supplied."
        tasks.append({"id": task_id, "data": task_data})
        manifest.append({"taskId": task_id, "comparisonId": c["id"], "groupId": c["groupId"],
                         "displayMap": mapping, "taskDataHash": digest(tasks[-1]["data"]),
                         "condition": condition})
    return {"config": LS_ASSISTED_CONFIG if condition == "model_assisted" else LS_CONFIG,
            "condition": condition, "tasks": tasks, "manifest": manifest,
            "manifestNotice": "Private reconciliation metadata; distribute only tasks and config to reviewers.",
            "assistanceNotice": "Conditional UI reveal is recorded, not a security boundary: assisted task JSON contains the proposal."}


def reconcile(data):
    manifest = {m["comparisonId"]: m for m in data["manifest"]}
    if len(manifest) != len(data["manifest"]):
        raise ValueError("manifest contains duplicate comparisons")
    for m in manifest.values():
        if m.get("displayMap") not in ({"a": "a", "b": "b"}, {"a": "b", "b": "a"}):
            raise ValueError("manifest displayMap must be a canonical permutation")
        if m.get("condition", "human_only") not in ("human_only", "model_assisted"):
            raise ValueError("invalid manifest condition")
    decisions, issues, seen = [], [], set()
    task_counts = Counter(t.get("data", {}).get("comparison_id") for t in data["annotations"])
    for task in data["annotations"]:
        tid = task.get("id")
        cid = task.get("data", {}).get("comparison_id")
        m = manifest.get(cid)
        reason = None
        if not m or cid in seen or task_counts[cid] > 1:
            reason = "unknown_or_duplicate_task"
        elif digest(task.get("data")) != m["taskDataHash"]:
            reason = "task_data_changed"
        seen.add(cid)
        annotations = task.get("annotations", [])
        if not reason and (len(annotations) != 1 or annotations[0].get("was_cancelled")):
            reason = "missing_or_competing_annotations"
        if reason:
            issues.append({"taskId": tid, "code": reason})
            continue
        results = [r for r in annotations[0].get("result", [])
                   if r.get("from_name") == "preference" and r.get("to_name") == "a" and r.get("type") == "choices"]
        choices = results[0].get("value", {}).get("choices", []) if len(results) == 1 else []
        if len(choices) != 1 or choices[0] not in LS_CHOICES:
            issues.append({"taskId": tid, "code": "invalid_choice"})
            continue
        outcome = LS_CHOICES[choices[0]]
        if outcome in ("a", "b"):
            outcome = m["displayMap"][outcome]
        reveals = [r for r in annotations[0].get("result", []) if r.get("from_name") == "assistance"]
        assisted = False
        if reveals:
            if (m.get("condition", "human_only") != "model_assisted" or len(reveals) != 1
                or reveals[0].get("to_name") != "a" or reveals[0].get("type") != "choices"
                or reveals[0].get("value", {}).get("choices") not in ([], ["Reveal model proposal"])):
                issues.append({"taskId": tid, "code": "invalid_assisted_reveal"})
                continue
            assisted = bool(reveals[0]["value"]["choices"])
        decisions.append({"comparisonId": m["comparisonId"], "outcome": outcome, "finalized": False,
                          "qualityChecksPassed": False, "reviewMode": "model_assisted" if assisted else "human_only",
                          "assignedCondition": m.get("condition", "human_only"), "assistedReveal": assisted,
                          "interface": "labelstudio", "sourceAnnotationId": annotations[0].get("id")})
    duplicate_ids = {d["comparisonId"] for d in decisions
                     if sum(x["comparisonId"] == d["comparisonId"] for x in decisions) > 1}
    if duplicate_ids:
        decisions = [d for d in decisions if d["comparisonId"] not in duplicate_ids]
        issues.extend({"comparisonId": cid, "code": "competing_decisions"} for cid in duplicate_ids)
    return {"decisions": decisions, "issues": issues}


def assign(data):
    conditions = data.get("conditions", ["rf_human", "rf_assisted", "ls_human", "ls_assisted"])
    if not conditions or len(set(conditions)) != len(conditions):
        raise ValueError("conditions must be nonempty and unique")
    groups = defaultdict(list)
    for c in data["comparisons"]:
        if c.get("eligible"):
            groups[c["groupId"]].append(c["id"])
    assignments = []
    for ri, reviewer in enumerate(sorted(set(data["reviewers"]))):
        for gi, group in enumerate(sorted(groups)):
            choices = sorted(set(groups[group]))
            assignments.append({"reviewerId": reviewer, "groupId": group,
                                "comparisonId": choices[(ri + gi) % len(choices)],
                                "condition": conditions[(ri + gi) % len(conditions)]})
    return {"assignments": assignments}


def analyze(data):
    groups = defaultdict(list)
    for record in data["records"]:
        if record.get("interface") not in ("reviewflow", "labelstudio") or record.get("reviewMode") not in ("human_only", "model_assisted"):
            raise ValueError("each record must identify interface and reviewMode")
        groups[(record["interface"], record["reviewMode"])].append(record)
    summaries = []
    genuine = [r for r in data["records"] if r.get("measurementOrigin") == "genuine_human"]
    for (interface, mode), records in sorted(groups.items()):
        result = {"interface": interface, "reviewMode": mode, "records": len(records),
                  "genuineHumanRecords": sum(r.get("measurementOrigin") == "genuine_human" for r in records)}
        for field in ("activeMs", "waitingMs", "serviceMs", "correctionMs", "auditMs"):
            values = [r[field] for r in records if isinstance(r.get(field), (float, int))
                      and not isinstance(r.get(field), bool) and math.isfinite(r[field]) and r[field] >= 0]
            result[field] = {"measured": len(values), "missing": len(records) - len(values),
                             "total": sum(values) if values else None,
                             "mean": sum(values) / len(values) if values else None}
        summaries.append(result)
    # These optional estimates require explicitly attested genuine human data.
    # A reference is separate benchmark metadata, never provider input.
    accuracy_records = [r for r in genuine if r.get("outcome") in OUTCOMES
                        and r.get("referenceOutcome") in OUTCOMES and identifier(r.get("referenceSource"))]
    accuracy = ({"correct": sum(r["outcome"] == r["referenceOutcome"] for r in accuracy_records),
                 "count": len(accuracy_records),
                 "fraction": sum(r["outcome"] == r["referenceOutcome"] for r in accuracy_records) / len(accuracy_records)}
                if accuracy_records else None)
    paired = defaultdict(list)
    for r in genuine:
        if identifier(r.get("reviewerId")) and identifier(r.get("comparisonId")) and r.get("outcome") in OUTCOMES:
            paired[(r["interface"], r["reviewMode"], r["comparisonId"])].append(r)
    pairs = []
    for rs in paired.values():
        counts = Counter(r["reviewerId"] for r in rs)
        unique = [r for r in rs if counts[r["reviewerId"]] == 1]
        pairs.extend(a["outcome"] == b["outcome"] for a, b in itertools.combinations(unique, 2))
    agreement = ({"agreeingPairs": sum(pairs), "pairs": len(pairs),
                  "fraction": sum(pairs) / len(pairs), "method": "unweighted pairwise exact agreement within condition"}
                 if pairs else None)
    return {"conditions": summaries, "accuracy": accuracy, "agreement": agreement, "savings": None,
            "note": "Descriptive only. Genuine-human origin and reference provenance are caller attestations, not independently verified. No causal savings estimate."}


COMMANDS = {"validate": validate, "export": export_dataset, "labelstudio": labelstudio,
            "reconcile": reconcile, "assign": assign, "analyze": analyze}