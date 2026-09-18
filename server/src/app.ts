import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { attachParticipant, errorHandler } from './middleware.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { transliterateRouter } from './routes/transliterate.routes.js';
import { HttpError } from './types.js';

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachParticipant);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/transliterate', transliterateRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found', 'NOT_FOUND')));

  // Zod -> 400
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid request', details: err.flatten() } });
      return;
    }
    next(err);
  });
  app.use(errorHandler);

  // Serve the built SPA (web/dist copied to server/public by `pnpm build`)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(here, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('cache-control', 'no-store');
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }
  return app;
}
