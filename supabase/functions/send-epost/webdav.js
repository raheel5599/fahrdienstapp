export function epostSettings(env, unitId) {
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

export async function handOverInvoice(settings,filename,pdf,fetchDocument=fetch) {
 const credentials=new TextEncoder().encode(`${settings.username}:${settings.password}`);
 const authorization='Basic '+btoa(String.fromCharCode(...credentials));
 try{
  const response=await fetchDocument(new URL(encodeURIComponent(filename),settings.folder),{
   method:'PUT',redirect:'manual',
   headers:{Authorization:authorization,'Content-Type':'application/pdf','If-None-Match':'*'},
   body:pdf,signal:AbortSignal.timeout(15000)
  });
  await response.body?.cancel().catch(()=>{});
  if([200,201,204].includes(response.status))return {status:'handed_over',message:null};
  const rejected=[400,401,403,404,405,409,413,415,422].includes(response.status);
  return {
   status:rejected?'rejected':'uncertain',
   message:rejected?`Der Sammelkorb hat die Datei abgelehnt (HTTP ${response.status}).`:
    `Der Upload ist nicht bestätigt (HTTP ${response.status}). Bitte zuerst das E-POST-Journal prüfen.`
  };
 }catch{
  return {status:'uncertain',message:'Der Upload ist nicht bestätigt. Bitte zuerst das E-POST-Journal prüfen.'};
 }
}
