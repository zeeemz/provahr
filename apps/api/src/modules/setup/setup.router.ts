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
//
// WIZARD v3 (PLAN.md §12 D18, V2-1): the wizard bootstraps the PLATFORM SUPER
// ADMIN only. Step 1 collects those credentials; the old steps 2 (AI provider)
// and 3 (team invites) were company-creation concerns and moved to the
// super-admin console (POST /api/platform/companies with firstAdmin); step 2
// here (formerly step 4) is the auth-mode readout + finish.
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
  button.big { width: 100%; padding: 13px 16px; font-size: 1rem; }
  .error {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #fdecec; border: 1px solid #f5b5b5; border-radius: 6px; color: #8a1f1f;
  }
  .note {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #e9f1fb; border: 1px solid #bcd4f0; border-radius: 6px; color: #123c6b;
  }
  .busy { margin-left: 10px; font-size: 0.85rem; color: #5c6470; }
  code { background: #eef0f3; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }

  /* Stepper: 1 Install · 2 Finish */
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

  .actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

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
  <p class="sub">First-run configuration — the platform super admin, then you are in.</p>

  <ol id="stepper" class="stepper" aria-label="Setup progress">
    <li id="tab-1" class="current"><span class="num">1</span><span class="lbl">Install</span></li>
    <li id="tab-2"><span class="num">2</span><span class="lbl">Finish</span></li>
  </ol>

  <div id="wizard">
    <!-- Step 1 — Install (the platform super admin; no company here — D18) -->
    <section id="step-1">
      <h2>Create the platform</h2>
      <p class="sub">
        This account is the <strong>super admin</strong>: it owns the install — companies
        (tenants), their admins, and platform settings. Companies are created after
        setup, from the super admin console.
      </p>
      <form id="setup-form">
        <label for="adminName">Your name</label>
        <input id="adminName" type="text" autocomplete="name" required minlength="2" maxlength="120">

        <label for="adminEmail">Super admin email</label>
        <input id="adminEmail" type="email" autocomplete="email" required maxlength="200">

        <label for="adminPassword">Password</label>
        <input id="adminPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="100">
        <p class="hint">At least 8 characters. Keep it — you will use it to sign in.</p>

        <p class="hint mode-hint">
          Authentication mode (local vs Keycloak) is switchable after install from the
          super admin console (step 2 shows this install&rsquo;s current mode).
        </p>

        <div class="actions">
          <button id="submit-btn" type="submit">Create platform</button>
          <span id="spinner" class="busy" hidden>Working…</span>
        </div>
      </form>
      <p id="error" class="error" hidden></p>
    </section>

    <!-- Step 2 — Auth mode & finish -->
    <section id="step-2" hidden>
      <h2>Platform installed</h2>
      <p class="sub">How sign-in is verified on this install — and what comes next.</p>

      <p id="mode-loading" class="hint">Checking auth mode…</p>

      <div id="mode-local" hidden>
        <p><span class="badge green">Current</span> <strong>Local accounts (email + password)</strong></p>
        <p class="hint">
          Sign-in verifies email + password against this install&rsquo;s database and issues a JWT signed
          with <code>JWT_SECRET</code> — the development default.
        </p>
      </div>

      <div id="mode-oidc" hidden>
        <p><span class="badge green">Current</span> <strong>Keycloak SSO (OIDC)</strong></p>
        <p class="hint">
          Sign-in is verified by your org&rsquo;s Keycloak realm — RS256 access tokens checked against the
          issuer&rsquo;s JWKS, realm roles mapped to ADMIN / RECRUITER / INTERVIEWER on every request.
        </p>
      </div>

      <p id="mode-error" class="error" hidden></p>

      <p class="hint mode-note">
        The mode is now a platform setting: the super admin switches it in the console
        (Platform → Settings). Keycloak verification for the switch lands with V2-3 —
        until then the boot-time environment setting keeps deciding which verifier runs.
      </p>

      <div class="note">
        Next: sign in as the super admin and create your first company (with its admin)
        from <strong>Platform → Companies</strong>.
      </div>

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
  // ── Elements ──────────────────────────────────────────────────────────────
  function byId(id) { return document.getElementById(id); }

  var wizard = byId('wizard');
  var stepper = byId('stepper');
  var locked = byId('locked');
  var steps = [1, 2].map(function (n) { return byId('step-' + n); });
  var tabs = [1, 2].map(function (n) { return byId('tab-' + n); });
  var form = byId('setup-form');
  var errorBox = byId('error');
  var spinner = byId('spinner');
  var submitBtn = byId('submit-btn');
  var modeLoaded = false;

  // ── Shared helpers ────────────────────────────────────────────────────────
  // Parse any response into { ok, status, body }; non-JSON bodies become {}.
  function readJson(res) {
    return res.json().catch(function () { return {}; })
      .then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
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

  function setBusy(busy) {
    spinner.hidden = !busy;
    submitBtn.disabled = busy;
  }

  // ── Stepper / navigation ──────────────────────────────────────────────────
  function showStep(n) {
    for (var i = 0; i < 2; i++) {
      steps[i].hidden = i + 1 !== n;
      tabs[i].className = i + 1 === n ? 'current' : i + 1 < n ? 'done' : '';
      tabs[i].querySelector('.num').textContent = i + 1 < n ? '\\u2713' : String(i + 1);
      if (i + 1 === n) tabs[i].setAttribute('aria-current', 'step');
      else tabs[i].removeAttribute('aria-current');
    }
  }

  function gotoStep(n) {
    if (n === 2) loadMode();
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
        setBusy(false);
        if (result.ok) {
          byId('finish-email').textContent =
            (result.body && result.body.adminEmail) || payload.adminEmail;
          gotoStep(2);
          return;
        }
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

  // ── Step 2 — Auth mode readout & finish ───────────────────────────────────
  // GET /api/auth/mode is public and boolean-only; both cards are prerendered
  // in the HTML and just toggled. Since D19 the mode is platform data — the
  // super admin switches it in the console; this step only reports it.
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

/** Bootstrap the platform super admin. Rate-limited; locks once installed. */
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
