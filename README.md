# TARIQ Krankenfahrdienst App

Interne Web-App für Büro, Disposition und Fahrer unter `app.tariq-fahrdienst.de`.

## Implementiert

- Supabase-Anmeldung und Rollen für Verwaltung, Büro und Fahrer
- Kunden, Fahrzeuge, Fahrer, Termine und Live-Disposition
- Fahrerstatus und automatische Abrechnungsfälle nach Fahrtende
- Krankenkassen, Einzelverträge und Ersatzkassen-Gruppenverträge inklusive Bearbeitung und Deaktivierung
- Vertragswahl am Fahrtag: gültiger Einzelvertrag vor gültigem Gruppenvertrag; AOK und DAK benötigen Einzelverträge
- Kassenabrechnung ohne gültigen Vertrag gesperrt, auch bei manueller Rechnungserstellung
- Positionsvorlagen: `5130XX` mit `52` ergibt `513052`, mit `05` ergibt `513005`
- Rechnungen, Zuzahlungsquittungen und Druckansichten
- Interne Textgespräche zwischen Büro und jeweils einem Fahrer mit ungelesenen Nachrichten und ausdrücklicher Lesebestätigung
- PWA und Docker-/Nginx-Frontend, gemeinsamer Caddy-HTTPS-Eingang auf Hetzner

Die Kassen und tatsächlichen Vertragspreise müssen vom Büro eingetragen werden. Die Ersatzkassen-Zuordnung ist die konfigurierte Geschäftsregel dieses Systems; der konkrete Vertrag muss die betreffende Kasse abdecken. Für weitere Fahrtarten ist der Code aus dem jeweiligen Vertrag einzugeben.

## Entwicklung und Prüfung

```sh
npm ci
npm test
npm run build
```

Die Tests prüfen Vertragsvorrang, Gruppenabdeckung, Datumsgrenzen, fehlende/deaktivierte Verträge, vollständige Positionsnummern und die serverseitigen Rechnungs-/Berechnungsabläufe mit isolierten Datenbank-Fixtures.

## Backend

Die produktiven Edge Functions liegen unter `supabase/functions/`; gemeinsame Vertragsregeln unter `_shared/contracts.js`. Die Migration unter `supabase/migrations/` erlaubt Gruppenverträge ohne Kassenanker und verhindert direkte Browser-Änderungen des Abrechnungsstatus. Berechnung und Rechnungserstellung erfolgen über authentifizierte, rollenprüfende Serverfunktionen.

## Hetzner-Veröffentlichung

`.github/workflows/deploy-hetzner.yml` benötigt eines der vorhandenen SSH-Key-Secrets: `HETZNER_SSH_KEY`, `HETZNER_SSH_PRIVATE_KEY` oder `HETZNER_SSH_KEY_B64`. `HETZNER_HOST` kann gesetzt werden; sonst wird der bestehende Hetzner-Host verwendet. Schlüssel werden nicht ausgegeben.

`scripts/deploy-hetzner.sh` baut den App-Container, prüft ihn intern, ergänzt bei Bedarf ausschließlich den fehlenden eigenen Domainblock in der tatsächlich gemounteten Caddyfile und validiert die Konfiguration vor dem Reload. Abschließend wird die öffentliche Domain geprüft. Andere Apps werden nicht neu gebaut oder ausgerollt.

## Interne Nachrichten

Büro und Verwaltung öffnen „Nachrichten“; Fahrer öffnen „Nachrichten mit dem Büro“ im Fahrerportal, auch vor der Schichtanmeldung und während einer Pause. Kontakte erfordern einen aktiven Fahrer mit aktivem App-Zugang im selben Geschäftsbereich. Fahrer können ausschließlich ihr eigenes Gespräch lesen und beantworten. Das Büro kann vorhandene Gespräche nach einer Zugangssperre weiterhin lesen; neue Nachrichten an diesen Fahrer sind gesperrt.

Eine Lesebestätigung gilt bis zur angezeigten Nachrichtennummer einschließlich älterer Nachrichten. Der Büro-Posteingang und seine Lesebestätigung werden von den Büromitarbeitern gemeinsam verwendet. Öffnen und Aktualisieren bestätigen keine Nachrichten. Sendeanfragen mit unveränderter Anfragekennung und unverändertem Inhalt sind idempotent; Korrekturen erfolgen als neue Nachricht. Text ist auf 5000 Zeichen begrenzt.

Die geöffnete Ansicht fragt alle 30 Sekunden neu ab. Es gibt keine Hintergrund-Push-, E-Mail- oder SMS-Benachrichtigungen, Dateianhänge oder Offline-Sendewarteschlange. Entwürfe bleiben während der geöffneten Nachrichtenansicht im Arbeitsspeicher; Schließen oder Neuladen verwirft sie.

Server: `manage-messages` mit JWT und aus dem angemeldeten Konto abgeleiteter Identität, rollenprüfende SQL-Funktionen und RLS. Browser dürfen nur geschützte Daten lesen, keine Nachrichten direkt ändern. `tests/sql/messages.sql` prüft mit synthetischen Konten innerhalb einer zurückgerollten Transaktion Isolation, Wiederholungen, Lesestände und Seitenwechsel. `npm run test:reports` prüft die Nachrichtenoberfläche inklusive Fahrerportal auf fünf Bildschirmgrößen; `UI_WEBKIT=1` ergänzt WebKit.

## Fahrer-App ohne Empfang

Die App einmal mit Verbindung öffnen, anmelden, Aufträge laden und die Schicht mit Fahrzeug/Kilometerstand anmelden. Danach können vorbereitete Aufträge und eine bereits aktive Schicht ohne Empfang angezeigt werden. Die App-Hülle wird vom Service Worker zwischengespeichert; geschäftliche API-Antworten, Dokumente und Nachrichten werden dort nicht gespeichert.

„Auf dem Weg“, „Angekommen“, „Fahrt starten“ und „Fahrt beenden“ werden zuerst in IndexedDB auf diesem Gerät gespeichert. Die Oberfläche kennzeichnet die offene Übertragung. Wiederverbinden oder „Fahrtmeldungen übertragen“ überträgt die Warteschlange nacheinander, bei geöffneter Ansicht zusätzlich alle 30 Sekunden. Es gibt keine Zusage einer Übertragung bei geschlossener App und keine Hintergrund-Synchronisation. Erst die Serverbestätigung entfernt eine Meldung. Die ursprüngliche Erfassungszeit und Anfragekennung bleiben bei Wiederholung erhalten; der Server speichert zusätzlich seine Empfangszeit. Abschluss verwendet die vorhandene Abrechnungsfallerstellung mit Schutz gegen Duplikate.

Offline-Zugriff setzt ein zuvor geprüftes Fahrerkonto auf demselben Gerät voraus und gilt höchstens 12 Stunden seit der Online-Prüfung. Der Auftragscache umfasst bis zu 200 eigene Fahrten für heute/morgen sowie laufende Fahrten, keine Finanzdaten oder Kundenakten. Auftrags- und Schichtdaten dürfen höchstens 12 Stunden alt sein. Neue Zuweisungen oder Stornierungen können ohne Empfang nicht bekannt sein. Meldungen mit einer Erfassungszeit außerhalb der aktiven Schicht, während einer erfassten Pause, über 24 Stunden zurück oder über zwei Minuten in der Zukunft werden abgewiesen. Die Geräteuhr muss stimmen.

Die Serverfunktion prüft bei jedem Sendeversuch das aktive Konto, seinen Geschäftsbereich und seine Fahrerzuordnung. Die SQL-Transaktion prüft Fahrer, Fahrzeug, unveränderte Fahrtversion bzw. Vorgängermeldung, Schicht und die Statusfolge. Stornierungen, neue Zuweisungen und konkurrierende Änderungen halten die Warteschlange an. Es gibt keinen automatischen Überschreibungsweg. Nach tatsächlicher Klärung mit dem Büro kann der Fahrer alle offenen Meldungen ausdrücklich lokal verwerfen; dies ändert keine Serverfahrt.

Schichtbeginn, Pausen und Schichtende benötigen weiterhin Verbindung. Schichtänderungen und Kontoabmeldung sind mit offenen Fahrtmeldungen gesperrt. Beim Abmelden bzw. Sperren des Zugangs werden die Offline-Identität und sensiblen Auftrags-/Schichtsnapshots entfernt. Falls eine externe Abmeldung offene Meldungen unterbricht, bleiben nur die nach Konto/Einheit getrennten Statuskennungen und Zeiten zur späteren Klärung erhalten. Löschen von Browserdaten, privater Browsermodus oder Geräteverlust kann noch nicht übertragene Daten entfernen.

Prüfungen: `npm test`, `npm run test:offline` und `tests/sql/driver-offline.sql` mit zurückgerollten synthetischen Daten. `UI_WEBKIT=1 npm run test:offline` prüft Chromium und WebKit auf kleinem Handy, iPad und Desktop. Für WebKit wird wegen des dokumentierten Playwright-Fehlers [#42775](https://github.com/microsoft/playwright/issues/42775) der lokale Testserver abgeschaltet, anstatt die fehlerhafte Offline-Emulation zu verwenden; das Neuladen muss dabei tatsächlich ein neues Dokument aus dem Service Worker starten.
