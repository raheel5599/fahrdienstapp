import {testDocument} from './epostTestDocument.js';

export function epostTestSettings(env, unitId) {
  const url = env('EPOST_WEBDAV_URL');
  const username = env('EPOST_WEBDAV_USERNAME');
  const password = env('EPOST_WEBDAV_PASSWORD');
  if (!url || !username || !password || env('EPOST_WEBDAV_BUSINESS_UNIT_ID') !== unitId) return null;

  try {
    const folder = new URL(url);
    if (folder.origin !== 'https://mailer-webdav.epost.de' ||
        folder.username || folder.password || folder.search || folder.hash ||
        !/^\/\d+\/[^/]+\/$/.test(folder.pathname.replace(/\/?$/, '/'))) return null;
    folder.pathname = folder.pathname.replace(/\/?$/, '/');
    return {folder, username, password};
  } catch {
    return null;
  }
}

export async function uploadEpostTest(settings, fetchDocument = fetch) {
  const filename = `TARIQ-EP-TEST-${crypto.randomUUID()}.pdf`;
  const credentials = new TextEncoder().encode(`${settings.username}:${settings.password}`);
  const authorization = 'Basic ' + btoa(String.fromCharCode(...credentials));

  try {
    const response = await fetchDocument(new URL(filename, settings.folder), {
      method: 'PUT',
      redirect: 'manual',
      headers: {Authorization: authorization, 'Content-Type': 'application/pdf', 'If-None-Match': '*'},
      body: testDocument(),
      signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel();
    if ([200, 201, 204].includes(response.status)) return {status: 200, body: {filename}};
    const reason = {
      401: 'WebDAV-Anmeldung abgelehnt. Prüfe die Zugangsdaten.',
      403: 'Keine Schreibberechtigung. Prüfe die Freigabe für den Sammelkorb.',
      404: 'Sammelkorb nicht gefunden. Prüfe die vollständige WebDAV-Adresse.',
      409: 'Zielordner fehlt. Prüfe die vollständige WebDAV-Adresse.',
    }[response.status] ?? 'E-POST hat den Upload nicht bestätigt.';
    return {status: 502, body: {error: `${reason} (HTTP ${response.status})`}};
  } catch {
    return {status: 502, body: {error: `Upload unbestätigt. Prüfe zuerst das Journal. Testdatei ${filename}`}};
  }
}
