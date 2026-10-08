# Fahrdienst-App: Entwicklungsstand vom 8. Oktober 2026

Die App ist noch kein vollständig fertiges Gesamtsystem. Dieser Stand beruht auf einer Prüfung des Quellcodes und isolierten UI-Prüfungen mit fiktiven Daten. Er ist keine vollständige fachliche Abnahme der produktiven Daten und kein Nachweis auf physischen Apple-Geräten.

## In dieser Änderung behoben

- Kunden- und andere lange Formulare sind auf die verfügbare Bildschirmhöhe begrenzt, scrollbar und haben erreichbare Speichern-/Abbrechen-Aktionen.
- Rechnungen und Quittungen haben eine Dokumentvorschau innerhalb der App. Sie öffnet kein Popup. Gedruckt wird die angezeigte Rechnung mit ihren geladenen Positionen. PDF-Speichern erfolgt über den Druckdialog des Betriebssystems.
- Neu erstellte manuelle Rechnungen öffnen nach dem Laden die Vorschau.
- Quittungen sind über einen Reiter im Rechnungsbereich erreichbar.
- Rechnungen und Abrechnungen werden auf schmalen Displays als beschriftete Karten angezeigt.
- Fahrtaktionen Bearbeiten/Zuweisen bleiben auf kleinen Displays sichtbar.
- Kleine Tablets nutzen das einklappbare Menü. Eingaben auf Mobilgeräten verwenden eine lesbare Schriftgröße, Bedienelemente größere Berührungsflächen.
- Die funktionslose globale Suche und die fest angezeigte Benachrichtigungszahl wurden aus dem Kopfbereich entfernt. Unfertige Module werden ausdrücklich als nicht umgesetzt gekennzeichnet.

## Offene Punkte

| Priorität | Bereich | Tatsächlicher Stand / nächste Arbeit |
| --- | --- | --- |
| Hoch | Rechnungsdaten | Unternehmensprofil und Vorlage implementiert. Administrator muss die tatsächliche Anschrift, Bankverbindung, Kennungen und Hinweise eintragen; alte Belege ohne gespeichertes Profil behalten ihre bisherige Darstellung. |
| Hoch | Kassenabrechnung | Einzelrechnungen und vertragliche Positionen sind vorhanden. Abrechnungsläufe/Sammelabrechnungen und Übermittlungsexporte an Abrechnungsstellen sind nicht implementiert. Anforderungen der verwendeten Abrechnungsstelle klären. |
| Hoch | Storno und Korrektur | Server unterstützt einfache Statusänderungen. In der Oberfläche fehlt ein vollständiger, nachvollziehbarer Storno-/Korrekturprozess mit verknüpften Korrekturbelegen. |
| Hoch | Dokumente | Originalbelege können als PDF/JPEG/PNG/WebP hochgeladen, Kunden und Verordnungen/Genehmigungen/Fahrten zugeordnet, angesehen, heruntergeladen, archiviert und wiederhergestellt werden. OCR und ein Fahrer-Upload bleiben separate Erweiterungen. |
| Hoch | Fachliche Abnahme | Reale Büro-/Fahrerrollen, komplette Fahrt bis Rechnung, Belege und Apple-Druck-/PDF-Dialog auf tatsächlichen iPads/iPhones mit kontrollierten Daten prüfen. UI-Fixtures ersetzen diese Prüfung nicht. |
| Mittel | Fahrtenhistorie | Live-Disposition zeigt nur den heutigen Tag; der Loader begrenzt Fahrten auf gestern bis 45 Tage voraus. Datumsfilter, ältere Historie und Suche fehlen in dieser Ansicht. |
| Mittel | Privatabrechnung | Manuelle Privatrechnungen sind vorhanden. Der automatische Abrechnungsfall-/Rechnungsablauf richtet sich bisher an Kassenfahrten; einen eigenen automatischen Privatfahrtenablauf ergänzen. |
| Mittel | Buchhaltung | Menü vorhanden, Inhalt ist Platzhalter. Einnahmen/Ausgaben, offene Posten, Zahlungsabgleich und Exporte fehlen. |
| Mittel | Berichte | Menü vorhanden, Inhalt ist Platzhalter. Umsatz, Kilometer, Auslastung und Zeitraumauswertungen fehlen. |
| Mittel | Nachrichten | Menü vorhanden, Inhalt ist Platzhalter. Fahrerhinweise/Push-Funktionen sind davon getrennt; kein vollständiges Büro-/Fahrer-Nachrichtensystem vorhanden. |
| Mittel | Einstellungen | Unternehmensdaten, Bankverbindung und Rechnungshinweise sind pflegbar. Weitere zentrale Betriebsoptionen fehlen noch. |
| Mittel | Globale Suche / Benachrichtigungen | Die bisherigen nicht funktionierenden Kopfbedienelemente wurden entfernt. Datenübergreifende Suche und ein echtes Benachrichtigungszentrum fehlen. |
| Mittel | Offlinebetrieb | Service Worker behandelt Installation und Benachrichtigungsklicks; er bietet keinen Offline-Datencache und keine sichere Warteschlange für Fahrtstatus. |
| Mittel | Lange Listen | Lademechanismen laden viele Datensätze auf einmal. Pagination, Filter und Ladevolumen mit realistischen Datenmengen prüfen und ausbauen. |
| Optional | GPS-Karte | Fahrzeugstatus ist vorhanden, aber keine laufende GPS-Ortung/Kartendarstellung. Bedarf und Einwilligungs-/Betriebsablauf vor Implementierung festlegen. |

## Prüfungen

- `npm test`: Vertragswahl, Tarifberechnung, Rechnungspositionen, Eigenanteil, Rollstuhltrennung und sichere HTML-Dokumentdarstellung.
- `npm run build`: produktiver Vite-Build.
- `npm run test:ui`: isolierte Browserprüfungen mit fiktiven Daten bei 320 × 568, 390 × 844, 768 × 1024, 1024 × 768 und 1440 × 900. Prüft Formularhöhe/Scrollen, sichtbaren Speichern-Button, Dokumentvorschau, Druckaktion, Karten und Fahrtaktionen.
- `UI_WEBKIT=1 npm run test:ui` ergänzt dieselben Prüfungen mit WebKit. Der GitHub-Workflow `Responsive UI checks` führt Chromium und WebKit aus und speichert Screenshots.
- Browserprüfungen verwenden ausschließlich lokale Fixtures und blockieren externe Netzwerkanfragen. Keine produktiven Kunden, Rechnungen oder Zahlungen werden zu Testzwecken angelegt.

## Sinnvolle Reihenfolge

1. Unternehmensprofil fachlich vervollständigen; Originalbelege ergänzen.
2. Korrekturbelege, Privatfahrtenablauf und Abrechnungsläufe/Exporte.
3. Historie, Filter, Buchhaltung und Berichte.
4. Kommunikation, Einstellungen, echte Suche und danach optional Offlinebetrieb/GPS.

## Unternehmensprofil ergänzt

- Administratoren pflegen Unternehmensdaten pro Geschäftsbereich; Bürorollen können diese lesen, aber nicht ändern.
- IBAN-Prüfsumme, BIC, E-Mail und IK werden serverseitig geprüft. Unvollständige Profile können als Entwurf gespeichert werden.
- Neue Rechnungen und Quittungen benötigen Firmenname und vollständige Anschrift; die Angaben werden als Momentaufnahme im Beleg gespeichert. Alte Belege bleiben unverändert.
- Rechnungsvorlage zeigt Anschrift, Kennungen, Bankverbindung, Leistungsdatum und eingetragene Zahlungs-/Steuerhinweise. Muster-Vorschau legt keine Rechnung an.

## Originalbelege ergänzt

- Menü Dokumente und Kundenakte → Originalbelege nutzen dieselbe Ablage. Optionaler Bezug auf gespeicherte Verordnung/Genehmigung oder eine Fahrt desselben Kunden und Geschäftsbereichs.
- Mehrere Dateien pro Upload, maximal 10 MB je Datei; PDF, JPEG, PNG, WebP. HEIC muss vorher als JPEG/PNG exportiert werden.
- Privater Bucket, kein öffentliches Lesen und kein Überschreiben; Upload nur auf einen vorbereiteten, einmaligen Pfad des aktiven Büro-/Chefkontos. Server prüft Formatkennzeichen, tatsächliche Größe und SHA-256 der Originaldatei vor Freigabe.
- Vorschau lädt nach erneuter Berechtigungsprüfung einen kurzfristigen Link in einen lokalen Blob. Keine Ablage von URLs oder Dateiinhalten in localStorage. PDF-Originale haben auf iPad/iPhone zusätzlich Öffnen/Teilen für die vollständige Systemansicht.
- Archivieren und Wiederherstellen erhalten die Originaldatei. Dokumentart und Kunde sind nach Upload unveränderlich; Titel und passende Zuordnungen können bearbeitet werden.
- Dokumentliste lädt jeweils 50 Datensätze mit Filtern und Weitere-laden-Aktion. Fahrt-Auswahl verwendet den vorhandenen Dispositionszeitraum; ältere bereits gespeicherte Zuordnungen bleiben erhalten.
- Unterbrochene Uploads werden nicht als aktive Belege angezeigt. Fehlgeschlagene Uploads versucht die Oberfläche abzubrechen und aufzuräumen; bei Abbruch durch Schließen des Browsers können unvollständige private Uploads verbleiben. Automatische zeitgesteuerte Bereinigung ist noch offen.
- 56 Server-/Dokument-/Uploadtests; lokale Browser-Fixtures prüfen Mehrfachupload, Zuordnung, PDF-/Bildvorschau, Downloadaktion sowie Archiv/Wiederherstellung mit ausschließlich fiktiven Daten. Fachliche Abnahme mit tatsächlichen Belegen und Geräten bleibt offen.
