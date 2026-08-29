// App shell + routes.
//
// Public:   /                job board
//           /jobs/:id        detail + apply (one-time test link)
//           /test/:token     consent → proctored session → "Submitted ✓"
// Auth:     /login /register
// HR (/app): dashboard · roles (intake wizard) · job console · pipeline ·
//            application detail + X-ray.

import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth, useAuth } from './auth/AuthContext';
import Dashboard from './hr/Dashboard';
import JobsPage from './hr/JobsPage';
import JobConsole from './hr/JobConsole';
import Pipeline from './hr/Pipeline';
import ApplicationDetail from './hr/ApplicationDetail';
import Login from './hr/Login';
import Register from './hr/Register';
import JobBoard from './public/JobBoard';
import JobDetail from './public/JobDetail';
import TestFlow from './public/TestFlow';

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
          <Route index element={<Dashboard />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:id" element={<JobConsole />} />
          <Route path="jobs/:id/pipeline" element={<Pipeline />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
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
            <NavLink to="/app" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Dashboard
            </NavLink>
            <NavLink to="/app/jobs" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Roles
            </NavLink>
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
