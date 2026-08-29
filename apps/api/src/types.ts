import type { UserRole } from '@prisma/client';

/** The authenticated user attached to the request after `requireAuth`. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  companyName: string;
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
