// Admin: settings (/app/admin/settings).
//
// Three surfaces:
// 1. The live auth-mode badge — GET /api/auth/mode, public and boolean-only.
//    The MODE itself is the super-admin platform toggle (Platform → Settings),
//    because it is an install-wide concern; company admins read it here.
// 2. The company's OWN Keycloak/OIDC config since V2-3 (D19) —
//    GET/PUT /api/admin/auth-config (issuer URL + audience + enabled). This is
//    real, runtime data now: in SSO mode the middleware verifies tokens
//    against the issuer configured HERE for this company. Validation is
//    client-side URL-shape only (no test round-trip endpoint by design) — the
//    full walkthrough, including realm and client-role setup, lives in
//    docs/RBAC.md.
// 3. The company's SANDBOX IMAGE TEMPLATES since V2-4 (D21) —
//    GET/PUT /api/admin/sandbox-templates: per-language rows (BASH/NODE/
//    PYTHON) deciding which docker image runs this company's CODE answers.
//    The platform defaults show as hints; every override is shape-checked
//    client-side AND server-side (lowercase docker-ref grammar) and the
//    sandbox's hardening flags are identical for default and template images.

import { useEffect, useState } from 'react';
import { api, ApiError, errMessage } from '../api/client';
import type {
  AuthModeResponse,
  CodeLanguage,
  CompanyAuthConfig,
  PutSandboxTemplateInput,
  SandboxTemplateLanguageRow,
} from '../api/types';
import { CODE_LANGUAGES } from '../api/types';
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
      <h1>Settings</h1>
      <p className="sub">
        How sign-in is verified on this install, your company&rsquo;s Keycloak realm — and which sandbox
        images run your code tests.
      </p>

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
      <SandboxTemplatesCard />
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

// ─── Sandbox image templates (V2-4, D21) ──────────────────────────────────────

/** Mirror of the API's SAFE_IMAGE_REF grammar (client-side hint only — the
 * server re-validates with the same predicate at save AND build time). */
const SAFE_IMAGE_REF = /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-]+[a-z0-9]+)*)*(?::[a-z0-9]+(?:[._-]+[a-z0-9]+)*)?$/;

function imageShapeValid(image: string): boolean {
  const trimmed = image.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && SAFE_IMAGE_REF.test(trimmed);
}

const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  BASH: 'Bash',
  NODE: 'Node.js',
  PYTHON: 'Python',
};

/**
 * The company's per-language sandbox image templates. One row per CODE
 * language (all three always show), each saving independently via PUT
 * /api/admin/sandbox-templates. An enabled row with a safe image overrides
 * the platform default shown under it; disabled or absent rows keep the
 * default. The container HARDENING is identical either way — an override
 * changes which image runs, never how it runs.
 */
function SandboxTemplatesCard(): JSX.Element {
  // undefined = loading, null = load error handled by row below.
  const [rows, setRows] = useState<SandboxTemplateLanguageRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ templates: SandboxTemplateLanguageRow[] }>('/admin/sandbox-templates')
      .then((res) => {
        if (!cancelled) {
          setRows(res.templates);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loadError !== null) return <ApiErrorScreen err={loadError} />;
  if (rows === undefined) return <Spinner label="Loading sandbox templates…" />;

  return (
    <div className="card">
      <h2>Sandbox templates</h2>
      <p className="sub mt0">
        Which docker image runs your company&rsquo;s code-test answers, per language. Leave a row
        disabled (or unset) to keep the platform default — the isolation guarantees (no network,
        read-only filesystem, non-root user, resource caps) are identical for every image.
      </p>
      {CODE_LANGUAGES.map((language) => (
        <TemplateRow
          key={language}
          row={rows.find((r) => r.language === language) ?? null}
          language={language}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      ))}
      <p className="hint">
        Images must be lowercase docker references — registry/host, optional <code>:port</code>,
        path, optional <code>:tag</code> (e.g. <code>registry.example.com/team/java:21</code>).
        Uppercase names, flags, whitespace and digests are refused. The platform console
        (Platform&nbsp;→&nbsp;Sandbox templates) shows every tenant&rsquo;s templates read-only.
      </p>
    </div>
  );
}

/** One language's editable template row (name / image / enabled + save). */
function TemplateRow({
  row,
  language,
  onSaved,
}: {
  row: SandboxTemplateLanguageRow | null;
  language: CodeLanguage;
  onSaved: () => void;
}): JSX.Element {
  const defaultImage = row?.defaultImage ?? '';
  const stored = row?.template ?? null;
  const [name, setName] = useState(stored?.name ?? '');
  const [description, setDescription] = useState(stored?.description ?? '');
  const [image, setImage] = useState(stored?.image ?? '');
  const [enabled, setEnabled] = useState(stored?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [hydratedFor, setHydratedFor] = useState(stored?.id ?? '');

  // Re-hydrate the form when a save/reload changes the underlying row.
  if (row !== null && stored !== null && stored.id !== hydratedFor) {
    setHydratedFor(stored.id);
    setName(stored.name);
    setDescription(stored.description ?? '');
    setImage(stored.image);
    setEnabled(stored.enabled);
    setSaved(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaved(null);
    if (name.trim() === '') {
      setError('Give the template a name (e.g. "Java exercise image").');
      return;
    }
    if (!imageShapeValid(image)) {
      setError(
        'Image must be a lowercase docker reference (registry, optional :port, path, optional :tag), at most 100 characters.',
      );
      return;
    }
    setError(null);
    setBusy(true);
    const input: PutSandboxTemplateInput = {
      language,
      name: name.trim(),
      image: image.trim(),
      enabled,
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
    };
    try {
      const res = await api.put<{ template: SandboxTemplateLanguageRow }>('/admin/sandbox-templates', input);
      setSaved(
        res.template.activeSource === 'COMPANY'
          ? `Saved and active — ${language} answers now run ${res.template.activeImage}.`
          : 'Saved as a disabled draft — flip the toggle to override the platform default.',
      );
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SANDBOX_TEMPLATE_UNSAFE') {
        setError('The API refused this image as unsafe — check it is a lowercase docker reference with a tag.');
      } else {
        setError(errMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 14, marginTop: 14 }}>
      <h3 style={{ marginBottom: 4 }}>
        <span className={`badge ${row?.activeSource === 'COMPANY' ? 'green' : 'outline'}`}>
          {row?.activeSource === 'COMPANY' ? 'Override' : 'Default'}
        </span>{' '}
        {LANGUAGE_LABEL[language]}
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {row?.activeSource === 'COMPANY'
          ? `Currently running ${row.activeImage} (default would be ${defaultImage}).`
          : `Defaults to ${defaultImage}.`}
      </p>

      <label className="field" htmlFor={`tpl-name-${language}`}>Template name</label>
      <input
        id={`tpl-name-${language}`}
        type="text"
        required
        minLength={1}
        maxLength={120}
        placeholder={`${LANGUAGE_LABEL[language]} CI image`}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="field" htmlFor={`tpl-desc-${language}`}>Description (optional)</label>
      <input
        id={`tpl-desc-${language}`}
        type="text"
        maxLength={500}
        placeholder="What this image adds (tools, SDKs…)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="field" htmlFor={`tpl-image-${language}`}>Image</label>
      <input
        id={`tpl-image-${language}`}
        type="text"
        maxLength={100}
        placeholder={defaultImage}
        value={image}
        onChange={(e) => setImage(e.target.value)}
      />

      <label className="field" htmlFor={`tpl-enabled-${language}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          id={`tpl-enabled-${language}`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled — this company&rsquo;s {LANGUAGE_LABEL[language]} answers run this image
      </label>

      {error !== null && <ErrorBox err={error} />}
      {saved !== null && <p className="form-ok">{saved}</p>}
      <p style={{ marginTop: 10 }}>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : `Save ${LANGUAGE_LABEL[language]}`}
        </button>
      </p>
    </form>
  );
}
