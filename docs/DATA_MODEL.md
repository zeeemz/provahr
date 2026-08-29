# Data Model

> ⚠️ **STALE — describes the pre-v4 tracking-spine schema.**
> The AI-native entities (LlmProvider, TestBlueprint, SealedQuestionPool,
> TestSession, Answer valuations, ExecutionResult, SessionSignal, Evaluation,
> SessionAssessment, VoidedItem) are specified in [`PLAN.md`](PLAN.md) §8 and
> land with Phases 1–7. This file gets a full rewrite when those entities are
> implemented. See [`DOCUMENTATION.md`](DOCUMENTATION.md) for the freshness system.

Reference for the entities in [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
IDs are cuids; all timestamps are UTC.

## Entity overview

```
Company ─┬─< User
         └─< Job ─< Application ─┬─< StageEvent
Candidate ──────────┘            ├─< Interview ──< Scorecard (optional link)
                                 └─< Scorecard
```

## Company (tenant)

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `slug` | string, unique | Used in public URLs later; generated from name |
| `website`, `logoUrl` | string? | Optional branding |

## User (HR team member)

| Field | Type | Notes |
|---|---|---|
| `email` | string, unique | Login identifier |
| `passwordHash` | string | bcrypt (cost 10) |
| `role` | `ADMIN` \| `RECRUITER` \| `INTERVIEWER` | RBAC; ADMIN can manage users |
| `companyId` | FK | Tenant scope — every query filters on this |

Candidates are **not** users: they interact only with the public portal.

## Job

| Field | Type | Notes |
|---|---|---|
| `title`, `department` | string | e.g. "Senior Backend Engineer", "Product" |
| `roleFamily` | `ENGINEERING` \| `PRODUCT_MANAGEMENT` \| `DESIGN` \| `DATA` \| `QA` \| `OTHER` | First-class filter for technical hiring |
| `location` | string | Free text ("Berlin, DE" / "Remote — EMEA") |
| `workMode` | `ONSITE` \| `HYBRID` \| `REMOTE` | |
| `employmentType` | `FULL_TIME` \| `PART_TIME` \| `CONTRACT` \| `INTERNSHIP` | |
| `salaryMin`, `salaryMax`, `salaryCurrency` | optional | Band, ISO-4217 code |
| `description` | string | Markdown |
| `status` | `DRAFT` → `OPEN` → `PAUSED` → `CLOSED` | Only `OPEN` jobs appear on the public board |

## Candidate

| Field | Type | Notes |
|---|---|---|
| `email` | string, unique | Dedupe key — one profile per person worldwide |
| `name`, `phone` | string | |
| `resumeUrl`, `linkedinUrl`, `githubUrl` | string? | Links for MVP; uploads in a later phase |
| Data-minimization note | | No addresses, birthdays, photos, or nationality — intentionally |

## Application

| Field | Type | Notes |
|---|---|---|
| `jobId` + `candidateId` | unique together | One application per candidate per job |
| `stage` | `APPLIED` \| `SCREENING` \| `ASSESSMENT` \| `INTERVIEW` \| `OFFER` \| `HIRED` | Kanban column |
| `status` | `ACTIVE` \| `REJECTED` \| `WITHDRAWN` \| `HIRED` | Outcome, orthogonal to stage |
| `source` | string? | "Careers page", "LinkedIn", "Referral" |
| `coverLetter` | string? | |
| `rejectionReason` | string? | Required when rejecting — fair-hiring audit |

Stage + status are separate (ADR-9): the board position and the outcome are
independent facts, and history is preserved in `StageEvent`.

## StageEvent (append-only audit trail)

| Field | Type | Notes |
|---|---|---|
| `applicationId` | FK | |
| `fromStage`, `toStage` | Stage | `fromStage` null on creation |
| `actorId` | FK → User, nullable | Null for public submissions |
| `note` | string? | e.g. rejection reason |

Never updated or deleted — see fair-hiring commitments in [PLAN.md §8](PLAN.md#8-fair-hiring-privacy--compliance-design-commitments).

## Interview

| Field | Type | Notes |
|---|---|---|
| `type` | `PHONE_SCREEN` \| `TECHNICAL` \| `SYSTEM_DESIGN` \| `BEHAVIORAL` \| `PANEL` \| `FINAL` | |
| `interviewerId` | FK → User, nullable | Assigned later if needed |
| `scheduledAt` | DateTime | Stored in UTC; UI renders in local timezone |
| `durationMinutes` | int | Default 45 |
| `status` | `SCHEDULED` \| `COMPLETED` \| `CANCELLED` | |

## Scorecard

| Field | Type | Notes |
|---|---|---|
| `applicationId`, `authorId` | FK | Author is the interviewer; unique per (application, author) |
| `technical`, `communication`, `problemSolving`, `roleFit` | int 1–5 | Job-relevant competencies only |
| `strengths`, `concerns`, `summary` | string? | |
| `recommendation` | `STRONG_HIRE` \| `HIRE` \| `NO_HIRE` \| `STRONG_NO_HIRE` | |
| `interviewId` | FK? | Optional link to the interview it evaluates |

## Stage transition rules

```ts
APPLIED    → SCREENING | ASSESSMENT | INTERVIEW
SCREENING  → ASSESSMENT | INTERVIEW | APPLIED
ASSESSMENT → INTERVIEW | SCREENING
INTERVIEW  → OFFER | SCREENING | ASSESSMENT
OFFER      → HIRED | INTERVIEW
HIRED      → (terminal)
```

Rejection/withdrawal is a **status** change available from any stage (except
`HIRED` for rejection) and does not require a stage move. Backwards moves are
allowed (processes are messy in real life) but always recorded.
