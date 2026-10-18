# Kostenlos: Render Free + Neon Free

Diese Variante nutzt den bestehenden Web Service auf Render Free und eine externe PostgreSQL-Datenbank auf Neon Free. Eine Render-Disk wird nicht benötigt. Die Datenbanktabellen und die 15 Mitglieder legt die Anwendung automatisch an.

Stand der geprüften Tarife: 18.10.2026. Neon Free bietet laut Anbieter derzeit 1 GB Datenbankspeicher und 100 CU-Stunden pro Monat und Projekt, ohne feste Laufzeit und ohne Kreditkarte. Die Nutzung muss innerhalb der kostenlosen Kontingente beider Anbieter bleiben. Render Free kann den Web Service bei Inaktivität schlafen legen; die Daten bleiben in Neon gespeichert. Die kostenlose Render-eigene PostgreSQL-Datenbank läuft hingegen nach 30 Tagen ab und wird für diese Variante nicht verwendet.

## 1. Neon Free einrichten

1. [Neon](https://console.neon.tech/) öffnen und anmelden.
2. Ein Projekt `abgabenkonto` im **Free**-Tarif erstellen. Als Region Frankfurt bzw. eine nahe europäische Region wählen, falls verfügbar.
3. Im Projekt **Connect** öffnen.
4. Den Connection String für PostgreSQL kopieren. Er beginnt mit `postgresql://` und enthält die Zugangsdaten. Die vollständige URL inklusive TLS-Parametern wie `sslmode=require` verwenden; keinen davor angezeigten `psql`-Befehl und keine umschließenden Anführungszeichen kopieren.

## 2. Deinen bestehenden Render Web Service umstellen

1. Beim Web Service unter **Compute / Instance Type** den Tarif **Free** wählen. Keine Persistent Disk buchen.
2. **Environment** öffnen und die Variablen in einem Schritt so setzen:

| Key | Wert |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `ADMIN_SETUP_CODE` | Den bereits gewählten Admin-Einrichtungscode beibehalten |
| `DATABASE_URL` | Den vollständigen Connection String aus Neon |

3. Die Variable `SQLITE_PATH` aus der Konfiguration dieses Dienstes entfernen. `DATABASE_URL` und `SQLITE_PATH` dürfen nicht gleichzeitig gesetzt sein.
4. **Save, rebuild, and deploy** bzw. die angebotene Speichern-und-Deployen-Option wählen. Bei Bedarf unter **Manual Deploy → Deploy latest commit** den aktuellen Stand von `main` starten.

Build Command bleibt `npm ci --omit=dev`, Start Command bleibt `npm start`, Health Check Path bleibt `/api/health`.

Die Verbindungsadresse ist ein Geheimnis und gehört nur in Render Environment. Sie wird nicht in GitHub, einer öffentlichen Datei oder einem Screenshot veröffentlicht.

## 3. Seite öffnen

Nach erfolgreichem Deploy die Render-Adresse öffnen. Michael und Herbert registrieren sich mit ihrem Namen, selbst gewähltem Passwort und dem bestehenden Admin-Einrichtungscode. Die übrigen Mitglieder wählen ihren Namen und ihr Passwort selbst.

Bestehende Daten aus einer anderen PostgreSQL-Datenbank oder einer zuvor benutzten SQLite-Disk werden nicht automatisch übertragen. Eine bereits mit Daten benutzte Speicherquelle muss vor dem Wechsel übernommen werden. Ein fehlgeschlagener Start ohne konfigurierte Disk legt mit diesem Code keine flüchtigen Abgaben an.

## Optional: kostenloser Blueprint

Für einen neuen Blueprint **Blueprint Path = `render.free.yaml`** wählen. Dieser erstellt ausschließlich den kostenlosen Web Service und fragt nach `ADMIN_SETUP_CODE` und `DATABASE_URL`. Die bestehende `render.yaml` ist die kostenpflichtige PostgreSQL-Alternative. Eine bereits vorhandene Blueprint-Konfiguration nicht zusätzlich parallel auf dieselben Ressourcen anwenden.

Quellen: [Neon Free-Tarif](https://neon.com/pricing), [Neon-Verbindung](https://neon.com/docs/connect/connect-from-any-app), [Render Free](https://render.com/docs/free).
