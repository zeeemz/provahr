import { z } from 'zod';
import { roleFamilySchema, workModeSchema } from '../jobs/jobs.schema';

export const publicJobsQuerySchema = z.object({
  q: z.string().trim().max(150).optional(),
  roleFamily: roleFamilySchema.optional(),
  workMode: workModeSchema.optional(),
});
