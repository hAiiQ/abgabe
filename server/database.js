import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MEMBER_NAMES = [
  'Herbert Petersen', 'Michael Black', 'Zak Shakur', 'Milena Schlichter',
  'Luana Velaris', 'Mauritzius Petersen', 'Dragan Draganovic', 'Guenther Berger',
  'Neo Jones', 'Gorden Petersen', 'John Petersen', 'Azrael Black',
  'Maddox Petersen', 'Kami Blackwood', 'Jake Pot',
];

export function normalizeName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}

export async function createDatabase({ url, sqlitePath = resolve('data/portal.sqlite') } = {}) {
  let pool, sqlite;
  if (url) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 10000 });
    pool.on('error', (error) => console.error('Datenbankverbindung:', error.message));
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    if (sqlitePath !== ':memory:') mkdirSync(dirname(sqlitePath), { recursive: true });
    sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  // SQLite transactions share one connection. Queue every unit of work so requests cannot interleave.
  let queue = Promise.resolve();
  async function connection(work, transaction = false) {
    let releaseQueue;
    if (sqlite) {
      const previous = queue;
      queue = new Promise((resolveQueue) => { releaseQueue = resolveQueue; });
      await previous;
    }
    let client;
    try {
      if (pool) client = await pool.connect();
      const query = async (sql, params = []) => {
        if (client) {
          let n = 0;
          return client.query(sql.replace(/\?/g, () => `$${++n}`), params);
        }
        const statement = sqlite.prepare(sql);
        if (/^\s*(SELECT|WITH)/i.test(sql)) return { rows: statement.all(...params) };
        return { rows: [], rowCount: Number(statement.run(...params).changes) };
      };
      const tx = {
        all: async (sql, params) => (await query(sql, params)).rows,
        get: async (sql, params) => (await query(sql, params)).rows[0],
        run: query,
      };
      if (transaction) await query('BEGIN');
      try {
        const result = await work(tx);
        if (transaction) await query('COMMIT');
        return result;
      } catch (error) {
        if (transaction) await query('ROLLBACK');
        throw error;
      }
    } finally {
      client?.release();
      releaseQueue?.();
    }
  }
  const db = {
    read: (work) => connection(work),
    transaction: (work) => connection(work, true),
    close: async () => { if (pool) await pool.end(); else sqlite.close(); },
    kind: pool ? 'postgres' : 'sqlite',
  };
  await db.transaction(async (tx) => {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, normalized_name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('admin','member')), password_hash TEXT,
        registered_at TEXT, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, weekly_goal INTEGER NOT NULL CHECK(weekly_goal > 0))`,
      `CREATE TABLE IF NOT EXISTS weeks (id TEXT PRIMARY KEY, goal INTEGER NOT NULL CHECK(goal > 0))`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
        csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
        week_id TEXT NOT NULL REFERENCES weeks(id), amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 1000000000),
        recipient_id TEXT NOT NULL REFERENCES members(id), note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
        created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT REFERENCES members(id), review_note TEXT)`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES members(id), action TEXT NOT NULL,
        details TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS payment_resets (
        id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id), member_id TEXT REFERENCES members(id),
        actor_id TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL,
        restored_at TEXT, restored_by TEXT REFERENCES members(id))`,
      'CREATE INDEX IF NOT EXISTS payments_week_idx ON payments(week_id, member_id)',
      'CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)',
    ]) await tx.run(statement);
    // Additive migration preserves existing accounts and payments on both supported databases.
    for (const [table, column, declaration] of [
      ['members', 'active', 'INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))'],
      ['members', 'reset_token_hash', 'TEXT'],
      ['members', 'removed_at', 'TEXT'],
      ['payments', 'reset_id', 'TEXT REFERENCES payment_resets(id)'],
    ]) {
      const columns = pool
        ? await tx.all('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table])
        : await tx.all(`SELECT name FROM pragma_table_info('${table}')`);
      if (!columns.some((item) => item.name === column)) await tx.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }
    await tx.run('INSERT INTO settings(id, weekly_goal) VALUES(1, 250000) ON CONFLICT(id) DO NOTHING');
    for (const name of MEMBER_NAMES) {
      await tx.run(`INSERT INTO members(id, name, normalized_name, role, created_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(normalized_name) DO NOTHING`,
      [randomUUID(), name, normalizeName(name), ['Michael Black', 'Herbert Petersen'].includes(name) ? 'admin' : 'member', new Date().toISOString()]);
    }
  });
  return db;
}
