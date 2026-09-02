/**
 * ProvaHR application roles. Array order is role precedence: ADMIN beats
 * RECRUITER beats INTERVIEWER.
 */
export const PROVAHR_ROLES = ['ADMIN', 'RECRUITER', 'INTERVIEWER'] as const;
export type ProvaRole = (typeof PROVAHR_ROLES)[number];

/**
 * Maps the roles carried by an OIDC token (realm + client roles) to the
 * single ProvaHR role the request acts with. Returns `null` when the token
 * holds none of the ProvaHR roles — such tokens must be rejected.
 */
export function mapRoles(tokenRoles: string[]): ProvaRole | null {
  const granted = new Set(tokenRoles);
  for (const role of PROVAHR_ROLES) {
    if (granted.has(role)) {
      return role;
    }
  }
  return null;
}
