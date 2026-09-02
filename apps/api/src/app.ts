import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env';
import authRouter from './modules/auth/auth.router';
import usersRouter from './modules/users/users.router';
import jobsRouter from './modules/jobs/jobs.router';
import applicationsRouter from './modules/applications/applications.router';
import interviewsRouter from './modules/interviews/interviews.router';
import publicRouter from './modules/public/public.router';
import statsRouter from './modules/stats/stats.router';
import setupRouter, { WIZARD_HTML } from './modules/setup/setup.router';
import adminRouter from './modules/admin/llm-providers.router';
import platformRouter from './modules/platform/platform.router';
import { notFoundHandler, errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());

  const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({
    // Explicit origin allow-list from CORS_ORIGIN env; '*' is opt-in only.
    origin: origins[0] === '*' ? true : origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // 1mb default; the intake route carries base64 screenshots and gets its own
  // larger parser in the jobs router (QA wave-3 F2) — `type` decides whether
  // this parser runs at all for a given request.
  app.use(
    express.json({
      limit: '1mb',
      // `type` receives an IncomingMessage (no .path) — req.url is the full
      // request target at app level; compare the path without its query.
      type: (req) => (req.url ?? '').split('?')[0] !== '/api/jobs/intake',
    }),
  );
  if (env.NODE_ENV !== 'test') {
    // QA wave-5 F1: the one-time test token rides the URL of
    // /api/public/test/:token — never write those URLs to access logs (the
    // token must leave the system exactly once, in the apply response).
    app.use(
      morgan('tiny', {
        skip: (req) => (req.url ?? '').split('?')[0]!.startsWith('/api/public/test/'),
      }),
    );
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // First-run setup wizard — mounted before the other API routers so a fresh
  // install can be bootstrapped before any company or users exist.
  app.use('/api/setup', setupRouter);
  app.get(['/setup', '/setup/'], (_req, res) => {
    res.type('html').send(WIZARD_HTML);
  });

  app.use('/api/auth', authRouter);
  // Platform console (V2-1): super-admin-gated tenant + settings management.
  app.use('/api/platform', platformRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/interviews', interviewsRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/stats', statsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
