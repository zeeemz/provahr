// Small formatting helpers — mirrors of apps/web/src/components/ui.tsx so the
// two portals render identical strings for the same data.

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

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Label lookup with a human default — enums stay raw in the data model. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function salaryLine(job: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null;
  const cur = job.salaryCurrency ?? 'USD';
  const lo = job.salaryMin !== null ? job.salaryMin.toLocaleString() : '…';
  const hi = job.salaryMax !== null ? job.salaryMax.toLocaleString() : '…';
  return `${cur} ${lo} – ${hi}`;
}
