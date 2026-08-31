// Admin: authentication settings (/app/admin/settings).
//
// Two surfaces since V2-3 (D19):
// 1. The live mode badge — GET /api/auth/mode, public and boolean-only. The
//    MODE itself is the super-admin platform toggle (Platform → Settings),
//    because it is an install-wide concern; company admins read it here.
// 2. The company's OWN Keycloak/OIDC config — GET/PUT /api/admin/auth-config
//    (issuer URL + audience + enabled). This is real, runtime data now: in
//    SSO mode the middleware verifies tokens against the issuer configured
//    HERE for this company. Validation is client-side URL-shape only (no test
//    round-trip endpoint by design) — the full walkthrough, including realm
//    and client-role setup, lives in docs/RBAC.md.

import { useEffect, useState } from 'react';
import { api, ApiError, errMessage } from '../api/client';
import type { AuthModeResponse, CompanyAuthConfig } from '../api/types';
import { ApiErrorScreen, ErrorBox, Spinner } from '../components/ui';

export default function SettingsPage(): JSX.Element {
  const [modeInfo, setModeInfo] = useState<AuthModeResponse | null>(null);
  const [modeError, setModeError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AuthModeResponse>('/auth/mode')
      .then((res) => {
        if (!cancelled) setModeInfo(res);
      })
      .catch((err) => {
        if (!cancelled) setModeError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page narrow">
      <h1>Authentication</h1>
      <p className="sub">How sign-in is verified on this install — and your company&rsquo;s Keycloak realm.</p>

      {modeError !== null && <ApiErrorScreen err={modeError} />}
      {modeError === null && modeInfo === null && <Spinner label="Checking auth mode…" />}

      {modeInfo !== null && (
        <div className="card">
          <h2>
            <span className={`badge ${modeInfo.mode === 'oidc' ? 'green' : 'outline'}`}>
              {modeInfo.mode === 'oidc' ? 'SSO' : 'Local'}
            </span>{' '}
            Platform sign-in mode
          </h2>
          <p className="sub mt0">
            {modeInfo.mode === 'local'
              ? 'This install verifies email + password sign-ins against its own database (the development default).'
              : 'This install verifies Keycloak SSO tokens. Company users sign in through their realm; the platform super admin always keeps local sign-in as the lockout safety.'}
          </p>
          {modeInfo.mode === 'oidc' && modeInfo.perCompany && (
            <p className="hint">
              At least one company — possibly yours — has an enabled Keycloak config: tenant realms are
              in play, resolved per token issuer.
            </p>
          )}
          <p className="hint">
            The switch between local and SSO is install-wide: the platform super admin flips it in the
            Platform console (Platform → Settings) — a runtime setting, no restart. This page reports
            it live.
          </p>
        </div>
      )}

      <KeycloakConfigCard mode={modeInfo?.mode ?? null} />
    </main>
  );
}

/** True when the issuer looks like a reachable http(s) URL — shape only, no network probe. */
function issuerShapeValid(issuerUrl: string): boolean {
  try {
    const parsed = new URL(issuerUrl.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * The company's Keycloak/OIDC verifier (V2-3). One config per company — PUT
 * replaces it. `enabled` gates whether the middleware will resolve tokens
 * from this issuer to THIS company; a disabled row is a harmless draft.
 */
function KeycloakConfigCard({ mode }: { mode: 'local' | 'oidc' | null }): JSX.Element {
  // undefined = loading, null = never saved.
  const [initial, setInitial] = useState<CompanyAuthConfig | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [audience, setAudience] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ authConfig: CompanyAuthConfig | null }>('/admin/auth-config')
      .then((res) => {
        if (cancelled) return;
        setInitial(res.authConfig);
        setIssuerUrl(res.authConfig?.issuerUrl ?? '');
        setAudience(res.authConfig?.audience ?? '');
        setEnabled(res.authConfig?.enabled ?? false);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaved(null);
    if (!issuerShapeValid(issuerUrl)) {
      setError('Issuer URL must be a full http:// or https:// URL (e.g. https://sso.example.com/realms/acme).');
      return;
    }
    if (audience.trim() === '') {
      setError('Audience is required — the Keycloak client id whose tokens ProvaHR accepts.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.put<{ authConfig: CompanyAuthConfig }>('/admin/auth-config', {
        issuerUrl: issuerUrl.trim(),
        audience: audience.trim(),
        enabled,
      });
      setInitial(res.authConfig);
      setIssuerUrl(res.authConfig.issuerUrl);
      setAudience(res.authConfig.audience);
      setEnabled(res.authConfig.enabled);
      setSaved(
        res.authConfig.enabled
          ? 'Saved and enabled — tokens from this issuer now verify against your company (SSO mode permitting).'
          : 'Saved as a disabled draft — flip the toggle when the realm is ready.',
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ISSUER_TAKEN') {
        setError('Another company on this install already verifies that issuer — issuers must be unique per company.');
      } else {
        setError(errMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError !== null) return <ApiErrorScreen err={loadError} />;
  if (initial === undefined) return <Spinner label="Loading Keycloak config…" />;

  return (
    <div className="card">
      <h2>
        <span className={`badge ${enabled ? 'green' : 'outline'}`}>{enabled ? 'Enabled' : 'Draft'}</span>{' '}
        Your company&rsquo;s Keycloak (OIDC)
      </h2>
      <p className="sub mt0">
        In SSO mode, sign-in tokens carrying your issuer URL are verified against the issuer +
        audience you configure here, and the user joins <strong>your</strong> company. Roles map from
        realm/client roles: ADMIN &gt; RECRUITER &gt; INTERVIEWER (docs/RBAC.md has the realm setup
        walkthrough).
      </p>

      <form onSubmit={(e) => void submit(e)}>
        <label className="field" htmlFor="kc-issuer">Issuer URL</label>
        <input
          id="kc-issuer"
          type="url"
          required
          maxLength={500}
          placeholder="https://sso.example.com/realms/acme"
          value={issuerUrl}
          onChange={(e) => setIssuerUrl(e.target.value)}
        />
        <p className="hint">
          The realm&rsquo;s issuer identifier — Keycloak reports it as the token&rsquo;s <code>iss</code>{' '}
          claim. No trailing slash needed; the API normalizes it.
        </p>

        <label className="field" htmlFor="kc-audience">Audience (client ID)</label>
        <input
          id="kc-audience"
          type="text"
          required
          minLength={1}
          maxLength={200}
          placeholder="provahr-api"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        />
        <p className="hint">The Keycloak client ProvaHR accepts tokens for — <code>azp</code>/audience is enforced.</p>

        <label className="field" htmlFor="kc-enabled" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="kc-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled — tokens from this issuer verify for this company
        </label>
        <p className="hint">
          A disabled config authenticates nobody, so it is safe to save a draft first. Enabling an
          issuer another company already uses is refused.
          {mode === 'local' && ' Note: the platform is currently in LOCAL mode — this config takes effect when the super admin switches the install to SSO.'}
        </p>

        {error !== null && <ErrorBox err={error} />}
        {saved !== null && <p className="form-ok">{saved}</p>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save config'}</button>
        </p>
      </form>

      {initial !== null && (
        <p className="hint">Last saved {new Date(initial.updatedAt).toLocaleString()}.</p>
      )}
      <p className="hint">
        No live “test” button by design — verification happens on real sign-in. Validate the issuer
        URL shape here, then check <code>docs/RBAC.md</code> for the realm, client and role-mapping
        walkthrough; the platform console (Platform → Auth configs) shows every company&rsquo;s
        config and a validity hint.
      </p>
    </div>
  );
}
