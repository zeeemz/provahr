/**
 * @provahr/shared — canonical ProvaHR vocabulary shared by api, web, worker,
 * and mobile. Single source of truth for cross-app contracts.
 */

/** Pipeline stages (mirrors apps/api/src/rules/pipeline.ts — keep in sync until api adopts this package in Phase 1). */
export const STAGES = ['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED'] as const;
export type Stage = (typeof STAGES)[number];

/** Question formats supported by sealed pools. */
export const QUESTION_FORMATS = ['SWIPE_MCQ', 'MCQ', 'WRITTEN', 'CODE'] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

/** Per-option valuations for the Swipe MCQ format (like/dislike cards). */
export type SwipeValuation = 'LIKE' | 'DISLIKE';
export type SwipeAnswer = Record<string, SwipeValuation>; // optionId -> valuation

/** Proctoring signal types (web tab-switch ≙ mobile app-background). */
export const SIGNAL_TYPES = [
  'TAB_SWITCH',
  'APP_BACKGROUND',
  'BLUR',
  'LARGE_PASTE',
  'COPY',
  'TIMING_ANOMALY',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** AI-likelihood verdicts — flags for humans, never auto-rejections (PLAN §2.1). */
export type AiLikelihood = 'LOW' | 'MEDIUM' | 'HIGH';

/** LLM provider kinds configurable by admins. */
export const PROVIDER_KINDS = ['OPENAI_COMPATIBLE', 'ANTHROPIC', 'AZURE_OPENAI'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVAHR_VERSION = '0.1.0';
