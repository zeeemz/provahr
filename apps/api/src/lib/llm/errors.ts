import { AppError } from '../http';

/** Replaces every occurrence of `secret` in `text` with '***'. */
export function redactSecret(text: string, secret: string): string {
  if (secret.length === 0) {
    return text;
  }
  return text.split(secret).join('***');
}

/**
 * Provider-call failure. Every string this error holds is scrubbed of the
 * configured API key (`scrub`) at construction time — provider error bodies
 * sometimes echo request headers back, and an exception must never become a
 * secret-leaking side channel. `detail` carries at most 300 chars of the
 * provider response body; it is for logs/CLI use only and is not serialized
 * by the global error handler.
 */
export class LlmError extends AppError {
  public readonly detail?: string;

  constructor(status: number, message: string, detail?: string, scrub?: string) {
    super(status, scrub ? redactSecret(message, scrub) : message, 'LLM_ERROR');
    this.name = 'LlmError';
    if (detail !== undefined) {
      this.detail = scrub ? redactSecret(detail, scrub) : detail;
    }
  }
}
