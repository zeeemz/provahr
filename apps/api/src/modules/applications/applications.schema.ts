import { z } from 'zod';

export const moveStageSchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED']),
});

export const changeStatusSchema = z.object({
  action: z.enum(['REJECT', 'WITHDRAW', 'REOPEN']),
  reason: z.string().trim().max(1000).optional(),
});

export const listApplicationsQuerySchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED']).optional(),
  status: z.enum(['ACTIVE', 'REJECTED', 'WITHDRAWN', 'HIRED']).optional(),
});

export const applySchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  phone: z.string().trim().max(30).optional(),
  resumeUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  linkedinUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  githubUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  coverLetter: z.string().trim().max(5000).optional(),
  source: z.string().trim().max(100).optional(),
});

export type ApplyInput = z.infer<typeof applySchema>;
export type StatusAction = z.infer<typeof changeStatusSchema>['action'];

// ─── HR walk-in flow (founder requirement 2026-09-20) ─────────────────────────
// HR fills the identifying details at the office; the candidate completes the
// rest (links, cover letter) at the start of the test via the one-time link.

/** What HR enters for a walk-in candidate — identity only, no links/letters. */
export const walkInSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  phone: z.string().trim().max(30).optional(),
});

export type WalkInInput = z.infer<typeof walkInSchema>;

/**
 * What the CANDIDATE may add from their test link before starting. Name/email
 * are HR-owned and never editable here; all fields optional (a walk-in may
 * simply continue).
 */
export const walkInDetailsSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  resumeUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  linkedinUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  githubUrl: z.string().trim().url('Must be a valid URL').max(500).optional(),
  coverLetter: z.string().trim().max(5000).optional(),
});

export type WalkInDetailsInput = z.infer<typeof walkInDetailsSchema>;
