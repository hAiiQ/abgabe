import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { normalizeName } from './database.js';
import { hashPassword, verifyPassword, tokenHash, randomToken, safeEqual } from './auth.js';
import { FIRST_WEEK, TIME_ZONE, addDays, currentWeek, validWeek, ensureWeeks } from './weeks.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const publicMember = (m) => ({ id: m.id, name: m.name, role: m.role });
const validPassword = (password) => typeof password === 'string' && password.length >= 10 && password.length <= 128;
const validMoney = (amount) => Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000_000;

export function createApp({ db, adminSetupCode, production = false, clock = () => new Date(), disableRateLimit = false }) {
  if (production && (!adminSetupCode || adminSetupCode.length < 16)) throw new Error('ADMIN_SETUP_CODE muss mindestens 16 Zeichen lang sein.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'self'"],
    upgradeInsecureRequests: production ? [] : null,
  } }, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.is('application/json') || req.get('x-portal-request') !== '1') return res.status(403).json({ error: 'Anfrage nicht erlaubt. Bitte die Seite neu laden.' });
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Ungültige Eingabe.' });
      const origin = req.get('origin');
      if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Anfrage nicht erlaubt.' });
    }
    next();
  });
  const authLimiter = disableRateLimit ? (_req, _res, next) => next() : rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' },
  });
  if (!disableRateLimit) app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anfragen. Bitte kurz warten.' } }));
  app.use('/api', async (req, _res, next) => {
    const rawCookie = req.headers.cookie?.split(';').map((v) => v.trim()).find((v) => v.startsWith('abgabe_session='))?.slice(15);
    if (rawCookie && /^[a-f0-9]{64}$/.test(rawCookie)) {
      const session = await db.read((tx) => tx.get(`SELECT s.*, m.name, m.role FROM sessions s JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND m.active = 1`, [tokenHash(rawCookie), clock().toISOString()]));
      if (session) {
        req.member = { id: session.member_id, name: session.name, role: session.role };
        req.session = session;
      }
    }
    next();
  });
  const requireAuth = (req, _res, next) => {
    if (!req.member) return next(new HttpError(401, 'Bitte melde dich an.'));
    if (!['GET', 'HEAD'].includes(req.method) && !safeEqual(req.get('x-csrf-token') || '', req.session.csrf_token)) return next(new HttpError(403, 'Sitzung ungültig. Bitte die Seite neu laden.'));
    next();
  };
  const requireAdmin = (req, _res, next) => req.member?.role === 'admin' ? next() : next(new HttpError(403, 'Nur Michael Black und Herbert Petersen dürfen das.'));
  async function createSession(tx, memberId) {
    const token = randomToken(), csrf = randomToken();
    const expires = new Date(clock().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await tx.run('DELETE FROM sessions WHERE expires_at <= ?', [clock().toISOString()]);
    await tx.run('INSERT INTO sessions(token_hash, member_id, csrf_token, expires_at) VALUES(?, ?, ?, ?)', [tokenHash(token), memberId, csrf, expires]);
    return { token, csrf };
  }
  function setSessionCookie(res, token) {
    res.cookie('abgabe_session', token, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 7 * 86400000, path: '/' });
  }
  const audit = (tx, actor, action, details) => tx.run('INSERT INTO audit_log(id, actor_id, action, details, created_at) VALUES(?, ?, ?, ?, ?)',
    [randomUUID(), actor, action, JSON.stringify(details), clock().toISOString()]);
  const lockMember = (tx, id) => tx.get(`SELECT * FROM members WHERE id = ?${db.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [id]);

  app.get('/api/health', async (_req, res) => {
    await db.read((tx) => tx.get('SELECT 1 AS ok'));
    res.json({ ok: true });
  });
  app.get('/api/session', (req, res) => res.json({ user: req.member || null, csrf: req.session?.csrf_token || null }));
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { name, password, setupCode, recoveryCode } = req.body;
    if (!validPassword(password)) fail(400, 'Dein Passwort muss 10 bis 128 Zeichen lang sein.');
    const member = await db.read((tx) => tx.get('SELECT * FROM members WHERE normalized_name = ?', [normalizeName(name)]));
    if (!member) fail(400, 'Dieser Name steht nicht auf der Mitgliederliste. Bitte Vor- und Nachnamen prüfen.');
    if (!member.active) fail(403, 'Dieses Mitgliedskonto ist gesperrt. Bitte Michael oder Herbert kontaktieren.');
    if (member.password_hash) fail(409, 'Dieser Name ist bereits registriert. Bitte melde dich an.');
    if (member.reset_token_hash && !safeEqual(tokenHash(String(recoveryCode || '').trim()), member.reset_token_hash)) fail(403, 'Dieses Konto wurde zurückgesetzt. Bitte gib den Wiederherstellungscode deines Admins ein.');
    if (member.role === 'admin' && (!adminSetupCode || !safeEqual(setupCode || '', adminSetupCode))) fail(403, 'Für dieses Adminkonto brauchst du den richtigen Einrichtungscode.');
    const hash = await hashPassword(password);
    const session = await db.transaction(async (tx) => {
      const current = await lockMember(tx, member.id);
      if (!current?.active || current.password_hash || current.reset_token_hash !== member.reset_token_hash) fail(409, 'Dieser Zugang wurde zwischenzeitlich geändert. Bitte erneut versuchen.');
      const result = await tx.run(`UPDATE members SET password_hash = ?, registered_at = ?, reset_token_hash = NULL
        WHERE id = ? AND password_hash IS NULL AND active = 1
        AND (reset_token_hash = ? OR (reset_token_hash IS NULL AND ? IS NULL))`,
      [hash, clock().toISOString(), member.id, member.reset_token_hash, member.reset_token_hash]);
      if (result.rowCount !== 1) fail(409, 'Dieser Name ist bereits registriert. Bitte melde dich an.');
      return createSession(tx, member.id);
    });
    setSessionCookie(res, session.token);
    res.status(201).json({ user: publicMember(member), csrf: session.csrf });
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { name, password } = req.body;
    if (typeof password !== 'string' || password.length > 128) fail(400, 'Bitte Name und Passwort eingeben.');
    const member = await db.read((tx) => tx.get('SELECT * FROM members WHERE normalized_name = ?', [normalizeName(name)]));
    const passwordMatches = await verifyPassword(password, member?.password_hash);
    if (!passwordMatches || !member?.active) fail(401, 'Name oder Passwort stimmt nicht oder der Zugang ist gesperrt. Nur freigegebene Mitglieder können sich anmelden.');
    const session = await db.transaction(async (tx) => {
      const unchanged = await lockMember(tx, member.id);
      if (!unchanged?.active || unchanged.password_hash !== member.password_hash) fail(401, 'Dein Zugang wurde zwischenzeitlich geändert. Bitte erneut anmelden.');
      return createSession(tx, member.id);
    });
    setSessionCookie(res, session.token);
    res.json({ user: publicMember(member), csrf: session.csrf });
  });
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await db.transaction((tx) => tx.run('DELETE FROM sessions WHERE token_hash = ?', [req.session.token_hash]));
    res.clearCookie('abgabe_session', { httpOnly: true, secure: production, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });
  app.post('/api/account/password', requireAuth, authLimiter, async (req, res) => {
    if (!validPassword(req.body.password)) fail(400, 'Dein Passwort muss 10 bis 128 Zeichen lang sein.');
    const member = await db.read((tx) => tx.get('SELECT * FROM members WHERE id = ?', [req.member.id]));
    if (typeof req.body.currentPassword !== 'string' || req.body.currentPassword.length > 128 || !await verifyPassword(req.body.currentPassword, member.password_hash)) fail(403, 'Dein aktuelles Passwort stimmt nicht.');
    const hash = await hashPassword(req.body.password);
    await db.transaction(async (tx) => {
      await lockMember(tx, req.member.id);
      const changed = await tx.run('UPDATE members SET password_hash = ? WHERE id = ? AND password_hash = ? AND active = 1', [hash, req.member.id, member.password_hash]);
      if (changed.rowCount !== 1) fail(409, 'Dein Zugang wurde zwischenzeitlich geändert. Bitte erneut anmelden.');
      await tx.run('DELETE FROM sessions WHERE member_id = ? AND token_hash <> ?', [req.member.id, req.session.token_hash]);
      await audit(tx, req.member.id, 'password_changed', {});
    });
    res.json({ ok: true });
  });
  app.get('/api/dashboard', requireAuth, async (req, res) => {
    const now = clock(), activeWeek = currentWeek(now);
    const selected = req.query.week || (activeWeek < FIRST_WEEK ? FIRST_WEEK : activeWeek);
    if (!validWeek(selected, now)) fail(400, 'Ungültiger Wochenzeitraum.');
    const data = await db.transaction(async (tx) => {
      await ensureWeeks(tx, now);
      const week = await tx.get('SELECT * FROM weeks WHERE id = ?', [selected]);
      const members = await tx.all(`SELECT m.id, m.name, m.role, m.registered_at, m.active,
        COALESCE(SUM(CASE WHEN p.status = 'accepted' THEN p.amount ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END), 0) AS pending
        FROM members m LEFT JOIN payments p ON p.member_id = m.id AND p.week_id = ? AND p.reset_id IS NULL
        GROUP BY m.id, m.name, m.role, m.registered_at, m.active ORDER BY m.name`, [selected]);
      const payments = await tx.all(`SELECT p.*, m.name AS member_name, r.name AS recipient_name, reviewer.name AS reviewer_name
        FROM payments p JOIN members m ON m.id = p.member_id JOIN members r ON r.id = p.recipient_id
        LEFT JOIN members reviewer ON reviewer.id = p.reviewed_by WHERE p.week_id = ? AND p.reset_id IS NULL ORDER BY p.created_at DESC, p.id DESC`, [selected]);
      const weeks = await tx.all('SELECT * FROM weeks ORDER BY id DESC');
      const settings = await tx.get('SELECT * FROM settings WHERE id = 1');
      const activity = await tx.all(`SELECT a.*, m.name AS actor_name FROM audit_log a JOIN members m ON m.id = a.actor_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 30`);
      const resets = req.member.role === 'admin' ? await tx.all(`SELECT pr.*, m.name AS member_name, a.name AS actor_name,
        COUNT(p.id) AS payment_count, COALESCE(SUM(p.amount), 0) AS total
        FROM payment_resets pr JOIN members a ON a.id = pr.actor_id
        LEFT JOIN members m ON m.id = pr.member_id LEFT JOIN payments p ON p.reset_id = pr.id
        WHERE pr.restored_at IS NULL GROUP BY pr.id, pr.week_id, pr.member_id, pr.actor_id, pr.created_at, pr.restored_at, pr.restored_by, m.name, a.name
        ORDER BY pr.created_at DESC, pr.id DESC`) : [];
      return { week, members, payments, weeks, settings, activity, resets };
    });
    const members = data.members.map((m) => {
      const accepted = Number(m.accepted), pending = Number(m.pending);
      return { ...publicMember(m), active: Boolean(m.active), registered: Boolean(m.registered_at), accepted, pending,
        credited: Math.min(accepted, data.week.goal), pocket: Math.max(0, accepted - data.week.goal), remaining: Math.max(0, data.week.goal - accepted) };
    });
    // Personal notes are visible to their author and the two administrators.
    const payments = data.payments.map((p) => ({ ...p, note: req.member.role === 'admin' || p.member_id === req.member.id ? p.note : '', review_note: req.member.role === 'admin' || p.member_id === req.member.id ? p.review_note : '' }));
    res.json({ user: req.member, csrf: req.session.csrf_token, timeZone: TIME_ZONE, now: now.toISOString(), activeWeek,
      week: { id: data.week.id, end: addDays(data.week.id, 7), goal: data.week.goal, canSubmit: selected === activeWeek && activeWeek >= FIRST_WEEK },
      weeks: data.weeks, defaultGoal: data.settings.weekly_goal, members, payments, resets: data.resets,
      activity: req.member.role === 'admin' ? data.activity.map((item) => ({ ...item, details: JSON.parse(item.details) })) : [],
    });
  });
  app.post('/api/payments', requireAuth, async (req, res) => {
    const { amount, recipientId, week, note = '' } = req.body;
    if (!validMoney(amount)) fail(400, 'Bitte einen ganzen Dollarbetrag zwischen 1 und 1.000.000.000 eingeben.');
    if (week !== currentWeek(clock()) || week < FIRST_WEEK) fail(400, 'Abgaben können nur in der laufenden Woche eingetragen werden.');
    if (typeof note !== 'string' || note.length > 300) fail(400, 'Die Notiz darf höchstens 300 Zeichen haben.');
    await db.transaction(async (tx) => {
      const recipient = await tx.get("SELECT id FROM members WHERE id = ? AND role = 'admin' AND active = 1", [recipientId || '']);
      if (!recipient) fail(400, 'Bitte Michael Black oder Herbert Petersen als Empfänger wählen.');
      await ensureWeeks(tx, clock());
      await tx.run(`INSERT INTO payments(id, member_id, week_id, amount, recipient_id, note, status, created_at)
        VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)`, [randomUUID(), req.member.id, week, amount, recipientId, note.trim(), clock().toISOString()]);
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/payments/:id/review', requireAuth, requireAdmin, async (req, res) => {
    const { decision, note = '' } = req.body;
    if (!['accepted', 'rejected'].includes(decision)) fail(400, 'Bitte annehmen oder ablehnen wählen.');
    if (typeof note !== 'string' || note.length > 300) fail(400, 'Die Begründung darf höchstens 300 Zeichen haben.');
    await db.transaction(async (tx) => {
      const result = await tx.run(`UPDATE payments SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = 'pending' AND reset_id IS NULL`,
        [decision, req.member.id, clock().toISOString(), note.trim(), req.params.id]);
      if (result.rowCount !== 1) fail(409, 'Dieser Eintrag wurde bereits bearbeitet oder existiert nicht.');
      await audit(tx, req.member.id, `payment_${decision}`, { paymentId: req.params.id });
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    const { goal, week, applyDefault = true } = req.body;
    if (!validMoney(goal) || typeof applyDefault !== 'boolean') fail(400, 'Bitte ein gültiges Wochenziel eingeben.');
    if (!validWeek(week, clock())) fail(400, 'Ungültiger Wochenzeitraum.');
    await db.transaction(async (tx) => {
      await ensureWeeks(tx, clock());
      const previous = await tx.get('SELECT goal FROM weeks WHERE id = ?', [week]);
      await tx.run('UPDATE weeks SET goal = ? WHERE id = ?', [goal, week]);
      if (applyDefault) await tx.run('UPDATE settings SET weekly_goal = ? WHERE id = 1', [goal]);
      await audit(tx, req.member.id, 'goal_changed', { week, previous: previous.goal, goal, applyDefault });
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/members', requireAuth, requireAdmin, async (req, res) => {
    if (typeof req.body.name !== 'string') fail(400, 'Bitte Vor- und Nachnamen eingeben.');
    const name = req.body.name.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 80 || name.split(' ').length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name)) fail(400, 'Bitte einen vollständigen Namen mit 3 bis 80 Zeichen eingeben.');
    const member = { id: randomUUID(), name, role: 'member' };
    await db.transaction(async (tx) => {
      const result = await tx.run(`INSERT INTO members(id, name, normalized_name, role, created_at) VALUES(?, ?, ?, 'member', ?)
        ON CONFLICT(normalized_name) DO NOTHING`, [member.id, name, normalizeName(name), clock().toISOString()]);
      if (result.rowCount !== 1) fail(409, 'Dieser Name steht bereits auf der Mitgliederliste.');
      await audit(tx, req.member.id, 'member_added', { memberId: member.id, name });
    });
    res.status(201).json({ member });
  });
  app.post('/api/admin/members/:id/access', requireAuth, requireAdmin, async (req, res) => {
    const { active, confirmation } = req.body;
    if (typeof active !== 'boolean' || confirmation !== (active ? 'FREIGEBEN' : 'SPERREN')) fail(400, 'Bitte die Zugriffsänderung bestätigen.');
    await db.transaction(async (tx) => {
      const member = await lockMember(tx, req.params.id);
      if (!member) fail(404, 'Dieses Mitglied wurde nicht gefunden.');
      if (member.role === 'admin') fail(403, 'Die beiden festen Adminkonten können nicht gesperrt werden.');
      if (Boolean(member.active) === active) fail(409, 'Der Zugang hat diesen Status bereits.');
      await tx.run('UPDATE members SET active = ? WHERE id = ?', [active ? 1 : 0, member.id]);
      await tx.run('DELETE FROM sessions WHERE member_id = ?', [member.id]);
      await audit(tx, req.member.id, active ? 'member_enabled' : 'member_disabled', { memberId: member.id, name: member.name });
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/members/:id/reset-access', requireAuth, requireAdmin, async (req, res) => {
    if (req.body.confirmation !== 'ZURÜCKSETZEN') fail(400, 'Bitte den Zugang-Reset ausdrücklich bestätigen.');
    if (req.params.id === req.member.id) fail(400, 'Dein eigenes Passwort kannst du über dein Profil ändern.');
    const recoveryCode = randomToken();
    await db.transaction(async (tx) => {
      const member = await lockMember(tx, req.params.id);
      if (!member) fail(404, 'Dieses Mitglied wurde nicht gefunden.');
      await tx.run('UPDATE members SET password_hash = NULL, registered_at = NULL, reset_token_hash = ? WHERE id = ?', [tokenHash(recoveryCode), member.id]);
      await tx.run('DELETE FROM sessions WHERE member_id = ?', [member.id]);
      await audit(tx, req.member.id, 'member_access_reset', { memberId: member.id, name: member.name });
    });
    res.json({ ok: true, recoveryCode });
  });
  app.post('/api/admin/resets', requireAuth, requireAdmin, async (req, res) => {
    const { week, memberId = null, confirmation } = req.body;
    if (confirmation !== 'ZURÜCKSETZEN') fail(400, 'Bitte den Reset ausdrücklich mit ZURÜCKSETZEN bestätigen.');
    if (!validWeek(week, clock())) fail(400, 'Ungültiger Wochenzeitraum.');
    if (memberId !== null && (typeof memberId !== 'string' || !memberId)) fail(400, 'Ungültiges Mitglied.');
    const id = randomUUID();
    let affected;
    await db.transaction(async (tx) => {
      await ensureWeeks(tx, clock());
      const member = memberId ? await tx.get('SELECT name FROM members WHERE id = ?', [memberId]) : null;
      if (memberId && !member) fail(404, 'Dieses Mitglied wurde nicht gefunden.');
      await tx.run('INSERT INTO payment_resets(id, week_id, member_id, actor_id, created_at) VALUES(?, ?, ?, ?, ?)', [id, week, memberId, req.member.id, clock().toISOString()]);
      const result = await tx.run(`UPDATE payments SET reset_id = ? WHERE week_id = ? AND reset_id IS NULL${memberId ? ' AND member_id = ?' : ''}`, [id, week, ...(memberId ? [memberId] : [])]);
      affected = result.rowCount;
      if (!affected) fail(409, 'Für diese Auswahl gibt es keine Abgabeneinträge zum Zurücksetzen.');
      await audit(tx, req.member.id, 'payments_reset', { resetId: id, week, memberId, name: member?.name || null, count: affected });
    });
    res.json({ ok: true, resetId: id, count: affected });
  });
  app.post('/api/admin/resets/:id/restore', requireAuth, requireAdmin, async (req, res) => {
    if (req.body.confirmation !== 'WIEDERHERSTELLEN') fail(400, 'Bitte die Wiederherstellung bestätigen.');
    await db.transaction(async (tx) => {
      const changed = await tx.run('UPDATE payment_resets SET restored_at = ?, restored_by = ? WHERE id = ? AND restored_at IS NULL', [clock().toISOString(), req.member.id, req.params.id]);
      if (changed.rowCount !== 1) fail(409, 'Dieser Reset existiert nicht oder wurde bereits rückgängig gemacht.');
      const result = await tx.run('UPDATE payments SET reset_id = NULL WHERE reset_id = ?', [req.params.id]);
      await audit(tx, req.member.id, 'payments_restored', { resetId: req.params.id, count: result.rowCount });
    });
    res.json({ ok: true });
  });
  app.get('/api/export', requireAuth, requireAdmin, async (req, res) => {
    if (!validWeek(req.query.week, clock())) fail(400, 'Ungültiger Wochenzeitraum.');
    const result = await db.transaction(async (tx) => {
      await ensureWeeks(tx, clock());
      const week = await tx.get('SELECT * FROM weeks WHERE id = ?', [req.query.week]);
      const rows = await tx.all(`SELECT m.name, COALESCE(SUM(CASE WHEN p.status = 'accepted' THEN p.amount ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END), 0) AS pending
        FROM members m LEFT JOIN payments p ON p.member_id = m.id AND p.week_id = ? AND p.reset_id IS NULL GROUP BY m.id, m.name ORDER BY m.name`, [week.id]);
      return { week, rows };
    });
    const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [['Woche ab', 'Mitglied', 'Wochenziel', 'Bestätigt', 'Abgabenkonto', 'Eigene Tasche', 'Offen', 'In Prüfung'],
      ...result.rows.map((r) => [result.week.id, r.name, result.week.goal, r.accepted, Math.min(Number(r.accepted), result.week.goal), Math.max(0, Number(r.accepted) - result.week.goal), Math.max(0, result.week.goal - Number(r.accepted)), r.pending])];
    res.type('text/csv').attachment(`abgaben-${result.week.id}.csv`).send('\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n'));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Diese Funktion gibt es nicht.' }));
  app.use(express.static(resolve('public'), { maxAge: production ? '1h' : 0, etag: true }));
  app.get('/', (_req, res) => res.sendFile(resolve('public/index.html')));
  app.use((error, _req, res, _next) => {
    if (!error.status) console.error('Serverfehler:', error.message);
    res.status(error.status || 500).json({ error: error.status ? (error.type === 'entity.parse.failed' ? 'Ungültige Eingabe.' : error.message) : 'Etwas ist schiefgelaufen. Bitte versuche es erneut.' });
  });
  return app;
}
