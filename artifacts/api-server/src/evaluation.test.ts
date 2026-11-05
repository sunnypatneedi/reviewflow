import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTask, ProviderError, type EvaluationTask } from "./evaluation";
import { validProbability, validDistribution } from "./lib/provider-contract";

const task = {
  question: "Question",
  evidence: "Evidence",
  candidateAnswer: "Answer",
} as EvaluationTask;
function fixture(score = 1.43) {
  return {
    model: "jev-returned-version",
    usage: { input_tokens: 12, output_tokens: 3 },
    answers: {
      label: {
        type: "choice",
        choice: "supported",
        confidence: 0.7,
        probabilities: {
          supported: 0.8,
          contradicted: 0.1,
          insufficient_evidence: 0.1,
        },
      },
      attempted_redirection: { type: "noul", noul: 0.2 },
      review_complexity: {
        type: "score",
        score,
        confidence: 0.35,
        probabilities:
          score === 0
            ? { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 }
            : score === 4
              ? { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 }
              : { "0": 0, "1": 0.57, "2": 0.43, "3": 0, "4": 0 },
        legend: {
          "0": "Direct",
          "1": "Minor",
          "2": "Multiple",
          "3": "Subtle",
          "4": "Ambiguous",
        },
      },
    },
  };
}

test("evidence provider preserves fractional native Score and maps only public complexity", async () => {
  const fetch = globalThis.fetch,
    key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "mock-only";
  try {
    for (const native of [0, 1.43, 4]) {
      const raw = fixture(native);
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.questions.review_complexity.criteria.length, 5);
        assert.equal(request.state.evidence, "Evidence");
        return Response.json(raw);
      };
      const result = await evaluateTask(task, "live");
      assert.equal(result.complexity, native + 1);
      assert.deepEqual(result.raw, raw);
      assert.equal(result.model, raw.model);
      assert.equal(result.inputTokens, 12);
      assert.equal(result.outputTokens, 3);
      assert.equal(result.injection, 0.2);
    }
  } finally {
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = key;
  }
});

test("provider contracts fail closed for malformed typed judgments without paid calls", async () => {
  const fetch = globalThis.fetch,
    key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "mock-only";
  try {
    const mutations: Array<(raw: any) => void> = [
      (raw) => {
        raw.answers.review_complexity.score = -0.1;
      },
      (raw) => {
        raw.answers.review_complexity.score = 4.1;
      },
      (raw) => {
        raw.answers.review_complexity.score = 2.9;
      },
      (raw) => {
        raw.answers.review_complexity.score = "1.43";
      },
      (raw) => {
        raw.answers.review_complexity.probabilities["4"] = 1;
      },
      (raw) => {
        delete raw.answers.review_complexity.probabilities["0"];
      },
      (raw) => {
        raw.answers.review_complexity.confidence = 1.1;
      },
      (raw) => {
        raw.answers.attempted_redirection.noul = -0.1;
      },
      (raw) => {
        raw.answers.attempted_redirection.noul = 1.1;
      },
      (raw) => {
        raw.answers.attempted_redirection.noul = "0.2";
      },
      (raw) => {
        raw.answers.label.choice = "contradicted";
      },
      (raw) => {
        raw.answers.label.probabilities.extra = 0.5;
      },
      (raw) => {
        raw.answers.label.confidence = null;
      },
      (raw) => {
        raw.model = "";
      },
      (raw) => {
        delete raw.model;
      },
      (raw) => {
        raw.usage.input_tokens = -1;
      },
      (raw) => {
        raw.usage.output_tokens = 1.5;
      },
      (raw) => {
        raw.usage.output_tokens = "3";
      },
    ];
    for (const mutate of mutations) {
      const raw = fixture();
      mutate(raw);
      globalThis.fetch = async () => Response.json(raw);
      await assert.rejects(
        evaluateTask(task, "live"),
        (error) => error instanceof ProviderError && !error.retryable,
      );
    }
    for (const body of ["null", "{", " ".repeat(64_001)]) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(
        evaluateTask(task, "live"),
        (error) => error instanceof ProviderError && !error.retryable,
      );
    }
    const noUsage: any = fixture();
    delete noUsage.usage;
    globalThis.fetch = async () => Response.json(noUsage);
    assert.equal((await evaluateTask(task, "live")).inputTokens, null);
  } finally {
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = key;
  }
});

test("probability validation rejects nonfinite numbers before they can affect routing", () => {
  for (const value of [NaN, Infinity, -Infinity, "0.5", null, undefined]) {
    assert.equal(validProbability(value), false);
    assert.equal(validDistribution({ a: value, b: 1 }, ["a", "b"]), false);
  }
  assert.equal(validProbability(0), true);
  assert.equal(validProbability(1), true);
});
