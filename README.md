# Abgabenkonto

Fertiges Mitgliederportal für Render.com, mit dunkler Oberfläche und grünen Akzenten. Die Vorlage wurde ausschließlich als gestalterische Orientierung verwendet.

## Kostenlos: Render Free + Neon Free

Für den Betrieb ohne laufende Gebühren innerhalb der Free-Kontingente verwende Render Free für den Web Service und Neon Free für die PostgreSQL-Datenbank. Eine Render-Disk ist dabei nicht nötig. Die vollständige Anleitung steht in [docs/RENDER-KOSTENLOS.md](docs/RENDER-KOSTENLOS.md). Der Code unterstützt diese Variante bereits über `DATABASE_URL`; `SQLITE_PATH` bleibt ungesetzt. Für einen neuen kostenlosen Blueprint gibt es `render.free.yaml` (ohne Render-Datenbank und ohne Disk).

## Kostenpflichtige Alternative: ein Web Service ohne separate Datenbank

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
- Übersicht über alle Mitglieder mit Suche und Filtern. Alle angemeldeten Mitglieder sehen die Kontostände und Abgaben. Persönliche Notizen und Ablehnungsbegründungen sehen die betroffene Person, die Admins und der aktuell zur Abgabenannahme berechtigte Empfänger des Eintrags.
- Beliebig viele Abgabeneinträge pro laufender Woche, jeweils an einen freigegebenen Empfänger. Es werden nur ganze Dollarbeträge akzeptiert.
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

Die Startseite zeigt auch ohne Anmeldung das Ziel der laufenden Woche an. Änderungen werden beim Öffnen und auf einer sichtbaren Startseite alle 30 Sekunden geladen. Vor dem ersten Wochenstart gilt das Ziel der ersten Abgabenwoche; Änderungen an vergangenen Wochen ersetzen nicht das aktuelle Ziel.

In der Wochenübersicht zeigt **Gesamtbetrag** die Summe aller bestätigten Abgabenkonten und der eigenen Taschen für die ausgewählte Woche. Offene und abgelehnte Einträge werden nicht mitgerechnet. Erfasste Beträge entfernter Mitglieder bleiben enthalten.

Die eigene Tasche wird pro Person zusätzlich als **Grüngeld nach 30 % Abzug** ausgewiesen: 100.000 $ Schwarzgeld entsprechen 70.000 $ Grüngeld. Die Berechnung verwendet nur den bestätigten Überschuss über dem Wochenziel und wird bei Zieländerungen neu berechnet. Die zusätzliche Anzeige steht in der Mitgliederliste, im persönlichen Konto und im CSV-Export. Bei Bruchteilen werden zwei Nachkommastellen angezeigt; der CSV-Export verwendet ein deutsches Dezimalkomma. Der Gesamtbetrag summiert weiterhin die ursprünglichen Schwarzgeldbeträge.

### Zugriff auf alte Wochenabgaben

Unter **Wochenarchiv** stehen alle gespeicherten Wochen seit dem 19.10.2026, einschließlich der laufenden Woche. Jede Woche zeigt ihr eigenes Ziel, bestätigte Schwarzgeldbeträge und die Anzahl der Abgabeneinträge. **Abgaben ansehen** öffnet den Verlauf; **Wochenübersicht** zeigt Mitgliederbeträge, Grüngeld und Auszahlungsmarkierungen dieser Woche. Admins können die jeweilige Woche zusätzlich als CSV herunterladen und offene Einträge weiterhin bearbeiten.

Die gewählte Woche steht in der Seitenadresse und bleibt dadurch nach Neuladen oder erneutem Anmelden ausgewählt. Mit **Zur aktuellen Woche** wird wieder die laufende Woche geöffnet. Daten älterer Wochen bleiben beim automatischen Wochenwechsel gespeichert. Neue Abgaben sind weiterhin nur in der laufenden Woche möglich.

### Weitere Empfänger für Abgaben freigeben

Unter **Verwaltung → Abgabenannahme** können Michael und Herbert weitere aktive Mitglieder mit **Freigeben** zur Abgabenannahme berechtigen. Diese Mitglieder erscheinen sofort in der Empfängerauswahl bei neuen Abgaben und erhalten den Bereich **Freigaben**. Dort können sie ausschließlich Einträge bestätigen oder ablehnen, die bei ihnen eingetragen wurden – auch aus alten Wochen. Michael und Herbert dürfen weiterhin alle offenen Einträge prüfen.

**Freigabe entziehen** beendet diese Berechtigung sofort, auch in bestehenden Sitzungen. Bisherige Abgaben, Empfängernamen und Bestätigungen bleiben gespeichert; offene Einträge können die Admins übernehmen. Änderungen werden im Verwaltungsprotokoll erfasst. Gesperrte oder entfernte Mitglieder können nicht als Empfänger gewählt werden. Die Berechtigung bleibt beim Sperren/Entfernen gespeichert und wird nach Freigeben/Wiederherstellen des Zugangs wieder wirksam, sofern sie nicht separat entzogen wurde. Weitere Empfänger erhalten keine Mitgliederverwaltung, Zieländerungen, Resets oder Auszahlungsrechte. Die Freigabe ist auch vor der ersten Registrierung möglich; das Mitglied wählt weiterhin selbst sein Passwort.

### Eigene Tasche als ausgezahlt markieren

Michael und Herbert sehen in der Mitgliederübersicht pro Person die Spalte **Auszahlung**. Mit **Ausgezahlt** wird der aktuell offene Betrag der eigenen Tasche für die ausgewählte Woche als ausgezahlt markiert. Der Status mit Grüngeldbetrag, Datum und Administrator ist auch für Mitglieder sichtbar und wird im persönlichen Konto sowie im CSV-Export angezeigt. Abgaben- und Taschenbeträge bleiben als Wochenübersicht erhalten.

Die Markierung speichert den bestätigten Betrag zum Zeitpunkt des Klicks. Zusätzlicher Überschuss wird anschließend als **Teilweise ausgezahlt** mit offenem Rest angezeigt; **Rest ausgezahlt** markiert auch diesen Anteil. Zieländerungen und Abgaben-Resets löschen frühere Auszahlungsmarkierungen nicht. Jede Woche hat ihren eigenen Status. **Markierung zurücknehmen** hebt die gesamte Auszahlungsmarkierung dieser Person für die gewählte Woche auf; die Änderung bleibt im Verwaltungsprotokoll erhalten. Bei gleichzeitig geänderten Beträgen oder Markierungen muss die Übersicht vor dem erneuten Klick aktualisiert werden.

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

Zusätzlich prüfen die Speichertests die Konfiguration, den Schutz vor einer fehlenden Render-Disk sowie den Erhalt von Mitgliedern, Sitzungen und Abgaben nach Schließen und erneutem Öffnen der SQLite-Datei. Der produktive Render-Betrieb wird durch Deployment und Datenbank-Healthcheck geprüft.

Mit `TEST_DATABASE_URL` können dieselben HTTP-Integrationstests zusätzlich gegen echtes PostgreSQL ausgeführt werden. Der Testlauf legt dafür ein eigenes zufällig benanntes Schema an und entfernt ausschließlich dieses Schema nach dem Test. Bestehende Mitgliederdaten werden nicht verwendet. Ohne diese Variable verwenden die Tests weiterhin SQLite im Arbeitsspeicher. Beide Varianten prüfen insbesondere Erstregistrierung und erneute Registrierung nach einem Zugang-Reset.

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

Michael und Herbert sehen unter **Verwaltung** vier Bereiche:

1. **Mitglieder:** Mit „Mitglied hinzufügen“ einen vollständigen Namen freigeben. Das neue Mitglied registriert sich anschließend selbst und wählt sein Passwort. Bei jedem Mitglied bietet „Aktion wählen“ die verfügbaren Verwaltungsaktionen an.
2. **Abgabenannahme:** Weitere Empfänger freigeben oder ihre Freigabe entziehen.
3. **Wochenziel & Protokoll:** Wochenziel einstellen, CSV exportieren und die letzten Verwaltungsänderungen nachvollziehen.
4. **Abgaben zurücksetzen:** Über die Wochenauswahl oben und die Auswahl „Alle Mitglieder“ bzw. einen einzelnen Namen den Umfang festlegen. Nach Eingabe von `ZURÜCKSETZEN` werden die gewählten Abgabeneinträge aus der Berechnung genommen. Unter „Wiederherstellbare Resets“ können sie mit ihrem ursprünglichen Status zurückgeholt werden. Neue Einträge nach dem Reset bleiben dabei erhalten und werden zusätzlich berücksichtigt.

### Zugang sperren oder wieder freigeben

„Zugang sperren“ verweigert Anmeldung und Registrierung und beendet alle bestehenden Sitzungen. Abgabeneinträge und Historie bleiben erhalten. „Zugang freigeben“ hebt die Sperre wieder auf. Die beiden festen Adminkonten können nicht gesperrt werden. Eine Zugangssperre ändert ausschließlich den Portalzugriff, nicht die Wochenpflicht oder bisherige Kontoberechnungen.

### Mitglied entfernen oder wiederherstellen

Unter **Verwaltung → Mitglieder → Aktion wählen → Mitglied entfernen** können Michael und Herbert normale Mitglieder aus der aktiven Liste nehmen. Nach Bestätigung endet der Zugang sofort; bestehende Sitzungen werden beendet. Die Person kann sich auch mit ihrem bisherigen Passwort nicht mehr anmelden oder neu registrieren. Die beiden festen Adminkonten sind geschützt.

Abgaben, Bestätigungen, Summen und CSV-Exporte bleiben erhalten. Entfernte Personen zählen nicht mehr zur aktiven Mitgliederübersicht und zum Ziel des aktuellen Teams. Unter **Entfernte Mitglieder → Mitglied wiederherstellen** wird dasselbe Konto mit seiner Historie zurückgeholt. Eine vorher bestehende Zugangssperre bleibt bestehen. Eine entfernte Person wird bei Neustarts nicht erneut automatisch angelegt.

### Passwort vergessen / Zugang zurücksetzen

Der Admin wählt bei der betroffenen Person **Zugang zurücksetzen** und bestätigt mit `ZURÜCKSETZEN`. Das bisherige Passwort und alle Sitzungen werden ungültig. Der Admin erhält einen **einmaligen Wiederherstellungscode**, der nur in diesem Dialog angezeigt und nicht im Änderungsprotokoll gespeichert wird. Er gibt ihn der betroffenen Person persönlich weiter.

Das Mitglied öffnet **Zum ersten Mal hier?** und gibt seinen Namen, ein neues Passwort sowie den Wiederherstellungscode ein. Ohne richtigen Code bleibt das zurückgesetzte Konto gesperrt. Ein neuer Zugang-Reset entwertet einen vorherigen Code. Für die beiden Adminkonten ist auch nach einem Reset zusätzlich der Admin-Einrichtungscode erforderlich. Das eigene Passwort kann jeder über sein Profil ändern; ein Admin kann nur den Zugang des jeweils anderen Admins zurücksetzen. Eine separat gesetzte Zugangssperre bleibt auch nach dem Passwort-Reset bestehen.

Bestehende Datenbanken werden beim nächsten Start automatisch um die neuen Felder ergänzt. Vorhandene Konten und Abgaben bleiben dabei erhalten.
