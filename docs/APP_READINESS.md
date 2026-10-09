# Fahrdienst-App: Entwicklungsstand vom 9. Oktober 2026

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
| Hoch | Kassenabrechnung | Sammelvorbereitung nach Krankenkasse und Leistungszeitraum, Auswahl offener Einzelrechnungen, PDF-/Druckvorschau und allgemeine CSV sind vorhanden. Gespeicherte Abrechnungsläufe, Einreichungsstatus und Übermittlungsformate der Abrechnungsstelle bleiben offen; verwendete Abrechnungsstelle klären. |
| Erledigt | Storno und Korrektur | Eigener Stornobeleg mit exakter Gegenbuchung und Originalbezug; verknüpfte Ersatzrechnung, erneut prüfbare Fahrtenfälle, erhaltene Eigenanteilquittung und separate Erfassung ausgeführter Rückzahlungen. |
| Hoch | Dokumente | Originalbelege können als PDF/JPEG/PNG/WebP hochgeladen, Kunden und Verordnungen/Genehmigungen/Fahrten zugeordnet, angesehen, heruntergeladen, archiviert und wiederhergestellt werden. OCR und ein Fahrer-Upload bleiben separate Erweiterungen. |
| Hoch | Fachliche Abnahme | Reale Büro-/Fahrerrollen, komplette Fahrt bis Rechnung, Belege und Apple-Druck-/PDF-Dialog auf tatsächlichen iPads/iPhones mit kontrollierten Daten prüfen. UI-Fixtures ersetzen diese Prüfung nicht. |
| Erledigt | Fahrtenhistorie | Eigener Reiter mit Monats-/Kunden-/Statusfilter, Suche und nachträglicher Sammelbestätigung bzw. Ausfallerfassung. Prüfung vor Rechnung bleibt erforderlich. |
| Erledigt | Privatabrechnung | Privatfahrt und Bruttopreis mit Steuersatz beim Anlegen wählbar; nach Abschluss automatischer Abrechnungsfall, Preisprüfung und Rechnung mit Vorschau. Zahlungsstatus über Rechnungen sichtbar. |
| Mittel | Buchhaltung | Menü vorhanden, Inhalt ist Platzhalter. Einnahmen/Ausgaben, offene Posten, Zahlungsabgleich und Exporte fehlen. |
| Mittel | Berichte | Schichtauswertung nach Monat/Fahrer mit Start/Ende, erfassten Pausen, Zeiten und Kilometern ist vorhanden. Rechnungsvolumen nach Ausstellungsmonat/Kostenträger sowie aktuelle Restbeträge nach Teilzahlungen ergänzt. Zahlungszeitraum-, Ausgaben- und Auslastungsauswertungen bleiben offen. |
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
2. Abrechnungsläufe/Exporte.
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

## Storno und Korrektur ergänzt

- Offene und bezahlte Rechnungen können mit Pflichtgrund storniert werden. Ein eigener ST-Beleg übernimmt ursprüngliche Angaben und Positionen mit exakt umgekehrten Beträgen. Originalbeleg und Positionen bleiben erhalten.
- Manuelle Rechnungen erhalten eine bearbeitbare Ersatzrechnung mit neuer RE-Nummer und Originalbezug. Kassenfahrten werden über ihren Abrechnungsfall erneut geprüft und berechnet; die neue Rechnung verweist automatisch auf die stornierte Rechnung.
- Bereits quittierte Eigenanteile bleiben samt Zahlungsstatus und Quittung am Fall erhalten. Ein geänderter Eigenanteil ist bis zur gesonderten Klärung der bestehenden Quittung gesperrt.
- Bei bezahlten Originalen ist eine Rückzahlung offen. Der Benutzer bestätigt eine tatsächlich ausgeführte vollständige Rückzahlung und hinterlegt einen Zahlungsnachweis. Die App führt keine Banküberweisung aus und verrechnet keine Zahlung automatisch mit der Ersatzrechnung.
- Storno und Erstellung der Fahrten-/Ersatzrechnung sind Datenbanktransaktionen. Sperren, eindeutige Referenzen und Versionsprüfung verhindern Doppelbelege und Teilstände. RPC-Ausführung ist auf den Server beschränkt und prüft aktive Büro-/Chefberechtigung im Geschäftsbereich.
- Historische Rechnungen, die vor dieser Änderung nur den Status Storniert erhielten, werden nicht rückwirkend mit neuen Belegen ergänzt.
- 60 automatisierte Server-/Dokumenttests und SQL-Transaktionsprüfung mit anschließendem Rollback: exakte Gegenbuchung einschließlich Eigenanteilabzug, Erhalt quittierter Eigenanteile, Rückzahlung, Ersatzrechnung mit MwSt., Wiederholung, Berechtigungen und veraltete Fälle. Browser-Fixtures prüfen Storno, Vorschau, Rückzahlung und Ersatzrechnung auf den fünf Bildschirmgrößen.

## Automatischer Eigenanteil und Privatfahrten ergänzt

- Ein Abrechnungsfall gilt für genau eine gespeicherte Fahrtrichtung. Hin- und Rückfahrt werden als zwei Fahrten angelegt und getrennt berechnet; keine gemeinsame Begrenzung oder Halbierung. Zusammengefasste Altfälle mit direction_count=2 sind zur getrennten Prüfung gesperrt.
- Nicht befreit: 5148-Positionen erhalten 5 € je Richtung; andere Positionen 10 % des Fahrtrichtungsbetrags, mindestens 5 € und höchstens 10 €, auf Cent gerundet und nie über dem Fahrtbetrag. 120 € je Richtung bedeuten 10 € hin + 10 € zurück; bei 5148 5 € + 5 €.
- Befreiung und Versicherungszeitraum gelten am Fahrtag. Eingetragene alte manuelle Eigenanteile werden nicht mehr als Berechnungsquelle verwendet. Die Kundenakte zeigt die automatische Regel statt eines festen Betrags.
- Bereits ausgestellte Rechnungen und quittierte Eigenanteile werden nicht automatisch geändert. Ältere unberechnete Fälle müssen neu berechnet werden, bevor Rechnung oder Eigenanteilquittung erzeugt werden. Abweichungen bei vorhandener Quittung werden zur Klärung gesperrt.
- Zahlungsdialog für Eigenanteile: Betrag/Richtung anzeigen, Bar/Karte wählen und tatsächlichen vollständigen Zahlungseingang bestätigen. Quittung und Zahlungsstatus werden in einer Transaktion gespeichert; wiederholte Anfragen liefern denselben Beleg. Befreiungsänderungen vor Rechnungserstellung werden serverseitig erneut geprüft.
- Privatfahrt bei Disposition ausdrücklich auswählbar, auch für Patienten mit Krankenversicherung. Bruttopreis je Richtung und Steuersatz 0/7/19 % eintragen; bei fehlendem Preis bleibt der nach Fahrtabschluss automatisch erzeugte Fall zur Prüfung offen. Auto-Auswahl ohne gültige Versicherung bleibt zur Prüfung als Privatfall; eine Kassenfahrt ohne gültigen Vertrag bleibt gesperrt.
- Abrechnungen → Prüfen: Kostenträger, Privatpreis und Steuersatz prüfen; Rechnung per Aktion erstellen. Der gesamte Privatpreis wird dem Kunden berechnet, ohne Kassenbetrag oder Eigenanteilabzug. Vorschau öffnet direkt; Zahlung über Rechnungen erfassen. Storno und verknüpfte Ersatzrechnung funktionieren auch für Privatfahrten.
- Der Fahrtabschluss erstellt den Abrechnungsfall, noch keine Rechnung. Das Büro bestätigt die Rechnungserstellung; fehlende Unternehmensdaten oder Preise bleiben sichtbar gesperrt.
- 75 automatisierte Tests einschließlich aller Centbeträge von 0 bis 100 € plus SQL-Transaktionsprüfungen mit anschließendem Rollback: Grenzen, 5148, Hin/Rück, Befreiungsdatum, unveränderter quittierter Eigenanteil, Privatpreis/Steuer, Rechnung/Storno/Ersatz, doppelte Quittungen, Berechtigungen und Fehler-Rollback. UI-Fixtures ergänzen Privatpreis, Zahlungsbestätigung, Bar/Karte und Vorschauen auf den fünf Bildschirmgrößen.

## Sammelabrechnung vorbereiten

- Abrechnungen → Sammelabrechnung: Leistungsdatum von/bis und genau eine Krankenkasse auswählen; offene Einzelrechnungen einzeln oder gesammelt markieren. Gesamtwerte zeigen Fahrtenwert, Eigenanteil und Kassenforderung getrennt. Hin-/Rückfahrten bleiben einzelne Zeilen.
- Nur abgeschlossene Kassenfahrten mit ausgestellter offener Rechnung, passendem Patient/Kassen-/Datumsbezug, gültigem Berechnungsstand, Unternehmenssnapshot und vollständigen passenden Rechnungspositionen sind exportfähig. Private, bezahlte, stornierte, doppelt zugeordnete oder widersprüchliche Belege werden ausgeschlossen bzw. sichtbar gesperrt. Offene Eigenanteile bleiben beim Patienten einzuziehen und verhindern die Kassenübersicht nicht.
- Sammelvorschau mit Druck/PDF und CSV je Kasse. Keine neue Rechnung, keine Übermittlung, kein Zahlungs- oder Einreichungsstatus wird durch den Download gesetzt. Bereits exportierte Rechnungen können erneut heruntergeladen werden; es gibt noch kein gespeichertes Einreichungsregister. Abweichende Unternehmenssnapshots müssen getrennt exportiert werden.
- Vor jeder Vorschau/jedem CSV-Download werden die Daten erneut geladen und mit der geprüften Auswahl verglichen. Änderungen sperren den Export und erfordern erneute Auswahl. Änderungen nach Erstellung der Datei sind damit nicht ausgeschlossen; vor tatsächlicher Einreichung fachlich prüfen.
- CSV: UTF-8 mit BOM, Semikolon, deutsches Zahlenformat, sichere Textfelder gegen Tabellenformeln. Enthält Patient und Route und ist nur für die autorisierte Abrechnung bestimmt. Sie ist kein anbieterspezifischer Übermittlungsdatensatz.
- Abrechnungs-/Finanzloader lesen in geordneten Seiten mit kontrollierter Gesamtanzahl und begrenzen ID-Listen pro Anfrage. Ladefehler oder inkonsistente Seiten verhindern unvollständige Übersichten. Bestehende RLS-Zugriffsregeln bleiben maßgeblich.
- 98 Node-Tests; zusätzliche Chromium-/WebKit-UI-Fixtures prüfen Auswahl, Sperren, Hin/Rück, getrennte Summen, Vorschau, CSV-Download und Storno während der Vorbereitung auf den fünf Bildschirmgrößen.

## Eigenanteilsrechnung direkt an Patienten

- Abrechnungen → Eigenanteil berechnen erzeugt eine eigene Patientenrechnung je Fahrtrichtung aus dem gespeicherten automatischen Eigenanteil. Vollständige Patienten- und Unternehmensanschrift sind erforderlich. Fälligkeitsdatum wählbar, Vorschlag 14 Tage.
- Nur offener positiver Eigenanteil einer geprüften abgeschlossenen Kassenfahrt. Befreiungs-/Tarifänderungen vor Kassenrechnung erfordern Neuberechnung; bereits ausgestellte Kassenbeträge bleiben unverändert. Patient bekommt ausschließlich seinen Anteil, nicht den ganzen Fahrtpreis.
- Eigene RE-Nummer, Patientenanschrift, Datum, Richtung und Strecke sowie Betrag. Vorschau zeigt Eigenanteilsrechnung. Drucken/PDF für Post oder manuelles Anhängen an E-Mail; kein automatischer E-Mail-Versand eingerichtet.
- Erstellen markiert den Eigenanteil nicht als bezahlt. Rechnungen → Bezahlt verlangt Bestätigung des tatsächlichen vollständigen Zahlungseingangs und setzt Rechnung/Fall atomar auf bezahlt. Zahlung der Krankenkassenrechnung setzt den Patientenanteil nicht auf bezahlt.
- Bereits quittierter/bezahlter Anteil kann nicht zusätzlich fakturiert werden. Bei vorhandener Eigenanteilsrechnung wird die Zahlung über Rechnungen erfasst; zweite Forderung oder separate Quittung aus demselben Fall wird verhindert. Wiederholte Erstellung liefert dieselbe Rechnung. Keine rückwirkende Erstellung für vorhandene Zahlungen.
- Offene Eigenanteilsrechnung kann mit eigenem ST storniert und danach über den Fall ersetzt werden. Bei bezahlter Rechnung muss zuerst die tatsächlich ausgeführte Rückzahlung dokumentiert werden. Eigene Ersatzkette bleibt verknüpft; Kassenrechnung und Kassenstatus bleiben beim Patientenstorno bestehen. Neue Berechnung bei vorhandener Patientenrechnung ist gesperrt, bis Storno/Rückzahlung geklärt ist.
- Patientenrechnungen sind private Forderungen und werden nicht als Kassenrechnung in der Sammelübersicht exportiert. Diese Übersicht enthält weiterhin den Abzug des Eigenanteils vom Kassenbetrag.
- ZAD-Weberfassung auf zad-northeim.net: Screenshot zeigt Optionen „kein Eigenanteil abziehen (befreit)“, „Eigenanteil abziehen, keine Eigenanteilsrechnung (bereits bezahlt)“ und „Eigenanteil an privat berechnen“. Die Option „bereits bezahlt“ darf für offene selbst fakturierte Anteile nicht automatisch gewählt werden. Der passende ZAD-Ablauf muss mit ZAD geklärt werden; keine automatisierte Eingabe oder Übermittlung implementiert. Erfassungs-/Postversandregister und genaue Positionsmaske sind weiterhin offen.
- Sammelübersicht korrigiert: abgeschlossene Fahrten werden mit dem tatsächlichen Datenbankstatus `abgeschlossen` erkannt. Vorheriger englischer Fixturestatus wurde durch echte Statuswerte und einen Regressionstest ersetzt.
- 103 Node-Tests sowie SQL-Transaktionsprüfungen mit Rollback für Hin/Rück, 5148, Befreiung, eigene Forderung/keine Doppelberechnung, atomare Zahlung, Storno, Rückzahlung, Ersatz, getrennte Kassenbeträge und Zugriffsrechte. UI-Fixtures ergänzen Patientenrechnungsvorschau und tatsächliche Zahlungsbestätigung.

## Fortlaufende und bearbeitbare Serien

- Ohne Enddatum laufen Serien unbegrenzt bis zur Pause oder zum nachträglich gesetzten Enddatum. Ein täglicher Datenbankjob ergänzt jeweils 90 Tage Vorausplanung; die Serie endet nicht nach dieser Planungsfrist oder nach einem Jahr.
- Erstanlage berücksichtigt das eingetragene Startdatum, auch in der Vergangenheit. Termine werden ausschließlich offen angelegt; Durchführung und Abrechnungsprüfung bleiben ausdrücklich erforderlich.
- Bearbeiten aktualisiert zukünftige offene, nicht zugewiesene Termine ohne Abrechnungsfall. Vergangene, zugewiesene, begonnene, abgeschlossene und abgerechnete Fahrten bleiben erhalten. Pause entfernt ausschließlich solche ungebundenen zukünftigen Termine; Wiederaufnahme ergänzt ab heute und erzeugt keine nachträglichen Fahrten während der Pause.
- Speicherung, Änderung, Pause und Terminerzeugung erfolgen atomar im berechtigungsgeprüften Service-RPC. Unique-Konflikte berücksichtigen den vorhandenen partiellen Index und verhindern doppelte Termine auch bei täglicher Wiederholung. Interne Fortschreibung ist nicht über die öffentliche API ausführbar.
- 106 Node-Tests und SQL-Rollback-Prüfungen: Start am Dienstag mit Mo/Mi/Fr, 26 September-Hin/Rück-Termine, unbegrenzte Fortschreibung nach über 370 Tagen, Enddatum, Bearbeiten/Pause ohne Historienverlust, Wiederaufnahme, Idempotenz und Rollenprüfung.


## Fahrtenhistorie und nachträgliche Bestätigung

- Fahrten / Disposition → Fahrtenhistorie: Monat (Vorschlag letzter Monat), Kunde, Status und Suche nach Name/Strecke. Daten werden nach Monat/Kunde serverseitig eingegrenzt und vollständig paginiert gelesen; Darstellung jeweils 50 Fahrten mit Weitere-laden.
- Vergangene offene/geplante Fahrten einzeln oder sichtbar gesammelt auswählen (maximal 100). Hin und Rück bleiben getrennt. Durchführung mit Pflichtbestätigung und Nachweisnotiz erfasst ausschließlich tatsächlich durchgeführte Fahrten; Ausfälle mit Grund werden storniert und erhalten keine Abrechnungsfälle.
- Atomare Speicherung einschließlich Abrechnungsfällen, sortierte Zeilensperren und Versionsprüfung: Änderungen an einer Fahrt verhindern Teilbestätigungen. Wiederholung derselben Entscheidung erzeugt keine zweiten Fälle. Zukünftige, laufende, stornierte und bereits regulär abgeschlossene Fahrten werden abgewiesen.
- Nachträgliche Erfassung bleibt mit tatsächlichem Erfassungsdatum, Büro-/Chefbenutzer und Notiz sichtbar. Es werden keine erfundenen Unterwegs-/Ankunfts-/Startzeiten gesetzt. Bestehende Live-Statuswechsel bleiben unverändert.
- Bestätigte Krankenfahrten erscheinen als prüfbare Fälle, noch ohne Rechnung. Primäre Versicherung wird am Leistungsdatum ermittelt; Privatpreise bleiben gespeichert. Kilometer, Kostenträger, Vertrag, Fahrzeugart und Eigenanteil müssen vor der Rechnung neu geprüft/berechnet werden.
- 109 Node-Tests und SQL-Rollback-Prüfung: Rolle/Pflichtbestätigung, Hin/Rück, Ausfall, private und Kassenfälle, Versionskonflikt ohne Teilbuchung, Zukunftssperre, unveränderte Live-Übergänge und Idempotenz. Browser-Fixtures prüfen Monats-/Kundenfilter, getrennte Auswahl, Bestätigungsdialog, Pflichtgrund, Serverfehler und Zukunftssperre auf Handy/iPad/Desktop mit fiktiven Daten.

## Monatliche Eigenanteilsrechnung

- Abrechnungen → Monatliche Eigenanteile: Patient und Leistungsmonat auswählen, geprüfte offene Anteile markieren (bis 100 Fahrtrichtungen je Rechnung). Befreite, bezahlte, quittierte, bereits fakturierte, private und ungeprüfte Fälle bleiben ausgeschlossen und mit Grund sichtbar.
- Eine Patientenrechnung mit eigener RE-Nummer, Leistungsmonat, Anschrift, Fälligkeit und je Fahrt Datum/Richtung/Strecke/Eigenanteil. Gesamtsumme ausschließlich Patientenanteile, keine Kassenforderungen. Vorschau und Drucken/PDF für Post oder manuellen E-Mail-Anhang. Zusätzliche später geprüfte Fahrten können separat berechnet werden; derselbe Anteil nie zweimal.
- Server prüft aktuelle Tarife/Versicherung, Monat/Patient und gespeicherte Versionen. Datenbank sperrt alle ausgewählten Fälle in stabiler Reihenfolge und verknüpft sie atomar mit der Rechnung; ein veränderter Fall verhindert die gesamte Erstellung. Wiederholte identische Erstellung liefert denselben Beleg.
- Vollständiger bestätigter Rechnungseingang markiert sämtliche zugehörigen Patientenanteile atomar bezahlt. Zahlung der Kassenrechnung bleibt davon getrennt. Bei bezahlter Monatsrechnung bleibt die Forderungszuordnung bis zur dokumentierten tatsächlichen Rückzahlung erhalten.
- Storno übernimmt sämtliche Originalpositionen mit exakt negativen Beträgen. Offenes Storno bzw. dokumentierte Rückzahlung öffnen die Patientenanteile wieder, ohne Kassenrechnung oder Kassenstatus zu verändern. Monatskorrekturen erfolgen zusammen über die Monatsansicht und verweisen auf das Original; keine Aufteilung derselben Monatskorrektur in Einzelrechnungen. Korrekturen unterschiedlicher Originale werden getrennt erstellt.
- 114 Node-Tests und SQL-Rollback-Prüfungen für Mischung normal/5148-Hin/Rück (30 €), Bezahlt-/Quittungs-/Befreiungssperre, Patient/Monat/Version, atomare Zahlung aller Fälle, Storno/Rückzahlung/Ersatz und unveränderte Kassenforderungen. Bestehende Einzel-Eigenanteilsrechnungen erneut geprüft. Browser-Fixtures prüfen Monatsauswahl, ausgeschlossene Anteile, Pflichtbestätigung, Serverfehler, Gesamtvorschau und Verhinderung erneuter Berechnung auf fünf Bildschirmgrößen mit Chromium und WebKit.

### 2026-10-08 · ZAD-Erfassungs- und Postversandregister

- Kassen-Einzelrechnungen können je Krankenkasse als fester ZAD-Lauf gespeichert werden (maximal 100). Betrag, Rechnung, Positionen, Patient, Fahrtrichtung und Unternehmensdaten kommen aus serverseitig geprüften Daten. Kein neuer Rechnungsbeleg entsteht.
- Abrechnungen → ZAD-Übersicht: gespeicherte Vorschau/CSV, Statusfilter und manuell bestätigte tatsächliche Weberfassung / tatsächlicher Postversand mit Datum und optionaler Referenz. Benutzer und Erfassungszeitpunkt werden protokolliert.
- Aktive Rechnungen gehören höchstens zu einem Lauf. Nicht erfasste Vorbereitungen lassen sich begründet verwerfen und neu auswählen; erfasste/versandte Läufe bleiben erhalten. Änderung/Storno der Rechnungen oder Positionen sperrt eine neue Statusbestätigung. Zahlung bleibt ein eigener Vorgang; keine automatische Patienten-Zahlungsbestätigung.
- Eigenanteilsrechnungen bleiben ausschließlich in unserem System. Offene Eigenanteile dürfen nicht als bereits bezahlt in ZAD eingetragen werden; passende Anbieteroption bei ZAD klären. Es gibt weder eine bestätigte ZAD-Importschnittstelle noch eine automatische Übermittlung.
- Prüfung: 115 Node-Tests; SQL-Lebenszyklus mit synthetischen Daten und vollständigem ROLLBACK; Browserprüfung des Speicherns, Doppelaufnahme-Schutzes und ZAD-Statusablaufs auf Handy, iPad und Desktop in Chromium und WebKit.
- Als nächstes sinnvoll: Belegvollständigkeit pro Abrechnungsfall prüfen und fehlende Verordnungen/Genehmigungen/Transportnachweise vor der ZAD-Erfassung sichtbar machen. Aktuell bestätigt der Benutzer die vollständigen Originalbelege vor dem Postversand manuell.

### 2026-10-08 · Belegvollständigkeit vor ZAD

- Abrechnungen → Belegprüfung: Originalbelege je Fahrtrichtung auswählen, ansehen und Inhalt/Unterschriften manuell bestätigen. Suche und Filter für offene Prüfungen; Upload/Zuordnung direkt für den Patienten und die konkrete Fahrt.
- Eigene Belegart Transportnachweis mit verpflichtender Fahrtzuordnung. Verordnung und erforderliche Genehmigung müssen zu einer am Leistungsdatum gültigen Verordnung/Genehmigung in der Kundenakte gehören. Eine gemeinsame Verordnung kann für mehrere passende Fahrten geprüft werden; beliebige Dateien aus der Kundenakte reichen nicht automatisch.
- Genehmigungspflicht wird ausdrücklich durch Office/Admin geprüft; „nicht erforderlich“ braucht eine Begründung. Das System trifft keine automatische rechtliche Entscheidung und prüft keine Unterschriften per OCR.
- ZAD-Übersicht zeigt vollständige Prüfungen je Lauf. Weberfassungs- und Postversandbestätigung sind bei offenen/geänderten Prüfungen gesperrt; die serverseitige Prüfung verhindert auch das Umgehen der Oberfläche. Speichern der Vorbereitung und Patientenrechnungen bleiben unabhängig möglich.
- Geänderte/archivierte/neu zugeordnete Dokumente oder geänderte Fahrtdaten erfordern erneute Prüfung. Prüfverlauf, Mitarbeiter und Zeitpunkt bleiben gespeichert; bei Weberfassung und Versand wird der geprüfte Belegstand im Lauf festgehalten. Digitale Belege ersetzen nicht den tatsächlichen Versand der Originale.
- Validierung: 117 Node-Tests, SQL-Lebenszyklus mit ROLLBACK (Pflichtbelege, Datum/Zuordnung, veraltete Prüfung, Archiv/Restore, Prüfverlauf, ZAD-Sperre und Belegstand), Chromium/WebKit auf Handy/iPad/Desktop einschließlich Bestätigung, Fehlermeldung und erreichbarem Speichern.
- Als nächstes sinnvoll: Zahlungseingänge der Kasse je ZAD-Lauf mit den enthaltenen Rechnungen abgleichen, einschließlich Teilbeträgen und nachvollziehbaren Abweichungen; keine automatische Zahlungsbestätigung allein durch ZAD-Erfassung oder Versand.


### 2026-10-08 · Zahlungseingänge je ZAD-Lauf

- Abrechnungen → ZAD-Übersicht → Zahlungseingänge abgleichen: tatsächlichen Bankeingang mit Datum, eindeutiger Referenz, Betrag und optionalem Vermerk erfassen und den enthaltenen Kassenrechnungen ausdrücklich zuordnen. Nur bereits erfasste/versandte Läufe sind zulässig.
- Teilzahlungen zeigen den offenen Rest; ausschließlich vollständiger Ausgleich setzt eine Rechnung bezahlt. Nicht zugeordnete Bankbeträge bleiben separat sichtbar. Eigenanteilsrechnungen und Patienten-Zahlungsstatus bleiben getrennt. Der bisherige Bezahlt-Button verweist bei diesen Kassenrechnungen auf den Zahlungsabgleich.
- Centgenaue atomare Speicherung mit Versionsprüfung, tatsächlicher Zahlungsbestätigung, Schutz vor Überzuordnung, mehrfacher Bankreferenz und doppelten Wiederholungsanfragen. Aktive Office/Admin-Mitgliedschaft und Betriebsbereich werden serverseitig geprüft; Browserzugriff ist lesend mit RLS.
- Fehlerhafte Erfassung mit Pflichtgrund nachvollziehbar aufheben und danach korrekt neu erfassen. Historie mit Benutzer/Zeitpunkt bleibt erhalten; dies führt keine Bankbewegung aus. Stornierte Rechnungen sperren das Aufheben ihrer Zahlung; tatsächliche Rückzahlung erfolgt über den Stornobeleg. Bei Teilzahlung entspricht dessen Rückzahlungsbetrag ausschließlich dem erhaltenen Anteil.
- Ein Eingang gehört aktuell zu genau einem ZAD-Lauf. Gebühren, Kürzungen und Abweichungen können vermerkt werden, werden aber nicht automatisch ausgebucht. Keine Bankanbindung oder automatische ZAD-Übermittlung. Früher vollständig bezahlt erfasste Rechnungen werden kenntlich gemacht und nicht erneut belastet.
- Validierung: 121 Node-Tests, Produktionsbuild, SQL-Lebenszyklus und bestehender ZAD-/Belegprüfungsablauf jeweils mit synthetischen Daten und ROLLBACK. Chromium und WebKit auf fünf Handy/iPad/Desktop-Größen prüfen Teilzahlung, vollständigen Ausgleich, Pflichtbestätigung, veralteten Stand, Korrektur und erreichbare Dialogbuttons. Keine realen Zahlungen zu Testzwecken angelegt.
- Als nächstes sinnvoll: offene Patienten-Eigenanteilsrechnungen mit Fälligkeit und einem nachvollziehbaren manuellen Mahnlauf vorbereiten; Versand und tatsächliche Zahlungen bleiben ausdrücklich bestätigt.


### 2026-10-09 · Fälligkeiten und manueller Erinnerungslauf

- Rechnungen → Fälligkeiten & Erinnerungen zeigt ausschließlich offene Patienten-Eigenanteilsrechnungen: überfällig, noch nicht überfällig, ohne Fälligkeitsdatum, Suchfilter und Betragsübersicht. Der Fälligkeitstag selbst zählt noch nicht als überfällig; Tagesgrenzen beziehen sich auf Europe/Berlin. Einzel- und monatliche Eigenanteilsrechnungen werden berücksichtigt, Kassen- und übrige Privatrechnungen ausgeschlossen.
- Zahlungserinnerung je Rechnung einzeln prüfen, Text bearbeiten und neue Frist wählen (Vorschlag 14 Tage; morgen bis 90 Tage). Vollständige Empfängeranschrift sowie Unternehmensname/IBAN aus dem Rechnungssnapshot sind erforderlich. Vorbereitung speichert den geprüften Rechnungsstand unverändert; weder neue Rechnung noch neue Forderung, Gebühren, Zinsen oder Zahlung werden erzeugt.
- Vorschau im bestehenden Rechnungsstil mit Druck/PDF, Rechnungsnummer, ursprünglicher Fälligkeit, offener Forderung und Bankdaten. Manuelle Zustellung per Post oder E-Mail mit PDF-Anhang. Druck/Download ist keine Versandbestätigung; kein automatischer Versand eingerichtet.
- Tatsächlichen Versand ausdrücklich mit Datum, Post/E-Mail, konkretem Empfänger und optionalem Versandvermerk bestätigen. Zeitpunkt und Office/Admin-Benutzer werden gespeichert. Ein tatsächlich vor Fristablauf ausgeführter Versand kann auch später mit seinem tatsächlichen Datum dokumentiert werden. Aktive bestätigte Zahlungsfrist sperrt weitere Vorbereitung; nach Ablauf sind weitere nummerierte Erinnerungen möglich. Ein vorhandener Entwurf sperrt Doppelvorbereitung und lässt sich begründet verwerfen, mit erhaltener Historie. Bestätigter Versand wird nicht überschrieben.
- Serverseitige Versionsprüfung bei Vorbereitung, Entwurfsvorschau und Versand: veränderte, inzwischen bezahlte oder stornierte Rechnung bzw. abgelaufene Entwurfsfrist sperren den weiteren Ablauf. Nach manueller Klärung Entwurf verwerfen und ggf. neu vorbereiten. Versandarchiv bleibt mit dem damaligen Snapshot einsehbar. Gleichartige Wiederholungsanfragen sind idempotent; unterschiedliche Inhalte werden abgewiesen.
- Datenbankänderungen erfolgen berechtigungsgeprüft über Service-RPC mit Rechnungssperre; Browser darf nur über bereichsgebundene RLS lesen. Keine realen Erinnerungen, Rechnungen, Zahlungen oder Sendungen zu Testzwecken angelegt.
- Validierung: 125 Node-Tests, SQL-Lebenszyklus vollständig mit ROLLBACK, Produktionsbuild; Browser-Fixtures auf fünf Größen in Chromium/WebKit für Filter, fehlende Fälligkeit, Pflichtbestätigung, Vorschau/PDF, tatsächlichen Versand, Serverkonflikte, inzwischen bezahlte Rechnung und begründetes Verwerfen.
- Aktuelle Grenzen: manuell geprüfte Zahlungserinnerungen einzeln, keine automatischen Mahnstufen oder rechtliche Verzugsentscheidung, kein automatischer Versand; bestehende Patienten-Zahlungserfassung bestätigt weiterhin den vollständigen Rechnungseingang. Als nächstes sinnvoll: Teilzahlungen für Patienten-Eigenanteilsrechnungen mit genauem Restbetrag und Anpassung der Erinnerung daran.


### 2026-10-09 · Teilzahlungen auf Eigenanteilsrechnungen

- Rechnungen → Zahlung erfassen bei Einzel- und monatlichen Eigenanteilsrechnungen: tatsächlichen Teilbetrag oder gesamten offenen Rest mit Zahlungsdatum, Überweisung/Bar/Karte, eindeutiger Referenz und optionalem Vermerk dokumentieren. Keine Bankanbindung, kein automatischer Versand und keine zusätzliche Rechnung/Quittung durch diesen Vorgang.
- Rechnungsbetrag bleibt unverändert; Übersicht zeigt erhaltenen Betrag, Teilzahlung und offenen Rest. Erst vollständiger Ausgleich markiert die Rechnung und alle zugehörigen Eigenanteile atomar bezahlt. Teilzahlungen werden nicht willkürlich auf einzelne Monatsfahrten verteilt. Kassenforderungen und deren Zahlungsstatus bleiben getrennt.
- Zahlungsdialog lädt vor der Erfassung den aktuellen serverseitigen Stand. Positive Centbeträge, Zahlung ab Rechnungsdatum bis heute, Referenz, Rollen/Bereich, Fallzuordnung, Versionsstand und Überzahlungssperre werden serverseitig geprüft. Wiederholung derselben Anfrage erzeugt keinen zweiten Eingang; gleiche aktive Referenz wird abgewiesen. Frühere vollständige Zahlungsbestätigungen ohne Einzelregister bleiben als solche kenntlich. Der alte Bezahlt-Weg kann einen bereits teilweise bezahlten Eigenanteil nicht überspringen.
- Falschen Eintrag ausdrücklich mit Pflichtgrund aufheben und korrekt neu erfassen; Zahlungshistorie und Benutzer/Zeitpunkte bleiben erhalten. Dies führt keine Rückzahlung aus. Nach Rechnungsstorno ist die Zahlungskorrektur gesperrt; tatsächliche Rückzahlung erfolgt über den Stornobeleg. Bei Teilzahlung entspricht die Rückzahlung ausschließlich dem erhaltenen Anteil. Die betroffenen Eigenanteile werden bis zur bestätigten Rückzahlung nicht für eine neue Patientenrechnung freigegeben.
- Fälligkeiten & Erinnerungen summiert die offenen Restbeträge. Neu vorbereitete Schreiben speichern ursprüngliche Rechnung, erhaltenen Betrag und noch offenen Rest; nur letzterer wird verlangt, ohne Gebühren/Zinsen. Jede Zahlung/Korrektur macht einen alten Entwurf mit abweichendem Zahlungsstand ungültig. Versandarchive behalten ihre damaligen Beträge.
- Validierung: 127 Node-Tests, Produktionsbuild, SQL-Lebenszyklus ausschließlich mit synthetischen Daten und ROLLBACK für Monats-/Einzelrechnung, Teil-/Vollzahlung, Korrektur, Referenz-/Versions-/Überzahlungsschutz, atomare Eigenanteile, getrennte Kassenforderung, Mahnrest, Storno/Rückzahlung und Browserrechte. Bestehende Erinnerungs- und Kassen-Zahlungstests ebenfalls erneut erfolgreich. Chromium/WebKit auf fünf Handy/iPad/Desktop-Größen prüfen Pflichtbestätigung, Konflikt, 10/20-Teilzahlungen auf 30 €, Korrektur, Rechnungsteilstatus und Erinnerungsvorschau mit 20 € Rest.
- Weiterhin offen: automatischer E-Mail-Versand, automatische Mahnstufen und fachlich konfigurierte Gebühren/Zinsen. Ein einzelner Eingang wird aktuell genau einer Patientenrechnung zugeordnet; kein Bankimport oder Sammelüberweisungs-Abgleich für mehrere Patientenrechnungen.


### 2026-10-09 · Konfigurierbare Mahnstufen

- Einstellungen → Mahnstufen: Administratoren bearbeiten für Zahlungserinnerung, Erste Mahnung und Zweite Mahnung jeweils Text und Zahlungsfrist (1–90 Tage ab dem neuen Schreiben, Standard 14 Tage). Office kann die Vorgaben nutzen. Speichern schützt vor dem Überschreiben zwischenzeitlicher Änderungen.
- Rechnungen → Fälligkeiten & Erinnerungen schlägt die nächste Stufe vor. Vorbereitung übernimmt deren Text und Frist; beide bleiben vor dem Speichern individuell bearbeitbar. Die Stufe steigt ausschließlich nach tatsächlichem bestätigtem Versand und Ablauf der vorigen Zahlungsfrist. Entwurf/Verwerfen verbrauchen nur die laufende Schreiben-Nummer, keine Mahnstufe. Nach der zweiten versandten Mahnung ist weiteres Vorgehen manuell zu klären.
- Stufe und Einstellungssnapshot werden im Schreiben gespeichert. Bereits vorhandene Erinnerungen bleiben Stufe 1 und behalten Text, Betrag und Frist. Neue Vorgaben verändern bestehende Entwürfe/Versandarchive nicht. Geänderte Einstellungen zwischen Laden und Vorbereitung erfordern erneute Prüfung. Serverseitige Sperren gegen Stufensprünge, doppelte Entwürfe, Zahlung/Storno und veraltete Zahlungsstände bleiben erhalten.
- Eigenanteile werden mit ihrem offenen Rest erinnert; Originalbetrag und erhaltene Teilzahlung stehen separat im PDF. Keine zusätzlichen Gebühren/Zinsen und kein automatischer Versand. Post-/E-Mail-Versand bleibt ausdrücklich manuell bestätigt.
- Validierung: 131 Node-Tests und synthetische SQL-Lebenszyklen mit vollständigem ROLLBACK (Einstellungen/Versionsschutz, Stufenfolge, verworfener Entwurf, Fristen und unveränderte Archive); bestehende Erinnerungs- und Teilzahlungsprüfungen bestanden. Browserprüfungen der Einstellungen und Mahnungs-PDFs auf fünf Handy/iPad/Desktop-Größen in Chromium und WebKit.


### 2026-10-09 · Fahrerschichten, Pausen und Kilometer

- Fahrer-App: Nach dem Konto-Login wird die gespeicherte Schicht geladen. Ohne offene Schicht sind Fahrtdaten und Fahrtaktionen gesperrt, bis Fahrzeug und tatsächlicher Startkilometerstand erfasst wurden. Ein erneuter Login/Neuladen übernimmt die bestehende Schicht einschließlich laufender Pause, statt eine zweite Schicht zu erzeugen. Konto abmelden beendet keine Schicht.
- Dauerhafte Fahrzeugzuordnung vom Büro wird fest übernommen, ohne Auswahlfeld. Ohne Bürozuordnung werden verfügbare aktive Flottenfahrzeuge anhand Kennzeichen zur Auswahl angeboten. Spontane Zuordnungen gelten für diese Schicht und werden erst bei deren Ende freigegeben; dauerhafte Bürozuordnungen bleiben bestehen. Fahrzeugwechsel in einer laufenden Schicht ist gesperrt. Bürozuordnung/Freigabe erfolgen nun atomar per RPC. Büro sieht unter Fahrer / Personal eine separate Aktion Fahrzeug zuteilen; Anlegen/Bearbeiten der Fahrer-Stammdaten bleibt ausschließlich dem Chef vorbehalten.
- Pause starten/beenden speichert tatsächliche Server-Zeitstempel und einen separaten Pausenverlauf. Schichtformulare zeigen Kilometerfehler direkt auf Deutsch innerhalb der App, ohne überlagernde Safari-Validierungspopups. Schichtende braucht einen ganzen Endkilometerstand, mindestens Start- und zuletzt gespeicherter Fahrzeugstand; eine noch laufende Pause wird geschlossen. Fahrzeugkilometer werden nach Start/Ende aktualisiert. Historische Schichten behalten Fahrername und Kennzeichen als Snapshot.
- Laufende Fahrten sperren Pause und Schichtende. Fahrtstatus erfordert serverseitig eine aktive eigene Schicht mit passendem Fahrzeug; während der Pause sind Fahrtaktionen gesperrt. Office kann bestehende Fahrten unabhängig manuell klären. Keine automatische Erfassung von Fahrten, Zeiten oder Kilometerständen.
- Eindeutige offene Schicht pro Fahrer/Fahrzeug, eindeutige offene Pause, Versionsschutz und wiederholbare Anfrage-IDs verhindern Doppelerfassung. Browser darf Schichten/Pausen/Ereignisse ausschließlich lesen; Fahrer sieht eigene Daten, Chef/Büro ihren Geschäftsbereich. Änderungen laufen über authentifizierte Edge Function und service-only RPCs mit erneuter Rollen-/Betriebsprüfung.
- Nächster offener Bereich umgesetzt: Berichte → Schichten & Kilometer. Monats-/Fahrerfilter, Schichtenverlauf mit 50 Einträgen je Seite und vollständige Monatssummen für abgeschlossene Schichten (Kilometer, erfasste Pausen, Zeit ohne Pausen). Offene Schichten werden getrennt gezeigt und nicht mit geschätzten Endkilometern summiert. Monat folgt dem Schichtbeginn in Europe/Berlin; keine Lohn-/Zuschlagsberechnung.
- Validierung: 137 Node-Tests, Produktionsbuild und SQL-Transaktionsprüfungen mit vollständigem ROLLBACK: Kilometerpflicht, Fahrzeug-/Betriebszuordnung, laufende Fahrt, Pause/Resume, Ende während Pause, Doppelanfragen/Versionen, dauerhafte/spontane Zuordnung, Berichtssummen und tatsächliche RLS-Isolation zweier synthetischer Fahrer. Browser-Fixtures prüfen Schichtstart, Pause, Neuladen, Pflicht-Endkilometer, Bürofahrzeug und Berichte auf fünf Bildschirmgrößen in Chromium/WebKit. Keine produktiven Schichten/Kilometerstände zu Testzwecken verändert.
- Weitere Berichtsarten (Umsatz, Kassen, Auslastung), Nachrichten, Buchhaltung und Offlinebetrieb bleiben eigenständige offene Punkte.

## Rechnungs- und Kostenträgerbericht ergänzt (9. Oktober 2026)

- Berichte → Rechnungen & Kostenträger: Monats-, Rechnungsart- und Kostenträgerfilter; Netto/MwSt./Brutto, Kassen-/Eigenanteils-/Privatbelege, Kostenträgersummen und Belegverlauf mit 50 Einträgen je Seite. Vollständige Summen aus paginierten, RLS-geschützten Finanzdaten; Anzeige-Pagination verändert Summen nicht.
- Ausstellungsdatum bestimmt den Monat. Originale bleiben im ursprünglichen Monat, negative ST-Belege zählen im Stornomonat, Ersatzrechnungen mit eigenem Ausstellungsdatum. Historische Status-Stornos ohne ST werden ausdrücklich ausgeschlossen und als Anzahl angezeigt. Keine rückwirkenden Belege erfunden.
- Aktuelle offene Restbeträge verwenden Kassen-/Patienten-Zahlungsabgleich, einschließlich Teilzahlungen. Zusätzlich aktuelle offene Beträge und noch zu bestätigende Rückzahlungen aus allen Monaten mit denselben Filtern. Dies ist kein historischer Stichtagsbericht und keine Zahlungseingangsstatistik.
- Eigenanteile werden getrennt angezeigt; Kassenrechnungen enthalten bereits deren Abzug. Quittungen werden nicht nochmals zum Rechnungsvolumen addiert. Keine produktiven Rechnungen, Zahlungen oder Belege verändert.
- Noch offen: Einnahmen nach Zahlungsdatum, Ausgaben, Buchhaltungsexport, Auslastung und Kommunikation.
- Validierung: 142 Node-Tests und Produktionsbuild bestanden; eigener Berichts-Browsertest (`UI_WEBKIT=1 npm run test:reports`) besteht in Chromium/WebKit auf fünf Bildschirmgrößen. Prüft Summen, Teilzahlungen, Monats-/Art-/Kostenträgerfilter, Aktualisierung und Seitenbreite. Bericht auch in bestehende Responsive-UI-Prüfung aufgenommen.
