import { Router } from 'express';
import { AppError, asyncHandler } from '../../lib/http';
import { installSchema } from './setup.schema';
import { isInstalled, install } from './setup.service';

// ── Naive in-memory rate limiter (POST /install only) ────────────────────────
// Max 10 requests per IP per hour, per process, no dependencies. Best-effort —
// acceptable because the endpoint hard-locks itself after the first success.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function allowRequest(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Periodic cleanup so the Map cannot grow without bound.
  if (hits.size > 1000) {
    for (const [key, timestamps] of hits) {
      if (timestamps.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}

// ── First-run wizard page (inlined — must survive the tsc build) ─────────────
// NOTE: helmet's default CSP blocks inline <script>, so the page's JS is a
// separate same-origin asset served below at /api/setup/wizard.js ('self' is
// allowed). Inline <style> is permitted by helmet's default style policy.
export const WIZARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ProvaHR — Setup</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 24px;
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f5f7; color: #1b1f24; line-height: 1.5;
  }
  .card {
    width: 100%; max-width: 520px; padding: 32px;
    background: #ffffff; border: 1px solid #e3e5e8; border-radius: 10px;
  }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 0 0 8px; }
  .sub { margin: 0 0 20px; color: #5c6470; font-size: 0.92rem; }
  label { display: block; font-size: 0.85rem; font-weight: 600; margin: 14px 0 4px; }
  input, select {
    width: 100%; padding: 9px 10px; font: inherit;
    border: 1px solid #c9cdd3; border-radius: 6px; background: #fff; color: inherit;
  }
  input:focus, select:focus { outline: 2px solid #2563eb; outline-offset: 0; border-color: #2563eb; }
  .hint { margin: 6px 0 0; font-size: 0.8rem; color: #5c6470; }
  .mode-hint, .mode-note { margin-top: 18px; }
  button {
    margin-top: 20px; padding: 10px 16px; font: inherit; font-weight: 600;
    color: #fff; background: #1d4ed8; border: 0; border-radius: 6px; cursor: pointer;
  }
  button:hover { background: #1e40af; }
  button:disabled { opacity: 0.6; cursor: default; }
  button.secondary { background: #fff; color: #1b1f24; border: 1px solid #c9cdd3; }
  button.secondary:hover { background: #f4f5f7; }
  button.big { width: 100%; padding: 13px 16px; font-size: 1rem; }
  .linklike {
    display: inline-block; margin-top: 20px; padding: 10px 2px;
    background: none; border: 0; border-radius: 0;
    color: #1d4ed8; font: inherit; font-weight: 600;
    text-decoration: underline; cursor: pointer;
  }
  .error {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #fdecec; border: 1px solid #f5b5b5; border-radius: 6px; color: #8a1f1f;
  }
  .ok {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #e8f5ec; border: 1px solid #b3dfc0; border-radius: 6px; color: #14532d;
  }
  .note {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #e9f1fb; border: 1px solid #bcd4f0; border-radius: 6px; color: #123c6b;
  }
  .busy { margin-left: 10px; font-size: 0.85rem; color: #5c6470; }
  code { background: #eef0f3; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }

  /* Stepper: 1 Install · 2 AI provider · 3 Team · 4 Finish */
  .stepper { display: flex; list-style: none; margin: 0 0 24px; padding: 0; font-size: 0.8rem; }
  .stepper li {
    flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 7px;
    padding: 8px 2px; color: #5c6470; border-bottom: 2px solid #e3e5e8;
  }
  .stepper .num {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 50%;
    background: #e9ebee; color: #5c6470; font-weight: 700; font-size: 0.75rem;
  }
  .stepper .lbl { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stepper li.current { color: #1b1f24; font-weight: 600; border-bottom-color: #1d4ed8; }
  .stepper li.current .num { background: #1d4ed8; color: #fff; }
  .stepper li.done .num { background: #e8f5ec; color: #14532d; }
  .stepper li.off { opacity: 0.45; }
  .stepper li.off .lbl { text-decoration: line-through; }

  /* Steps */
  fieldset.plain { border: 0; margin: 0; padding: 0; }
  fieldset.plain:disabled { opacity: 0.55; }
  .actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

  /* Step 3 — invite rows (built by wizard.js) */
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; }
  .invite-row { margin-top: 14px; padding: 2px 14px 12px; border: 1px solid #e3e5e8; border-radius: 8px; }
  .invite-row label { margin-top: 12px; }
  .invite-row .error, .invite-row .ok { font-size: 0.82rem; margin: 12px 0 0; }
  .kv { margin: 0 0 8px; }
  .kv dt { font-weight: 700; font-size: 0.82rem; margin-top: 10px; }
  .kv dd { margin: 2px 0 0; font-size: 0.85rem; color: #5c6470; }

  .badge {
    display: inline-block; padding: 1px 8px; border: 1px solid; border-radius: 999px;
    font-size: 0.72rem; font-weight: 700; vertical-align: 2px;
  }
  .badge.green { background: #e8f5ec; color: #14532d; border-color: #b3dfc0; }
  #locked p, #mode-local p, #mode-oidc p { margin: 6px 0; }
</style>
</head>
<body>
<main class="card">
  <h1>ProvaHR — Setup</h1>
  <p class="sub">First-run configuration — four quick steps.</p>

  <ol id="stepper" class="stepper" aria-label="Setup progress">
    <li id="tab-1" class="current"><span class="num">1</span><span class="lbl">Install</span></li>
    <li id="tab-2"><span class="num">2</span><span class="lbl">AI provider</span></li>
    <li id="tab-3"><span class="num">3</span><span class="lbl">Team</span></li>
    <li id="tab-4"><span class="num">4</span><span class="lbl">Finish</span></li>
  </ol>

  <div id="wizard">
    <!-- Step 1 — Install -->
    <section id="step-1">
      <h2>Create your install</h2>
      <p class="sub">Your company and the first admin account — everything else can be done right here, right after.</p>
      <form id="setup-form">
        <label for="companyName">Company name</label>
        <input id="companyName" type="text" autocomplete="organization" required minlength="2" maxlength="120">

        <label for="adminName">Your name</label>
        <input id="adminName" type="text" autocomplete="name" required minlength="2" maxlength="120">

        <label for="adminEmail">Admin email</label>
        <input id="adminEmail" type="email" autocomplete="email" required maxlength="200">

        <label for="adminPassword">Admin password</label>
        <input id="adminPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="100">
        <p class="hint">At least 8 characters. Keep it — you will use it to sign in.</p>

        <p class="hint mode-hint">
          Authentication mode (local vs Keycloak) is configured via the environment — see
          <code>docs/RBAC.md</code> (step 4 shows this install’s mode).
        </p>

        <div class="actions">
          <button id="submit-btn" type="submit">Create install</button>
          <span id="spinner" class="busy" hidden>Working…</span>
        </div>
      </form>
      <p id="error" class="error" hidden></p>
    </section>

    <!-- Step 2 — LLM provider (optional) -->
    <section id="step-2" hidden>
      <h2>AI provider</h2>
      <p class="sub">
        Exactly one provider is <strong>active</strong> at a time — the one every AI feature uses.
        The key is sealed with AES-256-GCM before it touches the database and is never returned.
        Optional: you can add it later under Admin → LLM providers.
      </p>
      <fieldset id="fs-2" class="plain">
        <form id="provider-form">
          <label for="pv-kind">Kind</label>
          <select id="pv-kind">
            <option value="OPENAI_COMPATIBLE" selected>OpenAI-compatible</option>
            <option value="ANTHROPIC">Anthropic</option>
            <option value="AZURE_OPENAI">Azure OpenAI</option>
          </select>
          <p id="pv-helper" class="hint"></p>

          <label for="pv-baseurl" id="pv-baseurl-label">Base URL (optional)</label>
          <input id="pv-baseurl" type="text" maxlength="500" placeholder="https://api.openai.com/v1">

          <label for="pv-key">API key</label>
          <input id="pv-key" type="password" required minlength="8" maxlength="500" autocomplete="new-password" placeholder="sk-…">
          <p class="hint">Minimum 8 characters — local backends like Ollama ignore it but still need one.</p>

          <label for="pv-model" id="pv-model-label">Text model</label>
          <input id="pv-model" type="text" required maxlength="200" placeholder="gpt-4o-mini">
          <p id="pv-azure-hint" class="hint" hidden>The deployment name you created in Azure — not the underlying model id.</p>

          <div class="actions">
            <button id="pv-add" type="submit">Add &amp; activate</button>
            <span id="pv-spinner" class="busy" hidden>Working…</span>
            <button id="pv-skip" type="button" class="linklike">Skip for now</button>
          </div>
        </form>
        <p id="pv-error" class="error" hidden></p>
        <p id="pv-result" class="ok" hidden></p>
      </fieldset>
    </section>

    <!-- Step 3 — Invite your team (optional) -->
    <section id="step-3" hidden>
      <h2>Invite your team</h2>
      <p class="sub">
        Creates local accounts (email + password) in this company — share each password with the
        person (min 8 characters); there is no email invitation flow in v1. Roles, one sentence each:
      </p>
      <fieldset id="fs-3" class="plain">
        <dl class="kv">
          <dt>ADMIN</dt>
          <dd>Runs the install: LLM providers (incl. the company’s own Azure OpenAI tenant), users, question-pool seals.</dd>
          <dt>RECRUITER</dt>
          <dd>Role intake (reference profile → JD), test blueprints, publishing roles, evaluations, pipeline.</dd>
          <dt>INTERVIEWER</dt>
          <dd>Post-test interviews and scorecards — evidence views, no job management.</dd>
        </dl>
        <div id="invite-rows"></div>
        <div class="actions">
          <button id="iv-add" type="button" class="secondary">+ add another</button>
          <button id="iv-continue" type="button">Continue →</button>
        </div>
      </fieldset>
    </section>

    <!-- Step 4 — Auth mode & finish -->
    <section id="step-4" hidden>
      <h2>Authentication mode</h2>
      <p class="sub">How sign-in is verified on this install — and how to change it.</p>

      <p id="mode-loading" class="hint">Checking auth mode…</p>

      <div id="mode-local" hidden>
        <p><span class="badge green">Current</span> <strong>Local accounts (email + password)</strong></p>
        <p class="hint">
          Sign-in verifies email + password against this install’s database and issues a JWT signed
          with <code>JWT_SECRET</code> — the development default. Users you invited above sign in
          with the passwords you set.
        </p>
        <p class="hint">
          To switch to single sign-on (Keycloak, OIDC): set <code>OIDC_ENABLED=true</code> (plus
          <code>OIDC_ISSUER_URL</code>, <code>OIDC_AUDIENCE</code>) in <code>apps/api/.env</code>
          and restart the API. Full walkthrough: <code>docs/RBAC.md</code>.
        </p>
      </div>

      <div id="mode-oidc" hidden>
        <p><span class="badge green">Current</span> <strong>Keycloak SSO (OIDC)</strong></p>
        <p class="hint">
          Sign-in is verified by your org’s Keycloak realm — RS256 access tokens checked against the
          issuer’s JWKS, realm roles mapped to ADMIN / RECRUITER / INTERVIEWER on every request.
        </p>
        <p class="hint">
          Keycloak admin console: typically <code>http://localhost:8081</code> (this install’s
          issuer default is <code>http://localhost:8081/realms/provahr</code>) — select the provahr
          realm to manage users and roles. Azure AD / SAML / LDAP federate through Keycloak — see
          <code>docs/RBAC.md</code>.
        </p>
      </div>

      <p id="mode-error" class="error" hidden></p>

      <p class="hint mode-note">
        The mode is an environment setting (<code>OIDC_ENABLED</code>) applied at API startup —
        there is deliberately no toggle here. Details: <code>docs/RBAC.md</code>.
      </p>

      <p id="authfail-note" class="error" hidden>
        Automatic sign-in failed after install — the AI provider and team steps were skipped.
        Finish here, then configure them from the app after logging in.
      </p>

      <p class="hint">Sign in as <strong id="finish-email"></strong> if the app asks.</p>
      <button id="finish-btn" type="button" class="big">Finish → open the app</button>
    </section>
  </div>

  <div id="locked" hidden>
    <h2>Already configured</h2>
    <p>This ProvaHR install is already configured.</p>
    <p><a href="/">Open the app</a></p>
  </div>
</main>
<script src="/api/setup/wizard.js" defer></script>
</body>
</html>
`;

export const WIZARD_JS = `'use strict';
(function () {
  // ── State ─────────────────────────────────────────────────────────────────
  var authToken = null;     // auto-login token — a JS variable only, never storage
  var authFailed = false;   // auto-login failed → steps 2–3 disabled, skip to finish
  var providerAdded = false; // step 2 done — its primary button becomes “Continue”
  var modeLoaded = false;

  // ── Elements ──────────────────────────────────────────────────────────────
  function byId(id) { return document.getElementById(id); }

  var wizard = byId('wizard');
  var stepper = byId('stepper');
  var locked = byId('locked');
  var steps = [1, 2, 3, 4].map(function (n) { return byId('step-' + n); });
  var tabs = [1, 2, 3, 4].map(function (n) { return byId('tab-' + n); });
  var form = byId('setup-form');
  var errorBox = byId('error');
  var spinner = byId('spinner');
  var submitBtn = byId('submit-btn');

  // ── Shared helpers ────────────────────────────────────────────────────────
  // Parse any response into { ok, status, body }; non-JSON bodies become {}.
  function readJson(res) {
    return res.json().catch(function () { return {}; })
      .then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
  }

  // Authed JSON fetch — adds the wizard's in-memory Bearer token when present.
  function api(path, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    opts.headers = headers;
    return fetch(path, opts).then(readJson);
  }

  // Render the API error envelope ({ code, message, details[] }) as one line.
  function errText(result, fallback) {
    var err = result.body && result.body.error;
    if (!err) return fallback || 'Request failed (' + result.status + ')';
    var msg = err.message || err.code || 'Request failed';
    if (err.details && err.details.length > 0) {
      msg += ': ' + err.details.map(function (d) { return d.message; }).join(' · ');
    }
    return msg;
  }

  function setMsg(el, text) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setBox(el, cls, text) {
    if (!el) return;
    el.className = cls;
    setMsg(el, text);
  }

  function setBusy(busy) {
    spinner.hidden = !busy;
    submitBtn.disabled = busy;
  }

  // ── Stepper / navigation ──────────────────────────────────────────────────
  function showStep(n) {
    for (var i = 0; i < 4; i++) {
      steps[i].hidden = i + 1 !== n;
      var off = authFailed && (i === 1 || i === 2);
      tabs[i].className = off ? 'off' : i + 1 === n ? 'current' : i + 1 < n ? 'done' : '';
      tabs[i].querySelector('.num').textContent = !off && i + 1 < n ? '\\u2713' : String(i + 1);
      if (i + 1 === n) tabs[i].setAttribute('aria-current', 'step');
      else tabs[i].removeAttribute('aria-current');
    }
  }

  function gotoStep(n) {
    if (n === 4) loadMode();
    showStep(n);
    window.scrollTo(0, 0);
  }

  function showLocked() {
    wizard.hidden = true;
    stepper.hidden = true;
    locked.hidden = false;
  }

  // ── Step 1 — Install ──────────────────────────────────────────────────────
  // On load: if this install is already configured, hard-lock the wizard.
  fetch('/api/setup/status')
    .then(readJson)
    .then(function (data) {
      if (data && data.ok && data.body && data.body.installed) showLocked();
    })
    .catch(function () {
      /* Status unreachable — leave the form visible; submit surfaces errors. */
    });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setMsg(errorBox, '');
    setBusy(true);

    var payload = {
      companyName: byId('companyName').value,
      adminName: byId('adminName').value,
      adminEmail: byId('adminEmail').value,
      adminPassword: byId('adminPassword').value
    };

    fetch('/api/setup/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(readJson)
      .then(function (result) {
        if (result.ok) {
          byId('finish-email').textContent =
            (result.body && result.body.adminEmail) || payload.adminEmail;
          afterInstall(payload);
          return;
        }
        setBusy(false);
        var err = result.body && result.body.error ? result.body.error : {};
        if (err.code === 'ALREADY_INSTALLED') {
          showLocked();
          return;
        }
        setMsg(errorBox, errText(result, 'Setup failed'));
      })
      .catch(function () {
        setBusy(false);
        setMsg(errorBox, 'Could not reach the server. Is the API running?');
      });
  });

  // The admin exists now — sign in with the just-entered credentials so steps
  // 2–3 can call the existing authed endpoints. The token lives only in this
  // page's authToken variable (never localStorage): the wizard is one page
  // view, and the app at / manages its own session.
  function afterInstall(payload) {
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: payload.adminEmail, password: payload.adminPassword })
    })
      .then(readJson)
      .then(function (result) {
        setBusy(false);
        if (result.ok && result.body && result.body.token) {
          authToken = result.body.token;
          gotoStep(2);
        } else {
          markAuthFailed();
        }
      })
      .catch(markAuthFailed);
  }

  // Unlikely (install just succeeded with these credentials) — degrade
  // gracefully: steps 2–3 show as skipped/disabled, finish at step 4.
  function markAuthFailed() {
    setBusy(false);
    authFailed = true;
    byId('fs-2').disabled = true;
    byId('fs-3').disabled = true;
    byId('authfail-note').hidden = false;
    gotoStep(4);
  }

  // ── Step 2 — LLM provider (optional) ──────────────────────────────────────
  // Copy mirrors the admin screen (apps/web/src/admin/ProvidersPage.tsx).
  var KIND_LABEL = {
    OPENAI_COMPATIBLE: 'OpenAI-compatible',
    ANTHROPIC: 'Anthropic',
    AZURE_OPENAI: 'Azure OpenAI'
  };
  var BASE_URL_PLACEHOLDER = {
    OPENAI_COMPATIBLE: 'https://api.openai.com/v1',
    ANTHROPIC: 'https://api.anthropic.com',
    AZURE_OPENAI: 'https://<resource>.openai.azure.com'
  };
  var TEXT_MODEL_PLACEHOLDER = {
    OPENAI_COMPATIBLE: 'gpt-4o-mini',
    ANTHROPIC: 'claude-sonnet-4-20250514',
    AZURE_OPENAI: 'deployment-name'
  };
  var KIND_HELPER = {
    OPENAI_COMPATIBLE: 'Any API that mirrors OpenAI’s /chat/completions — OpenAI, OpenRouter, vLLM, LM Studio, Ollama (from Docker: http://host.docker.internal:11434/v1). baseUrl must include the version segment where the backend uses one; leave it out for OpenAI’s default. textModel is the model id.',
    ANTHROPIC: 'Native Anthropic API. baseUrl is optional (defaults to https://api.anthropic.com — the API appends /v1/messages itself). textModel is the model id.',
    AZURE_OPENAI: 'Your own Azure OpenAI tenant. baseUrl is the resource URL — required, there is no default. textModel is the deployment name you created in Azure AI Foundry / the portal, not the model id. The api-version query parameter is fixed by the adapter.'
  };

  var pvForm = byId('provider-form');
  var pvKind = byId('pv-kind');
  var pvBaseUrl = byId('pv-baseurl');
  var pvKey = byId('pv-key');
  var pvModel = byId('pv-model');
  var pvAdd = byId('pv-add');
  var pvSkip = byId('pv-skip');
  var pvSpinner = byId('pv-spinner');
  var pvError = byId('pv-error');
  var pvResult = byId('pv-result');

  function syncKindUi() {
    var kind = pvKind.value;
    var azure = kind === 'AZURE_OPENAI';
    byId('pv-helper').textContent = KIND_HELPER[kind];
    pvBaseUrl.placeholder = BASE_URL_PLACEHOLDER[kind];
    pvModel.placeholder = TEXT_MODEL_PLACEHOLDER[kind];
    byId('pv-baseurl-label').textContent = azure ? 'Base URL (required)' : 'Base URL (optional)';
    pvBaseUrl.required = azure;
    byId('pv-model-label').textContent = azure ? 'Text model — deployment name' : 'Text model';
    byId('pv-azure-hint').hidden = !azure;
  }
  pvKind.addEventListener('change', syncKindUi);
  syncKindUi();

  function pvSetBusy(busy, label) {
    pvSpinner.hidden = !busy;
    pvAdd.disabled = busy;
    if (label) pvAdd.textContent = label;
  }

  pvForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (providerAdded) { gotoStep(3); return; } // button was relabeled “Continue →”
    setMsg(pvError, '');
    setMsg(pvResult, '');
    pvSetBusy(true, 'Adding…');

    var kind = pvKind.value;
    var body = { kind: kind, apiKey: pvKey.value, textModel: pvModel.value.trim() };
    var baseUrl = pvBaseUrl.value.trim();
    if (baseUrl !== '') body.baseUrl = baseUrl;

    api('/api/admin/llm-providers', { method: 'POST', body: JSON.stringify(body) })
      .then(function (result) {
        if (!result.ok) {
          pvSetBusy(false, 'Add & activate');
          setMsg(pvError, errText(result, 'Could not add the provider'));
          return null;
        }
        var provider = (result.body && result.body.provider) || {};
        return api('/api/admin/llm-providers/' + provider.id + '/activate', { method: 'POST' })
          .then(function (actRes) {
            if (!actRes.ok) {
              pvSetBusy(false, 'Add & activate');
              setMsg(pvError, 'Added, but activation failed — ' + errText(actRes) +
                '. Retry from Admin → LLM providers.');
              return null;
            }
            providerAdded = true;
            var masked = provider.apiKeyLast4 ? ' (key ••••' + provider.apiKeyLast4 + ')' : '';
            setBox(pvResult, 'ok', KIND_LABEL[kind] + ' added and activated' + masked +
              ' — testing the connection…');
            // Auto-test: informational only — a failure never blocks advancing.
            return api('/api/admin/llm-providers/' + provider.id + '/test', { method: 'POST' })
              .then(function (testRes) {
                pvSetBusy(false, 'Continue →');
                pvSkip.hidden = true;
                if (testRes.ok) {
                  var t = testRes.body || {};
                  setBox(pvResult, 'ok', 'Active — round-trip OK: ' + (t.model || 'model') +
                    ' replied “' + (t.reply || '') + '” in ' +
                    (t.latencyMs != null ? t.latencyMs : '?') + ' ms.');
                } else {
                  setBox(pvResult, 'note', 'Active — but the live test failed: ' +
                    errText(testRes) + '. You can retry from Admin → LLM providers.');
                }
              });
          });
      })
      .catch(function () {
        pvSetBusy(false, providerAdded ? 'Continue →' : 'Add & activate');
        setMsg(pvError, 'Could not reach the server.');
      });
  });

  pvSkip.addEventListener('click', function () { gotoStep(3); });

  // ── Step 3 — Invite your team (optional) ──────────────────────────────────
  // Up to three rows, each its own <form> so native validation applies and
  // each POST /api/users outcome renders per-row. Rows are built with DOM
  // APIs (no innerHTML) — user-entered text only ever passes through
  // textContent, so nothing can inject markup.
  var inviteRows = byId('invite-rows');
  var ivAdd = byId('iv-add');
  var rowCount = 0;

  function addInviteRow() {
    if (rowCount >= 3) return;
    rowCount += 1;
    var n = rowCount;

    var rowForm = document.createElement('form');
    rowForm.className = 'invite-row';

    function appendField(parent, suffix, labelText, input) {
      var id = 'iv-' + suffix + '-' + n;
      var label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = labelText;
      input.id = id;
      parent.appendChild(label);
      parent.appendChild(input);
    }

    var grid = document.createElement('div');
    grid.className = 'grid2';

    var name = document.createElement('input');
    name.type = 'text';
    name.required = true;
    name.minLength = 2;
    name.maxLength = 120;
    name.setAttribute('autocomplete', 'off');
    appendField(grid, 'name', 'Name', name);

    var email = document.createElement('input');
    email.type = 'email';
    email.required = true;
    email.maxLength = 200;
    email.setAttribute('autocomplete', 'off');
    appendField(grid, 'email', 'Email', email);

    var pw = document.createElement('input');
    pw.type = 'password';
    pw.required = true;
    pw.minLength = 8;
    pw.maxLength = 100;
    pw.setAttribute('autocomplete', 'new-password');
    appendField(grid, 'pw', 'Password', pw);

    var role = document.createElement('select');
    ['ADMIN', 'RECRUITER', 'INTERVIEWER'].forEach(function (r, i) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === 'RECRUITER') opt.selected = true;
      role.appendChild(opt);
    });
    appendField(grid, 'role', 'Role', role);

    var out = document.createElement('p');
    out.hidden = true;

    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = 'Invite';

    var actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(btn);

    rowForm.appendChild(grid);
    rowForm.appendChild(out);
    rowForm.appendChild(actions);
    inviteRows.appendChild(rowForm);

    if (rowCount >= 3) ivAdd.hidden = true;

    rowForm.addEventListener('submit', function (event) {
      event.preventDefault();
      out.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Inviting…';
      api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.value.trim(),
          email: email.value.trim(),
          password: pw.value,
          role: role.value
        })
      })
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = 'Invite';
          if (result.ok) {
            var who = (result.body && result.body.user && result.body.user.name) || name.value.trim();
            rowForm.reset();
            setBox(out, 'ok', who + ' can now sign in at /login with this email and password.');
            return;
          }
          var code = result.body && result.body.error ? result.body.error.code : '';
          setBox(out, 'error', code === 'EMAIL_TAKEN'
            ? 'An account with this email already exists — each person gets exactly one account.'
            : errText(result, 'Could not create the user'));
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = 'Invite';
          setBox(out, 'error', 'Could not reach the server.');
        });
    });
  }

  ivAdd.addEventListener('click', addInviteRow);
  byId('iv-continue').addEventListener('click', function () { gotoStep(4); });
  addInviteRow(); // start with one row

  // ── Step 4 — Auth mode & finish ───────────────────────────────────────────
  // GET /api/auth/mode is public and boolean-only; both cards are prerendered
  // in the HTML and just toggled. Copy mirrors the admin settings screen.
  function loadMode() {
    if (modeLoaded) return;
    modeLoaded = true;
    fetch('/api/auth/mode')
      .then(readJson)
      .then(function (result) {
        byId('mode-loading').hidden = true;
        var mode = result.ok && result.body ? result.body.mode : null;
        if (mode === 'local') byId('mode-local').hidden = false;
        else if (mode === 'oidc') byId('mode-oidc').hidden = false;
        else setMsg(byId('mode-error'), 'Could not read the auth mode — see docs/RBAC.md.');
      })
      .catch(function () {
        byId('mode-loading').hidden = true;
        setMsg(byId('mode-error'), 'Could not read the auth mode — see docs/RBAC.md.');
      });
  }

  byId('finish-btn').addEventListener('click', function () {
    window.location.href = '/';
  });
})();
`;

// ── Routes (mounted at /api/setup; the page itself is also served at /setup) ─
const router = Router();

/** Boolean-only install status — safe to expose before configuration. */
router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ installed: await isInstalled() });
}));

/** The wizard page (also reachable directly at /api/setup). */
router.get('/', (_req, res) => {
  res.type('html').send(WIZARD_HTML);
});

/** Same-origin wizard script — kept external because helmet's CSP blocks
 *  inline <script> (script-src 'self'). */
router.get('/wizard.js', (_req, res) => {
  res.type('application/javascript').send(WIZARD_JS);
});

/** Bootstrap company + first admin. Rate-limited; locks once installed. */
router.post(
  '/install',
  (req, _res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!allowRequest(ip)) {
      next(new AppError(429, 'Too many setup attempts — try again later', 'RATE_LIMITED'));
      return;
    }
    next();
  },
  asyncHandler(async (req, res) => {
    const input = installSchema.parse(req.body);
    const admin = await install(input);
    res.status(201).json({ installed: true, adminEmail: admin.email });
  }),
);

export default router;
