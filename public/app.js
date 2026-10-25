const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
let user = null, csrf = null, data = null, page = 'overview', authMode = 'login', memberSearch = '', memberFilter = 'all', selectedWeek = null;
let toastTimer, refreshing = false, adminTab = 'members';
let authWeeklyGoal = null;

const paths = {
  arrows: '<path d="M5 15V5h10M9 19h10V9M5 5l6 6m8 8-6-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6m17 7h-5v4h5"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  logout: '<path d="M9 5H4v14h5m5-14 7 7-7 7m-6-7h13"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="3" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  file: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8m-8 4h5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (value) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value)} $`;
const number = (value) => new Intl.NumberFormat('de-DE').format(value);
const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const dateLabel = (date, options = {}) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', ...options, timeZone: 'Europe/Berlin' }).format(new Date(`${date}T12:00:00Z`));
const weekLabel = (date) => `${dateLabel(date)} – ${dateLabel(addDays(date, 6), { year: 'numeric' })}`;
const dateTime = (date) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(date));
const initials = (name) => name.split(' ').map((s) => s[0]).slice(0, 2).join('');
const avatar = (name, index = 0) => `<span class="avatar tone-${index % 5}" aria-hidden="true">${esc(initials(name))}</span>`;
const badge = (status) => `<span class="badge ${status}">${({ accepted: 'Bestätigt', pending: 'In Prüfung', rejected: 'Abgelehnt', open: 'Offen' })[status]}</span>`;
const admin = () => user?.role === 'admin';
const teamMembers = () => data.members.filter((member) => !member.removed);
const mine = () => data.members.find((m) => m.id === user.id);
const brand = () => `<a class="brand" href="/" aria-label="Abgabenkonto Startseite"><span class="brand-mark">${icon('arrows')}</span><span>abgabenkonto<span class="brand-sub">Das Mitgliederportal</span></span></a>`;
const footer = () => `<footer class="footer"><span>Abgabenkonto <span class="muted">/</span> Gemeinsam den Überblick behalten.</span><span class="footer-status"><span class="status-dot"></span> Wochenrhythmus · Europe/Berlin</span></footer>`;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-Portal-Request': '1', 'X-CSRF-Token': csrf || '' } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({ error: 'Der Server ist gerade nicht erreichbar.' }));
  if (!response.ok) {
    if (response.status === 401 && user && !path.includes('/auth/')) { user = null; data = null; modal.close(); renderAuth(); }
    throw new Error(result.error || 'Die Anfrage ist fehlgeschlagen.');
  }
  return result;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
function toast(message, error = false) {
  const el = document.querySelector('#toast');
  clearTimeout(toastTimer); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 5500);
}
function passwordField(name, label, autocomplete) {
  return `<label class="field"><span>${label}</span><div class="password-wrap"><input name="${name}" type="password" autocomplete="${autocomplete}" minlength="10" maxlength="128" required placeholder="${autocomplete === 'new-password' ? 'Mindestens 10 Zeichen' : 'Dein persönliches Passwort'}"><button type="button" data-action="toggle-password" aria-label="Passwort anzeigen">${icon('eye')}</button></div></label>`;
}

async function loadPublicGoal() {
  const settings = await api('/public-settings');
  authWeeklyGoal = settings.weeklyGoal;
  const amount = document.querySelector('#auth-weekly-goal');
  if (amount) amount.firstChild.textContent = `${number(authWeeklyGoal)} `;
}

function renderAuth() {
  const register = authMode === 'register';
  root.innerHTML = `<div class="auth-shell"><header class="header auth-header">${brand()}<span class="secure-label">${icon('shield')} Nur für unsere Mitglieder</span></header>
    <main id="main" class="auth-main"><div class="auth-grid"><section class="auth-copy"><span class="pill"><span class="status-dot"></span> Ein Team. Ein gemeinsamer Überblick.</span>
      <h1>Alles im Blick.<br><span>Jede Woche.</span></h1><p class="intro">Deine Abgaben, dein Fortschritt und das, was für dich bleibt. Alles an einem Ort. Klar und nachvollziehbar.</p>
      <div class="auth-target"><div class="amount" id="auth-weekly-goal" aria-live="polite">${authWeeklyGoal === null ? '–' : number(authWeeklyGoal)} <span>$</span></div><div class="target-label">Wöchentliches Abgabenziel<br>Der Rest gehört dir.</div></div>
    </section><section class="auth-card" aria-label="Mitgliederzugang"><div class="card-icon">${icon(register ? 'people' : 'arrows')}</div><h2>${register ? 'Dein Platz im Team.' : 'Schön, dass du da bist.'}</h2><p class="subtitle">${register ? 'Mit deinem Namen registrieren und Passwort wählen.' : 'Melde dich an und behalte deine Woche im Blick.'}</p>
      <div class="auth-tabs" aria-label="Zugang wählen"><button class="${!register ? 'active' : ''}" data-action="auth-login" aria-pressed="${!register}">Anmelden</button><button class="${register ? 'active' : ''}" data-action="auth-register" aria-pressed="${register}">Zum ersten Mal hier?</button></div>
      <form id="auth-form"><div class="form-error" role="alert" hidden></div><label class="field"><span>Vor- und Nachname</span><input name="name" autocomplete="username" placeholder="z. B. Zak Shakur" required maxlength="100">${register ? '<small>Verwende deinen vollständigen Namen aus der Mitgliederliste.</small>' : ''}</label>
      ${passwordField('password', register ? 'Passwort wählen' : 'Passwort', register ? 'new-password' : 'current-password')}
      ${register ? `${passwordField('passwordConfirm', 'Passwort wiederholen', 'new-password')}<label class="field"><span>Wiederherstellungscode <span class="muted">· nur nach Zugang-Reset</span></span><input name="recoveryCode" autocomplete="off" maxlength="100" placeholder="Bei der ersten Registrierung leer lassen"><small>Nach einem Reset erhältst du diesen Code persönlich von deinem Admin.</small></label><label class="field" id="admin-code-field" hidden><span>Admin-Einrichtungscode</span><input name="setupCode" type="password" autocomplete="off" maxlength="200" placeholder="Persönlicher Einrichtungscode"><small>Nur für Michael Black und Herbert Petersen.</small></label>` : ''}
      <button type="submit" class="btn btn-primary btn-wide">${register ? 'Konto erstellen' : 'Anmelden'} ${icon('arrow')}</button></form>
      <div class="auth-bottom">${icon('lock')}<span>Persönlicher Zugang. Dein Passwort bleibt privat.</span></div></section></div>
      <section class="auth-steps" aria-label="So funktioniert es"><div class="auth-step"><span class="step-number">01</span><div><h3>Abgabe eintragen</h3><p>Trage ein, wie viel du an Michael Black oder Herbert Petersen abgegeben hast.</p></div></div><div class="auth-step"><span class="step-number">02</span><div><h3>Bestätigung erhalten</h3><p>Einer der beiden bestätigt deine Abgabe. Erst dann zählt sie für dein Konto.</p></div></div><div class="auth-step"><span class="step-number">03</span><div><h3>Den Rest behalten</h3><p>Alles über deinem Wochenziel wird separat als eigene Tasche ausgewiesen.</p></div></div></section>
    </main>${footer()}</div>`;
  loadPublicGoal().catch(() => { /* Keep the last known goal during temporary network failures. */ });
}

async function loadDashboard({ quiet = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  try {
    const requestedWeek = quiet && data && selectedWeek === data.activeWeek ? null : selectedWeek;
    data = await api(`/dashboard${requestedWeek ? `?week=${encodeURIComponent(requestedWeek)}` : ''}`);
    user = data.user; csrf = data.csrf; selectedWeek = data.week.id;
    // Preserve an open form while background refreshes update underlying records.
    if (!quiet || !modal.open) renderPortal();
  } finally { refreshing = false; }
}

function renderPortal() {
  const pendingCount = data.payments.filter((p) => p.status === 'pending').length;
  root.innerHTML = `<div class="portal-shell"><header class="header">${brand()}<nav class="nav" aria-label="Hauptnavigation">
      <button data-page="overview" class="${page === 'overview' ? 'active' : ''}">Übersicht</button>
      <button data-page="history" class="${page === 'history' ? 'active' : ''}">Abgabenverlauf</button>
      ${admin() ? `<button data-page="reviews" class="${page === 'reviews' ? 'active' : ''}">Freigaben ${pendingCount ? `<span class="count">${pendingCount}</span>` : ''}</button><button data-page="settings" class="${page === 'settings' ? 'active' : ''}">Verwaltung</button>` : ''}
    </nav><div class="header-right"><button class="user-button" data-action="account" aria-label="Konto von ${esc(user.name)} öffnen">${avatar(user.name)}<span><strong>${esc(user.name)}</strong><small>${admin() ? 'Administrator' : 'Mitglied'}</small></span></button><button class="icon-button" data-action="logout" title="Abmelden" aria-label="Abmelden">${icon('logout')}</button></div></header>
    <main id="main" class="main">${pageTop()}${data.activeWeek < '2026-10-19' ? `<div class="banner">${icon('calendar')} Die erste Abgabenwoche startet am Montag, 19. Oktober 2026, um 00:00 Uhr. Bis dahin kannst du dein Konto einrichten.</div>` : selectedWeek !== data.activeWeek ? `<div class="banner">${icon('clock')} Du siehst eine abgeschlossene Woche. Offene Einträge können weiterhin von den Admins bestätigt werden.</div>` : ''}
      ${page === 'overview' ? overview() : page === 'history' ? history() : page === 'reviews' && admin() ? reviews() : page === 'settings' && admin() ? settings() : overview()}
      <p class="help-callout">${icon('lock')} Nur bestätigte Beträge zählen. Jede Woche beginnt montags um 00:00 Uhr und endet am folgenden Montag um 00:00 Uhr.</p>
    </main>${footer()}</div>`;
}

function pageTop() {
  const titles = { overview: ['DEIN WOCHENÜBERBLICK', 'Eine Woche. Alles im Blick.', 'Jede Abgabe zählt. Und du weißt genau, was für dich bleibt.'], history: ['ALLES NACHVOLLZIEHBAR', 'Deine Abgaben im Verlauf.', 'Alle Einträge der gewählten Woche und ihr aktueller Status.'], reviews: ['GEMEINSAM VERWALTEN', 'Eintragen. Prüfen. Bestätigen.', 'Hier warten die Abgaben der gewählten Woche auf deine Freigabe.'], settings: ['DIE RICHTIGEN EINSTELLUNGEN', 'Ein klarer Rahmen fürs Team.', 'Mitglieder freigeben, Wochenziele festlegen und Abgaben verwalten.'] };
  const [eyebrow, title, subtitle] = titles[page] || titles.overview;
  const index = data.weeks.findIndex((w) => w.id === selectedWeek);
  return `<div class="page-top"><div class="page-title"><div class="eyebrow"><span class="status-dot"></span> ${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="week-controls"><button class="icon-button" data-action="week-prev" aria-label="Vorherige Woche" ${index === data.weeks.length - 1 ? 'disabled' : ''}>${icon('left')}</button><label class="week-select">${icon('calendar')}<select id="week-select" aria-label="Abgabenwoche">${data.weeks.map((w) => `<option value="${w.id}" ${w.id === selectedWeek ? 'selected' : ''}>${weekLabel(w.id)}</option>`).join('')}</select></label><button class="icon-button" data-action="week-next" aria-label="Nächste Woche" ${index === 0 ? 'disabled' : ''}>${icon('chevron')}</button></div></div>`;
}
function statCard(label, value, hint, symbol, currency = true, extraClass = '') {
  return `<div class="stat-card${extraClass ? ` ${extraClass}` : ''}"><div class="stat-head"><span>${label}</span>${icon(symbol)}</div><div class="stat-value">${value}${currency ? '<span class="currency">$</span>' : ''}</div><p class="stat-foot">${hint}</p></div>`;
}
function stats() {
  const credited = data.members.reduce((s, m) => s + m.credited, 0), pocket = data.members.reduce((s, m) => s + m.pocket, 0);
  const paid = teamMembers().filter((m) => m.remaining === 0).length, pending = data.payments.filter((p) => p.status === 'pending').length;
  return `<section class="stats-grid" aria-label="Wochenstatistik">${statCard('Gesamtbetrag', number(credited + pocket), 'Schwarzgeld · Abgaben + eigene Tasche', 'wallet', true, 'stat-card-total')}${statCard('Bestätigte Wochenabgaben', number(credited), `von ${money(data.week.goal * teamMembers().length)} Wochenziel`, 'wallet')}${statCard('Eigene Tasche · Schwarzgeld', number(pocket), 'Bestätigter Überschuss aller Mitglieder', 'chart')}${statCard('Wochenziel erreicht', `${paid}<span class="currency">/ ${teamMembers().length}</span>`, 'Mitglieder haben ihre Abgabe erfüllt', 'people', false)}${statCard('Wartet auf Bestätigung', String(pending), `${money(data.members.reduce((s, m) => s + m.pending, 0))} in Prüfung`, 'clock', false)}</section>`;
}
function payoutStatus(member, controls = false) {
  const payout = member.payout;
  if (!payout) return '<span class="muted">–</span>';
  if (payout.status === 'none') return '<span class="muted">Kein Überschuss</span>';
  const label = { open: 'Offen', partial: 'Teilweise ausgezahlt', paid: 'Ausgezahlt' }[payout.status];
  return `<div class="payout-state"><span class="badge ${payout.status === 'paid' ? 'accepted' : payout.status === 'partial' ? 'pending' : 'open'}">${label}</span>
    ${payout.paidAt ? `<small>${money(payout.paidGreen)} Grüngeld ausgezahlt<br>${dateTime(payout.paidAt)} Uhr · ${esc(payout.paidBy)}</small>` : ''}
    ${payout.remainingGreen > 0 ? `<small>Noch ${money(payout.remainingGreen)} Grüngeld offen</small>` : ''}
    ${controls && admin() && payout.remainingPocket > 0 ? `<button class="btn btn-primary btn-sm" data-action="mark-payout" data-member="${member.id}" aria-label="Eigene Tasche von ${esc(member.name)} als ausgezahlt markieren">${icon('check')} ${payout.status === 'partial' ? 'Rest ausgezahlt' : 'Ausgezahlt'}</button>` : ''}
    ${controls && admin() && payout.paidAt ? `<button class="text-button" data-action="undo-payout" data-member="${member.id}" aria-label="Auszahlungsmarkierung von ${esc(member.name)} zurücknehmen">Markierung zurücknehmen</button>` : ''}
  </div>`;
}
function ownCard() {
  const m = mine(), progress = Math.min(100, Math.round(m.credited / data.week.goal * 100));
  return `<section class="own-card"><div class="eyebrow">DEIN ABGABENKONTO ${icon('wallet')}</div><h2>Dein Fortschritt.</h2><p class="own-sub">${weekLabel(selectedWeek)}</p><div class="own-amount">${number(m.credited)} <span>$</span><small> / ${money(data.week.goal)}</small></div><progress class="mini-progress own-progress" max="100" value="${progress}" aria-label="Dein Wochenfortschritt: ${progress} Prozent"></progress><div class="progress-labels"><span>${progress} % erreicht</span><span>${m.remaining ? `Noch ${money(m.remaining)}` : 'Wochenziel erfüllt'}</span></div><div class="own-breakdown"><div><span>Bestätigt gesamt</span><strong>${money(m.accepted)}</strong></div><div><span>Eigene Tasche · Schwarzgeld</span><strong class="pocket-total">${money(m.pocket)}</strong></div><div class="green-breakdown"><span>Grüngeld · 30 % Abzug</span><strong class="green-pocket-total">${money(m.greenPocket)}</strong></div><div><span>Dein Wochenziel</span><strong>${money(data.week.goal)}</strong></div></div><div class="own-payout"><h3>Auszahlung eigene Tasche</h3>${payoutStatus(m)}</div><button class="btn btn-primary btn-wide" data-action="new-payment" ${!data.week.canSubmit ? 'disabled' : ''}>${icon('plus')} Abgabe eintragen</button>${m.pending ? `<p class="own-pending">${icon('clock')} ${money(m.pending)} warten auf Bestätigung.</p>` : ''}</section>`;
}
function infoPanel() {
  return `<section class="panel info-panel"><h3>${icon('info')} Gut zu wissen</h3><p>Dein Wochenziel liegt bei <strong>${money(data.week.goal)}</strong>. Jeder bestätigte Dollar darüber geht als Schwarzgeld in deine eigene Tasche. Dein Grüngeldwert beträgt davon 70 % nach 30 % Abzug.</p><div class="divider"></div><h3>${icon('shield')} Deine Ansprechpartner</h3><div class="info-row">${avatar('Michael Black')} Michael Black <span class="outline-tag">ADMIN</span></div><div class="info-row">${avatar('Herbert Petersen', 2)} Herbert Petersen <span class="outline-tag">ADMIN</span></div>${admin() ? `<button class="text-button" data-page="settings" data-admin-section="general">Wochenziel verwalten ${icon('arrow')}</button>` : ''}</section>`;
}
function overview() {
  return `${stats()}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('people')}<h2>Die Mitglieder im Überblick</h2><small>${teamMembers().length}</small></div><p class="panel-subtitle">Ein gemeinsamer Stand für die gesamte Woche.</p></div>${admin() ? `<a class="icon-button" href="/api/export?week=${selectedWeek}" download title="Wochenübersicht als CSV exportieren" aria-label="Wochenübersicht als CSV exportieren">${icon('download')}</a>` : ''}</div><div class="toolbar"><label class="search">${icon('search')}<input id="member-search" aria-label="Mitglieder suchen" placeholder="Mitglied suchen …" value="${esc(memberSearch)}"></label><div class="filter-group" aria-label="Mitglieder filtern">${[['all','Alle'],['open','Offen'],['accepted','Erfüllt']].map(([key,label]) => `<button class="filter-btn ${memberFilter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${memberFilter === key}">${label}</button>`).join('')}</div></div><div class="table-scroll"><table><thead><tr><th scope="col">Mitglied</th><th scope="col">Abgabenkonto</th><th scope="col">Eigene Tasche<small class="money-type">Schwarzgeld</small></th><th scope="col">Grüngeld<small class="money-type">30 % Abzug</small></th><th scope="col">Status</th><th scope="col">Auszahlung</th></tr></thead><tbody id="member-rows">${memberRows()}</tbody></table></div><div class="table-bottom"><span id="member-count">${filteredMembers().length} von ${teamMembers().length} Mitgliedern</span><span class="legend"><span class="status-dot"></span> Nur bestätigte Beträge</span></div></section><aside class="sidebar">${ownCard()}${infoPanel()}</aside></div>`;
}
function filteredMembers() {
  return teamMembers().filter((m) => m.name.toLocaleLowerCase('de-DE').includes(memberSearch.toLocaleLowerCase('de-DE')) && (memberFilter === 'all' || (memberFilter === 'open' ? m.remaining > 0 : m.remaining === 0)));
}
function memberRows() {
  const members = filteredMembers();
  if (!members.length) return '<tr><td colspan="6"><div class="empty"><h3>Kein Mitglied gefunden.</h3><p>Versuche einen anderen Namen oder Filter.</p></div></td></tr>';
  return members.map((m) => {
    const status = m.remaining === 0 ? 'accepted' : m.pending ? 'pending' : 'open';
    return `<tr><td><div class="name-cell">${avatar(m.name, data.members.indexOf(m))}<span>${esc(m.name)}${m.id === user.id ? '<span class="me-tag">Du</span>' : ''}${m.role === 'admin' ? '<span class="admin-label">Administrator</span>' : ''}</span></div></td><td class="amount-cell">${money(m.credited)}<progress class="mini-progress" max="${data.week.goal}" value="${m.credited}" aria-label="Wochenziel von ${esc(m.name)}"></progress></td><td class="amount-cell pocket-cell">${m.pocket ? '+' : ''}${money(m.pocket)}</td><td class="amount-cell green-money">${money(m.greenPocket)}</td><td>${badge(status)}</td><td class="payout-cell">${payoutStatus(m, true)}</td></tr>`;
  }).join('');
}
function history() {
  const rows = data.payments;
  return `<div class="section-layout"><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('file')}<h2>Alle Abgaben dieser Woche</h2><small>${rows.length}</small></div><p class="panel-subtitle">Einträge und Freigaben bleiben nachvollziehbar.</p></div><button class="btn btn-primary btn-sm" data-action="new-payment" ${!data.week.canSubmit ? 'disabled' : ''}>${icon('plus')} Eintragen</button></div>${!rows.length ? empty('file', 'Noch keine Abgaben eingetragen.', 'Sobald ein Mitglied eine Abgabe einträgt, erscheint sie hier mit ihrem aktuellen Status.') : `<div class="table-scroll"><table><thead><tr><th>Mitglied / Eingang</th><th>Betrag</th><th>Empfänger</th><th>Status / Bestätigung</th></tr></thead><tbody>${rows.map((p) => `<tr><td class="history-name"><strong>${esc(p.member_name)} ${p.member_id === user.id ? '<span class="muted">· Du</span>' : ''}</strong><small>${dateTime(p.created_at)} Uhr</small>${p.note ? `<p class="transaction-note">${esc(p.note)}</p>` : ''}</td><td class="amount-cell">${money(p.amount)}</td><td>${esc(p.recipient_name)}</td><td>${badge(p.status)}${p.reviewer_name ? `<div class="history-name"><small>${esc(p.reviewer_name)} · ${dateTime(p.reviewed_at)}</small>${p.review_note ? `<p class="transaction-note">${esc(p.review_note)}</p>` : ''}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`}</section><aside class="sidebar">${ownCard()}${infoPanel()}</aside></div>`;
}
function empty(symbol, title, text) { return `<div class="empty">${icon(symbol)}<h3>${title}</h3><p>${text}</p></div>`; }
function reviews() {
  const pending = data.payments.filter((p) => p.status === 'pending');
  return `<div class="section-layout"><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('shield')}<h2>Offene Freigaben</h2><small>${pending.length}</small></div><p class="panel-subtitle">Michael und Herbert können jeden offenen Eintrag prüfen.</p></div></div>${pending.length ? `<div class="pending-list">${pending.map((p) => `<article class="review-card"><div class="review-card-top"><div class="review-person">${avatar(p.member_name)}<div><strong>${esc(p.member_name)}</strong><p>Abgegeben bei ${esc(p.recipient_name)}</p></div></div><span class="money">${money(p.amount)}</span></div>${p.note ? `<p class="review-note">${esc(p.note)}</p>` : ''}<div class="review-card-bottom"><span class="review-time">${dateTime(p.created_at)} Uhr · ${badge('pending')}</span><div class="actions"><button class="btn btn-ghost btn-sm" data-action="reject" data-id="${p.id}">${icon('close')} Ablehnen</button><button class="btn btn-primary btn-sm" data-action="accept" data-id="${p.id}">${icon('check')} Bestätigen</button></div></div></article>`).join('')}</div>` : empty('circleCheck', 'Alles auf dem aktuellen Stand.', 'In dieser Woche warten gerade keine Abgaben auf eine Bestätigung. Neue Einträge erscheinen automatisch hier.')}</section><aside class="sidebar"><section class="panel info-panel"><h3>${icon('shield')} Mit deiner Freigabe zählt es.</h3><p>Bestätigte Abgaben werden sofort dem jeweiligen Mitglied gutgeschrieben. Einträge über dem Wochenziel werden automatisch als eigene Tasche ausgewiesen.</p><p>Auch offene Einträge aus vergangenen Wochen lassen sich über die Wochenauswahl bearbeiten.</p></section>${infoPanel()}</aside></div>`;
}
function goalSettings() {
  const actions = { payment_accepted: 'hat eine Abgabe bestätigt.', payment_rejected: 'hat eine Abgabe abgelehnt.', goal_changed: 'hat das Wochenziel geändert.', password_changed: 'hat das eigene Passwort geändert.' };
  return `<div class="settings-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('settings')}<h2>Das wöchentliche Abgabenziel</h2></div><p class="panel-subtitle">Gilt für alle ${teamMembers().length} Mitglieder.</p></div></div><div class="settings-content"><form id="settings-form"><div class="form-error" role="alert" hidden></div><label class="field"><span>Wochenziel in Dollar</span><div class="amount-input"><input name="goal" inputmode="numeric" value="${number(data.week.goal)}" required maxlength="20" aria-describedby="goal-help"><span>$</span></div><small id="goal-help">Woche: ${weekLabel(selectedWeek)}</small></label><label class="checkbox-label"><input type="checkbox" name="applyDefault" checked><span>Auch als Standard für neue Wochen verwenden.<br><span class="muted">Aktueller Standard: ${money(data.defaultGoal)}</span></span></label><div class="setting-note">Die Änderung gilt sofort für die ausgewählte Woche. Die Aufteilung in Abgabenkonto und eigene Tasche wird für alle Mitglieder neu berechnet. Andere bereits angelegte Wochen behalten ihr Ziel.</div><button type="submit" class="btn btn-primary">${icon('check')} Wochenziel speichern</button></form><div class="divider"></div><div class="panel-title">${icon('download')}<h2>Wochenübersicht exportieren</h2></div><p class="panel-subtitle">Alle Mitglieder, bestätigte Beträge, eigene Tasche und offene Summen als CSV.</p><a class="btn btn-secondary btn-sm export-link" href="/api/export?week=${selectedWeek}" download>${icon('download')} CSV herunterladen</a></div></section><section class="panel"><div class="panel-header"><div class="panel-title">${icon('clock')}<h2>Letzte Änderungen</h2></div></div>${data.activity.length ? `<div class="audit-list">${data.activity.map((a) => `<div class="audit-item"><strong>${esc(a.actor_name)}</strong> ${actions[a.action] || auditText(a)}${a.action === 'goal_changed' ? `<br>${money(a.details.previous)} → ${money(a.details.goal)}<br>Woche ab ${dateLabel(a.details.week, { year: 'numeric' })}` : ''}<small>${dateTime(a.created_at)} Uhr</small></div>`).join('')}</div>` : empty('clock', 'Noch keine Änderungen.', 'Freigaben und Änderungen am Wochenziel werden hier protokolliert.')}</section></div>`;
}

function auditText(entry) {
  const d = entry.details;
  const text = {
    member_added: `hat ${d.name} zur Mitgliederliste hinzugefügt.`,
    member_removed: `hat ${d.name} aus der Mitgliederliste entfernt. Die Abgaben bleiben erhalten.`,
    member_restored: `hat ${d.name} in der Mitgliederliste wiederhergestellt.`,
    member_disabled: `hat den Zugang von ${d.name} gesperrt.`,
    member_enabled: `hat den Zugang von ${d.name} wieder freigegeben.`,
    member_access_reset: `hat den Zugang von ${d.name} zurückgesetzt.`,
    pocket_paid: `hat die eigene Tasche von ${d.name} für die Woche ab ${d.week} als ausgezahlt markiert (${money(d.greenAmount)} Grüngeld).`,
    pocket_payment_undone: `hat die Auszahlungsmarkierung von ${d.name} für die Woche ab ${d.week} zurückgenommen.`,
    payments_reset: `hat ${d.count} Abgabeneinträge ${d.name ? `von ${d.name} ` : ''}für die Woche ab ${d.week} zurückgesetzt.`,
    payments_restored: `hat ${d.count} zurückgesetzte Abgabeneinträge wiederhergestellt.`,
  };
  return esc(text[entry.action] || 'hat eine Änderung vorgenommen.');
}
function settings() {
  return `<nav class="admin-tabs" aria-label="Verwaltung auswählen">${[['members','people',`Mitglieder (${teamMembers().length})`],['general','settings','Wochenziel & Protokoll'],['resets','clock','Abgaben zurücksetzen']].map(([tab,symbol,label]) => `<button class="${adminTab === tab ? 'active' : ''}" data-admin-tab="${tab}" aria-pressed="${adminTab === tab}">${icon(symbol)} ${label}</button>`).join('')}</nav>${adminTab === 'members' ? memberManagement() : adminTab === 'resets' ? resetManagement() : goalSettings()}`;
}
function memberManagement() {
  const members = teamMembers(), allowed = members.filter((m) => m.active).length;
  const removed = data.members.filter((m) => m.removed);
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('shield')}<h2>Freigegebene Mitgliederliste</h2><small>${allowed} aktiv</small></div><p class="panel-subtitle">Nur freigegebene Namen auf dieser Liste können sich registrieren und anmelden.</p></div><button class="btn btn-primary btn-sm" data-action="add-member">${icon('plus')} Mitglied hinzufügen</button></div><div class="table-scroll"><table class="admin-members"><thead><tr><th>Mitglied</th><th>Konto</th><th>Zugang</th><th>Verwalten</th></tr></thead><tbody>${members.map((m,index) => `<tr><td><div class="name-cell">${avatar(m.name,index)}<span>${esc(m.name)}${m.id === user.id ? '<span class="me-tag">Du</span>' : ''}${m.role === 'admin' ? '<span class="admin-label">Administrator · festes Konto</span>' : ''}</span></div></td><td><span class="muted">${m.registered ? 'Registriert' : 'Passwort noch offen'}</span></td><td><span class="badge ${m.active ? 'accepted' : 'rejected'}">${m.active ? 'Freigegeben' : 'Gesperrt'}</span></td><td><select class="member-action" data-member="${m.id}" aria-label="Aktion für ${esc(m.name)}"><option value="">Aktion wählen …</option>${m.id === user.id ? '<option value="own-password">Eigenes Passwort ändern</option>' : '<option value="reset-access">Zugang zurücksetzen</option>'}<option value="reset-payments">Abgaben dieser Woche zurücksetzen</option>${m.role !== 'admin' ? `<option value="toggle-access">Zugang ${m.active ? 'sperren' : 'freigeben'}</option><option value="remove-member">Mitglied entfernen</option>` : ''}</select></td></tr>`).join('')}</tbody></table></div><div class="table-bottom"><span>${allowed} freigegeben · ${members.length - allowed} gesperrt</span><span>Entfernen beendet den Zugang. Abgaben bleiben erhalten.</span></div></section>
    <section class="panel member-archive"><div class="panel-header"><div><div class="panel-title">${icon('people')}<h2>Entfernte Mitglieder</h2><small>${removed.length}</small></div><p class="panel-subtitle">Frühere Abgaben bleiben im Verlauf und Export sichtbar.</p></div></div>${removed.length ? `<div class="reset-list">${removed.map((m) => `<article class="reset-item"><div><h3>${esc(m.name)}</h3><p>Entfernt am ${dateTime(m.removedAt)} Uhr</p><small>Wiederherstellung übernimmt den vorherigen Zugangsstatus.</small></div><button class="btn btn-secondary btn-sm" data-action="restore-member" data-id="${m.id}">Mitglied wiederherstellen</button></article>`).join('')}</div>` : empty('people','Keine entfernten Mitglieder.','Entfernte Mitglieder kannst du hier später wiederherstellen.')}</section>`;
}
function membershipModal(memberId, restore = false) {
  const m = data.members.find((member) => member.id === memberId);
  if (!m || m.role === 'admin') return;
  const title = restore ? 'Mitglied wiederherstellen' : 'Mitglied entfernen';
  openModal(`${modalHead(title,esc(m.name))}<form id="membership-form" data-member="${m.id}" data-restore="${restore}"><div class="form-error" role="alert" hidden></div><p class="setting-note">${restore ? `Das Mitglied erscheint wieder in der Mitgliederliste. Sein Zugang ist anschließend ${m.active ? 'wie vorher freigegeben' : 'weiterhin gesperrt'}. Konto und frühere Abgaben bleiben erhalten.` : 'Das Mitglied verschwindet aus der aktiven Mitgliederliste und kann sich nicht mehr anmelden oder registrieren. Laufende Sitzungen werden beendet. Alle bisherigen Abgaben und Bestätigungen bleiben erhalten. Du kannst die Person unter „Entfernte Mitglieder“ wiederherstellen.'}</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Abbrechen</button><button type="submit" class="btn ${restore ? 'btn-primary' : 'btn-danger'}">${title}</button></div></form>`);
}
function resetManagement() {
  return `<div class="reset-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('wallet')}<h2>Wochenabgaben zurücksetzen</h2></div><p class="panel-subtitle">Gewählte Woche: ${weekLabel(selectedWeek)}</p></div></div><div class="settings-content"><label class="field"><span>Welche Abgaben möchtest du zurücksetzen?</span><select id="reset-scope"><option value="all">Alle Mitglieder dieser Woche</option>${data.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label><div class="setting-note">Bestätigte, offene und abgelehnte Einträge der gewählten Auswahl werden aus der Wochenberechnung genommen. Kontozugänge und Wochenziele bleiben erhalten. Du kannst den Reset unten wieder rückgängig machen.</div><button class="btn btn-danger" data-action="open-reset">${icon('clock')} Auswahl zurücksetzen …</button></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">${icon('clock')}<h2>Wiederherstellbare Resets</h2><small>${data.resets.length}</small></div><p class="panel-subtitle">Alle Wochen · ursprüngliche Einträge bleiben erhalten.</p></div></div>${data.resets.length ? `<div class="reset-list">${data.resets.map((r) => `<article class="reset-item"><div><h3>${r.member_name ? esc(r.member_name) : 'Alle Mitglieder'}</h3><p>${weekLabel(r.week_id)} · ${r.payment_count} Einträge · ${money(Number(r.total))}</p><small>Zurückgesetzt von ${esc(r.actor_name)} · ${dateTime(r.created_at)} Uhr</small></div><button class="btn btn-secondary btn-sm" data-action="restore-reset" data-id="${r.id}">Wiederherstellen</button></article>`).join('')}</div>` : empty('circleCheck','Keine zurückgesetzten Abgaben.','Sobald du Wochenabgaben zurücksetzt, kannst du sie hier wiederherstellen.')}</section></div>`;
}
function addMemberModal() {
  openModal(`${modalHead('Mitglied hinzufügen','Erweitere die freigegebene Liste um einen weiteren Namen.')}<form id="add-member-form"><div class="form-error" role="alert" hidden></div><label class="field"><span>Vor- und Nachname</span><input name="name" required minlength="3" maxlength="80" placeholder="Vollständigen Namen eingeben" autocomplete="off" autofocus><small>Der Name muss bei der Registrierung übereinstimmen.</small></label><p class="form-hint">Das neue Mitglied wählt sein Passwort selbst. Michael Black und Herbert Petersen bleiben die beiden Administratoren.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Abbrechen</button><button type="submit" class="btn btn-primary">${icon('plus')} Mitglied hinzufügen</button></div></form>`);
}
function accessModal(memberId, reset = false) {
  const m = data.members.find((item) => item.id === memberId);
  if (!m) return;
  const action = reset ? 'reset-access' : 'toggle-access';
  const title = reset ? 'Zugang zurücksetzen' : m.active ? 'Zugang sperren' : 'Zugang freigeben';
  openModal(`${modalHead(title,esc(m.name))}<form id="access-form" data-member="${m.id}" data-operation="${action}" data-active="${!m.active}"><div class="form-error" role="alert" hidden></div><div class="setting-note">${reset ? 'Das bisherige Passwort wird ungültig und alle Sitzungen werden beendet. Du erhältst einen einmaligen Wiederherstellungscode. Mit diesem Code kann das Mitglied unter „Zum ersten Mal hier?“ ein neues Passwort wählen. Die Abgaben bleiben erhalten.' : m.active ? 'Dieses Mitglied kann sich danach weder anmelden noch registrieren. Laufende Sitzungen werden beendet. Die Abgaben bleiben erhalten. Du kannst den Zugang später wieder freigeben.' : 'Dieses Mitglied darf sich wieder anmelden oder mit seinem freigegebenen Namen registrieren.'}</div>${reset ? '<label class="field"><span>Zur Bestätigung ZURÜCKSETZEN eingeben</span><input name="confirmation" required autocomplete="off" placeholder="ZURÜCKSETZEN"></label>' : ''}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Abbrechen</button><button type="submit" class="btn ${reset || m.active ? 'btn-danger' : 'btn-primary'}">${title}</button></div></form>`);
}
function recoveryModal(code, name) {
  openModal(`${modalHead('Zugang zurückgesetzt',esc(name))}<p class="form-hint">Gib diesen einmaligen Code persönlich an das Mitglied weiter. Er wird nur jetzt angezeigt. Bei Bedarf kannst du einen neuen Code erzeugen; der bisherige wird dann ungültig.</p><label class="field recovery-field"><span>Einmaliger Wiederherstellungscode</span><textarea id="recovery-code" rows="3" readonly>${esc(code)}</textarea></label><button class="btn btn-secondary btn-wide" data-action="copy-recovery">Code kopieren</button><p class="form-hint">Zum Einrichten: „Zum ersten Mal hier?“ öffnen, Name, neues Passwort und diesen Code eingeben.${['Michael Black','Herbert Petersen'].includes(name) ? ' Für das Adminkonto ist zusätzlich der Admin-Einrichtungscode nötig.' : ''}</p><div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Fertig</button></div>`);
}
function resetPaymentsModal(memberId = null) {
  const member = data.members.find((m) => m.id === memberId);
  const payments = data.payments.filter((p) => !memberId || p.member_id === memberId);
  openModal(`${modalHead('Abgaben zurücksetzen',`${member ? esc(member.name) : 'Alle Mitglieder'} · ${weekLabel(selectedWeek)}`)}<form id="reset-payments-form" data-member="${memberId || ''}"><div class="form-error" role="alert" hidden></div><div class="setting-note"><strong>${payments.length} Einträge · ${money(payments.reduce((sum,p) => sum + p.amount,0))}</strong><br>Diese Einträge werden aus der Berechnung genommen. Die Abgabenkonten und die eigene Tasche werden neu berechnet. Du kannst die Einträge im Verwaltungsmenü wiederherstellen.</div><label class="field"><span>Zur Bestätigung ZURÜCKSETZEN eingeben</span><input name="confirmation" required autocomplete="off" placeholder="ZURÜCKSETZEN"></label><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Abbrechen</button><button type="submit" class="btn btn-danger" ${payments.length ? '' : 'disabled'}>Abgaben zurücksetzen</button></div></form>`);
}
function restoreModal(id) {
  const reset = data.resets.find((r) => r.id === id);
  if (!reset) return;
  openModal(`${modalHead('Abgaben wiederherstellen',`${reset.member_name ? esc(reset.member_name) : 'Alle Mitglieder'} · ${weekLabel(reset.week_id)}`)}<form id="restore-form" data-id="${id}"><div class="form-error" role="alert" hidden></div><p class="form-hint">${reset.payment_count} Einträge werden mit ihrem ursprünglichen Status wiederhergestellt. Bestätigte Beträge zählen anschließend zusätzlich zu allen seit dem Reset neu eingetragenen Abgaben.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Abbrechen</button><button type="submit" class="btn btn-primary">Wiederherstellen</button></div></form>`);
}
function openModal(content) { modal.innerHTML = content; if (!modal.open) modal.showModal(); }
function modalHead(title, subtitle) { return `<div class="modal-top"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Schließen">${icon('close')}</button></div><p class="modal-subtitle">${subtitle}</p>`; }
function paymentModal() {
  if (!data.week.canSubmit) return;
  openModal(`${modalHead('Abgabe eintragen', `Dein Eintrag für ${weekLabel(selectedWeek)}. Die Bestätigung erfolgt durch Michael oder Herbert.`)}<form id="payment-form"><div class="form-error" role="alert" hidden></div><label class="field"><span>Wie viel hast du abgegeben?</span><div class="amount-input"><input name="amount" inputmode="numeric" placeholder="z. B. 250.000" required maxlength="20" autofocus><span>$</span></div><small>Nur ganze Dollarbeträge. Mehrere Einträge werden addiert.</small></label><div class="preview-split"><div><span>Davon aufs Abgabenkonto</span><strong id="preview-credit">0 $</strong></div><div><span>Eigene Tasche · Schwarzgeld</span><strong id="preview-pocket">0 $</strong></div></div><label class="field"><span>Bei wem hast du abgegeben?</span><select name="recipientId" required><option value="">Empfänger wählen</option>${data.members.filter((m) => m.role === 'admin').sort((a,b) => a.name === 'Michael Black' ? -1 : b.name === 'Michael Black' ? 1 : 0).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label><label class="field"><span>Notiz <span class="muted">· optional</span></span><textarea name="note" maxlength="300" rows="2" placeholder="Etwas, das Michael oder Herbert wissen sollte …"></textarea></label><p class="form-hint">Die Vorschau berücksichtigt deine bisher bestätigten Abgaben. Offene Einträge zählen erst nach der Bestätigung.</p><div class="modal-actions"><button class="btn btn-ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn btn-primary" type="submit">Abgabe einreichen ${icon('arrow')}</button></div></form>`);
}
function reviewModal(id, decision) {
  const payment = data.payments.find((p) => p.id === id);
  if (!payment || payment.status !== 'pending') { toast('Dieser Eintrag ist nicht mehr offen.', true); return; }
  const accepted = decision === 'accepted';
  openModal(`${modalHead(accepted ? 'Abgabe bestätigen' : 'Abgabe ablehnen', `${esc(payment.member_name)} · ${money(payment.amount)}<br>Abgegeben bei ${esc(payment.recipient_name)}`)}<form id="review-form" data-id="${id}" data-decision="${decision}"><div class="form-error" role="alert" hidden></div><p class="form-hint">${accepted ? 'Mit deiner Bestätigung wird dieser Betrag dem Mitglied für diese Woche gutgeschrieben.' : 'Der Betrag wird nicht gutgeschrieben. Das Mitglied kann einen korrigierten Eintrag einreichen.'}</p><label class="field"><span>Begründung / Notiz · optional</span><textarea name="note" maxlength="300" placeholder="Deine Notiz zum Eintrag …"></textarea></label><div class="modal-actions"><button class="btn btn-ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn ${accepted ? 'btn-primary' : 'btn-danger'}" type="submit">${icon(accepted ? 'check' : 'close')} ${accepted ? 'Jetzt bestätigen' : 'Eintrag ablehnen'}</button></div></form>`);
}
function accountModal() {
  openModal(`${modalHead('Dein Konto', 'Verwalte dein persönliches Passwort.')}<div class="account-info">${avatar(user.name)}<div><strong>${esc(user.name)}</strong><p>${admin() ? 'Administrator' : 'Mitglied'}</p></div></div><form id="password-form"><div class="form-error" role="alert" hidden></div>${passwordField('currentPassword', 'Aktuelles Passwort', 'current-password')}${passwordField('password', 'Neues Passwort', 'new-password')}${passwordField('passwordConfirm', 'Neues Passwort wiederholen', 'new-password')}<p class="form-hint">Nach der Änderung werden deine anderen Sitzungen abgemeldet.</p><div class="modal-actions"><button class="btn btn-ghost" type="button" data-action="close-modal">Abbrechen</button><button type="submit" class="btn btn-primary">Passwort ändern</button></div></form>`);
}
function parseMoney(value) {
  const input = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:[. ]\d{3})+)(?:,00)?$/.test(input)) return NaN;
  const amount = Number(input.replace(/,00$/, '').replace(/[. ]/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 1e9 ? amount : NaN;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action],button[data-page],button[data-filter],button[data-admin-tab]');
  if (!button || button.disabled) return;
  try {
    if (button.dataset.adminTab) { adminTab = button.dataset.adminTab; renderPortal(); return; }
    if (button.dataset.page) { page = button.dataset.page; if (button.dataset.adminSection) adminTab = button.dataset.adminSection; memberSearch = ''; renderPortal(); return; }
    if (button.dataset.filter) { memberFilter = button.dataset.filter; renderPortal(); return; }
    const action = button.dataset.action;
    if (action === 'auth-login' || action === 'auth-register') { authMode = action === 'auth-login' ? 'login' : 'register'; renderAuth(); }
    if (action === 'toggle-password') { const input = button.parentElement.querySelector('input'); input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label', input.type === 'password' ? 'Passwort anzeigen' : 'Passwort verbergen'); }
    if (action === 'new-payment') paymentModal();
    if (action === 'close-modal') modal.close();
    if (action === 'account') accountModal();
    if (action === 'add-member') addMemberModal();
    if (action === 'restore-member') membershipModal(button.dataset.id, true);
    if (action === 'mark-payout' || action === 'undo-payout') {
      button.disabled = true;
      const member = data.members.find((m) => m.id === button.dataset.member);
      if (!member?.payout) throw new Error('Bitte aktualisiere die Übersicht.');
      const undo = action === 'undo-payout';
      await post(`/admin/members/${member.id}/payout${undo ? '/undo' : ''}`, {
        week: selectedWeek, expectedPocket: member.pocket, expectedPaidPocket: member.payout.paidPocket,
      });
      await loadDashboard(); toast(undo ? 'Auszahlungsmarkierung zurückgenommen.' : 'Eigene Tasche als ausgezahlt markiert.');
    }
    if (action === 'open-reset') { const scope = document.querySelector('#reset-scope').value; resetPaymentsModal(scope === 'all' ? null : scope); }
    if (action === 'restore-reset') restoreModal(button.dataset.id);
    if (action === 'copy-recovery') { await navigator.clipboard.writeText(document.querySelector('#recovery-code').value); toast('Wiederherstellungscode kopiert.'); }
    if (action === 'accept' || action === 'reject') reviewModal(button.dataset.id, action === 'accept' ? 'accepted' : 'rejected');
    if (action === 'logout') { button.disabled = true; await post('/auth/logout', {}); user = null; csrf = null; data = null; page = 'overview'; selectedWeek = null; modal.close(); renderAuth(); toast('Du bist abgemeldet.'); }
    if (action === 'week-prev' || action === 'week-next') {
      const index = data.weeks.findIndex((w) => w.id === selectedWeek), week = data.weeks[index + (action === 'week-prev' ? 1 : -1)];
      if (week) { selectedWeek = week.id; await loadDashboard(); }
    }
  } catch (error) { button.disabled = false; toast(error.message, true); }
});
document.addEventListener('input', (event) => {
  const field = event.target;
  if (field.id === 'member-search') { memberSearch = field.value; document.querySelector('#member-rows').innerHTML = memberRows(); document.querySelector('#member-count').textContent = `${filteredMembers().length} von ${teamMembers().length} Mitgliedern`; }
  if (field.form?.id === 'auth-form' && field.name === 'name' && authMode === 'register') {
    const isAdmin = ['michael black', 'herbert petersen'].includes(field.value.trim().replace(/\s+/g, ' ').toLowerCase());
    document.querySelector('#admin-code-field').hidden = !isAdmin;
    field.form.elements.setupCode.required = isAdmin;
  }
  if (field.form?.id === 'payment-form' && field.name === 'amount') {
    const amount = parseMoney(field.value), credit = Number.isNaN(amount) ? 0 : Math.min(amount, mine().remaining);
    document.querySelector('#preview-credit').textContent = money(credit);
    document.querySelector('#preview-pocket').textContent = money(Number.isNaN(amount) ? 0 : amount - credit);
  }
});
document.addEventListener('change', async (event) => {
  if (event.target.id === 'week-select') { selectedWeek = event.target.value; try { await loadDashboard(); } catch (error) { toast(error.message, true); } }
  if (event.target.matches('.member-action')) {
    const action = event.target.value, id = event.target.dataset.member;
    event.target.value = '';
    if (action === 'own-password') accountModal();
    if (action === 'reset-access') accessModal(id, true);
    if (action === 'toggle-access') accessModal(id);
    if (action === 'reset-payments') resetPaymentsModal(id);
    if (action === 'remove-member') membershipModal(id);
  }
});
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!['auth-form','payment-form','review-form','settings-form','password-form','add-member-form','access-form','membership-form','reset-payments-form','restore-form'].includes(form.id)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form)), errorBox = form.querySelector('.form-error'), submit = form.querySelector('[type="submit"]');
  errorBox.hidden = true; submit.disabled = true;
  try {
    if (form.id === 'auth-form') {
      if (authMode === 'register' && values.password !== values.passwordConfirm) throw new Error('Die beiden Passwörter stimmen nicht überein.');
      const result = await post(`/auth/${authMode}`, values); user = result.user; csrf = result.csrf;
      try { await loadDashboard(); } catch (error) { root.innerHTML = `<main id="main" class="error-view"><h1>Dein Konto ist bereit.</h1><p>${esc(error.message)}</p><a href="/" class="btn btn-primary">Erneut laden</a></main>`; }
    }
    if (form.id === 'payment-form') { const amount = parseMoney(values.amount); if (Number.isNaN(amount)) throw new Error('Bitte einen ganzen Dollarbetrag eingeben, z. B. 250.000.'); await post('/payments', { amount, recipientId: values.recipientId, week: selectedWeek, note: values.note }); modal.close(); await loadDashboard(); toast('Abgabe eingereicht. Sie wartet jetzt auf Bestätigung.'); }
    if (form.id === 'review-form') { await post(`/payments/${form.dataset.id}/review`, { decision: form.dataset.decision, note: values.note }); modal.close(); await loadDashboard(); toast(form.dataset.decision === 'accepted' ? 'Abgabe bestätigt und gutgeschrieben.' : 'Abgabe abgelehnt.'); }
    if (form.id === 'settings-form') { const goal = parseMoney(values.goal); if (Number.isNaN(goal)) throw new Error('Bitte einen gültigen ganzen Dollarbetrag eingeben.'); await post('/admin/settings', { goal, week: selectedWeek, applyDefault: values.applyDefault === 'on' }); await loadDashboard(); toast('Wochenziel gespeichert. Alle Beträge wurden neu berechnet.'); }
    if (form.id === 'password-form') { if (values.password !== values.passwordConfirm) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.'); await post('/account/password', values); modal.close(); toast('Dein Passwort wurde geändert.'); }
    if (form.id === 'add-member-form') { await post('/admin/members', { name: values.name }); modal.close(); await loadDashboard(); toast('Mitglied zur freigegebenen Liste hinzugefügt.'); }
    if (form.id === 'membership-form') {
      const restore = form.dataset.restore === 'true';
      await post(`/admin/members/${form.dataset.member}/${restore ? 'restore' : 'remove'}`, { confirmation: restore ? 'WIEDERHERSTELLEN' : 'ENTFERNEN' });
      modal.close(); await loadDashboard(); toast(restore ? 'Mitglied wiederhergestellt.' : 'Mitglied entfernt. Bisherige Abgaben bleiben erhalten.');
    }
    if (form.id === 'access-form') {
      const id = form.dataset.member, reset = form.dataset.operation === 'reset-access';
      const name = data.members.find((m) => m.id === id).name;
      const active = form.dataset.active === 'true';
      const result = await post(`/admin/members/${id}/${reset ? 'reset-access' : 'access'}`, reset ? { confirmation: values.confirmation } : { active, confirmation: active ? 'FREIGEBEN' : 'SPERREN' });
      if (reset) { recoveryModal(result.recoveryCode, name); await loadDashboard(); }
      else { modal.close(); await loadDashboard(); toast(active ? 'Zugang wieder freigegeben.' : 'Zugang gesperrt. Alle Sitzungen wurden beendet.'); }
    }
    if (form.id === 'reset-payments-form') { const result = await post('/admin/resets', { week: selectedWeek, memberId: form.dataset.member || null, confirmation: values.confirmation }); modal.close(); await loadDashboard(); toast(`${result.count} Abgabeneinträge zurückgesetzt. Die Einträge bleiben wiederherstellbar.`); }
    if (form.id === 'restore-form') { await post(`/admin/resets/${form.dataset.id}/restore`, { confirmation: 'WIEDERHERSTELLEN' }); modal.close(); await loadDashboard(); toast('Abgaben mit ursprünglichem Status wiederhergestellt.'); }
  } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  finally { submit.disabled = false; }
});
modal.addEventListener('click', (event) => { if (event.target === modal) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close(); } });

async function init() {
  try { const session = await api('/session'); user = session.user; csrf = session.csrf; if (user) await loadDashboard(); else renderAuth(); }
  catch (error) { root.innerHTML = `<main id="main" class="error-view"><h1>Das Portal ist gerade nicht erreichbar.</h1><p>${esc(error.message)}</p><a href="/" class="btn btn-primary">Erneut versuchen</a></main>`; }
}
await init();
setInterval(async () => {
  if (document.hidden) return;
  if (!user) { try { await loadPublicGoal(); } catch { /* Keep the form and last known goal. */ } return; }
  if (!modal.open && !document.activeElement?.closest('form') && document.activeElement?.id !== 'member-search') {
    try { await loadDashboard({ quiet: true }); } catch { /* Keep the current screen during temporary network failures. */ }
  }
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !user) loadPublicGoal().catch(() => {});
});


