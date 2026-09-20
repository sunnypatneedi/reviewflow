export const PROJECT_ROLES = ["owner", "reviewer", "adjudicator"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const REVIEW_ROLES: readonly ProjectRole[] = ["owner", "reviewer", "adjudicator"];
export const RELEASE_ROLES: readonly ProjectRole[] = ["owner", "adjudicator"];

export function isProjectRole(value: string): value is ProjectRole {
  return PROJECT_ROLES.includes(value as ProjectRole);
}

export function roleAllows(role: ProjectRole, allowedRoles?: readonly ProjectRole[]): boolean {
  return !allowedRoles || allowedRoles.includes(role);
}

export function membershipBelongsToProject(
  userId: string,
  projectId: string,
  membership: { userId: string; projectId: string; role: string } | undefined,
): membership is { userId: string; projectId: string; role: ProjectRole } {
  return Boolean(
    membership &&
    membership.userId === userId &&
    membership.projectId === projectId &&
    isProjectRole(membership.role),
  );
}

export function isEscalationResolution(status: string, action: string): boolean {
  return status === "escalated" && action !== "escalate";
}