import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, MEMBER_NAMES } from '../server/database.js';
import { createApp } from '../server/app.js';
import { currentWeek, validWeek } from '../server/weeks.js';
import { resolve } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPortalTestDatabase } from './database-fixture.js';

const setupCode = 'test-admin-code-not-for-production';
const password = 'EinSicheresTestpasswort42!';

test('Bestehende Datenbank wird ohne Datenverlust migriert; Sperren bleiben nach Neustart erhalten', async () => {
  const path = resolve('data', `migration-test-${randomUUID()}.sqlite`);
  mkdirSync(resolve('data'), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, normalized_name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL, password_hash TEXT, registered_at TEXT, created_at TEXT NOT NULL);
    INSERT INTO members VALUES('legacy-zak','Zak Shakur','zak shakur','member','existing-password-hash','2026-10-19','2026-10-19');`);
  legacy.close();
  let db;
  try {
    db = await createDatabase({ sqlitePath: path });
    const before = await db.read((tx) => tx.get('SELECT * FROM members WHERE id = ?', ['legacy-zak']));
    assert.equal(before.password_hash, 'existing-password-hash'); assert.equal(before.active, 1); assert.equal(before.reset_token_hash, null);
    await db.transaction(async (tx) => {
      await tx.run('UPDATE members SET active = 0, removed_at = ? WHERE id = ?', ['2026-10-20T12:00:00Z', 'legacy-zak']);
      await tx.run('INSERT INTO weeks(id, goal) VALUES(?, ?)', ['2026-10-19', 250000]);
      const actor = await tx.get('SELECT id FROM members WHERE name = ?', ['Michael Black']);
      await tx.run('INSERT INTO payouts(member_id, week_id, pocket_amount, green_cents, paid_at, paid_by) VALUES(?, ?, ?, ?, ?, ?)', ['legacy-zak', '2026-10-19', 100, 7000, '2026-10-20T12:00:00Z', actor.id]);
    });
    await db.close(); db = null;
    db = await createDatabase({ sqlitePath: path });
    const after = await db.read((tx) => tx.get('SELECT * FROM members WHERE id = ?', ['legacy-zak']));
    assert.equal(after.active, 0); assert.equal(after.password_hash, 'existing-password-hash');
    assert.equal(after.removed_at, '2026-10-20T12:00:00Z');
    const payout = await db.read((tx) => tx.get('SELECT * FROM payouts WHERE member_id = ? AND week_id = ?', ['legacy-zak', '2026-10-19']));
    assert.equal(Number(payout.pocket_amount), 100); assert.equal(Number(payout.green_cents), 7000);
    assert.equal(payout.paid_at, '2026-10-20T12:00:00Z');
    assert.equal((await db.read((tx) => tx.get('SELECT COUNT(*) AS count FROM members WHERE normalized_name = ?', ['zak shakur']))).count, 1);
  } finally {
    if (db) await db.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
});

test('Kalenderwochen in Berlin: Start, Sonntag, Winterzeit und exklusives Ende', () => {
  assert.equal(currentWeek(new Date('2026-10-18T21:59:59Z')), '2026-10-12');
  assert.equal(currentWeek(new Date('2026-10-18T22:00:00Z')), '2026-10-19');
  assert.equal(currentWeek(new Date('2026-10-24T22:00:00Z')), '2026-10-19');
  assert.equal(currentWeek(new Date('2026-10-25T22:59:59Z')), '2026-10-19');
  assert.equal(currentWeek(new Date('2026-10-25T23:00:00Z')), '2026-10-26');
  assert.equal(validWeek('2026-10-20', new Date('2026-10-26')), false);
  assert.equal(validWeek('2026-13-19', new Date('2026-10-26')), false);
  assert.equal(validWeek('2026-11-02', new Date('2026-10-26')), false);
});

test('Portal: echte HTTP-Sitzungen, Rollen, Freigaben und Kontoberechnung', async (t) => {
  const fixture = await createPortalTestDatabase();
  const { db } = fixture;
  let now = new Date('2026-10-20T12:00:00Z');
  const app = createApp({ db, adminSetupCode: setupCode, clock: () => now, disableRateLimit: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((done) => server.close(done)); await fixture.close(); });
  function client() {
    let cookie = '', csrf = '';
    return {
      async call(path, body, extra = {}) {
        const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
          headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Portal-Request': '1', 'X-CSRF-Token': csrf }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const text = await response.text();
        const result = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
        if (result.csrf) csrf = result.csrf;
        return { status: response.status, data: result, headers: response.headers };
      },
      register: async function(name, extra = {}) { return this.call('/auth/register', { name, password, ...extra }); },
      login: async function(name, pass = password) { return this.call('/auth/login', { name, password: pass }); },
      dashboard: async function(week) { const result = await this.call(`/dashboard${week ? `?week=${week}` : ''}`); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; },
    };
  }
  const zak = client(), michael = client(), herbert = client(), outsider = client(), luana = client();
  let michaelId, herbertId, zakId;
  await t.test('Nur Mitglieder registrieren; Admin-Einrichtungscode ist erforderlich', async () => {
    const publicSettings = await outsider.call('/public-settings');
    assert.equal(publicSettings.status, 200);
    assert.deepEqual(publicSettings.data, { week: '2026-10-19', weeklyGoal: 250000 });
    assert.equal(publicSettings.headers.get('cache-control'), 'no-store');
    assert.equal((await outsider.call('/dashboard')).status, 401);
    assert.equal((await outsider.register('Fremde Person')).status, 400);
    assert.equal((await outsider.register('Zak Shakur', { password: 'kurz' })).status, 400);
    assert.equal((await michael.register('Michael Black')).status, 403);
    assert.equal((await michael.register('Michael Black', { setupCode: 'falsch' })).status, 403);
    const registered = await michael.register('Michael Black', { setupCode });
    assert.equal(registered.status, 201); assert.equal(registered.data.user.role, 'admin');
    assert.match(registered.headers.get('set-cookie'), /HttpOnly/);
    michaelId = registered.data.user.id;
    const h = await herbert.register('Herbert Petersen', { setupCode }); assert.equal(h.status, 201); herbertId = h.data.user.id;
    const z = await zak.register('  zak   SHAKUR '); assert.equal(z.status, 201); zakId = z.data.user.id;
    assert.equal(z.data.user.name, 'Zak Shakur'); assert.equal(z.data.user.role, 'member');
    assert.equal((await outsider.register('Zak Shakur')).status, 409);
    assert.equal((await outsider.login('Zak Shakur', 'FalschesPasswort')).status, 401);
    const state = await zak.dashboard(); assert.equal(state.members.length, 15);
    assert.deepEqual(state.members.map((m) => m.name).sort(), [...MEMBER_NAMES].sort());
    assert.equal(state.week.goal, 250000);
    assert.equal(JSON.stringify(state).includes('password_hash'), false);
  });
  await t.test('Parallele Registrierung kann einen Namen nur einmal belegen', async () => {
    const a = client(), b = client();
    const results = await Promise.all([a.register('Neo Jones'), b.register('Neo Jones')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });
  await t.test('Rollen, CSRF, Herkunft und Eingaben werden serverseitig geprüft', async () => {
    assert.equal((await zak.call('/admin/settings', { week: '2026-10-19', goal: 1 })).status, 403);
    assert.equal((await zak.call('/payments', { amount: 1, week: '2026-10-19', recipientId: michaelId }, { 'X-CSRF-Token': 'falsch' })).status, 403);
    assert.equal((await zak.call('/payments', {}, { Origin: 'https://fremde-seite.example' })).status, 403);
    for (const amount of [0, -1, 1.5, '250000', 1000000001]) assert.equal((await zak.call('/payments', { amount, week: '2026-10-19', recipientId: michaelId })).status, 400);
    assert.equal((await zak.call('/payments', { amount: 1, week: '2026-10-19', recipientId: zakId })).status, 400);
    assert.equal((await zak.call('/payments', { amount: 1, week: '2026-10-19', recipientId: michaelId, note: 'x'.repeat(301) })).status, 400);
    assert.equal((await zak.call('/payments', { amount: 1, week: '2026-10-26', recipientId: michaelId })).status, 400);
  });
  await t.test('Offene Beträge zählen erst nach Bestätigung; Notizen bleiben privat', async () => {
    assert.equal((await zak.call('/payments', { amount: 200000, week: '2026-10-19', recipientId: michaelId, note: '<script>private Notiz</script>' })).status, 201);
    const state = await zak.dashboard(); const m = state.members.find((m) => m.id === zakId);
    assert.equal(m.accepted, 0); assert.equal(m.pending, 200000); assert.equal(m.remaining, 250000);
    assert.equal(state.payments[0].note, '<script>private Notiz</script>');
    await luana.register('Luana Velaris'); const otherState = await luana.dashboard();
    assert.equal(otherState.payments[0].note, '');
    assert.equal((await michael.dashboard()).payments[0].note, '<script>private Notiz</script>');
  });
  await t.test('Nur Admins bestätigen; parallele Freigaben schreiben nur einmal gut', async () => {
    const state = await zak.dashboard(), paymentId = state.payments[0].id;
    assert.equal((await zak.call(`/payments/${paymentId}/review`, { decision: 'accepted' })).status, 403);
    const result = await Promise.all([michael.call(`/payments/${paymentId}/review`, { decision: 'accepted' }), herbert.call(`/payments/${paymentId}/review`, { decision: 'accepted' })]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    const m = (await zak.dashboard()).members.find((m) => m.id === zakId);
    assert.equal(m.accepted, 200000); assert.equal(m.credited, 200000); assert.equal(m.pocket, 0); assert.equal(m.greenPocket, 0); assert.equal(m.pending, 0);
  });
  await t.test('Mehrere Abgaben addieren sich; Überschuss gehört in die eigene Tasche', async () => {
    await zak.call('/payments', { amount: 150000, week: '2026-10-19', recipientId: herbertId });
    const pending = (await zak.dashboard()).payments.find((p) => p.status === 'pending');
    assert.equal((await herbert.call(`/payments/${pending.id}/review`, { decision: 'accepted' })).status, 200);
    const m = (await zak.dashboard()).members.find((m) => m.id === zakId);
    assert.equal(m.accepted, 350000); assert.equal(m.credited, 250000); assert.equal(m.pocket, 100000); assert.equal(m.remaining, 0);
    assert.equal(m.greenPocket, 70000);
    await zak.call('/payments', { amount: 900000, week: '2026-10-19', recipientId: michaelId });
    const rejected = (await zak.dashboard()).payments.find((p) => p.status === 'pending');
    await michael.call(`/payments/${rejected.id}/review`, { decision: 'rejected', note: 'Betrag stimmt nicht.' });
    const after = await zak.dashboard(); assert.equal(after.members.find((m) => m.id === zakId).accepted, 350000);
    assert.equal(after.members.find((m) => m.id === zakId).greenPocket, 70000);
    assert.equal(after.payments.find((p) => p.id === rejected.id).review_note, 'Betrag stimmt nicht.');
  });
  await t.test('Grüngeld zieht 30 Prozent nur von der bestätigten eigenen Tasche ab und wird centgenau exportiert', async () => {
    const azrael = client();
    assert.equal((await azrael.register('Azrael Black')).status, 201);
    await azrael.call('/payments', { amount: 350001, week: '2026-10-19', recipientId: michaelId });
    let state = await azrael.dashboard();
    assert.equal(state.members.find((m) => m.name === 'Azrael Black').greenPocket, 0);
    const payment = state.payments.find((p) => p.member_name === 'Azrael Black');
    assert.equal((await michael.call(`/payments/${payment.id}/review`, { decision: 'accepted' })).status, 200);
    state = await azrael.dashboard();
    const member = state.members.find((m) => m.name === 'Azrael Black');
    assert.equal(member.credited, 250000); assert.equal(member.pocket, 100001);
    assert.equal(member.greenPocket, 70000.7); assert.equal(member.accepted, 350001);
    const csv = await michael.call('/export?week=2026-10-19');
    assert.match(csv.data.split('\r\n')[0], /Grüngeld nach 30 % Abzug/);
    assert.equal(csv.data.split('\r\n').find((row) => row.includes('"Azrael Black"')).split(';')[8], '"70000,70"');
  });
  await t.test('Zieländerung rechnet die gewählte Woche neu; beide Admins dürfen verwalten', async () => {
    assert.equal((await herbert.call('/admin/settings', { week: '2026-10-19', goal: 300000, applyDefault: true })).status, 200);
    assert.equal((await outsider.call('/public-settings')).data.weeklyGoal, 300000);
    let state = await zak.dashboard(), m = state.members.find((m) => m.id === zakId);
    assert.equal(m.credited, 300000); assert.equal(m.pocket, 50000); assert.equal(m.greenPocket, 35000); assert.equal(state.defaultGoal, 300000);
    assert.equal((await michael.call('/admin/settings', { week: '2026-10-19', goal: 400000, applyDefault: false })).status, 200);
    assert.equal((await outsider.call('/public-settings')).data.weeklyGoal, 400000);
    state = await zak.dashboard(); m = state.members.find((m) => m.id === zakId);
    assert.equal(m.remaining, 50000); assert.equal(m.pocket, 0); assert.equal(m.greenPocket, 0); assert.equal(state.defaultGoal, 300000);
    assert.equal(state.activity.length, 0); assert.ok((await michael.dashboard()).activity.length > 0);
  });
  await t.test('CSV-Export ist nur für Admins verfügbar und enthält reale Kontowerte', async () => {
    assert.equal((await zak.call('/export?week=2026-10-19')).status, 403);
    const result = await michael.call('/export?week=2026-10-19');
    assert.equal(result.status, 200); assert.match(result.data, /Zak Shakur/); assert.match(result.data, /350000/); assert.match(result.headers.get('content-disposition'), /abgaben-2026-10-19.csv/);
  });
  await t.test('Wochenwechsel setzt Konten zurück, erhält Historie und offene Freigaben', async () => {
    await luana.call('/payments', { amount: 100000, week: '2026-10-19', recipientId: michaelId });
    now = new Date('2026-10-25T23:00:00Z');
    // Before the new week has been created, the public page uses the configured default.
    assert.deepEqual((await outsider.call('/public-settings')).data, { week: '2026-10-26', weeklyGoal: 300000 });
    let state = await zak.dashboard(); assert.equal(state.week.id, '2026-10-26'); assert.equal(state.week.goal, 300000);
    assert.deepEqual(state.weeks.find((week) => week.id === '2026-10-19'), {
      id: '2026-10-19', goal: 400000, entryCount: 5, totalAccepted: 700001, pendingCount: 1,
    });
    assert.deepEqual(state.weeks.find((week) => week.id === '2026-10-26'), {
      id: '2026-10-26', goal: 300000, entryCount: 0, totalAccepted: 0, pendingCount: 0,
    });
    // Editing the previous week's default does not replace the running week's own goal.
    await michael.call('/admin/settings', { week: '2026-10-19', goal: 400000, applyDefault: true });
    assert.equal((await outsider.call('/public-settings')).data.weeklyGoal, 300000);
    await michael.call('/admin/settings', { week: '2026-10-26', goal: 300000, applyDefault: true });
    assert.equal(state.members.find((m) => m.id === zakId).accepted, 0); assert.equal(state.payments.length, 0);
    assert.equal((await zak.call('/payments', { amount: 10, week: '2026-10-19', recipientId: michaelId })).status, 400);
    state = await michael.dashboard('2026-10-19');
    assert.equal(state.week.goal, 400000); assert.equal(state.week.canSubmit, false);
    const oldPending = state.payments.find((p) => p.status === 'pending');
    assert.equal((await herbert.call(`/payments/${oldPending.id}/review`, { decision: 'accepted' })).status, 200);
    assert.equal((await luana.dashboard('2026-10-19')).members.find((m) => m.name === 'Luana Velaris').credited, 100000);
    const archivedWeek = (await michael.dashboard()).weeks.find((week) => week.id === '2026-10-19');
    assert.equal(archivedWeek.totalAccepted, 800001); assert.equal(archivedWeek.pendingCount, 0);
    assert.equal((await luana.dashboard()).members.find((m) => m.name === 'Luana Velaris').credited, 0);
    assert.equal((await zak.dashboard('2026-11-02').catch(() => 'invalid')), 'invalid');
  });
  await t.test('Vor dem Start sind Registrierung und Übersicht verfügbar, aber keine Einträge', async () => {
    now = new Date('2026-10-18T21:00:00Z');
    assert.deepEqual((await outsider.call('/public-settings')).data, { week: '2026-10-19', weeklyGoal: 400000 });
    const state = await zak.dashboard(); assert.equal(state.week.id, '2026-10-19'); assert.equal(state.week.canSubmit, false);
    assert.equal((await zak.call('/payments', { amount: 1, week: '2026-10-19', recipientId: michaelId })).status, 400);
    now = new Date('2026-10-26T12:00:00Z');
  });
  await t.test('Nur Admins erweitern die Liste; fremde Namen bleiben bei Registrierung und Login ausgeschlossen', async () => {
    assert.equal((await outsider.login('Fremde Person')).status, 401);
    assert.equal((await outsider.register('Neue Person')).status, 400);
    assert.equal((await zak.call('/admin/members', { name: 'Neue Person' })).status, 403);
    for (const name of ['Einzelname', '<script> Test', '=FORMULA Test', 'a'.repeat(81) + ' Test']) assert.equal((await michael.call('/admin/members', { name })).status, 400);
    const added = await herbert.call('/admin/members', { name: ' Neue   Person ', role: 'admin' });
    assert.equal(added.status, 201); assert.equal(added.data.member.name, 'Neue Person'); assert.equal(added.data.member.role, 'member');
    assert.equal((await michael.call('/admin/members', { name: 'neue person' })).status, 409);
    assert.equal((await outsider.register('Neue Person')).status, 201);
    const state = await michael.dashboard(); assert.equal(state.members.length, 16);
    assert.equal(state.members.find((m) => m.name === 'Neue Person').active, true);
  });
  await t.test('Sperren beendet Sitzungen und sperrt Login sowie Registrierung; Freigeben reaktiviert', async () => {
    const target = (await michael.dashboard()).members.find((m) => m.name === 'Neue Person');
    assert.equal((await michael.call(`/admin/members/${target.id}/access`, { active: false })).status, 400);
    assert.equal((await zak.call(`/admin/members/${target.id}/access`, { active: false, confirmation: 'SPERREN' })).status, 403);
    assert.equal((await michael.call(`/admin/members/${michaelId}/access`, { active: false, confirmation: 'SPERREN' })).status, 403);
    assert.equal((await michael.call(`/admin/members/${target.id}/access`, { active: false, confirmation: 'SPERREN' })).status, 200);
    assert.equal((await outsider.call('/dashboard')).status, 401);
    assert.equal((await outsider.login('Neue Person')).status, 401);
    assert.equal((await outsider.register('Neue Person')).status, 403);
    assert.equal((await michael.dashboard()).members.find((m) => m.id === target.id).active, false);
    assert.equal((await herbert.call(`/admin/members/${target.id}/access`, { active: true, confirmation: 'FREIGEBEN' })).status, 200);
    assert.equal((await outsider.login('Neue Person')).status, 200);
  });
  await t.test('Zugang-Reset verlangt Bestätigung und einen einmaligen Code; Abgaben bleiben erhalten', async () => {
    const luanaMember = (await michael.dashboard()).members.find((m) => m.name === 'Luana Velaris');
    assert.equal((await zak.call(`/admin/members/${luanaMember.id}/reset-access`, { confirmation: 'ZURÜCKSETZEN' })).status, 403);
    assert.equal((await michael.call(`/admin/members/${luanaMember.id}/reset-access`, {})).status, 400);
    assert.equal((await michael.call(`/admin/members/${michaelId}/reset-access`, { confirmation: 'ZURÜCKSETZEN' })).status, 400);
    const reset = await michael.call(`/admin/members/${luanaMember.id}/reset-access`, { confirmation: 'ZURÜCKSETZEN' });
    assert.equal(reset.status, 200); assert.match(reset.data.recoveryCode, /^[a-f0-9]{64}$/);
    assert.equal((await luana.call('/dashboard')).status, 401);
    assert.equal((await luana.login('Luana Velaris')).status, 401);
    assert.equal((await luana.register('Luana Velaris')).status, 403);
    assert.equal((await luana.register('Luana Velaris', { recoveryCode: 'falsch' })).status, 403);
    const newReset = await herbert.call(`/admin/members/${luanaMember.id}/reset-access`, { confirmation: 'ZURÜCKSETZEN' });
    assert.equal((await luana.register('Luana Velaris', { recoveryCode: reset.data.recoveryCode })).status, 403);
    const success = await luana.register('Luana Velaris', { recoveryCode: newReset.data.recoveryCode }); assert.equal(success.status, 201);
    assert.equal((await client().register('Luana Velaris', { recoveryCode: newReset.data.recoveryCode })).status, 409);
    assert.equal((await luana.dashboard('2026-10-19')).members.find((m) => m.id === luanaMember.id).accepted, 100000);
    const state = await michael.dashboard();
    assert.equal(JSON.stringify(state).includes(newReset.data.recoveryCode), false);
    assert.equal(JSON.stringify(state).includes('reset_token_hash'), false);
  });
  await t.test('Ein Admin-Zugang braucht nach Reset weiterhin den Admin-Einrichtungscode', async () => {
    const reset = await michael.call(`/admin/members/${herbertId}/reset-access`, { confirmation: 'ZURÜCKSETZEN' });
    assert.equal(reset.status, 200);
    assert.equal((await herbert.register('Herbert Petersen', { recoveryCode: reset.data.recoveryCode })).status, 403);
    assert.equal((await herbert.register('Herbert Petersen', { recoveryCode: reset.data.recoveryCode, setupCode })).status, 201);
  });
  await t.test('Reset eines Mitglieds betrifft nur dessen gewählte Woche und ist vollständig wiederherstellbar', async () => {
    const original = await michael.dashboard('2026-10-19');
    assert.equal((await zak.call('/admin/resets', { week: '2026-10-19', confirmation: 'ZURÜCKSETZEN' })).status, 403);
    assert.equal((await michael.call('/admin/resets', { week: '2026-10-19', memberId: zakId })).status, 400);
    assert.equal((await michael.call('/admin/resets', { week: '2026-10-19', memberId: '', confirmation: 'ZURÜCKSETZEN' })).status, 400);
    const reset = await michael.call('/admin/resets', { week: '2026-10-19', memberId: zakId, confirmation: 'ZURÜCKSETZEN' });
    assert.equal(reset.status, 200); assert.equal(reset.data.count, 3);
    let state = await michael.dashboard('2026-10-19');
    assert.equal(state.members.find((m) => m.id === zakId).accepted, 0);
    assert.equal(state.payments.filter((p) => p.member_id === zakId).length, 0);
    assert.equal(state.members.find((m) => m.name === 'Luana Velaris').accepted, 100000);
    assert.equal(state.resets.find((r) => r.id === reset.data.resetId).payment_count, 3);
    assert.equal(state.resets.find((r) => r.id === reset.data.resetId).total, 1250000);
    assert.equal((await zak.dashboard('2026-10-19')).resets.length, 0);
    const csv = await michael.call('/export?week=2026-10-19');
    assert.match(csv.data, /"Zak Shakur";"400000";"0";"0";"0"/);
    const result = await Promise.all([michael.call(`/admin/resets/${reset.data.resetId}/restore`, { confirmation: 'WIEDERHERSTELLEN' }), herbert.call(`/admin/resets/${reset.data.resetId}/restore`, { confirmation: 'WIEDERHERSTELLEN' })]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200,409]);
    state = await michael.dashboard('2026-10-19');
    assert.deepEqual(state.members, original.members); assert.deepEqual(state.payments, original.payments);
    assert.equal(state.resets.some((r) => r.id === reset.data.resetId), false);
  });
  await t.test('Reset einer ganzen Woche erhält andere Wochen, Ziele und Zugänge; versteckte Einträge sind nicht freigebbar', async () => {
    await zak.call('/payments', { amount: 123456, week: '2026-10-26', recipientId: michaelId });
    const pending = (await michael.dashboard()).payments.find((p) => p.status === 'pending');
    const reset = await herbert.call('/admin/resets', { week: '2026-10-26', confirmation: 'ZURÜCKSETZEN' }); assert.equal(reset.status, 200);
    const state = await zak.dashboard(); assert.equal(state.week.goal, 300000); assert.equal(state.payments.length, 0);
    assert.equal((await michael.call(`/payments/${pending.id}/review`, { decision: 'accepted' })).status, 409);
    assert.equal((await zak.dashboard('2026-10-19')).members.find((m) => m.id === zakId).accepted, 350000);
    assert.equal((await herbert.call('/admin/resets', { week: '2026-10-26', confirmation: 'ZURÜCKSETZEN' })).status, 409);
    assert.equal((await herbert.call(`/admin/resets/${reset.data.resetId}/restore`, { confirmation: 'WIEDERHERSTELLEN' })).status, 200);
    assert.equal((await michael.dashboard()).payments.find((p) => p.id === pending.id).status, 'pending');
  });
  await t.test('Passwortwechsel beendet andere Sitzungen; Abmelden entwertet die aktuelle', async () => {
    const second = client(); assert.equal((await second.login('Zak Shakur')).status, 200);
    assert.equal((await zak.call('/account/password', { currentPassword: 'falsch', password: 'EinNeuesSicheresPasswort!' })).status, 403);
    assert.equal((await zak.call('/account/password', { currentPassword: password, password: 'EinNeuesSicheresPasswort!' })).status, 200);
    assert.equal((await second.call('/dashboard')).status, 401);
    assert.equal((await outsider.login('Zak Shakur')).status, 401);
    assert.equal((await outsider.login('Zak Shakur', 'EinNeuesSicheresPasswort!')).status, 200);
    assert.equal((await zak.call('/auth/logout', {})).status, 200);
    assert.equal((await zak.call('/dashboard')).status, 401);
  });
  await t.test('Entfernen ist nur für Admins möglich; beendet den Zugang und erhält Konto, Verlauf und Export', async () => {
    const target = (await michael.dashboard()).members.find((m) => m.name === 'Neue Person');
    const departed = client();
    assert.equal((await departed.login(target.name)).status, 200);
    await departed.call('/payments', { amount: 50000, week: '2026-10-26', recipientId: michaelId });
    const payment = (await michael.dashboard()).payments.find((p) => p.member_id === target.id);
    assert.equal((await michael.call(`/payments/${payment.id}/review`, { decision: 'accepted' })).status, 200);
    const route = `/admin/members/${target.id}`;
    assert.equal((await departed.call(`${route}/remove`, { confirmation: 'ENTFERNEN' })).status, 403);
    assert.equal((await michael.call(`${route}/remove`, {})).status, 400);
    assert.equal((await michael.call(`${route}/remove`, { confirmation: 'ENTFERNEN' }, { 'X-CSRF-Token': 'falsch' })).status, 403);
    for (const id of [michaelId, herbertId]) assert.equal((await michael.call(`/admin/members/${id}/remove`, { confirmation: 'ENTFERNEN' })).status, 403);
    assert.equal((await michael.call('/admin/members/nicht-vorhanden/remove', { confirmation: 'ENTFERNEN' })).status, 404);
    assert.equal((await herbert.call(`${route}/remove`, { confirmation: 'ENTFERNEN' })).status, 200);
    assert.equal((await michael.call(`${route}/remove`, { confirmation: 'ENTFERNEN' })).status, 409);
    assert.equal((await departed.call('/dashboard')).status, 401);
    assert.equal((await departed.login(target.name)).status, 401);
    assert.equal((await departed.register(target.name)).status, 403);
    assert.equal((await michael.call(`${route}/access`, { active: true, confirmation: 'FREIGEBEN' })).status, 409);
    assert.equal((await michael.call(`${route}/reset-access`, { confirmation: 'ZURÜCKSETZEN' })).status, 409);
    assert.equal((await michael.call('/admin/members', { name: target.name })).status, 409);
    let state = await michael.dashboard();
    assert.equal(state.members.find((m) => m.id === target.id).removed, true);
    assert.equal(state.members.filter((m) => !m.removed).length, 15);
    assert.equal(state.payments.find((p) => p.id === payment.id).amount, 50000);
    assert.match((await michael.call('/export?week=2026-10-26')).data, /"Neue Person";"300000";"50000"/);
    assert.ok(state.activity.some((entry) => entry.action === 'member_removed' && entry.details.memberId === target.id));
    assert.equal((await departed.call(`${route}/restore`, { confirmation: 'WIEDERHERSTELLEN' })).status, 401);
    assert.equal((await michael.call(`${route}/restore`, {})).status, 400);
    assert.equal((await michael.call(`${route}/restore`, { confirmation: 'WIEDERHERSTELLEN' })).status, 200);
    assert.equal((await michael.call(`${route}/restore`, { confirmation: 'WIEDERHERSTELLEN' })).status, 409);
    assert.equal((await departed.call('/dashboard')).status, 401);
    assert.equal((await departed.login(target.name)).status, 200);
    state = await departed.dashboard();
    assert.equal(state.members.find((m) => m.id === target.id).removed, false);
    assert.equal(state.members.find((m) => m.id === target.id).credited, 50000);
  });
  await t.test('Wiederherstellen eines zuvor gesperrten Mitglieds hebt die Sperre nicht auf', async () => {
    const target = (await michael.dashboard()).members.find((m) => m.name === 'Neo Jones');
    const route = `/admin/members/${target.id}`;
    await michael.call(`${route}/access`, { active: false, confirmation: 'SPERREN' });
    assert.equal((await michael.call(`${route}/remove`, { confirmation: 'ENTFERNEN' })).status, 200);
    assert.equal((await herbert.call(`${route}/restore`, { confirmation: 'WIEDERHERSTELLEN' })).status, 200);
    const restored = (await michael.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(restored.removed, false); assert.equal(restored.active, false);
    assert.equal((await client().login(target.name)).status, 401);
  });
  await t.test('Auszahlungen sind je Person und Woche gespeichert, nur für Admins änderbar und gegen doppelte oder veraltete Klicks geschützt', async () => {
    const memberClient = client(), anonymous = client();
    assert.equal((await memberClient.login('Azrael Black')).status, 200);
    const target = (await michael.dashboard()).members.find((m) => m.name === 'Azrael Black');
    const route = `/admin/members/${target.id}/payout`;
    const week = '2026-10-26';
    const firstMark = { week, expectedPocket: 150001, expectedPaidPocket: 0 };
    assert.equal((await anonymous.call(route, firstMark)).status, 401);
    assert.equal((await memberClient.call(route, firstMark)).status, 403);
    assert.equal((await michael.call(route, firstMark, { 'X-CSRF-Token': 'falsch' })).status, 403);
    assert.equal((await michael.call(route, { ...firstMark, week: '2026-11-02' })).status, 400);
    assert.equal((await michael.call(route, { ...firstMark, expectedPocket: 0 })).status, 400);
    assert.equal((await michael.call('/admin/members/nicht-vorhanden/payout', firstMark)).status, 404);
    await memberClient.call('/payments', { amount: 450001, week, recipientId: michaelId });
    assert.equal((await michael.call(route, firstMark)).status, 409);
    let state = await michael.dashboard();
    const payment = state.payments.find((p) => p.member_id === target.id && p.status === 'pending');
    await michael.call(`/payments/${payment.id}/review`, { decision: 'accepted' });
    const results = await Promise.all([michael.call(route, firstMark), herbert.call(route, firstMark)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    state = await memberClient.dashboard();
    let member = state.members.find((m) => m.id === target.id);
    assert.equal(member.pocket, 150001); assert.equal(member.greenPocket, 105000.7);
    assert.equal(member.payout.status, 'paid'); assert.equal(member.payout.paidPocket, 150001);
    assert.equal(member.payout.paidGreen, 105000.7); assert.equal(member.payout.remainingGreen, 0);
    assert.ok(['Michael Black', 'Herbert Petersen'].includes(member.payout.paidBy)); assert.ok(member.payout.paidAt);
    let csv = (await michael.call(`/export?week=${week}`)).data;
    let csvRow = csv.split('\r\n').find((row) => row.includes('"Azrael Black"')).split(';');
    assert.equal(csvRow[9], '"Ausgezahlt"'); assert.equal(csvRow[10], '"105000,70"'); assert.equal(csvRow[11], '"0,00"');
    await memberClient.call('/payments', { amount: 100000, week, recipientId: herbertId });
    state = await michael.dashboard();
    assert.equal(state.members.find((m) => m.id === target.id).payout.status, 'paid');
    const additional = state.payments.find((p) => p.member_id === target.id && p.status === 'pending');
    await herbert.call(`/payments/${additional.id}/review`, { decision: 'accepted' });
    member = (await memberClient.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.payout.status, 'partial'); assert.equal(member.payout.remainingPocket, 100000);
    assert.equal(member.payout.remainingGreen, 70000); assert.equal(member.payout.paidGreen, 105000.7);
    assert.equal((await michael.call(route, firstMark)).status, 409);
    const restMark = { week, expectedPocket: 250001, expectedPaidPocket: 150001 };
    assert.equal((await herbert.call(route, restMark)).status, 200);
    member = (await memberClient.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.payout.status, 'paid'); assert.equal(member.payout.paidGreen, 175000.7);
    assert.equal(member.payout.paidBy, 'Herbert Petersen'); assert.equal(member.accepted, 550001);
    assert.equal((await michael.call(`${route}/undo`, { week, expectedPaidPocket: 150001 })).status, 409);
    assert.equal((await memberClient.call(`${route}/undo`, { week, expectedPaidPocket: 250001 })).status, 403);
    assert.equal((await michael.call(`${route}/undo`, { week, expectedPaidPocket: 250001 })).status, 200);
    assert.equal((await michael.call(`${route}/undo`, { week, expectedPaidPocket: 250001 })).status, 409);
    member = (await memberClient.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.payout.status, 'open'); assert.equal(member.payout.paidPocket, 0);
    assert.equal(member.payout.remainingGreen, 175000.7); assert.equal(member.pocket, 250001);
    assert.equal((await michael.call(route, { week, expectedPocket: 250001, expectedPaidPocket: 0 })).status, 200);
    await michael.call('/admin/settings', { week, goal: 550001, applyDefault: false });
    member = (await michael.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.pocket, 0); assert.equal(member.payout.paidPocket, 250001);
    await michael.call('/admin/settings', { week, goal: 300000, applyDefault: false });
    const reset = await michael.call('/admin/resets', { week, memberId: target.id, confirmation: 'ZURÜCKSETZEN' });
    member = (await michael.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.pocket, 0); assert.equal(member.payout.paidGreen, 175000.7);
    await michael.call(`/admin/resets/${reset.data.resetId}/restore`, { confirmation: 'WIEDERHERSTELLEN' });
    member = (await michael.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.payout.status, 'paid'); assert.equal(member.payout.remainingGreen, 0);
    assert.ok((await michael.dashboard()).activity.some((a) => a.action === 'pocket_payment_undone'));
    now = new Date('2026-11-02T12:00:00Z');
    assert.equal((await memberClient.login('Azrael Black')).status, 200);
    member = (await memberClient.dashboard()).members.find((m) => m.id === target.id);
    assert.equal(member.payout.status, 'none'); assert.equal(member.payout.paidPocket, 0);
    assert.equal((await memberClient.dashboard(week)).members.find((m) => m.id === target.id).payout.status, 'paid');
  });
});
