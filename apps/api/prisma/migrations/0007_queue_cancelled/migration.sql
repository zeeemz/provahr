-- Seal cancellation (founder requirement 2026-09-21): a terminal CANCELLED
-- state for queue rows aborted by HR. Postgres allows ADD VALUE inside a
-- migration transaction as long as the new value is not USED here (it isn't).

ALTER TYPE "QueueStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
