import { randomUUID } from 'node:crypto';
import { createDatabase } from '../server/database.js';

// Optional real PostgreSQL coverage uses its own schema, never existing member data.
export async function createPortalTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const db = await createDatabase({ sqlitePath: ':memory:' });
    return { db, close: () => db.close() };
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  const schema = `portal_test_${randomUUID().replaceAll('-', '')}`;
  let db;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const scopedUrl = new URL(url);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    db = await createDatabase({ url: scopedUrl.toString() });
  } catch (error) {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    throw error;
  }
  return {
    db,
    async close() {
      try {
        await db.close();
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    },
  };
}
