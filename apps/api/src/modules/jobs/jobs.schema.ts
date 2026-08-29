import { z } from 'zod';

export const roleFamilySchema = z.enum([
  'ENGINEERING',
  'PRODUCT_MANAGEMENT',
  'DESIGN',
  'DATA',
  'QA',
  'OTHER',
]);

export const workModeSchema = z.enum(['ONSITE', 'HYBRID', 'REMOTE']);

export const employmentTypeSchema = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']);

const salaryRefinement = (v: { salaryMin?: number; salaryMax?: number }) =>
  v.salaryMin === undefined ||
  v.salaryMax === undefined ||
  v.salaryMax >= v.salaryMin;

const jobBase = z.object({
  title: z.string().trim().min(2, 'Title is too short').max(150),
  department: z.string().trim().min(2, 'Department is too short').max(100),
  roleFamily: roleFamilySchema,
  location: z.string().trim().min(2, 'Location is too short').max(120),
  workMode: workModeSchema.default('ONSITE'),
  employmentType: employmentTypeSchema.default('FULL_TIME'),
  salaryMin: z.number().int().positive().optional(),
  salaryMax: z.number().int().positive().optional(),
  salaryCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Currency must be a 3-letter ISO code (e.g. USD)')
    .default('USD'),
  description: z.string().trim().min(30, 'Description must be at least 30 characters').max(10_000),
});

export const createJobSchema = jobBase.refine(salaryRefinement, {
  message: 'salaryMax must be greater than or equal to salaryMin',
  path: ['salaryMax'],
});

export const updateJobSchema = jobBase.partial().refine(salaryRefinement, {
  message: 'salaryMax must be greater than or equal to salaryMin',
  path: ['salaryMax'],
});

export const listJobsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED']).optional(),
  roleFamily: roleFamilySchema.optional(),
  q: z.string().trim().max(150).optional(),
});

export const setJobStatusSchema = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED']),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
