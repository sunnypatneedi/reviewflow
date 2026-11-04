import assert from "node:assert/strict";
import test from "node:test";
import {
  RELEASE_ROLES,
  REVIEW_ROLES,
  EXPORT_ROLES,
  AUDIT_ROLES,
  isEscalationResolution,
  membershipBelongsToProject,
  roleAllows,
} from "./authorization.ts";

test("a membership from another project never grants access", () => {
  assert.equal(
    membershipBelongsToProject("user-reviewer", "project-a", {
      userId: "user-reviewer",
      projectId: "project-b",
      role: "reviewer",
    }),
    false,
  );
  assert.equal(
    membershipBelongsToProject("user-reviewer", "project-a", {
      userId: "user-reviewer",
      projectId: "project-a",
      role: "reviewer",
    }),
    true,
  );
});

test("reviewers may review but may not resolve an escalation", () => {
  assert.equal(roleAllows("reviewer", REVIEW_ROLES), true);
  assert.equal(roleAllows("reviewer", RELEASE_ROLES), false);
  assert.equal(isEscalationResolution("escalated", "correct"), true);
});

test("only owners and adjudicators can resolve escalations", () => {
  assert.equal(isEscalationResolution("escalated", "accept"), true);
  assert.equal(roleAllows("owner", RELEASE_ROLES), true);
  assert.equal(roleAllows("adjudicator", RELEASE_ROLES), true);
  assert.equal(roleAllows("reviewer", RELEASE_ROLES), false);
  assert.equal(isEscalationResolution("proposed", "correct"), false);
});

test("the complete role matrix grants only intended capabilities", () => {
  const expected = {
    owner: { review: true, release: true },
    reviewer: { review: true, release: false },
    adjudicator: { review: true, release: true },
    auditor: { review: false, release: false },
    exporter: { review: false, release: false },
  } as const;
  for (const [role, access] of Object.entries(expected)) {
    assert.equal(roleAllows(role as keyof typeof expected, REVIEW_ROLES), access.review);
    assert.equal(roleAllows(role as keyof typeof expected, RELEASE_ROLES), access.release);
  }
});

test("membership validation rejects wrong users and invalid persisted roles", () => {
  assert.equal(membershipBelongsToProject("user-a", "project-a", {
    userId: "user-b",
    projectId: "project-a",
    role: "reviewer",
  }), false);
  assert.equal(membershipBelongsToProject("user-a", "project-a", {
    userId: "user-a",
    projectId: "project-a",
    role: "administrator",
  }), false);
});
test("auditor and exporter duties remain separate from review and adjudication", () => {
  assert.equal(roleAllows("auditor", AUDIT_ROLES), true);
  assert.equal(roleAllows("auditor", REVIEW_ROLES), false);
  assert.equal(roleAllows("auditor", EXPORT_ROLES), false);
  assert.equal(roleAllows("exporter", EXPORT_ROLES), true);
  assert.equal(roleAllows("exporter", AUDIT_ROLES), false);
  assert.equal(roleAllows("exporter", RELEASE_ROLES), false);
});
