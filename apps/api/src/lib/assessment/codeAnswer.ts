// CODE answer normalization (IDE wave 2, 2026-10): one place that understands
// BOTH answer arms — legacy `{ text }` (wave 1, single file) and the multi-file
// `{ files: [{path, content}], entry }` — and produces what the sandbox, the
// session validator and the web agree on. Pure: no imports, no side effects.

/** Same grammar as the item schema's filePathSchema (lib/assessment/item.ts). */
export const FILE_PATH_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

export const MAX_CODE_FILES = 8;
export const MAX_FILE_CHARS = 20_000;
export const MAX_TOTAL_CHARS = 64_000;

export interface CodeFile {
  path: string;
  content: string;
}

export type NormalizedCodeAnswer =
  | { kind: 'text'; text: string }
  | { kind: 'files'; files: CodeFile[]; entry: string };

export function defaultEntryName(language: string): string {
  if (language === 'NODE') return 'main.js';
  if (language === 'BASH') return 'main.sh';
  return 'main.py';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidFilePath(path: unknown): path is string {
  return typeof path === 'string' && FILE_PATH_REGEX.test(path) && !path.includes('..');
}

/**
 * Validates + normalizes a CODE answer body.
 * Returns `{ kind: 'files' }` for a valid multi-file answer, `{ kind: 'text' }`
 * for a valid legacy single-file answer, and null for anything invalid.
 * `language` seeds the default entry name for legacy text answers.
 */
export function normalizeCodeAnswer(content: unknown, language: string): NormalizedCodeAnswer | null {
  if (!isPlainObject(content)) return null;

  // Multi-file arm.
  if (Array.isArray(content.files)) {
    if (content.files.length < 1 || content.files.length > MAX_CODE_FILES) return null;
    const files: CodeFile[] = [];
    let total = 0;
    for (const raw of content.files) {
      if (!isPlainObject(raw)) return null;
      if (!isValidFilePath(raw.path)) return null;
      if (typeof raw.content !== 'string' || raw.content.length > MAX_FILE_CHARS) return null;
      total += raw.content.length;
      if (total > MAX_TOTAL_CHARS) return null;
      files.push({ path: raw.path, content: raw.content });
    }
    if (new Set(files.map((f) => f.path)).size !== files.length) return null;
    // Entry: explicit must match a file (strict — a wrong entry is a client
    // bug, not something to guess); absent defaults to the first file.
    if (content.entry !== undefined) {
      if (typeof content.entry !== 'string' || !files.some((f) => f.path === content.entry)) return null;
      return { kind: 'files', files, entry: content.entry };
    }
    return { kind: 'files', files, entry: files[0]!.path };
  }

  // Legacy single-file arm.
  if (typeof content.text === 'string' && content.text.length <= 10_000) {
    return { kind: 'text', text: content.text };
  }
  return null;
}
