import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { HttpError } from './types.js';
import type { Participant } from './types.js';
import { SESSION_COOKIE, getParticipant, verifySession } from './services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      participant?: Participant;
    }
  }
}

export async function attachParticipant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = (req.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
    if (token) {
      const pid = verifySession(token);
      if (pid) {
        const p = await getParticipant(pid);
        if (p) req.participant = p;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireParticipant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.participant) return next(new HttpError(401, 'Sign in first', 'UNAUTHENTICATED'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const token = req.header('x-admin-token') ?? (req.query.token as string | undefined);
  if (!config.adminToken || token !== config.adminToken) return next(new HttpError(401, 'Admin token required', 'ADMIN_ONLY'));
  next();
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const anyErr = err as { type?: string; status?: number; message?: string; code?: string };
  if (anyErr.type === 'entity.too.large' || anyErr.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Upload too large' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}

/** Wrap async handlers so rejections reach the error handler. */
export function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function requestOrigin(req: Request): string {
  const proto = req.header('x-forwarded-proto') ?? req.protocol;
  const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}`;
}
