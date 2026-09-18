import { db, runMigrations } from './db.js';

runMigrations()
  .then(() => db.destroy())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
