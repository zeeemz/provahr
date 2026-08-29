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
