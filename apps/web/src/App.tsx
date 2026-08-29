// App shell + routes.
//
// Public:   /                job board
//           /jobs/:id        detail + apply (one-time test link)
//           /test/:token     consent → proctored session → "Submitted ✓"
// Auth:     /login /register
// HR (/app): dashboard · roles (intake wizard) · job console · pipeline ·
//            application detail + X-ray.
// Admin (/app/admin/*): LLM providers · team & RBAC · authentication — ADMIN
//            only (double-gated: nav links + RequireAuth requireRole).
// Platform (/app/platform): tenants + platform settings — SUPER_ADMIN only
//            (D18). Super admins own no company, so the company-scoped nav
//            (dashboard/roles/admin) is hidden for them and /app lands on
//            the platform console instead.

import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth, useAuth } from './auth/AuthContext';
import Dashboard from './hr/Dashboard';
import JobsPage from './hr/JobsPage';
import JobConsole from './hr/JobConsole';
import Pipeline from './hr/Pipeline';
import ApplicationDetail from './hr/ApplicationDetail';
import Login from './hr/Login';
import Register from './hr/Register';
import ProvidersPage from './admin/ProvidersPage';
import TeamPage from './admin/TeamPage';
import SettingsPage from './admin/SettingsPage';
import PlatformPage from './platform/PlatformPage';
import JobBoard from './public/JobBoard';
import JobDetail from './public/JobDetail';
import TestFlow from './public/TestFlow';
import type { Role } from './api/types';

const ADMIN_ONLY: readonly Role[] = ['ADMIN'];
const SUPER_ADMIN_ONLY: readonly Role[] = ['SUPER_ADMIN'];

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<JobBoard />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/test/:token" element={<TestFlow />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>
        <Route path="/app" element={<RequireAuth><HrLayout /></RequireAuth>}>
          <Route index element={<AppIndex />} />
          <Route path="platform" element={
            <RequireAuth requireRole={SUPER_ADMIN_ONLY}>
              <PlatformPage />
            </RequireAuth>
          } />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:id" element={<JobConsole />} />
          <Route path="jobs/:id/pipeline" element={<Pipeline />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route
            path="admin/providers"
            element={
              <RequireAuth requireRole={ADMIN_ONLY}>
                <ProvidersPage />
              </RequireAuth>
            }
          />
          <Route
            path="admin/team"
            element={
              <RequireAuth requireRole={ADMIN_ONLY}>
                <TeamPage />
              </RequireAuth>
            }
          />
          <Route
            path="admin/settings"
            element={
              <RequireAuth requireRole={ADMIN_ONLY}>
                <SettingsPage />
              </RequireAuth>
            }
          />
        </Route>
        <Route
          path="*"
          element={
            <main className="page narrow">
              <div className="card">
                <h2>Page not found</h2>
                <p>Nothing lives at this URL.</p>
              </div>
            </main>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

/** Public + auth pages share a quiet header; the test session is chrome-free. */
function PublicLayout(): JSX.Element {
  const location = useLocation();
  const bare = location.pathname.startsWith('/test/');
  if (bare) return <Outlet />; // nothing distracts from the clock
  return (
    <>
      <AppHeader />
      <Outlet />
    </>
  );
}

/**
 * /app landing: the platform super admin (no company) lands on the platform
 * console; everyone else on the company dashboard.
 */
function AppIndex(): JSX.Element {
  const { user } = useAuth();
  return user !== null && user.role === 'SUPER_ADMIN' ? <PlatformPage /> : <Dashboard />;
}

function HrLayout(): JSX.Element {
  return (
    <>
      <AppHeader />
      <Outlet />
    </>
  );
}

function AppHeader(): JSX.Element {
  const { user, logout } = useAuth();
  return (
    <header className="appbar">
      <div className="appbar-inner">
        <NavLink to="/" className="brand">
          Prova<span>HR</span>
        </NavLink>
        {user !== null && (
          <nav>
            {user.role === 'SUPER_ADMIN' ? (
              // Super admins own no company (D18): company-scoped links stay
              // hidden — their whole console is the platform one.
              <NavLink
                to="/app/platform"
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                Platform
              </NavLink>
            ) : (
              <>
                <NavLink to="/app" className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  Dashboard
                </NavLink>
                <NavLink to="/app/jobs" className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  Roles
                </NavLink>
                {user.role === 'ADMIN' && (
                  <>
                    <span className="nav-group-label">Admin</span>
                    <NavLink
                      to="/app/admin/providers"
                      className={({ isActive }) => (isActive ? 'active' : undefined)}
                    >
                      Providers
                    </NavLink>
                    <NavLink
                      to="/app/admin/team"
                      className={({ isActive }) => (isActive ? 'active' : undefined)}
                    >
                      Team
                    </NavLink>
                    <NavLink
                      to="/app/admin/settings"
                      className={({ isActive }) => (isActive ? 'active' : undefined)}
                    >
                      Auth
                    </NavLink>
                  </>
                )}
              </>
            )}
          </nav>
        )}
        <span className="spacer" />
        {user !== null ? (
          <>
            <span className="who">
              {user.name} · {user.role}
            </span>
            <button type="button" className="secondary small" onClick={logout}>
              Sign out
            </button>
          </>
        ) : (
          <nav>
            <NavLink to="/login">Sign in</NavLink>
          </nav>
        )}
      </div>
    </header>
  );
}
