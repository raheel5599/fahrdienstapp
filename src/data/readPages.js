// No silent truncation at the Data API row limit. All reads keep their RLS scope.
export async function readPages(query){
 const rows=[],seen=new Set();let total=null;
 for(;;){
  const result=await query().range(rows.length,rows.length+499);
  if(result.error)throw result.error;
  if(!Number.isInteger(result.count))throw Error('Datensatzanzahl konnte nicht geprüft werden.');
  if(total!==null&&total!==result.count)throw Error('Daten wurden während des Ladens geändert. Bitte erneut laden.');
  total=result.count;
  for(const row of result.data||[]){if(seen.has(row.id))throw Error('Daten wurden während des Ladens geändert. Bitte erneut laden.');seen.add(row.id);rows.push(row)}
  if(rows.length>=total)return rows;
  if(!result.data?.length)throw Error('Daten konnten nicht vollständig geladen werden.');
 }
}
export async function readByIds(ids,query){const rows=[];for(let offset=0;offset<ids.length;offset+=100)rows.push(...await readPages(()=>query(ids.slice(offset,offset+100))));return rows}
