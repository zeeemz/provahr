import { z } from 'zod';

export const interviewTypeSchema = z.enum([
  'PHONE_SCREEN',
  'TECHNICAL',
  'SYSTEM_DESIGN',
  'BEHAVIORAL',
  'PANEL',
  'FINAL',
]);

export const createInterviewSchema = z.object({
  type: interviewTypeSchema,
  scheduledAt: z.coerce.date({ message: 'scheduledAt must be a valid date' }),
  durationMinutes: z.number().int().min(15).max(480).default(45),
  interviewerId: z.string().cuid().optional(),
  locationOrLink: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateInterviewSchema = z
  .object({
    scheduledAt: z.coerce.date(),
    durationMinutes: z.number().int().min(15).max(480),
    interviewerId: z.string().cuid(),
    locationOrLink: z.string().trim().max(300),
    notes: z.string().trim().max(2000),
    status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
  })
  .partial();

export const scorecardSchema = z.object({
  technical: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  problemSolving: z.number().int().min(1).max(5),
  roleFit: z.number().int().min(1).max(5),
  recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE']),
  strengths: z.string().trim().max(2000).optional(),
  concerns: z.string().trim().max(2000).optional(),
  summary: z.string().trim().max(2000).optional(),
});

export const listInterviewsQuerySchema = z.object({}).optional();

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type UpdateInterviewInput = z.infer<typeof updateInterviewSchema>;
export type ScorecardInput = z.infer<typeof scorecardSchema>;
