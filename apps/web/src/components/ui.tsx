// Tiny shared UI helpers — no framework, just functions over the design system.

import type { ReactNode } from 'react';
import { ApiError, errMessage } from '../api/client';

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <p className="busy" role="status">
      <span className="spin" aria-hidden="true" />
      {label ?? 'Loading…'}
    </p>
  );
}

export function ErrorBox({ err, note }: { err: unknown; note?: string }): JSX.Element {
  return (
    <p className="form-error">
      {note ? `${note} — ` : ''}
      {errMessage(err)}
    </p>
  );
}

/** Clean 403 rendering (API role guards) + a friendly catch-all for others. */
export function ApiErrorScreen({ err }: { err: unknown }): JSX.Element {
  if (err instanceof ApiError && err.status === 403) {
    return (
      <Screen title="Not allowed" variant="warn">
        <p>
          Your role does not have access to this action (403 — <code>{err.code}</code>).
          {err.message ? ` ${err.message}.` : ''}
        </p>
        <p className="sub mt0">Job management actions require the recruiter or admin role.</p>
      </Screen>
    );
  }
  return (
    <Screen title="Something went wrong" variant="error">
      <p>{errMessage(err)}</p>
    </Screen>
  );
}

export function Screen({
  title,
  variant,
  children,
}: {
  title: string;
  variant?: 'warn' | 'error' | 'ok';
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="card" style={variant === 'error' ? { borderColor: 'var(--danger-border)' } : undefined}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Label lookup with a human default — enums stay raw in the data model. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  // Web shows standard questionnaire wording; the swipe interaction is the
  // mobile app's rendering of the same format (D14).
  const overrides: Record<string, string> = {
    SWIPE_MCQ: 'Select-all (swipe on mobile)',
  };
  if (overrides[value]) return overrides[value];
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const WORK_MODES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
export const ROLE_FAMILIES = [
  'ENGINEERING',
  'PRODUCT_MANAGEMENT',
  'DESIGN',
  'DATA',
  'QA',
  'OTHER',
] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] as const;
export const DIFFICULTY_MIXES = ['EASY_HEAVY', 'BALANCED', 'HARD_HEAVY'] as const;
export const QUESTION_FORMAT_LIST = ['SWIPE_MCQ', 'MCQ', 'WRITTEN', 'CODE'] as const;

export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'OPEN':
    case 'ACTIVE':
    case 'CORRECT':
    case 'CORRECT_VERDICT':
    case 'HIRED':
      return 'badge green';
    case 'PAUSED':
    case 'PARTIAL':
    case 'STARTED':
    case 'ASSESSMENT':
    case 'INTERVIEW':
    case 'SCHEDULED':
      return 'badge amber';
    case 'CLOSED':
    case 'REJECTED':
    case 'WITHDRAWN':
    case 'EXPIRED':
    case 'INCORRECT':
    case 'HIGH':
      return 'badge red';
    case 'DRAFT':
    case 'APPLIED':
    case 'SCREENING':
      return 'badge blue';
    default:
      return 'badge';
  }
}
