// Admin: authentication settings (/app/admin/settings).
//
// GET /api/auth/mode is a public, boolean-only readout (D15): which credential
// verifier this install runs. The mode itself is environment-configured
// (OIDC_ENABLED in apps/api/.env + restart) — this page explains it, it does
// not (and cannot honestly) toggle it. Details: docs/RBAC.md.

import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AuthMode } from '../api/types';
import { ApiErrorScreen, Spinner } from '../components/ui';

export default function SettingsPage(): JSX.Element {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ mode: AuthMode }>('/auth/mode')
      .then((res) => {
        if (!cancelled) setMode(res.mode);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page narrow">
      <h1>Authentication</h1>
      <p className="sub">How sign-in is verified on this install — and how to change it.</p>

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && mode === null && <Spinner label="Checking auth mode…" />}

      {mode === 'local' && (
        <>
          <div className="card">
            <h2><span className="badge green">Current</span> Local accounts (email + password)</h2>
            <p className="sub mt0">
              Sign-in verifies email + password against this install&rsquo;s database and issues a
              JWT signed with <code>JWT_SECRET</code>. This is the development default — no network
              I/O, no identity provider to run.
            </p>
            <p className="hint">
              Users you invite on the Team page get local accounts with the password you set — that
              is the only way accounts are created in this mode (plus the first-run /setup wizard).
            </p>
          </div>
          <div className="card">
            <h2>Single sign-on (Keycloak, OIDC)</h2>
            <p className="sub mt0">
              Corporate sign-in via your org&rsquo;s Keycloak realm: RS256 access tokens verified
              against the issuer&rsquo;s JWKS, roles mapped per request (ADMIN &gt; RECRUITER &gt;
              INTERVIEWER), users provisioned automatically. Azure AD / SAML / LDAP / Google
              federate through Keycloak — ProvaHR itself never sees those credentials.
            </p>
            <p className="hint">
              To switch: set <code>OIDC_ENABLED=true</code> (plus <code>OIDC_ISSUER_URL</code>,
              <code>OIDC_AUDIENCE</code>) in <code>apps/api/.env</code> and restart the API. Full
              walkthrough: <code>docs/RBAC.md</code>.
            </p>
          </div>
        </>
      )}

      {mode === 'oidc' && (
        <>
          <div className="card">
            <h2><span className="badge green">Current</span> Keycloak SSO (OIDC)</h2>
            <p className="sub mt0">
              Sign-in is verified by your org&rsquo;s Keycloak realm. ProvaHR checks RS256 access
              tokens against the issuer&rsquo;s JWKS (issuer + audience enforced), maps realm roles
              to ADMIN / RECRUITER / INTERVIEWER on every request, and provisions the local user row
              from the verified token. Removing a user&rsquo;s roles in Keycloak locks them out on
              their next request.
            </p>
            <p className="hint">
              Keycloak admin console: typically <code>http://localhost:8081</code> (this install&rsquo;s
              issuer default is <code>http://localhost:8081/realms/provahr</code>) — select the
              provahr realm to manage users and roles.
            </p>
            <p className="hint">
              Federate Azure AD / SAML / LDAP in Keycloak — see <code>docs/RBAC.md</code>. ProvaHR
              only ever talks to Keycloak, so adding or swapping providers needs no ProvaHR changes.
            </p>
          </div>
          <div className="card">
            <h2>Switching back to local accounts</h2>
            <p className="sub mt0">
              Set <code>OIDC_ENABLED=false</code> in <code>apps/api/.env</code> and restart the API.
              Users provisioned from OIDC have no usable local password (a random unknown hash), so
              they would need a password reset or a fresh invite.
            </p>
          </div>
        </>
      )}

      <p className="hint">
        The mode is an environment setting (<code>OIDC_ENABLED</code>) applied at API startup — there
        is deliberately no toggle here. Details and security notes: <code>docs/RBAC.md</code>.
      </p>
    </main>
  );
}
