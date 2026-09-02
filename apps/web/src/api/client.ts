// Typed fetch wrapper around the ProvaHR REST API (apps/api).
//
// Contract notes (mirrors apps/api/src/middleware/error.ts):
// - Every error body is { error: { code, message, details? } }.
// - Auth is a Bearer JWT stored in localStorage under 'provahr_token'.
// - The API base is same-origin '/api' (Vite dev proxy → http://localhost:4000).

export const TOKEN_STORAGE_KEY = 'provahr_token';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Error thrown for every non-2xx API response; carries the API error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable (private mode) — session is simply not persisted */
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
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
      err?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Human-readable message for any thrown value (ApiError or otherwise). */
export function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details && err.details.length > 0) {
      return `${err.message}: ${err.details.map((d) => `${d.path ? d.path + ' — ' : ''}${d.message}`).join(' · ')}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when the error is the API's uniform test-link 404 / session 404. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND');
}
