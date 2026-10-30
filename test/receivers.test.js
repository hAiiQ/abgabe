import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { createPortalTestDatabase } from './database-fixture.js';

test('Abgabenannahme: nur Admins vergeben Rechte; Empfänger bestätigen nur eigene Eingänge', async (t) => {
  const fixture = await createPortalTestDatabase();
  let now = new Date('2026-10-20T12:00:00Z');
  const setupCode = 'receiver-test-only-setup-code', password = 'ReceiverTestPassword42!';
  const server = createApp({ db: fixture.db, adminSetupCode: setupCode, clock: () => now, disableRateLimit: true }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((done) => server.close(done)); await fixture.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = '', csrf = '';
    return {
      async call(path, body, headers = {}) {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
          Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Portal-Request': '1', 'X-CSRF-Token': csrf }), ...headers,
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const data = await response.json();
        if (data.csrf) csrf = data.csrf;
        return { status: response.status, data };
      },
      register(name) { return this.call('/auth/register', { name, password, setupCode }); },
      async dashboard(week = '2026-10-19') { const result = await this.call(`/dashboard?week=${week}`); assert.equal(result.status, 200); return result.data; },
    };
  }
  const admin = client(), collector = client(), author = client(), anonymous = client();
  await admin.register('Michael Black'); await collector.register('Zak Shakur'); await author.register('Luana Velaris');
  const initial = await admin.dashboard();
  const id = (name) => initial.members.find((m) => m.name === name).id;
  const collectorId = id('Zak Shakur'), adminId = id('Michael Black'), neoId = id('Neo Jones');
  const permissionRoute = `/admin/members/${collectorId}/receiver`;
  const submit = (recipientId, note = '') => author.call('/payments', { amount: 300000, week: '2026-10-19', recipientId, note });
  let assignedId, otherId;

  await t.test('Freigabe ist geschützt und ändert bestehende Sitzungen ohne neue Anmeldung', async () => {
    assert.equal(initial.members.filter((m) => m.canReceive).length, 2);
    assert.equal((await submit(collectorId)).status, 400);
    assert.equal((await anonymous.call(permissionRoute, { enabled: true })).status, 401);
    assert.equal((await collector.call(permissionRoute, { enabled: true })).status, 403);
    assert.equal((await admin.call(permissionRoute, { enabled: true }, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await admin.call(permissionRoute, { enabled: 'true' })).status, 400);
    assert.equal((await admin.call('/admin/members/missing/receiver', { enabled: true })).status, 404);
    for (const name of ['Michael Black', 'Herbert Petersen']) assert.equal((await admin.call(`/admin/members/${id(name)}/receiver`, { enabled: false })).status, 403);
    assert.equal((await admin.call(permissionRoute, { enabled: true })).status, 200);
    const session = await collector.call('/session');
    assert.equal(session.data.user.canReceive, true); assert.equal(session.data.user.role, 'member');
    assert.equal((await collector.dashboard()).user.canReceive, true);
    assert.equal((await submit(collectorId, 'Nur für den gewählten Empfänger')).status, 201);
    assert.equal((await submit(adminId, 'Private andere Abgabe')).status, 201);
    const payments = (await admin.dashboard()).payments;
    assignedId = payments.find((p) => p.recipient_id === collectorId).id;
    otherId = payments.find((p) => p.recipient_id === adminId).id;
  });
  await t.test('Delegierte sehen nur zugeordnete Notizen und erhalten keine Verwaltungsrechte', async () => {
    const state = await collector.dashboard();
    assert.equal(state.payments.find((p) => p.id === assignedId).note, 'Nur für den gewählten Empfänger');
    assert.equal(state.payments.find((p) => p.id === otherId).note, '');
    assert.deepEqual(state.activity, []); assert.deepEqual(state.resets, []);
    assert.equal((await collector.call(`/payments/${otherId}/review`, { decision: 'accepted' })).status, 403);
    assert.equal((await collector.call('/admin/settings', { goal: 1, week: '2026-10-19' })).status, 403);
    assert.equal((await collector.call('/admin/members', { name: 'Unbefugte Person' })).status, 403);
    assert.equal((await collector.call(`/admin/members/${id('Luana Velaris')}/payout`, { week: '2026-10-19', expectedPocket: 50000, expectedPaidPocket: 0 })).status, 403);
    assert.equal((await author.call(`/payments/${assignedId}/review`, { decision: 'accepted' })).status, 403);
    const result = await Promise.all([
      collector.call(`/payments/${assignedId}/review`, { decision: 'accepted', note: 'Eingang bestätigt' }),
      admin.call(`/payments/${assignedId}/review`, { decision: 'accepted' }),
    ]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await author.dashboard()).members.find((m) => m.name === 'Luana Velaris').accepted, 300000);
  });
  await t.test('Entziehen wirkt sofort, erhält alte Empfänger und lässt Admins offene Einträge übernehmen', async () => {
    await submit(collectorId, 'Noch offen');
    let state = await admin.dashboard();
    const pendingId = state.payments.find((p) => p.recipient_id === collectorId && p.status === 'pending').id;
    assert.equal((await admin.call(permissionRoute, { enabled: false })).status, 200);
    assert.equal((await collector.call('/session')).data.user.canReceive, false);
    assert.equal((await collector.call(`/payments/${pendingId}/review`, { decision: 'accepted' })).status, 403);
    assert.equal((await submit(collectorId)).status, 400);
    state = await collector.dashboard();
    assert.equal(state.payments.find((p) => p.id === pendingId).recipient_name, 'Zak Shakur');
    assert.equal(state.payments.find((p) => p.id === pendingId).note, '');
    assert.equal((await admin.call(`/payments/${pendingId}/review`, { decision: 'rejected' })).status, 200);
    assert.equal((await admin.call(permissionRoute, { enabled: true })).status, 200);
    await submit(collectorId);
    now = new Date('2026-10-26T12:00:00Z');
    const historical = (await collector.dashboard()).payments.find((p) => p.recipient_id === collectorId && p.status === 'pending');
    assert.equal((await collector.call(`/payments/${historical.id}/review`, { decision: 'rejected', note: 'Alte Woche geprüft' })).status, 200);
    assert.ok((await admin.dashboard()).activity.some((a) => a.action === 'receiver_disabled' && a.details.memberId === collectorId));
  });
  await t.test('Freigabe vor Registrierung funktioniert; Sperren und Entfernen schließen Empfänger aus', async () => {
    const neo = client();
    assert.equal((await admin.call(`/admin/members/${neoId}/receiver`, { enabled: true })).status, 200);
    const registered = await neo.register('Neo Jones');
    assert.equal(registered.status, 201); assert.equal(registered.data.user.canReceive, true); assert.equal(registered.data.user.role, 'member');
    const currentSubmit = (recipientId) => author.call('/payments', { amount: 1000, week: '2026-10-26', recipientId });
    assert.equal((await currentSubmit(neoId)).status, 201);
    assert.equal((await admin.call(`/admin/members/${neoId}/access`, { active: false, confirmation: 'SPERREN' })).status, 200);
    assert.equal((await currentSubmit(neoId)).status, 400);
    assert.equal((await admin.call(`/admin/members/${neoId}/receiver`, { enabled: true })).status, 409);
    assert.equal((await admin.call(`/admin/members/${neoId}/receiver`, { enabled: false })).status, 200);
    assert.equal((await admin.call(`/admin/members/${collectorId}/remove`, { confirmation: 'ENTFERNEN' })).status, 200);
    assert.equal((await currentSubmit(collectorId)).status, 400);
    assert.equal((await admin.call(permissionRoute, { enabled: true })).status, 409);
    assert.equal((await collector.call('/session')).data.user, null);
    assert.equal((await admin.dashboard()).payments.find((p) => p.id === assignedId).amount, 300000);
  });
});
