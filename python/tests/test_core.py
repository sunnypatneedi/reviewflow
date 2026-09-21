import copy
import json
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET

from trace2preference import core


def fixture():
    a = {"id": "run-a", "scenarioId": "scenario", "groupId": "family", "task": "Say hello",
         "decisionPoint": "response-1", "context": {"complete": True,
         "messages": [{"role": "user", "content": "Say hello"}], "tools": [], "parameters": {}},
         "response": "Hello", "events": [{"type": "message", "text": "Say hello"}],
         "provenance": {"source": "synthetic local fixture"}, "candidateIdentity": "script-A", "kind": "scripted"}
    b = copy.deepcopy(a)
    b.update(id="run-b", response="Hi", candidateIdentity="script-B")
    return {"schemaVersion": 1, "runs": [a, b]}


class TraceTests(unittest.TestCase):
    def test_eligible_and_order(self):
        data = fixture()
        result = core.validate(data)
        self.assertTrue(result["comparisons"][0]["eligible"])
        self.assertEqual(result["runs"], data["runs"])
        data["runs"].reverse()
        self.assertEqual(core.validate(data)["comparisons"], result["comparisons"])

    def test_context_mismatch(self):
        data = fixture()
        data["runs"][1]["context"]["messages"][0]["content"] = "Other prompt"
        self.assertIn("context_mismatch", core.validate(data)["comparisons"][0]["reasons"])

    def test_context_extension_matters(self):
        data = fixture()
        data["runs"][0]["context"]["systemMetadata"] = "different"
        self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_context_boolean_not_number(self):
        data = fixture()
        data["runs"][0]["context"]["parameters"]["extra"] = True
        data["runs"][1]["context"]["parameters"]["extra"] = 1
        self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_incomplete(self):
        for mutation in ("missing", "false", "tools", "messages"):
            data = fixture()
            if mutation == "missing":
                del data["runs"][0]["context"]
            elif mutation == "false":
                data["runs"][0]["context"]["complete"] = False
            elif mutation == "messages":
                data["runs"][0]["context"]["messages"] = []
            else:
                del data["runs"][0]["context"]["tools"]
            self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_telemetry(self):
        data = fixture()
        data["runs"][0]["kind"] = "telemetry"
        self.assertIn("telemetry_only", core.validate(data)["comparisons"][0]["reasons"])

    def test_missing_counterpart(self):
        data = fixture()
        data["runs"].pop()
        result = core.validate(data)["comparisons"][0]
        self.assertIsNone(result["b"])
        self.assertIn("counterpart_missing", result["reasons"])

    def test_missing_response_not_synthesized(self):
        data = fixture()
        del data["runs"][0]["response"]
        result = core.validate(data)["comparisons"][0]
        self.assertIsNone(result["a"]["response"])
        self.assertFalse(result["eligible"])

    def test_duplicate_ids(self):
        data = fixture()
        data["runs"][1]["id"] = "run-a"
        self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_duplicate_responses(self):
        data = fixture()
        data["runs"][1]["response"] = "Hello"
        self.assertIn("duplicate_response", core.validate(data)["comparisons"][0]["reasons"])

    def test_task_group_mismatch(self):
        for key in ("task", "groupId"):
            data = fixture()
            data["runs"][1][key] = "other"
            self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_trajectory(self):
        data = fixture()
        for r in data["runs"]:
            r["decisionPoint"] = "whole_trajectory"
        self.assertFalse(core.validate(data)["comparisons"][0]["eligible"])

    def test_trajectory_metadata(self):
        for key in ("comparisonType", "scope"):
            data = fixture()
            data["runs"][0][key] = "full-trajectory"
            self.assertIn("whole_trajectory_unsupported", core.validate(data)["comparisons"][0]["reasons"])

    def test_nested_reference_fields(self):
        for field in ("reference_answer", "groundTruth", "humanDecision"):
            data = fixture()
            data["runs"][0]["context"]["parameters"]["nested"] = [{"other": {field: "must not leak"}}]
            result = core.validate(data)
            self.assertIn("reference_material_present", result["comparisons"][0]["reasons"])
            self.assertEqual(result["runs"], data["runs"])

    def test_invalid_envelopes(self):
        for data in ({}, {"schemaVersion": True, "runs": []}, {"schemaVersion": 1, "runs": "bad"}):
            with self.assertRaises(ValueError):
                core.validate(data)

    def test_bound(self):
        data = fixture()
        data["runs"] = data["runs"] * 251
        with self.assertRaises(ValueError):
            core.validate(data)

    def export_args(self, outcome="a"):
        validation = core.validate(fixture())
        return {"validation": validation, "salt": "test-project", "decisions": [
            {"comparisonId": validation["comparisons"][0]["id"], "outcome": outcome,
             "finalized": True, "qualityChecksPassed": True, "reviewMode": "human_only"}]}

    def test_training_and_privacy(self):
        output = core.export_dataset(self.export_args("b"))
        self.assertEqual(output["training"][0]["chosen"], "Hi")
        self.assertNotIn("script-A", json.dumps(output))
        self.assertEqual(output["complete"][0]["a"]["events"], fixture()["runs"][0]["events"])

    def test_evidence_refs_both_names(self):
        for key in ("evidenceRefs", "evidenceReferences"):
            args = self.export_args()
            args["decisions"][0][key] = ["a:event:0"]
            output = core.export_dataset(args)
            self.assertEqual(output["complete"][0]["decision"]["evidenceRefs"], ["a:event:0"])
            self.assertEqual(output["training"][0]["decision"]["evidenceReferences"], ["a:event:0"])

    def test_nonbinary(self):
        for outcome in core.OUTCOMES[2:]:
            output = core.export_dataset(self.export_args(outcome))
            self.assertEqual(output["training"], [])
            self.assertEqual(output["complete"][0]["decision"]["outcome"], outcome)

    def test_unresolved_checks_and_concurrency(self):
        for field in ("finalized", "qualityChecksPassed"):
            args = self.export_args()
            args["decisions"][0][field] = False
            self.assertEqual(core.export_dataset(args)["training"], [])
        args = self.export_args()
        args["decisions"] *= 2
        self.assertEqual(core.export_dataset(args)["training"], [])

    def test_recomputes_eligibility(self):
        args = self.export_args()
        args["validation"]["runs"][0]["context"]["complete"] = False
        self.assertEqual(core.export_dataset(args)["training"], [])

    def test_group_splits_stable(self):
        args = self.export_args()
        first = core.export_dataset(args)["complete"][0]["split"]
        args["validation"]["runs"][0]["response"] = "A correction to observable response"
        self.assertEqual(core.export_dataset(args)["complete"][0]["split"], first)

    def test_labelstudio_all_outcomes(self):
        kit = core.labelstudio({"validation": core.validate(fixture()),
                               "proposals": [{"comparisonId": "none", "outcome": "b"}]})
        ET.fromstring(kit["config"])
        self.assertNotIn("candidateIdentity", json.dumps(kit["tasks"]))
        self.assertNotIn("proposal", json.dumps(kit["tasks"]))
        for choice, outcome in core.LS_CHOICES.items():
            tasks = copy.deepcopy(kit["tasks"])
            tasks[0]["annotations"] = [{"id": 100, "result": [{"from_name": "preference",
                "to_name": "a", "type": "choices", "value": {"choices": [choice]}}]}]
            result = core.reconcile({"manifest": kit["manifest"], "annotations": tasks})
            expected = kit["manifest"][0]["displayMap"].get(outcome, outcome)
            self.assertEqual(result["decisions"][0]["outcome"], expected)
            self.assertFalse(result["decisions"][0]["finalized"])

    def test_labelstudio_human_no_proposals_anywhere(self):
        validation = core.validate(fixture())
        kit = core.labelstudio({"validation": validation, "condition": "human_only", "proposals": [
            {"comparisonId": validation["comparisons"][0]["id"], "outcome": "a", "explanation": "secret-model-reason"}]})
        self.assertNotIn("secret-model-reason", json.dumps(kit))
        self.assertNotIn('"proposal":', json.dumps(kit))

    def test_labelstudio_assistance_reveal_and_new_task_id(self):
        validation = core.validate(fixture())
        kit = core.labelstudio({"validation": validation, "condition": "model_assisted", "proposals": [
            {"comparisonId": validation["comparisons"][0]["id"], "outcome": "a", "provider": "simulator",
             "simulated": True, "explanation": "must-not-include", "confidence": 1}]})
        ET.fromstring(kit["config"])
        self.assertIn('visibleWhen="choice-selected"', kit["config"])
        self.assertNotIn("must-not-include", json.dumps(kit))
        task = kit["tasks"][0]
        task["id"] = 999999  # LS assigns its own database primary keys at import.
        task["annotations"] = [{"result": [
            {"from_name": "preference", "to_name": "a", "type": "choices", "value": {"choices": ["Tie"]}},
            {"from_name": "assistance", "to_name": "a", "type": "choices", "value": {"choices": ["Reveal model proposal"]}}]}]
        result = core.reconcile({"manifest": kit["manifest"], "annotations": [task]})
        self.assertEqual(result["decisions"][0]["reviewMode"], "model_assisted")
        self.assertTrue(result["decisions"][0]["assistedReveal"])
        task["annotations"][0]["result"].pop()
        result = core.reconcile({"manifest": kit["manifest"], "annotations": [task]})
        self.assertEqual(result["decisions"][0]["reviewMode"], "human_only")
        self.assertEqual(result["decisions"][0]["assignedCondition"], "model_assisted")

    def test_manifest_invalid_order(self):
        kit = core.labelstudio({"validation": core.validate(fixture())})
        kit["manifest"][0]["displayMap"] = {"a": "a", "b": "a"}
        with self.assertRaises(ValueError):
            core.reconcile({"manifest": kit["manifest"], "annotations": []})

    def test_labelstudio_reversal_explicit(self):
        kit = core.labelstudio({"validation": core.validate(fixture())})
        kit["manifest"][0]["displayMap"] = {"a": "b", "b": "a"}
        task = kit["tasks"][0]
        task["annotations"] = [{"result": [{"from_name": "preference", "to_name": "a",
            "type": "choices", "value": {"choices": ["A preferred"]}}]}]
        result = core.reconcile({"manifest": kit["manifest"], "annotations": [task]})
        self.assertEqual(result["decisions"][0]["outcome"], "b")

    def test_labelstudio_tampering(self):
        kit = core.labelstudio({"validation": core.validate(fixture())})
        kit["tasks"][0]["data"]["response_a"] = "tampered"
        self.assertEqual(core.reconcile({"manifest": kit["manifest"],
            "annotations": kit["tasks"]})["issues"][0]["code"], "task_data_changed")

    def test_labelstudio_duplicate_task_rejects_all(self):
        kit = core.labelstudio({"validation": core.validate(fixture())})
        kit["tasks"][0]["annotations"] = [{"result": [{"from_name": "preference",
            "to_name": "a", "type": "choices", "value": {"choices": ["A preferred"]}}]}]
        result = core.reconcile({"manifest": kit["manifest"], "annotations": kit["tasks"] * 2})
        self.assertEqual(result["decisions"], [])

    def test_assignment_no_group_repeats(self):
        comparisons = core.validate(fixture())["comparisons"] * 3
        result = core.assign({"reviewers": ["one", "two"], "comparisons": comparisons})
        self.assertEqual(len(result["assignments"]), 2)

    def test_assignment_families_across_all_conditions(self):
        comparisons = [{"id": f"case-{group}-{variant}", "groupId": f"group-{group}", "eligible": True}
                       for group in range(12) for variant in range(4)]
        assignments = core.assign({"reviewers": ["a", "b", "c", "d"], "comparisons": comparisons})["assignments"]
        self.assertEqual(len(assignments), 48)
        self.assertEqual(len({(a["reviewerId"], a["groupId"]) for a in assignments}), 48)
        self.assertEqual({a["condition"] for a in assignments}, {"rf_human", "rf_assisted", "ls_human", "ls_assisted"})

    def test_missing_metrics(self):
        result = core.analyze({"records": [{"interface": "reviewflow", "reviewMode": "human_only"}]})
        self.assertIsNone(result["conditions"][0]["activeMs"]["mean"])
        self.assertIsNone(result["accuracy"])

    def test_metrics_separate(self):
        result = core.analyze({"records": [{"interface": "reviewflow", "reviewMode": "human_only",
                                           "activeMs": 12, "waitingMs": 100, "serviceMs": 90}]})
        self.assertEqual(result["conditions"][0]["activeMs"]["total"], 12)
        self.assertEqual(result["conditions"][0]["waitingMs"]["total"], 100)

    def test_benchmark_requires_genuine_attestation(self):
        records = [{"reviewerId": r, "comparisonId": "case", "interface": "reviewflow",
                    "reviewMode": "human_only", "outcome": "a", "referenceOutcome": "a",
                    "referenceSource": "synthetic-mechanical-test-reference"} for r in ("r1", "r2")]
        self.assertIsNone(core.analyze({"records": records})["agreement"])
        self.assertIsNone(core.analyze({"records": records})["accuracy"])
        # Mechanical test of arithmetic, NOT actual independent reviews.
        for record in records:
            record["measurementOrigin"] = "genuine_human"
        result = core.analyze({"records": records})
        self.assertEqual(result["agreement"]["fraction"], 1)
        self.assertEqual(result["accuracy"]["count"], 2)
        records[1]["reviewMode"] = "model_assisted"
        self.assertIsNone(core.analyze({"records": records})["agreement"])

    def test_cli(self):
        result = subprocess.run([sys.executable, "-m", "trace2preference", "validate"],
                                input=json.dumps(fixture()), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["comparisons"][0]["eligible"])
        bad = subprocess.run([sys.executable, "-m", "trace2preference", "validate"],
                             input='{"schemaVersion": NaN}', text=True, capture_output=True)
        self.assertEqual(bad.returncode, 2)


if __name__ == "__main__":
    unittest.main()