import type { UserRole } from '@prisma/client';

/**
 * Role union (PLAN.md §12 D18):
 * - `SUPER_ADMIN` — PLATFORM-level: owns the install (companies, platform
 *   settings) and has NO company (`companyId` null). Gate with the platform
 *   module's `requireSuperAdmin`, not `requireRole`.
 * - `ADMIN` / `RECRUITER` / `INTERVIEWER` — company-scoped tenant roles; they
 *   always carry a `companyId` and every company service scopes by it.
 */

/** The authenticated user attached to the request after `requireAuth`. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Null only for SUPER_ADMIN (platform-level, D18) — company services must
   *  never be reached with a null company (requireRole keeps them out). */
  companyId: string | null;
  companyName: string | null;
}

/** Public (no-auth) view of a user. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
