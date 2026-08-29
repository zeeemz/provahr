// Admin: LLM provider management (/app/admin/providers).
//
// Wraps the /api/admin/llm-providers contract (llm-providers.router.ts):
// GET list · POST add · POST /:id/activate · POST /:id/test · DELETE /:id.
// Providers are YOUR COMPANY'S (V2-2): the list is server-side company-
// filtered, and exactly one of them is active at a time per company — the one
// every AI feature uses. API keys are write-only: the API encrypts them at
// rest and returns only the last 4 characters; this screen never renders
// anything else.

import { useEffect, useState } from 'react';
import { api, errMessage } from '../api/client';
import type {
  CreateProviderInput,
  ProviderKind,
  RedactedProvider,
  SmokeTestResult,
} from '../api/types';
import { ApiErrorScreen, Spinner, fmtDate } from '../components/ui';

const KINDS: readonly ProviderKind[] = ['OPENAI_COMPATIBLE', 'ANTHROPIC', 'AZURE_OPENAI'];

const KIND_LABEL: Record<ProviderKind, string> = {
  OPENAI_COMPATIBLE: 'OpenAI-compatible',
  ANTHROPIC: 'Anthropic',
  AZURE_OPENAI: 'Azure OpenAI',
};

const BASE_URL_PLACEHOLDER: Record<ProviderKind, string> = {
  OPENAI_COMPATIBLE: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
  AZURE_OPENAI: 'https://<resource>.openai.azure.com',
};

const TEXT_MODEL_PLACEHOLDER: Record<ProviderKind, string> = {
  OPENAI_COMPATIBLE: 'gpt-4o-mini',
  ANTHROPIC: 'claude-sonnet-4-20250514',
  AZURE_OPENAI: 'deployment-name',
};

const KIND_HELPER: Record<ProviderKind, string> = {
  OPENAI_COMPATIBLE:
    'Any API that mirrors OpenAI’s /chat/completions — OpenAI, OpenRouter, vLLM, LM Studio, ' +
    'Ollama (from Docker: http://host.docker.internal:11434/v1). baseUrl must include the version ' +
    'segment where the backend uses one; leave it out for OpenAI’s default. textModel is the model id.',
  ANTHROPIC:
    'Native Anthropic API. baseUrl is optional (defaults to https://api.anthropic.com — the API ' +
    'appends /v1/messages itself). textModel is the model id.',
  AZURE_OPENAI:
    'Your own Azure OpenAI tenant. baseUrl is the resource URL — required, there is no default. ' +
    'textModel is the deployment name you created in Azure AI Foundry / the portal, not the model id. ' +
    'The api-version query parameter is fixed by the adapter.',
};

/** Inline outcome of the last Test click for one provider row. */
type TestOutcome = { ok: true; result: SmokeTestResult } | { ok: false; message: string };

export default function ProvidersPage(): JSX.Element {
  const [providers, setProviders] = useState<RedactedProvider[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tests, setTests] = useState<Record<string, TestOutcome | undefined>>({});
  const [busyId, setBusyId] = useState<string | null>(null); // provider with a running row action
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RedactedProvider | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ providers: RedactedProvider[] }>('/admin/llm-providers')
      .then((res) => {
        if (!cancelled) {
          setProviders(res.providers);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function activate(provider: RedactedProvider): Promise<void> {
    setActionError(null);
    setBusyId(provider.id);
    try {
      await api.post(`/admin/llm-providers/${provider.id}/activate`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setActionError(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function test(provider: RedactedProvider): Promise<void> {
    setActionError(null);
    setBusyId(provider.id);
    setTests((prev) => ({ ...prev, [provider.id]: undefined }));
    try {
      const res = await api.post<SmokeTestResult>(`/admin/llm-providers/${provider.id}/test`);
      setTests((prev) => ({ ...prev, [provider.id]: { ok: true, result: res } }));
    } catch (err) {
      setTests((prev) => ({ ...prev, [provider.id]: { ok: false, message: errMessage(err) } }));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.del(`/admin/llm-providers/${deleteTarget.id}`);
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setActionError(errMessage(err));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page">
      <h1>LLM providers</h1>
      <p className="sub">
        These are your company&rsquo;s providers — exactly one is <strong>active</strong> at a time,
        and it is the one every AI feature uses (JD drafting, evaluation). API keys are encrypted
        at rest and never leave the server; the list only ever shows their last 4 characters. See{' '}
        <code>docs/SELF_HOSTING.md</code>.
      </p>

      {error !== null && <ApiErrorScreen err={error} />}
      {actionError !== null && <p className="form-error">{actionError}</p>}
      {error === null && providers === null && <Spinner label="Loading providers…" />}

      {providers !== null && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>API key</th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No providers configured — AI features fail with <code>NO_PROVIDER</code> until
                    one is active. Add the first one below.
                  </td>
                </tr>
              )}
              {providers.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  busy={busyId === p.id}
                  outcome={tests[p.id]}
                  onActivate={() => void activate(p)}
                  onTest={() => void test(p)}
                  onDelete={() => setDeleteTarget(p)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddProviderForm onCreated={() => setReloadKey((k) => k + 1)} />

      {deleteTarget !== null && (
        <DeleteProviderModal
          provider={deleteTarget}
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </main>
  );
}

function ProviderRow({
  provider,
  busy,
  outcome,
  onActivate,
  onTest,
  onDelete,
}: {
  provider: RedactedProvider;
  busy: boolean;
  outcome: TestOutcome | undefined;
  onActivate: () => void;
  onTest: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <>
      <tr className={provider.isActive ? 'active-row' : undefined}>
        <td>
          <strong>{KIND_LABEL[provider.kind]}</strong>
          <div className="muted" style={{ fontSize: '0.82rem' }}>
            {provider.baseUrl !== '' ? provider.baseUrl : 'default endpoint'}
          </div>
        </td>
        <td>
          <code>{provider.textModel}</code>
          {provider.visionModel !== null && (
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              vision: {provider.visionModel}
            </div>
          )}
        </td>
        <td>
          <code>••••{provider.apiKeyLast4}</code>
        </td>
        <td>
          <span className={provider.isActive ? 'badge green' : 'badge outline'}>
            {provider.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="muted">{fmtDate(provider.createdAt)}</td>
        <td>
          <div className="row">
            <button
              type="button"
              className="secondary small"
              disabled={busy || provider.isActive}
              onClick={onActivate}
              title={provider.isActive ? 'This is the active provider' : 'Make this the one active provider'}
            >
              {busy ? 'Working…' : provider.isActive ? 'Active' : 'Activate'}
            </button>
            <button type="button" className="secondary small" disabled={busy} onClick={onTest}>
              Test
            </button>
            <button type="button" className="danger small" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          </div>
        </td>
      </tr>
      {outcome !== undefined && (
        <tr>
          <td colSpan={6} style={{ borderTop: 0 }}>
            {outcome.ok ? (
              <p className="form-ok mt0">
                Round-trip OK — <code>{outcome.result.model}</code> replied{' '}
                &ldquo;{outcome.result.reply}&rdquo; in {outcome.result.latencyMs} ms.
              </p>
            ) : (
              <p className="form-error mt0">Test failed — {outcome.message}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AddProviderForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const [kind, setKind] = useState<ProviderKind>('OPENAI_COMPATIBLE');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [textModel, setTextModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okNote, setOkNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchKind(next: ProviderKind): void {
    setKind(next);
    setBaseUrl(''); // each kind has its own placeholder/default
    setOkNote(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setOkNote(null);
    const body: CreateProviderInput = {
      kind,
      apiKey,
      textModel: textModel.trim(),
    };
    if (baseUrl.trim() !== '') body.baseUrl = baseUrl.trim();
    setBusy(true);
    try {
      await api.post('/admin/llm-providers', body);
      setApiKey('');
      setTextModel('');
      setBaseUrl('');
      setOkNote(
        `Provider added — it is inactive until you press Activate in the list above (a live Test ` +
          `first is a good idea).`,
      );
      onCreated();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Add provider</h2>
      <p className="sub">
        The key is sealed with AES-256-GCM before it touches the database and is never returned by
        any endpoint. Minimum 8 characters — local backends like Ollama ignore it but still need one.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field" htmlFor="pv-kind">Kind</label>
        <select
          id="pv-kind"
          value={kind}
          onChange={(e) => switchKind(e.target.value as ProviderKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <p className="hint">{KIND_HELPER[kind]}</p>

        <label className="field" htmlFor="pv-baseurl">Base URL {kind === 'AZURE_OPENAI' ? '(required)' : '(optional)'}</label>
        <input
          id="pv-baseurl"
          type="text"
          placeholder={BASE_URL_PLACEHOLDER[kind]}
          maxLength={500}
          required={kind === 'AZURE_OPENAI'}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label className="field" htmlFor="pv-key">API key</label>
        <input
          id="pv-key"
          type="password"
          required
          minLength={8}
          maxLength={500}
          autoComplete="new-password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <label className="field" htmlFor="pv-model">
          {kind === 'AZURE_OPENAI' ? 'Text model — deployment name' : 'Text model'}
        </label>
        <input
          id="pv-model"
          type="text"
          required
          maxLength={200}
          placeholder={TEXT_MODEL_PLACEHOLDER[kind]}
          value={textModel}
          onChange={(e) => setTextModel(e.target.value)}
        />
        {kind === 'AZURE_OPENAI' && (
          <p className="hint">The deployment name you created in Azure — not the underlying model id.</p>
        )}

        {error !== null && <p className="form-error">{error}</p>}
        {okNote !== null && <p className="form-ok">{okNote}</p>}
        <p>
          <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add provider'}</button>
        </p>
      </form>
    </div>
  );
}

function DeleteProviderModal({
  provider,
  busy,
  onCancel,
  onConfirm,
}: {
  provider: RedactedProvider;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete provider">
      <div className="modal">
        <h2>Delete provider?</h2>
        <p className="sub">
          {KIND_LABEL[provider.kind]} · <code>{provider.textModel}</code> and its stored key will be
          removed. {provider.isActive
            ? 'This is the ACTIVE provider — AI features will fail with NO_PROVIDER until you activate another one.'
            : 'The active provider is not affected.'}
        </p>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : 'Delete provider'}
          </button>
        </div>
      </div>
    </div>
  );
}
