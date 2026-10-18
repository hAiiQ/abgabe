import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { storageOptions } from '../server/storage.js';
import { createDatabase } from '../server/database.js';

const mounted = { readMountInfo: () => '82 38 8:1 / /var/data rw,relatime - ext4 /dev/disk rw\n' };
const renderEnv = { NODE_ENV: 'production', RENDER: 'true', SQLITE_PATH: '/var/data/portal.sqlite' };

test('Lokaler Start bleibt einfach; Produktion verlangt expliziten dauerhaften Speicher', () => {
  assert.deepEqual(storageOptions({ NODE_ENV: 'development' }), {});
  assert.throws(() => storageOptions({ NODE_ENV: 'production' }), /Dauerhafter Speicher fehlt/);
  assert.throws(() => storageOptions({ SQLITE_PATH: 'data/portal.sqlite' }), /absoluter Dateipfad/);
});
test('PostgreSQL bleibt verfügbar; widersprüchliche Speicherkonfiguration wird abgelehnt', () => {
  assert.deepEqual(storageOptions({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://example/db' }), { url: 'postgresql://example/db' });
  assert.throws(() => storageOptions({ DATABASE_URL: 'postgresql://example/db', SQLITE_PATH: '/var/data/portal.sqlite' }), /nur einen Speicher/);
});
test('Render speichert SQLite ausschließlich auf der tatsächlich eingehängten Disk', () => {
  assert.deepEqual(storageOptions(renderEnv, mounted), { sqlitePath: '/var/data/portal.sqlite' });
  assert.throws(() => storageOptions({ ...renderEnv, SQLITE_PATH: '/tmp/portal.sqlite' }, mounted), /unter \/var\/data/);
  assert.throws(() => storageOptions({ ...renderEnv, SQLITE_PATH: '/var/data/../portal.sqlite' }, mounted), /unter \/var\/data/);
  assert.throws(() => storageOptions(renderEnv, { readMountInfo: () => '80 38 8:1 / / rw - ext4 /dev/root rw\n' }), /Persistent Disk fehlt/);
  assert.throws(() => storageOptions(renderEnv, { readMountInfo: () => { throw new Error('Nicht lesbar'); } }), /Persistent Disk fehlt/);
});
test('SQLite erhält Mitglieder, Sitzungen und Abgaben beim erneuten Öffnen derselben Speicherdatei', async () => {
  mkdirSync(resolve('data'), { recursive: true });
  const sqlitePath = resolve('data', `persistence-test-${randomUUID()}.sqlite`);
  const options = storageOptions({ NODE_ENV: 'production', SQLITE_PATH: sqlitePath });
  let db;
  try {
    db = await createDatabase(options);
    let id;
    await db.transaction(async (tx) => {
      const zak = await tx.get('SELECT id FROM members WHERE name = ?', ['Zak Shakur']);
      const michael = await tx.get('SELECT id FROM members WHERE name = ?', ['Michael Black']);
      id = zak.id;
      await tx.run('UPDATE members SET password_hash = ?, registered_at = ? WHERE id = ?', ['saved-password-hash', '2026-10-19', zak.id]);
      await tx.run('INSERT INTO weeks(id, goal) VALUES(?, ?)', ['2026-10-19', 250000]);
      await tx.run('INSERT INTO sessions(token_hash, member_id, csrf_token, expires_at) VALUES(?, ?, ?, ?)', ['saved-session', zak.id, 'saved-csrf', '2026-12-01']);
      await tx.run(`INSERT INTO payments(id, member_id, week_id, amount, recipient_id, note, status, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, ['saved-payment', zak.id, '2026-10-19', 350000, michael.id, '', 'accepted', '2026-10-20']);
    });
    await db.close(); db = null;
    db = await createDatabase(options);
    const saved = await db.read(async (tx) => ({
      member: await tx.get('SELECT * FROM members WHERE id = ?', [id]),
      payment: await tx.get('SELECT * FROM payments WHERE id = ?', ['saved-payment']),
      session: await tx.get('SELECT * FROM sessions WHERE token_hash = ?', ['saved-session']),
    }));
    assert.equal(saved.member.password_hash, 'saved-password-hash');
    assert.equal(saved.payment.amount, 350000); assert.equal(saved.payment.status, 'accepted');
    assert.equal(saved.session.member_id, id); assert.equal(saved.session.csrf_token, 'saved-csrf');
  } finally {
    if (db) await db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(sqlitePath + suffix, { force: true });
  }
});
