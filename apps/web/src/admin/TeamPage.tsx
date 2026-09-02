// Admin: team & RBAC (/app/admin/team).
//
// GET /api/users lists the caller's company members (all roles — colleagues
// see each other); POST /api/users is admin-only and creates a local account
// (name/email/password/role). 409 EMAIL_TAKEN and validation errors render
// inline under the invite form. Role semantics come from PLAN §3.

import { useEffect, useState } from 'react';
import { api, ApiError, errMessage } from '../api/client';
import type { CreateUserInput, Role, UserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ApiErrorScreen, Spinner, fmtDate } from '../components/ui';

const ROLES: readonly Role[] = ['ADMIN', 'RECRUITER', 'INTERVIEWER'];

const ROLE_BADGE_CLASS: Record<Role, string> = {
  SUPER_ADMIN: 'badge red', // platform-level (D18) — never invited from here
  ADMIN: 'badge blue',
  RECRUITER: 'badge green',
  INTERVIEWER: 'badge amber',
};

/** One sentence per role — mirrors PLAN §3 (role matrix). */
const ROLE_EXPLAINERS: Record<Role, string> = {
  SUPER_ADMIN: 'Platform owner (created by the install wizard): companies, platform settings — not a member of any company.',
  ADMIN: 'Runs the install: LLM providers (incl. the company’s own Azure OpenAI tenant), users, question-pool seals.',
  RECRUITER: 'Role intake (reference profile → JD), test blueprints, publishing roles, evaluations, pipeline.',
  INTERVIEWER: 'Post-test interviews and scorecards — evidence views, no job management.',
};

export default function TeamPage(): JSX.Element {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ users: UserRow[] }>('/users')
      .then((res) => {
        if (!cancelled) {
          setUsers(res.users);
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

  return (
    <main className="page">
      <h1>Team</h1>
      <p className="sub">
        Everyone in this company&rsquo;s workspace. Roles decide what each person can do —
        one sentence each:
      </p>
      <div className="card">
        <dl className="kv">
          {ROLES.map((role) => (
            <div key={role}>
              <dt style={{ marginTop: 4 }}><span className={ROLE_BADGE_CLASS[role]}>{role}</span></dt>
              <dd>{ROLE_EXPLAINERS[role]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && users === null && <Spinner label="Loading team…" />}

      {users !== null && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    {me !== null && u.id === me.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td><span className={ROLE_BADGE_CLASS[u.role]}>{u.role}</span></td>
                  <td className="muted">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteForm onCreated={() => setReloadKey((k) => k + 1)} />
    </main>
  );
}

function InviteForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('RECRUITER');
  const [error, setError] = useState<string | null>(null);
  const [okNote, setOkNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setOkNote(null);
    const input: CreateUserInput = {
      name: name.trim(),
      email: email.trim(),
      password,
      role,
    };
    setBusy(true);
    try {
      const res = await api.post<{ user: { name: string } }>('/users', input);
      setName('');
      setEmail('');
      setPassword('');
      setRole('RECRUITER');
      setOkNote(`${res.user.name} can now sign in at /login with this email and password.`);
      onCreated();
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
    <div className="card">
      <h2>Invite user</h2>
      <p className="sub">
        Creates a local account (email + password) in this company. Share the password with the
        person — they change nothing here; there is no email invitation flow in v1.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field" htmlFor="iv-name">Name</label>
        <input
          id="iv-name"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="field" htmlFor="iv-email">Email</label>
        <input
          id="iv-email"
          type="email"
          required
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="field" htmlFor="iv-pw">Password</label>
        <input
          id="iv-pw"
          type="password"
          required
          minLength={8}
          maxLength={100}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="hint">At least 8 characters.</p>

        <label className="field" htmlFor="iv-role">Role</label>
        <select id="iv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <p className="hint">{ROLE_EXPLAINERS[role]}</p>

        {error !== null && <p className="form-error">{error}</p>}
        {okNote !== null && <p className="form-ok">{okNote}</p>}
        <p>
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Invite user'}</button>
        </p>
      </form>
    </div>
  );
}
