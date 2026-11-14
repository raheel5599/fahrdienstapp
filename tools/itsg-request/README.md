# ITSG-Zertifikatsantrag ohne dakota (lokales Werkzeug)

Erzeugt **lokal** einen Antrag für sonstige Leistungserbringer (IK), keine
Abrechnungsdatei. Es erfolgt kein Upload, keine Zertifikatsbestellung und kein
Produktionsdeployment. Der private Schlüssel verlässt den lokalen Rechner nicht.
Diese Funktion ist noch nicht Teil der produktiven Weboberfläche.

## Vor dem echten Antrag

- IK, Firmenname und vollständige Kontaktperson mit dem bestehenden
  Registrierungsportal abgleichen. Keine Namen aus alten Rechnungen raten.
- GUID der bestehenden Registrierung verwenden. Firmenname maximal 64,
  Kontaktperson maximal 128 Zeichen gemäß SECON DN-Profil. Nicht automatisch
  kürzen oder Umlaute ersetzen; erforderliche Umsetzungen vorher abstimmen.
- Einen dauerhaft verfügbaren, vertrauenswürdigen Rechner und einen separaten
  Datensicherungsort verwenden. Kein temporärer Chat-Workspace für echte Schlüssel.
- Ein Passwort (mindestens 16 Zeichen empfohlen) lokal im Terminal eingeben und
  separat verwahren; niemals an Chat, GitHub oder ITSG senden.

## Auf dem eigenen Rechner ausführen

Python 3.10+ installieren und im Repository:

```sh
python3 -m venv .venv-itsg
.venv-itsg/bin/python -m pip install -r tools/itsg-request/requirements.txt
```

Unter Windows statt `.venv-itsg/bin/python` den Aufruf
`.venv-itsg\Scripts\python.exe` verwenden. Kein Windows/Dakota erforderlich.
Ein persönliches Profil **außerhalb des Git-Repositorys** als JSON speichern:

```json
{
  "ik": "IHRE_NEUNSTELLIGE_IK",
  "company": "FIRMA_WIE_IM_PORTAL",
  "contact": "KONTAKTPERSON_WIE_IM_PORTAL",
  "guid": "GUID_AUS_BESTEHENDER_REGISTRIERUNG"
}
```

Diese Platzhalter sind absichtlich ungültig, damit daraus kein echter Antrag entsteht.
Dann mit echtem, kontrolliertem Profil:

```sh
.venv-itsg/bin/python tools/itsg-request/request.py generate --profile /PFAD/ZUM/PERSOENLICHEN/profil.json --identity-confirmed
```

Das Passwort wird verdeckt und zweimal im Terminal abgefragt. Keine Passwort-
Argumente, Umgebungsvariablen oder Profildateifelder. Standardablage:
`~/ITSG-Antraege/<GUID>/`. Ein bestehender GUID-Ordner wird **nie überschrieben**,
auch nicht nach einem Fehler oder unterbrochenen Erzeugungslauf. Nicht einfach
löschen oder einen anderen `--root` wählen, um diesen Schutz zu umgehen.

Der Ordner enthält:

- `<IK>.p10`: DER-binäre PKCS#10-Anfrage für den Upload.
- `SHA256-Pruefblatt.pdf`: prüfen, drucken, von der registrierten Kontaktperson
  unterschreiben und wieder als PDF scannen.
- `PRIVATE-KEY.encrypted.pem`: passwortverschlüsselter PKCS#8-Schlüssel.
  **Nicht hochladen, nicht per E-Mail verschicken, nicht in Git speichern.**
- `manifest.json`: Profil und Prüfwerte, keine Passwörter.
- `README.txt` und `RESERVED`: Ablauf und Schutz vor unbemerktem Neuerzeugen.

Gesamten Ordner sichern. Sicherung prüfen, ohne Schlüssel neu zu erzeugen:

```sh
.venv-itsg/bin/python tools/itsg-request/request.py verify /PFAD/ZUM/GUID-ORDNER
```

Erst danach ausschließlich `.p10` und das **unterschriebene** Prüfblatt unter
https://www.itsg-trust.de/zap mit derselben GUID hochladen. Für die reine eigene IK
keine Meldestellen-Eigenerklärung erzeugen. Auftragsnummer sichern und zum
Registrierungsportal zurückkehren. Freischaltbrief und Schlüsselprüfwert vergleichen;
Annahme/Zertifikat sind erst durch die ITSG bestätigt, nicht durch unsere Tests.

## Technisches Profil und Prüfungen

SECON Anlage 16, gültig ab 01.01.2026, Stand 02.09.2025:

- RSA 4096 Bit, Exponent 65537.
- RSASSA-PSS, SHA256, MGF1-SHA256, Salt-Länge 32.
- DN-Reihenfolge C=DE, O=ITSG TrustCenter fuer sonstige Leistungserbringer,
  OU=Firma, OU=IK plus neun Ziffern, CN=Kontaktperson, PrintableString.
- Keine CSR-Attribute/ExtensionReq, DER-Datei mit Endung `.p10`.
- Fingerprint über den subjectPublicKey BIT STRING (DER-RSAPublicKey/PKCS#1),
  **nicht** über das komplette SPKI, PEM oder die gesamte CSR-Datei.
- GUID dient nur als Uploadreferenz und ist kein DN-Attribut.

Prüfblatt hat keine erfundene Unterschrift und keinen Zertifikatsstatus.
Zertifikatsimport, Trust-Chain-/Sperrlistenprüfung und spätere Signatur/Verschlüsselung
von §302-Nutzdaten müssen noch ergänzt und mit Annahmestellen getestet werden.

Test mit ausschließlich synthetischer Identität:

```sh
python3 -m pip install -r tools/itsg-request/requirements-test.txt
python3 -m unittest discover -s tools/itsg-request -p 'test_*.py' -v
```

Unabhängige OpenSSL-Prüfung von Signatur, PSS-Parametern und Public-Key-Fingerprint,
PDF-Inhalt, Passwortschutz, Sicherungswiederherstellung, Namens-/GUID-Prüfung,
Manipulation und Schutz gegen erneute Generierung. Synthetische Schlüssel werden
nur in temporären Verzeichnissen erzeugt und anschließend entfernt.

Quellen:

- https://www.itsg.de/produkte/trust-center/zertifikat-beantragen/
- https://www.itsg.de/wp-content/uploads/2023/03/Informationen-zu-den-Antragsformen-beim-ITSG-Trust-Center.pdf
- https://www.gkv-datenaustausch.de/media/dokumente/standards_und_normen/technische_spezifikationen/Anlage_16_-_Security_Schnittstelle.pdf
