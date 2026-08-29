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
    width: 100%; max-width: 440px; padding: 32px;
    background: #ffffff; border: 1px solid #e3e5e8; border-radius: 10px;
  }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 0 0 8px; }
  .sub { margin: 0 0 20px; color: #5c6470; font-size: 0.92rem; }
  label { display: block; font-size: 0.85rem; font-weight: 600; margin: 14px 0 4px; }
  input {
    width: 100%; padding: 9px 10px; font: inherit;
    border: 1px solid #c9cdd3; border-radius: 6px; background: #fff; color: inherit;
  }
  input:focus { outline: 2px solid #2563eb; outline-offset: 0; border-color: #2563eb; }
  .hint { margin: 6px 0 0; font-size: 0.8rem; color: #5c6470; }
  .mode-hint { margin-top: 18px; }
  button {
    margin-top: 20px; padding: 10px 16px; font: inherit; font-weight: 600;
    color: #fff; background: #1d4ed8; border: 0; border-radius: 6px; cursor: pointer;
  }
  button:hover { background: #1e40af; }
  button:disabled { opacity: 0.6; cursor: default; }
  .error {
    margin: 14px 0 0; padding: 10px 12px; font-size: 0.88rem;
    background: #fdecec; border: 1px solid #f5b5b5; border-radius: 6px; color: #8a1f1f;
  }
  .busy { margin-left: 10px; font-size: 0.85rem; color: #5c6470; }
  code { background: #eef0f3; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  #done p, #locked p { margin: 6px 0; }
</style>
</head>
<body>
<main class="card">
  <h1>ProvaHR — Setup</h1>
  <p class="sub">First-run configuration: create your company and the first admin account.</p>

  <div id="form-wrap">
    <form id="setup-form">
      <label for="companyName">Company name</label>
      <input id="companyName" type="text" autocomplete="organization" required minlength="2" maxlength="120">

      <label for="adminName">Your name</label>
      <input id="adminName" type="text" autocomplete="name" required minlength="2" maxlength="120">

      <label for="adminEmail">Admin email</label>
      <input id="adminEmail" type="email" autocomplete="email" required maxlength="200">

      <label for="adminPassword">Admin password</label>
      <input id="adminPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="100">
      <p class="hint">At least 8 characters.</p>

      <p class="hint mode-hint">
        Authentication mode (local vs Keycloak) is configured via the environment — see
        <code>docs/RBAC.md</code>.
      </p>

      <button id="submit-btn" type="submit">Create install</button>
      <span id="spinner" class="busy" hidden>Working…</span>
    </form>
    <p id="error" class="error" hidden></p>
  </div>

  <div id="locked" hidden>
    <h2>Already configured</h2>
    <p>This ProvaHR install is already configured.</p>
  </div>

  <div id="done" hidden>
    <h2>Setup complete ✓</h2>
    <p>You can now sign in as <strong id="done-email"></strong>.</p>
    <p>API: <code>POST /api/auth/login</code></p>
    <p>Docs: <code>docs/RBAC.md</code>, <code>docs/PLAN.md</code></p>
  </div>
</main>
<script src="/api/setup/wizard.js" defer></script>
</body>
</html>
`;

export const WIZARD_JS = `'use strict';
(function () {
  var form = document.getElementById('setup-form');
  var formWrap = document.getElementById('form-wrap');
  var locked = document.getElementById('locked');
  var done = document.getElementById('done');
  var errorBox = document.getElementById('error');
  var spinner = document.getElementById('spinner');
  var submitBtn = document.getElementById('submit-btn');

  function showError(message) {
    errorBox.textContent = message || 'Something went wrong. Please try again.';
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function setBusy(busy) {
    spinner.hidden = !busy;
    submitBtn.disabled = busy;
  }

  // On load: if this install is already configured, drop the form.
  fetch('/api/setup/status')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.installed) {
        formWrap.hidden = true;
        locked.hidden = false;
      }
    })
    .catch(function () {
      /* Status unreachable — leave the form visible; submit surfaces errors. */
    });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();
    setBusy(true);

    var payload = {
      companyName: document.getElementById('companyName').value,
      adminName: document.getElementById('adminName').value,
      adminEmail: document.getElementById('adminEmail').value,
      adminPassword: document.getElementById('adminPassword').value
    };

    fetch('/api/setup/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (result) {
        setBusy(false);
        if (result.ok) {
          formWrap.hidden = true;
          done.hidden = false;
          document.getElementById('done-email').textContent =
            result.body.adminEmail || payload.adminEmail;
          return;
        }
        var err = result.body && result.body.error ? result.body.error : {};
        if (err.code === 'ALREADY_INSTALLED') {
          formWrap.hidden = true;
          locked.hidden = false;
          return;
        }
        var message = err.message || 'Setup failed (' + (err.code || 'unknown error') + ')';
        if (err.details && err.details.length > 0) {
          message = message + ': ' + err.details
            .map(function (d) { return d.message; })
            .join(' · ');
        }
        showError(message);
      })
      .catch(function () {
        setBusy(false);
        showError('Could not reach the server. Is the API running?');
      });
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
