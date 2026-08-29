// Zod schemas for the role-intake → JD flow (PLAN.md Phase 2).

import { z } from 'zod';

export const screenshotSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z.string().min(1).max(2_800_000),
});

export type ScreenshotInput = z.infer<typeof screenshotSchema>;

/**
 * Role-intake material. At least one of notes / urls / screenshots must be
 * present — an empty intake has nothing for the LLM to ground on.
 */
export const intakeSchema = z
  .object({
    notes: z.string().trim().max(4000).optional(),
    urls: z.array(z.string().trim().url()).max(5).default([]),
    screenshots: z.array(screenshotSchema).max(5).default([]),
  })
  .refine((v) => (v.notes !== undefined && v.notes !== '') || v.urls.length > 0 || v.screenshots.length > 0, {
    message: 'Provide at least one of notes, urls, or screenshots',
  });

export type IntakeInput = z.infer<typeof intakeSchema>;

const jdDraftBase = z.object({
  title: z.string().min(2).max(150),
  department: z.string().min(2).max(100),
  roleFamily: z.enum(['ENGINEERING', 'PRODUCT_MANAGEMENT', 'DESIGN', 'DATA', 'QA', 'OTHER']),
  location: z.string().min(2).max(120),
  workMode: z.enum(['ONSITE', 'HYBRID', 'REMOTE']),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']),
  description: z.string().min(200).max(8000),
  summary: z.string().max(500),
});

/**
 * Draft object as stored on `Job.jdDraft`. The LLM boundary tolerates missing
 * fields (partial) — `runJdGeneration` separately requires title +
 * description before accepting a draft. Nulls are allowed: the prompt tells
 * the model to leave unsupported fields null rather than invent.
 */
export const jdDraftPartialSchema = jdDraftBase.extend({
  title: z.string().min(2).max(150).nullable().optional(),
  department: z.string().min(2).max(100).nullable().optional(),
  roleFamily: jdDraftBase.shape.roleFamily.nullable().optional(),
  location: z.string().min(2).max(120).nullable().optional(),
  workMode: jdDraftBase.shape.workMode.nullable().optional(),
  employmentType: jdDraftBase.shape.employmentType.nullable().optional(),
  description: z.string().min(200).max(8000).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
});

export type JdDraft = z.infer<typeof jdDraftPartialSchema>;

/** HR edit patch: every field optional, but whatever is sent must be valid. */
export const editDraftSchema = jdDraftPartialSchema;

export type EditDraftInput = z.infer<typeof editDraftSchema>;

/** Approval takes no body. */
export const approveSchema = z.object({}).optional();
