// HR login — POST /api/auth/login (dev-mode email/password JWT).

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function Login(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <div className="card">
        <h1>Sign in</h1>
        <p className="sub">ProvaHR HR console — hiring on proof, not polish.</p>
        <form onSubmit={(e) => void submit(e)}>
          <label className="field" htmlFor="lg-email">Email</label>
          <input id="lg-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <label className="field" htmlFor="lg-pw">Password</label>
          <input id="lg-pw" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

          {error !== null && <p className="form-error">{error}</p>}
          <p>
            <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </p>
        </form>
        <p className="hint">
          First run? <Link to="/register">Create the platform super admin</Link> (only works on an
          empty install — after that, the API&apos;s <code>/setup</code> wizard locks itself).
        </p>
      </div>
    </main>
  );
}
