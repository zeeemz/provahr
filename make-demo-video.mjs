// Demo video frame capturer — drives real Chrome (headless) through the
// two-tier prompt feature and saves a PNG per state. ffmpeg stitches the video.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'demo-frames';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
let n = 0;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `${OUT}/${String(n++).padStart(2, '0')}-${name}.png` });

const login = async (email, pw) => {
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await wait(600);
  await page.evaluate(async (e, p) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
    const j = await r.json();
    localStorage.setItem('provahr_token', j.token);
  }, email, pw);
};

const scrollToSelector = async (text) => {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('h1,h2,h3,strong,label')].find(x => x.textContent.toLowerCase().includes(t));
    el?.scrollIntoView({ block: 'center' });
  }, text);
  await wait(400);
};

// ── Title card (rendered locally) ─────────────────────────────────────────────
await page.setContent(`<html><body style="margin:0;background:#10131a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center">
<div style="font-size:64px;font-weight:700">ProvaHR</div>
<div style="font-size:24px;color:#8fa3c0;margin-top:8px">Two-tier system prompts — recorded demo</div>
<div style="font-size:16px;color:#5b6b82;margin-top:18px">Main prompt (super admin) + Role prompt (HR) → composed into every AI request</div>
</div></body></html>`);
await shot('title');

// ── Super admin: platform console + main prompt ──────────────────────────────
await login('founder@provahr.demo', 'demo-password-123');
await page.goto('http://localhost:5173/app/platform', { waitUntil: 'domcontentloaded' });
await wait(1800);
await shot('platform-console');

await scrollToSelector('main system prompt');
await shot('main-prompt-card');

// Edit + save
await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  if (ta) {
    ta.focus();
    ta.value = 'PLATFORM RULES (every AI generation):\n1) Ground every fact in the material — invent nothing.\n2) Inclusive, jargon-light tone for a worldwide audience.\n3) Difficulty spans easy→hard; never trick questions.\n4) Evaluations stay advisory — a human decides.\n\n[edited by the SUPER ADMIN — company admins can read but not change this]';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await wait(400);
await shot('main-prompt-edited');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /save main prompt/i.test(b.textContent))?.click());
await wait(1600);
await shot('main-prompt-saved');

// ── HR user: job console, AI prompts card ────────────────────────────────────
await login('rebecca@acme.test', 'acme-password-123');
const jobs = await page.evaluate(async () => {
  const t = localStorage.getItem('provahr_token');
  const r = await fetch('/api/jobs', { headers: { Authorization: `Bearer ${t}` } });
  return (await r.json()).jobs.map(j => j.id);
});
const job = jobs[0];
await page.goto(`http://localhost:5173/app/jobs/${job}`, { waitUntil: 'domcontentloaded' });
await wait(1800);
await page.evaluate(() => { const d = document.querySelector('details'); if (d) d.open = true; });
await scrollToSelector('ai prompts');
await shot('hr-ai-prompts-card');

await page.evaluate(() => {
  const tas = [...document.querySelectorAll('textarea')];
  const ta = tas.find(t => t.placeholder && t.placeholder.length === 0) || tas[tas.length - 1];
  if (ta) {
    ta.focus();
    ta.value = 'ROLE PROMPT — Staff SRE (Payments): emphasize incident-response leadership, Postgres operations, and mentoring; the test must weigh troubleshooting over trivia.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await wait(400);
await shot('role-prompt-edited');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /save role prompt/i.test(b.textContent))?.click());
await wait(1600);
await shot('role-prompt-saved');

// ── Proof: generated content carries both tiers ──────────────────────────────
// New intake so the JD is drafted WITH the job prompt (set it fast, before the worker claims)
await page.goto('http://localhost:5173/app/jobs', { waitUntil: 'domcontentloaded' });
await wait(1200);
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find(t => /person & role/i.test(t.placeholder || ''));
  if (ta) { ta.focus(); ta.value = 'Staff-level SRE who ran incident response for a payments platform and teaches incident reviews.'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
});
await shot('intake-form');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create role & draft JD')?.click());
await wait(2500);
// immediately set the role prompt on the new job (worker polls every 2s — race it)
const newJobUrl = page.url();
const newJobId = newJobUrl.split('/').pop();
await page.evaluate(async (jid) => {
  const t = localStorage.getItem('provahr_token');
  await fetch(`/api/jobs/${jid}/prompt`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobPrompt: 'ROLE PROMPT — Staff SRE (Payments): emphasize incident response, Postgres ops, mentoring; troubleshooting over trivia.' }) });
}, newJobId);
// wait for JD review
for (let i = 0; i < 12; i++) { await wait(2000); if (/jd review/i.test(await page.evaluate(() => document.body.innerText))) break; }
await scrollToSelector('job description');
await shot('jd-drafted-with-prompts');
// zoom on the summary marker
const hasMarker = await page.evaluate(() => document.body.innerText.includes('prompts received'));
if (hasMarker) {
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => /prompts received/i.test(t.value || ''));
    if (ta) { ta.scrollIntoView({ block: 'center' }); ta.style.outline = '3px solid #2563eb'; }
  });
  await wait(400);
  await shot('jd-marker-highlighted');
}
// samples with markers
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /approve/i.test(b.textContent))?.click());
await wait(2000);
await page.evaluate(() => {
  const tas = [...document.querySelectorAll('textarea')];
  const tp = tas.find(t => /kubernetes/i.test(t.placeholder || ''));
  if (tp) { tp.focus(); tp.value = 'bash, incidents'; tp.dispatchEvent(new Event('input', { bubbles: true })); }
  const sp = document.querySelector('input[type=number]');
});
await page.evaluate(() => {
  const nums = [...document.querySelectorAll('input[type=number]')];
  const set = (el, v) => { if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  set(nums[0], '1'); set(nums[3], '1');
});
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create blueprint')?.click());
await wait(2200);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /generate samples/i.test(b.textContent))?.click());
for (let i = 0; i < 12; i++) { await wait(2000); if (/both prompt tiers applied|platform tier/i.test(await page.evaluate(() => document.body.innerText))) break; }
await scrollToSelector('sample');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && /both prompt tiers applied/i.test(x.textContent || ''));
  if (el) { el.scrollIntoView({ block: 'center' }); el.style.outline = '3px solid #16a34a'; }
});
await shot('samples-with-both-tiers');
// sealed pool
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Generate & seal pool/i.test(b.textContent))?.click());
for (let i = 0; i < 10; i++) { await wait(2000); if (/Active pool: \d+ items/i.test(await page.evaluate(() => document.body.innerText))) break; }
await scrollToSelector('sealed question pool');
await shot('pool-sealed');

// ── End card ──────────────────────────────────────────────────────────────────
await page.setContent(`<html><body style="margin:0;background:#10131a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center;font-size:22px;color:#8fa3c0">
Both prompts travelled with every AI request.<br/><br/>
<b style="color:#fff">Platform tier</b>: super-admin only · visible to all<br/>
<b style="color:#fff">Role tier</b>: HR-editable per job<br/><br/>
Proof: generated items carry <span style="color:#16a34a">[both prompt tiers applied]</span>
</div></body></html>`);
await shot('end');

await browser.close();
console.log('captured', n, 'frames');
