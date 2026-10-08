export const DOCUMENT_BUCKET='fahrdienst-documents';
export const MAX_DOCUMENT_SIZE=10*1024*1024;
export const DOCUMENT_TYPES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
export function validateDocumentInput(body){
 const kind=body.kind;
 if(!['prescription','approval','other'].includes(kind))throw new Error('Dokumentart fehlt.');
 const mime=body.mimeType,size=Number(body.size);
 if(!Object.hasOwn(DOCUMENT_TYPES,mime))throw new Error('Bitte PDF, JPEG, PNG oder WebP verwenden.');
 if(!Number.isInteger(size)||size<1||size>MAX_DOCUMENT_SIZE)throw new Error('Dateien dürfen höchstens 10 MB groß sein.');
 const name=String(body.fileName||'').replace(/[\\/\x00-\x1f\x7f]/g,'_').trim();
 const title=String(body.title||name).trim();
 if(!name||name.length>180||!title||title.length>180)throw new Error('Dateiname und Titel dürfen höchstens 180 Zeichen enthalten.');
 return {kind,mime_type:mime,size_bytes:size,file_name:name,title};
}
export function detectDocumentMime(bytes){
 const starts=values=>values.every((v,i)=>bytes[i]===v);
 if(starts([37,80,68,70,45]))return 'application/pdf';
 if(starts([255,216,255]))return 'image/jpeg';
 if(starts([137,80,78,71,13,10,26,10]))return 'image/png';
 if(bytes.length>=12&&starts([82,73,70,70])&&[87,69,66,80].every((v,i)=>bytes[8+i]===v))return 'image/webp';
 return null;
}
