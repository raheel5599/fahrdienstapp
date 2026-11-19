# Google Kalender für die Disposition

Die App überträgt Einzeltermine und erzeugte Serienfahrten einseitig. Google erhält eine gekürzte Auftragsnummer, Beginn und eine technische Endzeit. In der Terminbeschreibung stehen Name, Abholadresse und Zieladresse. Taxi-, Kurier- und Flughafenfahrten erscheinen gelb, Krankenfahrten blau. Die Google-Anzeige verwendet Europe/Berlin. Diagnosen und interne Notizen bleiben in der Fahrdienst-App. Nutze einen internen Kalender, auf den nur berechtigte Mitarbeitende Zugriff haben.

## Google-Anmeldung einrichten

1. Für das Fahrdienst-Projekt in der TARIQ Verwaltung `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` freigeben. Die Edge Function `google-calendar` liest sie serverseitig mit dem vorhandenen Fahrdienst-Projektzugang. Dessen Token als Supabase Edge Function Secret `VERWALTUNG_PROJECT_TOKEN` hinterlegen.
2. Im Google-Cloud-Projekt des OAuth-Webclients die Google Calendar API aktivieren. In den autorisierten Weiterleitungs-URIs `https://app.tariq-fahrdienst.de/google-calendar-callback.html` ergänzen.
3. Datenbankmigration `20261118210000_calendar_oauth.sql`, die aktualisierte Edge Function und die Fahrdienst-App bereitstellen.
4. Als Geschäftsleitung unter **Einstellungen → Google Kalender → Mit Google verbinden** mit dem Geschäftskonto anmelden. Einen beschreibbaren Kalender für die Disposition auswählen und auf **Kalender verbinden** klicken.
5. Den gewählten Kalender auf dem Handy einblenden. Für den Funktionstest eine Fahrt mit Beispieldaten anlegen, verschieben und stornieren.

Die Übertragung läuft nach dem Speichern im Hintergrund. Ausstehende Termine und Fehler zeigt der Einstellungsbereich. Beim Trennen bleiben bereits übertragene Termine im gewählten Kalender. Die bisherige Dienstkonto-Einrichtung ist weiterhin verwendbar, wenn `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` gesetzt ist.
