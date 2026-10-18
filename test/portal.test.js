import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, MEMBER_NAMES } from '../server/database.js';
import { createApp } from '../server/app.js';
import { currentWeek, validWeek } from '../server/weeks.js';
import { resolve } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

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
    await db.transaction((tx) => tx.run('UPDATE members SET active = 0 WHERE id = ?', ['legacy-zak']));
    await db.close(); db = null;
    db = await createDatabase({ sqlitePath: path });
    const after = await db.read((tx) => tx.get('SELECT * FROM members WHERE id = ?', ['legacy-zak']));
    assert.equal(after.active, 0); assert.equal(after.password_hash, 'existing-password-hash');
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
  const db = await createDatabase({ sqlitePath: ':memory:' });
  let now = new Date('2026-10-20T12:00:00Z');
  const app = createApp({ db, adminSetupCode: setupCode, clock: () => now, disableRateLimit: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((done) => server.close(done)); await db.close(); });
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
    assert.equal(m.accepted, 200000); assert.equal(m.credited, 200000); assert.equal(m.pocket, 0); assert.equal(m.pending, 0);
  });
  await t.test('Mehrere Abgaben addieren sich; Überschuss gehört in die eigene Tasche', async () => {
    await zak.call('/payments', { amount: 150000, week: '2026-10-19', recipientId: herbertId });
    const pending = (await zak.dashboard()).payments.find((p) => p.status === 'pending');
    assert.equal((await herbert.call(`/payments/${pending.id}/review`, { decision: 'accepted' })).status, 200);
    const m = (await zak.dashboard()).members.find((m) => m.id === zakId);
    assert.equal(m.accepted, 350000); assert.equal(m.credited, 250000); assert.equal(m.pocket, 100000); assert.equal(m.remaining, 0);
    await zak.call('/payments', { amount: 900000, week: '2026-10-19', recipientId: michaelId });
    const rejected = (await zak.dashboard()).payments.find((p) => p.status === 'pending');
    await michael.call(`/payments/${rejected.id}/review`, { decision: 'rejected', note: 'Betrag stimmt nicht.' });
    const after = await zak.dashboard(); assert.equal(after.members.find((m) => m.id === zakId).accepted, 350000);
    assert.equal(after.payments.find((p) => p.id === rejected.id).review_note, 'Betrag stimmt nicht.');
  });
  await t.test('Zieländerung rechnet die gewählte Woche neu; beide Admins dürfen verwalten', async () => {
    assert.equal((await herbert.call('/admin/settings', { week: '2026-10-19', goal: 300000, applyDefault: true })).status, 200);
    let state = await zak.dashboard(), m = state.members.find((m) => m.id === zakId);
    assert.equal(m.credited, 300000); assert.equal(m.pocket, 50000); assert.equal(state.defaultGoal, 300000);
    assert.equal((await michael.call('/admin/settings', { week: '2026-10-19', goal: 400000, applyDefault: false })).status, 200);
    state = await zak.dashboard(); m = state.members.find((m) => m.id === zakId);
    assert.equal(m.remaining, 50000); assert.equal(m.pocket, 0); assert.equal(state.defaultGoal, 300000);
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
    let state = await zak.dashboard(); assert.equal(state.week.id, '2026-10-26'); assert.equal(state.week.goal, 300000);
    assert.equal(state.members.find((m) => m.id === zakId).accepted, 0); assert.equal(state.payments.length, 0);
    assert.equal((await zak.call('/payments', { amount: 10, week: '2026-10-19', recipientId: michaelId })).status, 400);
    state = await michael.dashboard('2026-10-19');
    assert.equal(state.week.goal, 400000); assert.equal(state.week.canSubmit, false);
    const oldPending = state.payments.find((p) => p.status === 'pending');
    assert.equal((await herbert.call(`/payments/${oldPending.id}/review`, { decision: 'accepted' })).status, 200);
    assert.equal((await luana.dashboard('2026-10-19')).members.find((m) => m.name === 'Luana Velaris').credited, 100000);
    assert.equal((await luana.dashboard()).members.find((m) => m.name === 'Luana Velaris').credited, 0);
    assert.equal((await zak.dashboard('2026-11-02').catch(() => 'invalid')), 'invalid');
  });
  await t.test('Vor dem Start sind Registrierung und Übersicht verfügbar, aber keine Einträge', async () => {
    now = new Date('2026-10-18T21:00:00Z');
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
});
