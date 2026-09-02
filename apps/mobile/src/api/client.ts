// Typed fetch wrapper around the ProvaHR REST API (apps/api) — the mobile
// twin of apps/web/src/api/client.ts. Differences from web:
// - No auth: every route used here is public (no Bearer token, no storage).
// - The API base comes from app.json → expo.extra.apiUrl (default
//   http://localhost:4000, the apps/api dev port), because React Native has
//   no same-origin '/api' relative URL the way the browser does.
//
// Contract notes (mirrors apps/api/src/middleware/error.ts):
// - Every error body is { error: { code, message, details? } }.

import Constants from 'expo-constants';

export const DEFAULT_API_URL = 'http://localhost:4000';

/** API base URL from app.json extra.apiUrl (falls back to the dev default). */
export function apiUrl(): string {
  const raw = Constants.expoConfig?.extra?.apiUrl;
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_API_URL;
}

/** Error thrown for every non-2xx API response; carries the API error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Is the API running?');
  }

  if (res.status === 204) return undefined as T;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};

/** Human-readable message for any thrown value (ApiError or otherwise). */
export function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when the error is the API's uniform test-link 404 / session 404. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND');
}
