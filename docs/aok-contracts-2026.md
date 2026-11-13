# AOK Hessen: Vertragsvorlagen 2026 (Vorbereitung, kein Livebetrieb)

Quelle: die bereitgestellten Auszüge `AOK sitzend.pdf` (Seite 1, Anlagen 5/6,
gedruckte Seiten 24/25) und `AOK Rollstuhl.pdf` (Seite 1, Anlagen 5/6,
gedruckte Seiten 25/26). Beide Version 24.11.2025, gültig ab 01.01.2026,
Wetteraukreis. Die vertraulichen Scans und persönlichen Vertragsdaten werden nicht
im Repository gespeichert.

| Vorlage | AC/TK | AC | TK |
| --- | --- | --- | --- |
| AOK sitzend, Taxi | 4606280 | 46 | 06280 |
| AOK Rollstuhl | 4606460 | 46 | 06460 |

Die langen ZAD-Vertragskennungen und die zuvor in der E-Mail eingetragene Nummer
sind nicht als DTA-AC/TK zu übernehmen. Maßgeblich sind die sieben Stellen im Vertrag.

## Verwendung

Unter **Kassen & Verträge** stehen zwei Vorlagen zur Verfügung. Im vorhandenen
AOK-Vertrag kann dessen passende Positionsliste übernommen werden. Alternativ
öffnet eine Vorlage einen neuen, noch nicht gespeicherten Entwurf. Krankenkasse,
Gültigkeit, Leistungsbereich und Preise prüfen und ausdrücklich speichern. Bestehende
Verträge/Rechnungen werden beim Öffnen einer Vorlage nicht verändert.

Der Positionskatalog je Vertrag zeigt aus den XX-Vorlagen erzeugte sechsstellige
Codes, Bezeichnung und Behandlung. Eine Nummer kann kopiert werden. In der
Abrechnungsprüfung lassen sich der am Fahrtag passende Vertrag, dessen
Positionsvorlage und die Behandlung wählen. Fremde oder zu Kilometer/Fahrtgebiet
unpassende AOK-Positionen verhindern den Status bereit.

Die Hauptposition ist eine Auswahlhilfe; Grund- und Kilometerpositionen werden
weiterhin automatisch nach den Regeln kombiniert. Bei Wechsel des Vertrags wird
die Positionsauswahl neu aufgebaut. Die Abrechnung lädt dafür alle Verträge des
eigenen Geschäftsbereichs, auch noch nicht in Fällen verwendete Vorlagen.

## Sitzend Taxi

- Außerhalb Pflichtfahrgebiet, bis einschließlich 5 km: `5116XX`, 12,90 EUR,
  ohne zusätzliche Einsatzpauschale oder Kilometerposition.
- Über 5 km: `511200`, 2,40 EUR, plus `5130XX`, 2,10 EUR je Besetzt-km.
- Innerhalb Pflichtfahrgebiet: `5148XX`, Taxameterbetrag als **Menge** bei
  Einzelpreis 1,00 EUR. Kein zusätzlicher Kilometerpreis.
- Mehrpersonentransport-Katalog: `521200` 2,40 EUR, `5231XX` 1,73 EUR/km.
- Vereinbarungspreise: `512900` und `522900`; kein Preis wird ausgedacht.

## Rollstuhl

- Nicht umsetzbarer Rollstuhl im behindertengerechten Fahrzeug.
- `7501XX`, 27,48 EUR, enthält die ersten zehn Besetzt-km.
- `753000`, 2,10 EUR je weiterem km: Menge `max(0, Besetzt-km - 10)`.
- Mehrpersonentransport-Katalog: `7502XX` 18,78 EUR und `753100` 1,73 EUR
  je weiterem km ab dem 11. km.
- Genehmigter Vereinbarungspreis: `752900`.

Sammeltransporte sind **keine Serienfahrten**. Sie sind im Katalog vorhanden, bleiben
aber für automatische Berechnung gesperrt, bis die tatsächliche Personenzahl und
Kostenaufteilung zuverlässig erfasst und geklärt sind. Vereinbarungspreise bleiben
bis zur gesonderten Genehmigungs-/Preisprüfung ebenfalls gesperrt. Das gilt auch
bei direktem API-Aufruf; diese Zeilen werden nicht als 0-EUR-Position abgerechnet.

Behandlungscodes: 01 stationär, 02 vor-/nachstationär, 03 Verlegung, 05 ambulant im
Krankenhaus, 10 ambulante Operation, 20 ambulante Behandlung, 30 Chemo/Strahlentherapie,
52 Dialyse. Bei sitzenden Einsatzpauschalen bleibt die Endung 00 erhalten. Beim
Rollstuhl trägt die Grundpauschale die Behandlung; Besetztkilometer bleiben auf 00.
Preise sind einschließlich gegebenenfalls anfallender Umsatzsteuer; kein Aufschlag.

## Schnittstelle und Freigabe

Bei Wahl einer AOK-Vorlage werden Tarifkennzeichen und Vertragsquelle in der
Kassenanbindung vorgeschlagen. Empfänger-IK, Kostenträger-IK und Prüfdatum müssen
weiter anhand der aktuellen Annahmestellenvorgaben bestätigt werden. Im Export
wird der gespeicherte Vertrag mit gesichert; bekannte AOK-Verträge mit falschem
Tarifkennzeichen werden abgewiesen.

Die §302-Migration ist weiterhin nicht live angewendet; sie enthält nun auch den
Vertrag im unveränderlichen Snapshot. Kein Echtversand, keine Änderung des
Abrechnungswegs über ZAD und kein automatisches Produktionsdeployment.

Prüfung: `npm test`, `npm run build`, `npm run test:aok`, `npm run test:dta`.
Der SQL-Test läuft gemeinsam mit der noch nicht angewendeten §302-Migration in
einer abschließend zurückgerollten Transaktion. Wichtige Grenzfälle: 5/5,01 km,
10/11 km, Taxameter als Menge, Behandlungswechsel, Fremdvertrag, falsches TK und
nicht automatisch abrechenbare Sammel-/Sonderpreispositionen.
