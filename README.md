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
