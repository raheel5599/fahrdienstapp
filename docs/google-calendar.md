# Google Kalender für die Disposition

Die App überträgt Einzeltermine und erzeugte Serienfahrten einseitig. Google erhält nur eine gekürzte Auftragsnummer, Beginn und eine technische Endzeit. Die Google-Anzeige verwendet Europe/Berlin. Die App übermittelt weder Namen noch Adressen, Diagnosen oder Notizen.

## Einmalige Einrichtung

1. Im Google-Cloud-Projekt die Google Calendar API aktivieren und ein eigenes Dienstkonto für diese Installation erstellen.
2. Den JSON-Schlüssel als serverseitiges Supabase-Secret `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` setzen. Eine lokale, nicht versionierte dotenv-Datei mit dem JSON-Wert kann über `supabase secrets set --env-file <datei>` geladen werden. Schlüssel nie im Frontend, Repository oder Chat hinterlegen.
3. Die Migration `20261118160000_google_calendar_sync.sql` auf dem Fahrdienst-Projekt ausführen. Sie erwartet die vorhandenen Fahrdienst-Tabellen sowie pg_net und pg_cron. Die Worker-URL zeigt auf das bestehende Produktionsprojekt. Bei einem Testprojekt die URL vor der Installation anpassen.
4. Die Edge Function mit `supabase functions deploy google-calendar --no-verify-jwt` und die zugehörige Fahrdienst-App bereitstellen.
5. Als Geschäftsleitung unter Einstellungen → Google Kalender die angezeigte Dienstkonto-Adresse kopieren. Im gewünschten Google-Kalender diese Adresse mit „Termine ändern“ freigeben. Die Kalender-ID steht in den Google-Kalendereinstellungen unter „Kalender integrieren“. In der Fahrdienst-App eintragen und „Kalender verbinden“ wählen.
6. Auf dem Handy den verbundenen Google-Kalender einblenden. Zum Funktionstest eine eigene Testfahrt anlegen, die Uhrzeit ändern und die Fahrt stornieren. Die Aktualisierung auf dem Gerät hängt auch von seiner Google-Synchronisierung ab.

Der Datenbanktrigger stößt die Übertragung nach dem Speichern an. Ein minütlicher Hintergrundlauf holt offene Änderungen nach. Fehler und ausstehende Termine lassen sich im Einstellungsbereich prüfen. Beim Trennen bleiben bereits übertragene Termine im gewählten Kalender.
