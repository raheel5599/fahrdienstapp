# Kassenabrechnung nach §302 – Integrationsstand

Die vorhandene Abrechnung erhält einen Reiter **Kassenabrechnung**. Rechnungsnummern,
Tarifpositionen, Fahrtenwerte und Eigenanteile werden aus ausgestellten Rechnungen
übernommen. Es werden keine zusätzlichen Rechnungen, Zahlungen oder Versandbestätigungen angelegt.

## Einrichtung und Veröffentlichung

1. Migration `supabase/migrations/20261113094842_dta302_exports.sql` anwenden.
2. Edge Function `manage-dta302` mit der vorhandenen Supabase-Konfiguration veröffentlichen.
3. Frontend aus diesem Commit bauen und über den vorhandenen Releaseweg veröffentlichen.
4. Als Administration im Reiter Kassenabrechnung die Kasse und den zugehörigen Vertrag wählen.
   Kostenträger-IK, entschlüsselungsberechtigte Datenannahmestelle, vertragliches
   Tarifkennzeichen sowie Quelle/Prüfdatum hinterlegen. Kein Rückschluss aus dem Kassennamen.
5. Pro Fahrt Zusatzangaben anhand Karte/Verordnung/Genehmigung bestätigen. Strukturierte
   Abhol-/Zieladressen werden nicht aus Freitext geraten. Fehlende Angaben erscheinen am Fall.
6. Auswahl prüfen und Testexport erstellen. ZIP enthält je vorhandener Rechnung eine
   eigene ISO-8859-1-Nutzdatei, ein Exportprotokoll und Hinweise. Keine Auftragsdatei.

Tarifkennzeichen ist an einen konkreten bestehenden Vertrag gebunden. Fälle eines anderen
Vertrags bleiben gesperrt, bis die passende Zuordnung eingerichtet wird. Rechnungsnummern
mit mehr als 14 Zeichen oder nicht zulässigen Gliederungszeichen müssen im bestehenden
Rechnungsverfahren geklärt werden; der Export kürzt oder ersetzt sie nicht.

## Was vor Echtbetrieb noch erforderlich ist

Der Stand unterstützt ausschließlich Testindikator 0. Echt- und Erprobungsdateien werden
auch serverseitig abgewiesen. Das ist eine fachliche Freigabegrenze, keine Versandfunktion.

- Datenannahmestellentest vereinbaren; insbesondere die drei unbenutzten UNB-Felder
  0029/0031/0032 anhand einer bestätigten Referenzdatei prüfen.
- Tatsächliche Kostenträgerdateien laden/aktualisieren oder die hinterlegte Zuordnung
  anhand der offiziellen Datei prüfen. Ein automatischer KE-Dateiimport ist nicht enthalten.
- ITSG-Zertifikat, Empfängerzertifikate, Verschlüsselung/Signatur und KKS-Auftragsdatei
  über einen geeigneten Übermittlungsdienst anbinden. Ein ZIP allein ist kein KKS-Dateipaar.
- Übermittlungsantworten, Ablehnungen und Wiederholungen mit derselben Lieferungsidentität
  integrieren; Originalbelegweg separat mit der Annahmestelle abstimmen.
- Korrekturverfahren, eVO/IMG, Ausland, Sammelrechnungen mit neuer Rechnungsnummer und
  gesonderte Mehrwertsteuerfälle sind nicht freigegeben. Bestehende Einzelrechnungen
  werden als einzelne Dateien exportiert.
- Kennzeichen 4/5 wird nicht auf null gesetzt: Zuzahlung ist je Fahrt mit 0/1/3 zu bestätigen.
  Kennzeichen 2 und offene Patientenzuzahlungen erfordern einen gesonderten Forderungsweg.

## Datenintegrität

Alle Exportquellen werden serverseitig gelesen. Die Vorprüfung liefert einen SHA-256-
Fingerabdruck je Fall einschließlich Zuordnung. Änderungen seit Prüfung verhindern den Export.
Innerhalb einer Transaktion werden Quellen gesperrt, Snapshots verglichen und dauerhafte
Lieferungsreferenzen je Absender-/Empfänger-IK vergeben. Browser können weder Zähler noch
Exportstände schreiben. Wiederholungen mit identischer Anfragekennung erzeugen keinen
zweiten Lauf; gespeicherte Exporte lassen sich unverändert erneut herunterladen.

Neue Tabellen verwenden RLS. Nur aktives Büro/Administration im jeweiligen Geschäftsbereich
darf lesen; schreibende RPCs sind ausschließlich für die rollenprüfende Serverfunktion freigegeben.
Routingänderungen sind der Administration vorbehalten. Testexporte sperren keine Rechnungen
für spätere Abrechnung; aktive ZAD-Zuordnungen verhindern jedoch den parallelen Testexport.
Exportverlauf und Snapshots enthalten Gesundheitsdaten und unterliegen der betrieblichen
Aufbewahrungs-/Löschregelung; es gibt keinen öffentlichen Downloadlink.

Berechnung verwendet skalierte Ganzzahlen, keine Gleitkomma-Summen. Einzelwerte mit mehr
als zwei Nachkommastellen werden abgewiesen, bevor abweichende Übertragungswerte entstehen.
Der Versionwechsel erfolgt nach Erstellzeitpunkt in Europe/Berlin: TA21 bis 31.01.2027,
TA22 ab 01.02.2027. TA21 läuft offiziell am 30.04.2027 aus; diese Umsetzung nutzt V22 bereits
ab Beginn der Übergangsfrist.

## Prüfung

- `npm test`: bisherige und neue Server-/Format-/Berechnungstests.
- `npm run build`: Produktionsbuild.
- `npm run test:dta`: Download, ZIP-Inhalt, Pflichtangaben und Layout auf fünf Bildschirmgrößen.
- `tests/sql/dta302.sql`: synthetischer Datenbanktest mit abschließendem Rollback.
  Für isolierte Prüfung ohne dauerhafte Migration: `BEGIN`, Migration und den Test ohne
  dessen erstes `BEGIN` zusammen in einer Datenbankverbindung ausführen. Das abschließende
  `ROLLBACK` entfernt auch die neuen Tabellen/Funktionen wieder.

Grundlagen: beigefügte TA1 V21 (15.01.2026), TA1 V22 (21.05.2026), TA3 V21/V22,
Anhang 1, Anhang 2 und Anhang 3. Die vorhandenen Python-Dateien wurden nicht als
Browser-/Supabase-Laufzeit eingeführt; die Prüf- und Serialisierungsregeln liegen im
geteilten JavaScript-Modul `_shared/dta302.js`.
