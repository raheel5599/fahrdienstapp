# TARIQ Krankenfahrdienst App

Interne Web-App für Büro, Disposition und Fahrer.

## Aktueller MVP
- Responsive Chef-/Büro-Dashboard
- Live-Disposition als interaktiver Workflow
- Fahrer-Web-App mit Status: geplant, auf dem Weg, angekommen, Fahrt gestartet, beendet
- Fahrer wird nach Fahrtende wieder als frei markiert
- Fahrer, Fahrzeug und Status-Historie werden je Fahrt mitgeführt
- Module vorbereitet für Kunden, Termine, Kassen/Verträge, Abrechnung, Rechnungen, Fahrzeuge, Personal, Buchhaltung, Dokumente und Berichte
- PWA-Grundlage
- Docker-/Nginx-Deployment vorbereitet

## Entwicklung
npm install
npm run dev

## Produktion
npm run build

Zieldomain: app.tariq-fahrdienst.de

Die aktuelle Version ist ein Frontend-MVP. Für echte Live-Synchronisierung zwischen Büro und mehreren Fahrergeräten folgen Datenbank, Authentifizierung, Realtime-Events, Rollen/Rechte, Dokumentenspeicher und Abrechnungslogik.
