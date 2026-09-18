import knex, { type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db: Knex = knex({
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: path.join(here, 'migrations'),
    // dist has .js, src has .ts (tsx). Load whichever exists next to this file.
    loadExtensions: [path.extname(fileURLToPath(import.meta.url))],
  },
});

export async function runMigrations(): Promise<void> {
  const [, applied] = await db.migrate.latest();
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
  else console.log('[db] schema up to date');
}
