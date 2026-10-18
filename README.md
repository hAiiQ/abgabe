# Abgabenkonto

Fertiges Mitgliederportal für Render.com, mit dunkler Oberfläche und grünen Akzenten. Die Vorlage wurde ausschließlich als gestalterische Orientierung verwendet.

## Einfach: ein Web Service ohne separate Datenbank

Für **New → Web Service** gibt es jetzt die Variante mit SQLite auf einer Persistent Disk. Dabei wird nur ein bezahlter Web Service mit 1 GB Disk angelegt. Die vollständige Feld-für-Feld-Anleitung steht in [docs/RENDER-WEBSERVICE.md](docs/RENDER-WEBSERVICE.md).

Wichtig sind die Disk mit Mount Path `/var/data` und die Umgebungsvariable `SQLITE_PATH=/var/data/portal.sqlite`. Konten, Abgaben und Einstellungen bleiben dort bei Neustarts und Deployments erhalten. Die Anwendung prüft auf Render, ob diese Disk tatsächlich eingehängt ist. Free unterstützt keine Persistent Disk.

## Alternative: Blueprint mit PostgreSQL

1. Den Inhalt dieses Ordners bzw. der ZIP-Datei in ein neues GitHub-Repository hochladen. `package.json`, `package-lock.json` und `render.yaml` müssen direkt im Hauptverzeichnis liegen. Die lokale `.env`, `data/` und `node_modules/` gehören **nicht** ins Repository und sind nicht im Lieferpaket enthalten.
2. Bei [Render](https://dashboard.render.com/) **New → Blueprint** wählen und das Repository verbinden.
3. Für `ADMIN_SETUP_CODE` einen eigenen zufälligen Code mit mindestens **16 Zeichen** eingeben. Nur Michael Black und Herbert Petersen benötigen diesen Code für ihre jeweils erste Registrierung. Danach melden sie sich mit ihrem selbst gewählten Passwort an.
4. Die angezeigten Ressourcen und Kosten prüfen und den Blueprint erstellen. Die mitgelieferte Konfiguration erstellt einen kostenlosen Node-Webdienst und eine **kostenpflichtige, dauerhafte PostgreSQL-Datenbank** in Frankfurt. `DATABASE_URL` wird automatisch verbunden.
5. Nach erfolgreichem Deployment die von Render angezeigte `https://…onrender.com`-Adresse öffnen. Zuerst können Michael und Herbert ihre Konten unter **Zum ersten Mal hier?** einrichten. Anschließend den Link an die Mitglieder weitergeben.

Der kostenlose Webdienst kann bei Inaktivität einschlafen; der erste Aufruf braucht dann länger. Die Daten liegen unabhängig davon in PostgreSQL. Eine kostenlose Render-Datenbank ist nur zum Ausprobieren geeignet: Sie läuft nach 30 Tagen ab. Die kostenpflichtige Datenbank ist deshalb bewusst voreingestellt. Es wurden noch keine Render-Ressourcen angelegt oder kostenpflichtigen Dienste gebucht.

Offizielle Dokumentation: [Blueprints](https://render.com/docs/blueprint-spec), [Free-Tarif und Datenbankablauf](https://render.com/docs/free).

### Alternative: vorhandene Datenbank verwenden

Statt eines Blueprints einen **Web Service** mit Node 22 aus diesem Repository anlegen:

| Einstellung | Wert |
|---|---|
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | PostgreSQL-Verbindungsadresse; bei Render die Internal Database URL derselben Region |
| `ADMIN_SETUP_CODE` | Eigener zufälliger Code, mindestens 16 Zeichen |

In Produktion verlangt die Anwendung einen gültigen Einrichtungscode und einen explizit eingerichteten Speicher: entweder `DATABASE_URL` für PostgreSQL oder `SQLITE_PATH` für die Persistent-Disk-Variante. Beide Speicherarten gleichzeitig zu setzen wird abgelehnt. Bei SQLite auf Render wird die eingehängte Disk geprüft.

## Was enthalten ist

- Alle 15 vorgegebenen Mitglieder. Michael Black **und** Herbert Petersen sind Administratoren.
- Ausschließlich freigegebene Namen aus der Mitgliederliste können sich registrieren und anmelden. Nur die Admins können zusätzliche Namen auf diese Liste setzen. Gesperrte Mitglieder werden auch bei richtigem Passwort abgelehnt.
- Registrierung mit vollständigem Namen von der Liste und selbst gewähltem Passwort (10–128 Zeichen). Groß-/Kleinschreibung und zusätzliche Leerzeichen werden toleriert, andere Namen nicht.
- Ein Name kann nur einmal registriert werden. Die Namensregistrierung allein ist kein Identitätsnachweis; der erste Registrierende belegt das jeweilige Mitgliedskonto. Deshalb den Link gezielt an eure Mitglieder geben. Die beiden Adminkonten sind zusätzlich durch den Einrichtungscode geschützt.
- Persönliche Anmeldung, Abmeldung und Passwortänderung über das Profil rechts oben. Passwörter werden mit scrypt gehasht gespeichert; Sitzungen liegen in der Datenbank und werden per HttpOnly-Cookie übertragen.
- Übersicht über alle Mitglieder mit Suche und Filtern. Alle angemeldeten Mitglieder sehen die Kontostände und Abgaben. Persönliche Notizen und Ablehnungsbegründungen sehen nur die betroffene Person und die Admins.
- Beliebig viele Abgabeneinträge pro laufender Woche, jeweils an Michael oder Herbert. Es werden nur ganze Dollarbeträge akzeptiert.
- Michael und Herbert können offene Einträge unabhängig vom eingetragenen Empfänger bestätigen oder ablehnen. Freigaben können auch nach Ende der betreffenden Woche erfolgen. Bereits bearbeitete Einträge lassen sich nicht doppelt gutschreiben.
- Standard-Wochenziel **250.000 $ je Mitglied**, durch beide Admins einstellbar. Die Admins können das Ziel der gewählten Woche ändern und optional als Standard für neu angelegte Wochen übernehmen. Andere bereits angelegte Wochen behalten ihr Ziel.
- Automatische Aufteilung in **Abgabenkonto** und **Eigene Tasche**. Änderungen am Wochenziel berechnen diese Aufteilung anhand der bestätigten Beträge neu.
- Wochenarchiv, Änderungsprotokoll für Admins und CSV-Export der Wochenübersicht.
- Adminmenü mit Mitgliederverwaltung, Sperren/Freigeben, Zugang-Reset sowie wiederherstellbaren Resets einzelner Mitglieder oder ganzer Wochen.
- Aktualisierung im Hintergrund alle 30 Sekunden, solange keine Eingabe oder kein Dialog geöffnet ist.
- Responsive Darstellung, lokal gespeicherte Schriftarten, keine externen Tracker.

## Wochen und Berechnung

Die erste Woche läuft von **Montag, 19.10.2026, 00:00 Uhr**, bis **Montag, 26.10.2026, 00:00 Uhr** (Ende exklusiv), Zeitzone **Europe/Berlin**. Sonntag, der 25.10., gehört vollständig dazu. Danach geht es automatisch in Kalenderwochen weiter; es braucht keinen Cronjob. Vor Beginn können Konten bereits eingerichtet werden, Abgabeneinträge sind noch gesperrt.

Hinweis zur Zeitangabe: Sonntag **00:00 Uhr** wäre bereits der Anfang des Sonntags und damit nur sechs Kalendertage nach Montag. Für eine vollständige Woche ist das Ende daher der folgende Montag um 00:00 Uhr. Wegen der Zeitumstellung am 25.10. hat diese erste Kalenderwoche tatsächlich 169 Stunden.

Beispiel: Ein Mitglied trägt 200.000 $ und anschließend 150.000 $ ein. Erst nach Bestätigung **beider** Einträge ergibt sich bei einem Wochenziel von 250.000 $:

| Wert | Betrag |
|---|---:|
| Bestätigt gesamt | 350.000 $ |
| Abgabenkonto | 250.000 $ |
| Eigene Tasche | 100.000 $ |
| Noch offen | 0 $ |

Offene oder abgelehnte Einträge werden nicht gutgeschrieben. Zum Wochenwechsel beginnt der Wochenstand wieder bei null; die vergangenen Wochen bleiben erhalten. „Eigene Tasche“ wird ebenfalls je Woche angezeigt und exportiert. Das Portal dokumentiert die Abgaben, es überträgt kein Geld.

## Lokal starten

Voraussetzung: Node.js **22.17 oder neuer innerhalb der 22er-Reihe**.

```powershell
npm.cmd ci
Copy-Item .env.example .env
# In .env einen eigenen ADMIN_SETUP_CODE setzen.
npm.cmd start
```

Dann [http://localhost:3000](http://localhost:3000) öffnen. Falls `.env` bereits existiert, diese weiterverwenden, statt sie zu überschreiben. Im aktuell eingerichteten Arbeitsordner ist bereits eine lokale `.env` mit einem zufälligen Einrichtungscode vorhanden. Diese Datei wird weder veröffentlicht noch mit verpackt.

Ohne `DATABASE_URL` und `SQLITE_PATH` wird lokal `data/portal.sqlite` verwendet. Die SQLite-Datei enthält nur lokale Konten und Einträge und ist vom späteren Render-Speicher getrennt. Node 22 zeigt dafür gegebenenfalls einen Hinweis zur experimentellen SQLite-Schnittstelle an. Auf Render sind PostgreSQL oder SQLite auf einer Persistent Disk möglich.

## Prüfung

```powershell
npm.cmd run check
npm.cmd test
```

Die HTTP-Integrationstests verwenden eine eigene flüchtige Testdatenbank. Geprüft werden Registrierung, konkurrierende Registrierung, Anmeldung, Rollen, CSRF-/Herkunftsprüfung, Validierung, Notizsichtbarkeit, konkurrierende Freigaben, Teilabgaben, Überschüsse, Ablehnungen, Zieländerungen, Export, Wochenwechsel inklusive Zeitumstellung, Startdatum, Passwortwechsel und Sitzungsende. Die erweiterten Tests decken Mitglieder hinzufügen, Sperren/Freigeben, einmalige Wiederherstellungscodes, Resets mit Wiederherstellung und die Migration bestehender Konten ab. Zusätzlich wurden Anmeldung, Abgabeneingabe, Freigabe, Zieländerung, Mitglieder hinzufügen sowie Abgaben-Reset und Wiederherstellung in einer isolierten lokalen Browser-Testumgebung geprüft. Die Admin-Vorschau unter `docs/admin-vorschau.png` zeigt diese Testumgebung; das zusätzliche „Test Mitglied“ gehört nicht zur ausgelieferten Mitgliederliste.

Zusätzlich prüfen die Speichertests die Konfiguration, den Schutz vor einer fehlenden Render-Disk sowie den Erhalt von Mitgliedern, Sitzungen und Abgaben nach Schließen und erneutem Öffnen der SQLite-Datei. Der produktive Render-Betrieb wird abschließend durch das erste Deployment und den Datenbank-Healthcheck geprüft. Ein Live-Deployment wurde noch nicht durchgeführt.

## Projektaufbau

```text
public/              Oberfläche, Symbole und lokale Schriftarten
server/              API, Anmeldung, Berechnung und Datenbankzugriff
test/                Automatische HTTP- und Kalenderwochentests
render.yaml          Render-Blueprint mit Webdienst und PostgreSQL
.env.example         Beispiel der Umgebungsvariablen ohne Zugangsdaten
```

Die Schriftarten Manrope und DM Sans werden unter der SIL Open Font License ausgeliefert. Die Lizenztexte liegen unter `public/fonts/`.

## Mitglieder und Resets verwalten

Michael und Herbert sehen unter **Verwaltung** drei Bereiche:

1. **Mitglieder:** Mit „Mitglied hinzufügen“ einen vollständigen Namen freigeben. Das neue Mitglied registriert sich anschließend selbst und wählt sein Passwort. Bei jedem Mitglied bietet „Aktion wählen“ die verfügbaren Verwaltungsaktionen an.
2. **Wochenziel & Protokoll:** Wochenziel einstellen, CSV exportieren und die letzten Verwaltungsänderungen nachvollziehen.
3. **Abgaben zurücksetzen:** Über die Wochenauswahl oben und die Auswahl „Alle Mitglieder“ bzw. einen einzelnen Namen den Umfang festlegen. Nach Eingabe von `ZURÜCKSETZEN` werden die gewählten Abgabeneinträge aus der Berechnung genommen. Unter „Wiederherstellbare Resets“ können sie mit ihrem ursprünglichen Status zurückgeholt werden. Neue Einträge nach dem Reset bleiben dabei erhalten und werden zusätzlich berücksichtigt.

### Zugang sperren oder wieder freigeben

„Zugang sperren“ verweigert Anmeldung und Registrierung und beendet alle bestehenden Sitzungen. Abgabeneinträge und Historie bleiben erhalten. „Zugang freigeben“ hebt die Sperre wieder auf. Die beiden festen Adminkonten können nicht gesperrt werden. Eine Zugangssperre ändert ausschließlich den Portalzugriff, nicht die Wochenpflicht oder bisherige Kontoberechnungen.

### Passwort vergessen / Zugang zurücksetzen

Der Admin wählt bei der betroffenen Person **Zugang zurücksetzen** und bestätigt mit `ZURÜCKSETZEN`. Das bisherige Passwort und alle Sitzungen werden ungültig. Der Admin erhält einen **einmaligen Wiederherstellungscode**, der nur in diesem Dialog angezeigt und nicht im Änderungsprotokoll gespeichert wird. Er gibt ihn der betroffenen Person persönlich weiter.

Das Mitglied öffnet **Zum ersten Mal hier?** und gibt seinen Namen, ein neues Passwort sowie den Wiederherstellungscode ein. Ohne richtigen Code bleibt das zurückgesetzte Konto gesperrt. Ein neuer Zugang-Reset entwertet einen vorherigen Code. Für die beiden Adminkonten ist auch nach einem Reset zusätzlich der Admin-Einrichtungscode erforderlich. Das eigene Passwort kann jeder über sein Profil ändern; ein Admin kann nur den Zugang des jeweils anderen Admins zurücksetzen. Eine separat gesetzte Zugangssperre bleibt auch nach dem Passwort-Reset bestehen.

Bestehende Datenbanken werden beim nächsten Start automatisch um die neuen Felder ergänzt. Vorhandene Konten und Abgaben bleiben dabei erhalten.
