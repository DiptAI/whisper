import { createApp } from './app.js';
import { config } from './config.js';
import { db, runMigrations } from './db.js';
import { expireStaleAssignments } from './services/assignment.service.js';
import { startModelWorker, stopModelWorker } from './services/model-worker.js';

async function main(): Promise<void> {
  await runMigrations();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
    if (config.devLogin && !config.googleClientId) console.log('[api] dev login enabled (no GOOGLE_CLIENT_ID)');
  });
  startModelWorker();
  const sweeper = setInterval(() => void expireStaleAssignments(), 60_000);

  const shutdown = (): void => {
    clearInterval(sweeper);
    stopModelWorker();
    server.close(() => void db.destroy().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
