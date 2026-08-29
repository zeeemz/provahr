// Super admin: platform console (/app/platform).
//
// The SaaS control surface (PLAN.md §12 D18/D19): tenants (companies) with
// their user counts, the "New company" wizard-modal (company + optional first
// ADMIN in one POST), and the platform Settings card with the auth-mode
// SWITCH — a real toggle now: PUT /api/platform/settings writes the runtime
// setting that GET /api/auth/mode reads back.
//
// Honest V2-1 caveat surfaced in the UI: Keycloak VERIFICATION wiring lands
// with V2-3 — until then the boot-time environment decides which verifier
// actually runs, so switching modes changes the readout now and enforcement
// later.

import { useEffect, useState } from 'react';
import { api, ApiError, errMessage } from '../api/client';
import type { AuthMode, CreateCompanyInput, PlatformCompany, PlatformSettings } from '../api/types';
import { ApiErrorScreen, ErrorBox, Spinner, fmtDate } from '../components/ui';

export default function PlatformPage(): JSX.Element {
  const [companies, setCompanies] = useState<PlatformCompany[] | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showWizard, setShowWizard] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ companies: PlatformCompany[] }>('/platform/companies'),
      api.get<PlatformSettings>('/platform/settings'),
    ])
      .then(([cos, se]) => {
        if (!cancelled) {
          setCompanies(cos.companies);
          setSettings(se);
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
        The switch is stored as platform data and read back by the sign-in screens immediately.
        Keycloak verification becomes ACTIVE with V2-3 — until then the boot-time environment
        setting keeps deciding which verifier runs, so plan the cutover there.
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
