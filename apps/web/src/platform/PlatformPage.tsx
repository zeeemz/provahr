// Super admin: platform console (/app/platform).
//
// The SaaS control surface (PLAN.md §12 D18/D19): tenants (companies) with
// their user counts, the "New company" wizard-modal (company + optional first
// ADMIN in one POST), and the platform Settings card with the auth-mode
// SWITCH — a real toggle since V2-1: PUT /api/platform/settings writes the
// runtime setting that GET /api/auth/mode reads back.
//
// Since V2-3 the switch is fully LIVE: the auth middleware resolves the mode
// from the platform row on every request, and each company's Keycloak realm
// is configured inside the tenant (Company admin → Settings → Keycloak). The
// platform owner keeps local sign-in in SSO mode by design — lockout safety.
//
// Also home of the MAIN system prompt (two-tier prompts, founder
// requirement): the platform-wide rules card below (MainPromptCard).

import { useEffect, useState } from 'react';
import { api, ApiError, errMessage } from '../api/client';
import type {
  AuthMode,
  CreateCompanyInput,
  PlatformCompany,
  PlatformMainPrompt,
  PlatformSandboxTemplateRow,
  PlatformSettings,
} from '../api/types';
import { ApiErrorScreen, ErrorBox, Spinner, fmtDate } from '../components/ui';

export default function PlatformPage(): JSX.Element {
  const [companies, setCompanies] = useState<PlatformCompany[] | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [sandboxTemplates, setSandboxTemplates] = useState<PlatformSandboxTemplateRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showWizard, setShowWizard] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ companies: PlatformCompany[] }>('/platform/companies'),
      api.get<PlatformSettings>('/platform/settings'),
      api.get<{ companies: PlatformSandboxTemplateRow[] }>('/platform/sandbox-templates'),
    ])
      .then(([cos, se, tpl]) => {
        if (!cancelled) {
          setCompanies(cos.companies);
          setSettings(se);
          setSandboxTemplates(tpl.companies);
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

  function reload(): void {
    setReloadKey((k) => k + 1);
  }

  async function deleteCompany(co: PlatformCompany): Promise<void> {
    setNote(null);
    const confirmed = window.confirm(
      `Delete ${co.name} and everything in it (users, jobs, applications)? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await api.del(`/platform/companies/${co.id}`);
      setNote(`${co.name} deleted.`);
      reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <main className="page">
      <h1>Platform</h1>
      <p className="sub">
        The super admin console: tenants on this install, and the platform-wide sign-in mode.
        Company-scoped areas (roles, pipeline, team) live inside each tenant.
      </p>

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && (companies === null || settings === null) && <Spinner label="Loading platform…" />}

      {sandboxTemplates !== null && <SandboxTemplatesCard rows={sandboxTemplates} />}

      {note !== null && <p className="form-ok">{note}</p>}

      {companies !== null && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', gap: 12, flexWrap: 'wrap' }}>
            <h2 className="mt0" style={{ margin: 0 }}>Companies ({companies.length})</h2>
            <button type="button" onClick={() => setShowWizard(true)}>+ New company</button>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Users</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No companies yet — create the first tenant with the button above.
                  </td>
                </tr>
              )}
              {companies.map((co) => (
                <tr key={co.id}>
                  <td>
                    <strong>{co.name}</strong>
                    {co.website !== null && (
                      <>
                        {' '}
                        <a href={co.website} target="_blank" rel="noreferrer" className="muted">site</a>
                      </>
                    )}
                  </td>
                  <td>{co.userCount}</td>
                  <td className="muted">{fmtDate(co.createdAt)}</td>
                  <td>
                    <button type="button" className="danger small" onClick={() => void deleteCompany(co)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {settings !== null && (
        <AuthModeCard
          authMode={settings.authMode}
          onSwitched={(mode) => {
            setSettings({ authMode: mode });
            setNote(`Sign-in mode switched to ${mode === 'oidc' ? 'Keycloak SSO (OIDC)' : 'local accounts'}.`);
          }}
        />
      )}

      <MainPromptCard />

      {showWizard && (
        <NewCompanyModal
          onClose={() => setShowWizard(false)}
          onCreated={(co, admin) => {
            setShowWizard(false);
            setNote(
              admin !== null
                ? `${co.name} created — ${admin.email} is its admin and can sign in at /login.`
                : `${co.name} created (no admin yet — add one from inside the company).`,
            );
            reload();
          }}
        />
      )}
    </main>
  );
}

/** Sandbox templates across every tenant (V2-4, D21) — read-only oversight. */
function SandboxTemplatesCard({ rows }: { rows: PlatformSandboxTemplateRow[] }): JSX.Element {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 16px 0' }}>
        <h2 className="mt0" style={{ margin: 0 }}>Sandbox templates</h2>
        <p className="sub mt0">
          Which docker image each tenant&rsquo;s code answers run, per language — read-only
          oversight; templates are configured inside each company (Admin → Settings). Companies
          without templates run the platform defaults.
        </p>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Company</th>
            <th>Language</th>
            <th>Template image</th>
            <th>Active image</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No companies yet.</td>
            </tr>
          )}
          {rows.flatMap((company) =>
            company.languages.map((l, i) => (
              <tr key={`${company.companyId}-${l.language}`}>
                <td>{i === 0 ? <strong>{company.companyName}</strong> : <span className="muted">{company.companyName}</span>}</td>
                <td>{l.language}</td>
                <td className={l.template === null ? 'muted' : undefined}>
                  {l.template === null ? '—' : l.template.image}
                  {l.template !== null && !l.template.enabled && <span className="muted"> (disabled)</span>}
                </td>
                <td>
                  <code>{l.activeImage}</code>
                </td>
                <td>
                  <span className={`badge ${l.activeSource === 'COMPANY' ? 'green' : 'outline'}`}>
                    {l.activeSource === 'COMPANY' ? 'Company' : 'Platform'}
                  </span>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Platform settings: the runtime auth-mode switch (D19). */
function AuthModeCard({
  authMode,
  onSwitched,
}: {
  authMode: AuthMode;
  onSwitched: (mode: AuthMode) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(mode: AuthMode): Promise<void> {
    if (mode === authMode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<PlatformSettings>('/platform/settings', { authMode: mode });
      onSwitched(res.authMode);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Authentication mode</h2>
      <p className="sub mt0">
        Which credential verifier this install uses. <span className="badge green">Current</span>{' '}
        <strong>{authMode === 'oidc' ? 'Keycloak SSO (OIDC)' : 'Local accounts (email + password)'}</strong>
      </p>
      <p>
        {authMode === 'local' ? (
          <button type="button" disabled={busy} onClick={() => void switchTo('oidc')}>
            {busy ? 'Switching…' : 'Switch to Keycloak SSO (OIDC)'}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void switchTo('local')}>
            {busy ? 'Switching…' : 'Switch back to local accounts'}
          </button>
        )}
      </p>
      {error !== null && <p className="form-error">{error}</p>}
      <p className="hint">
        The switch is stored as platform data and takes effect on the next request — the middleware
        reads it per sign-in, no restart. Each company brings its own Keycloak realm (company admin →
        Settings); this install-wide mode decides whether those realms or local passwords verify.
        YOUR super-admin password keeps working in both modes, so a bad realm config can never lock
        you out of this console.
      </p>
      {authMode === 'oidc' && (
        <p className="hint">
          Users provisioned from OIDC have no usable local password; switching back to local means
          they need a password reset or a fresh invite.
        </p>
      )}
    </div>
  );
}

/** The MAIN system-prompt tier (founder requirement): platform-wide rules. */
function MainPromptCard(): JSX.Element {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<PlatformMainPrompt>('/platform/prompts/main')
      .then((res) => {
        if (!cancelled) {
          setValue(res.mainPrompt);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(): Promise<void> {
    if (value === null || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.put<PlatformMainPrompt>('/platform/prompts/main', { mainPrompt: value });
      setValue(res.mainPrompt);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Main system prompt</h2>
      <p className="sub mt0">
        Platform-wide rules for every AI generation (JDs, tests, evaluations). Company admins can
        read this in their job console but only the super admin can edit it.
      </p>
      {value === null && error === null && <Spinner label="Loading prompt…" />}
      {error !== null && value === null && <ErrorBox err={error} note="Could not load the main prompt" />}
      {value !== null && (
        <>
          <label className="field" htmlFor="platform-main-prompt">Prompt text</label>
          <textarea
            id="platform-main-prompt"
            value={value}
            maxLength={8000}
            style={{ minHeight: 180 }}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
          />
          <p className="hint">
            Appended before each job&rsquo;s own prompt on every AI request, ahead of the built-in
            output rules. Empty means no platform overlay — generations run exactly as before.
          </p>
          {error !== null && <p className="form-error">{error}</p>}
          {saved && <p className="form-ok" style={{ marginTop: 0 }}>Saved ✓</p>}
          <p>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save main prompt'}
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/** The company wizard (D18): tenant + optional first ADMIN in one POST. */
function NewCompanyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (company: { name: string }, admin: { email: string } | null) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [withAdmin, setWithAdmin] = useState(true);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const input: CreateCompanyInput = { name: name.trim() };
    if (website.trim() !== '') input.website = website.trim();
    if (withAdmin) {
      input.firstAdmin = {
        name: adminName.trim(),
        email: adminEmail.trim(),
        password: adminPassword,
      };
    }
    setBusy(true);
    try {
      const res = await api.post<{ company: { name: string }; admin: { email: string } | null }>(
        '/platform/companies',
        input,
      );
      onCreated(res.company, res.admin);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
        setError('An account with this email already exists — each person gets exactly one account.');
      } else {
        setError(errMessage(err)); // validation errors arrive with field details
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="New company">
      <div className="modal">
        <h2>New company</h2>
        <p className="sub mt0">
          Creates a tenant workspace. Give it a first admin now — that person signs in at /login
          with the password you set and runs the company from the inside.
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <label className="field" htmlFor="nc-name">Company name</label>
          <input
            id="nc-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <label className="field" htmlFor="nc-website">Website (optional)</label>
          <input
            id="nc-website"
            type="url"
            maxLength={500}
            placeholder="https://example.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          <label className="field" htmlFor="nc-admin" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="nc-admin"
              type="checkbox"
              checked={withAdmin}
              onChange={(e) => setWithAdmin(e.target.checked)}
            />
            Create the company&rsquo;s admin now
          </label>

          {withAdmin && (
            <>
              <label className="field" htmlFor="nc-admin-name">Admin name</label>
              <input
                id="nc-admin-name"
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />

              <label className="field" htmlFor="nc-admin-email">Admin email</label>
              <input
                id="nc-admin-email"
                type="email"
                required
                maxLength={200}
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />

              <label className="field" htmlFor="nc-admin-pw">Password</label>
              <input
                id="nc-admin-pw"
                type="password"
                required
                minLength={8}
                maxLength={100}
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
              <p className="hint">At least 8 characters — share it with the person; there is no email invite flow in v1.</p>
            </>
          )}

          {error !== null && <ErrorBox err={error} />}
          <p style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          </p>
        </form>
      </div>
    </div>
  );
}
