import { join } from 'node:path';
import express from 'express';
import { registerRoutes } from './api/routes.js';
import { localOnly } from './api/guard.js';

// `staticDir`, when given, must be an absolute path to a built frontend
// (a `vite build` output directory). Omit it in dev, where Vite serves the
// frontend itself.
export function buildApp({ staticDir } = {}) {
  const app = express();
  // First, so a refused request is never parsed, let alone run.
  app.use('/api', localOnly);
  // Well above express's 100kb default: a single hunk from a minified or
  // generated file is sent back verbatim to be applied, and can be large.
  app.use(express.json({ limit: '50mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  registerRoutes(app);

  // Terminal 404 for the API namespace. Registered above the static
  // middleware so a mistyped endpoint can never fall through to the SPA
  // fallback and return HTML with status 200.
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (req, res) => res.sendFile(join(staticDir, 'index.html')));
  }
  return app;
}
