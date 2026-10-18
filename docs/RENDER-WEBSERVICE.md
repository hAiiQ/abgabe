# Ein Web Service mit dauerhafter Speicherung

Diese Variante verwendet SQLite auf einer Render Persistent Disk. Du legst nur einen Web Service an. Die Datenbankdatei erstellt die Anwendung selbst. Voraussetzung ist ein **bezahlter Web-Service-Tarif plus Persistent Disk**; Free unterstützt keine dauerhafte lokale Speicherung.

1. Bei Render **New → Web Service** wählen.
2. Das Repository `hAiiQ/abgabe` verbinden.
3. Diese Einstellungen eintragen:

| Feld | Eintrag |
|---|---|
| Name | `abgabenkonto` (oder ein noch verfügbarer Name) |
| Language / Runtime | Node |
| Branch | `main` |
| Region | Frankfurt |
| Root Directory | Leer lassen |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | Kleinster bezahlter Tarif mit Persistent-Disk-Unterstützung |

4. Unter **Environment Variables** setzen:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `ADMIN_SETUP_CODE` | Ein eigener zufälliger Code mit mindestens 16 Zeichen |
| `SQLITE_PATH` | `/var/data/portal.sqlite` |

`DATABASE_URL` bleibt bei dieser Variante ungesetzt. Sie ist nur für die separate PostgreSQL-Variante gedacht. Bei einem bereits eingerichteten Dienst zuerst klären, wo dessen vorhandene Daten liegen, bevor der Speicher gewechselt wird; PostgreSQL-Daten werden nicht automatisch nach SQLite kopiert.

5. **Advanced → Add Disk** öffnen und eintragen:

| Disk-Feld | Eintrag |
|---|---|
| Name | `abgaben-daten` |
| Mount Path | `/var/data` |
| Size | `1 GB` |

6. Unter **Advanced** den **Health Check Path** auf `/api/health` setzen. Ein Pre-Deploy Command ist nicht nötig.
7. Die angezeigten Kosten prüfen und **Deploy Web Service** anklicken.

Die Anwendung prüft beim Start, ob die Disk unter `/var/data` tatsächlich eingehängt ist. Fehlt sie, stoppt der Start mit einer verständlichen Fehlermeldung, statt Konten und Abgaben in einem flüchtigen Verzeichnis zu speichern.

Nach dem Deployment die Render-Adresse öffnen. Unter **Zum ersten Mal hier?** können sich Michael und Herbert mit Namen, selbst gewähltem Passwort und dem Admin-Einrichtungscode registrieren. Die übrigen freigegebenen Mitglieder brauchen den Admincode nicht.

Konten, Passworthashes, Sitzungen, Abgaben und Einstellungen liegen unter `/var/data` und bleiben bei normalen Neustarts und Deployments erhalten. Die Disk und den zugehörigen Service für den Weiterbetrieb behalten. Ein CSV-Export enthält die Wochenübersicht, aber kein vollständiges Backup der Datenbank. Die vorhandene `render.yaml` bleibt als separate PostgreSQL-Blueprint-Variante verfügbar.

Offizielle Anleitung: [Render Persistent Disks](https://render.com/docs/disks).
