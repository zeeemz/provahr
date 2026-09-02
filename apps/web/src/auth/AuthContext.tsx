// Auth state: dev-mode JWT (email/password) in localStorage, /auth/me on boot.
// Keycloak users authenticate against the API the same way in dev mode.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from '../api/client';
import type { AuthResponse, PublicUser, RegisterInput, Role } from '../api/types';
import { Spinner } from '../components/ui';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: PublicUser }>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // Stale/invalid token — drop it; the user just logs in again.
        if (!cancelled) setToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await api.post<AuthResponse>('/auth/register', input);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Route guard: requires a session; optionally a minimum role. */
export function RequireAuth({
  children,
  requireRole,
}: {
  children: ReactNode;
  /** When set, only these roles may enter (recruiter+ = ADMIN | RECRUITER). */
  requireRole?: readonly Role[];
}): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="page narrow">
        <Spinner label="Checking your session…" />
      </main>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (requireRole && !requireRole.includes(user.role)) {
    return (
      <main className="page narrow">
        <div className="card">
          <h2>Not allowed</h2>
          <p>
            This area requires the <code>{requireRole.join(' or ')}</code> role. You are signed in
            as <code>{user.role}</code>.
          </p>
          <p className="sub mt0">Evidence views are read-only; job management is recruiter+.</p>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

/** True when the user may manage jobs (mirrors the API's requireRole guards). */
export function isRecruiterPlus(user: PublicUser | null): boolean {
  return user !== null && (user.role === 'ADMIN' || user.role === 'RECRUITER');
}
