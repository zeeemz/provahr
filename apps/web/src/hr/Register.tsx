// Platform bootstrap — POST /api/auth/register creates the install's SUPER
// ADMIN (D18: no company; tenants come from the platform console). 409s once
// a super admin exists — the first-run wizard at /setup is the guided path.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function Register(): JSX.Element {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <div className="card">
        <h1>Create the platform</h1>
        <p className="sub">
          Creates this install&rsquo;s <strong>super admin</strong> — the account that owns companies
          and platform settings. Only works on an empty install; afterwards the{' '}
          <Link to="/login">sign-in</Link> page is the way in.
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <label className="field" htmlFor="rg-name">Your name</label>
          <input id="rg-name" type="text" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />

          <label className="field" htmlFor="rg-email">Email</label>
          <input id="rg-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />

          <label className="field" htmlFor="rg-pw">Password</label>
          <input id="rg-pw" type="password" required minLength={8} maxLength={100} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="hint">At least 8 characters.</p>

          {error !== null && <p className="form-error">{error}</p>}
          <p>
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create platform'}</button>
          </p>
        </form>
      </div>
    </main>
  );
}
