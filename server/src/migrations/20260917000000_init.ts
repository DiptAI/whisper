import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('participants', (t) => {
    t.increments('id').primary();
    t.string('google_sub', 64).unique().nullable();
    t.string('email', 255).nullable();
    t.string('name', 200).nullable();
    t.string('gender', 40).nullable();
    t.string('study_level', 80).nullable();
    t.boolean('consent_audio').notNullable().defaultTo(false);
    t.boolean('consent_text').notNullable().defaultTo(false);
    t.timestamp('consented_at', { useTz: true }).nullable();
    t.string('resume_code', 16).notNullable().unique();
    t.string('preferred_language', 8).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('blobs', (t) => {
    t.increments('id').primary();
    t.string('mime', 80).notNullable();
    t.integer('size_bytes').notNullable();
    t.binary('bytes').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('chains', (t) => {
    t.increments('id').primary();
    t.string('code', 40).notNullable().unique(); // e.g. AUD-BN-001
    t.string('modality', 8).notNullable(); // AUDIO | TEXT
    t.string('language', 8).notNullable(); // ISO 639-1
    t.string('composition', 12).notNullable(); // ALL_HUMAN | ALL_MODEL | MIXED
    t.integer('max_hops').notNullable();
    t.string('status', 12).notNullable().defaultTo('OPEN'); // OPEN | COMPLETE
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['modality', 'language', 'status']);
  });

  await knex.schema.createTable('hops', (t) => {
    t.increments('id').primary();
    t.integer('chain_id').notNullable().references('id').inTable('chains').onDelete('CASCADE');
    t.integer('hop_index').notNullable(); // 0 = seed
    t.integer('parent_hop_id').nullable().references('id').inTable('hops');
    t.string('contributor_type', 8).notNullable(); // SEED | HUMAN | MODEL
    t.integer('participant_id').nullable().references('id').inTable('participants');
    t.string('model_name', 120).nullable();
    t.text('text_content').nullable(); // TEXT hops, and transcript for MODEL audio hops
    t.integer('audio_blob_id').nullable().references('id').inTable('blobs');
    t.string('audio_mime', 80).nullable();
    t.integer('audio_duration_ms').nullable();
    t.integer('listen_count').nullable();
    t.integer('takes_count').nullable();
    t.integer('read_seconds').nullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['chain_id', 'hop_index']);
    t.index(['participant_id']);
  });

  await knex.schema.createTable('assignments', (t) => {
    t.increments('id').primary();
    t.integer('participant_id').notNullable().references('id').inTable('participants');
    t.integer('chain_id').notNullable().references('id').inTable('chains');
    t.integer('source_hop_id').notNullable().references('id').inTable('hops');
    t.string('modality', 8).notNullable();
    t.string('status', 12).notNullable().defaultTo('ACTIVE'); // ACTIVE | SUBMITTED | EXPIRED | ABANDONED
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.integer('content_fetches').notNullable().defaultTo(0);
    t.timestamp('reading_started_at', { useTz: true }).nullable();
    t.timestamp('reading_hidden_at', { useTz: true }).nullable();
    t.integer('submitted_hop_id').nullable().references('id').inTable('hops');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['participant_id', 'modality', 'status']);
    t.index(['chain_id', 'status']);
  });
  await knex.raw(
    `CREATE UNIQUE INDEX assignments_one_active_per_chain ON assignments (chain_id) WHERE status = 'ACTIVE'`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX assignments_one_submitted_per_participant_modality ON assignments (participant_id, modality) WHERE status = 'SUBMITTED'`,
  );

  await knex.schema.createTable('model_jobs', (t) => {
    t.increments('id').primary();
    t.integer('chain_id').notNullable().references('id').inTable('chains').onDelete('CASCADE');
    t.integer('parent_hop_id').notNullable().references('id').inTable('hops');
    t.string('kind', 16).notNullable(); // LLM_TEXT | ALM_AUDIO | WHISPER_AUDIO
    t.string('status', 12).notNullable().defaultTo('PENDING'); // PENDING | RUNNING | DONE | FAILED
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
  });
  await knex.raw(
    `CREATE UNIQUE INDEX model_jobs_one_open_per_chain ON model_jobs (chain_id) WHERE status IN ('PENDING','RUNNING')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('model_jobs');
  await knex.schema.dropTableIfExists('assignments');
  await knex.schema.dropTableIfExists('hops');
  await knex.schema.dropTableIfExists('chains');
  await knex.schema.dropTableIfExists('blobs');
  await knex.schema.dropTableIfExists('participants');
}
