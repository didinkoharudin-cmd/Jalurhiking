'use strict';
const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const TILE=256;
const DB_NAME='JalurNusaDB', DB_VERSION=3;
const STORES={routes:'routes',maps:'mapPackages',recordings:'recordings',trips:'tripPlans'};
let mountains=[],routes=[],mapPackages=[],recordings=[],tripPlans=[];
let activeTrip=null;
let activeRoute=null,activeMapPackage=null,deferredInstall=null;
let gpsWatch=null,gpsPosition=null,gpsFix=null,currentRecording=null,recordTimer=null;
let lastOffRouteAlert=0,compassHandler=null;
let mapState={center:[-2.35,117.6],zoom:5,dragging:false,last:null,onlineTiles:false};
let mapRenderSeq=0,tileObjectUrls=[],readerCache=new Map();

function toast(msg){const e=$('#toast');e.textContent=msg;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),2600)}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function xmlEsc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]))}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function fmtBytes(n=0){if(!Number.isFinite(n))return '—';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`}
function fmtDuration(ms){const s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;return [h,m,ss].map(v=>String(v).padStart(2,'0')).join(':')}
function dateTimeID(v){try{return new Date(v).toLocaleString('id-ID')}catch{return ''}}

function dbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORES.routes))db.createObjectStore(STORES.routes,{keyPath:'id'});if(!db.objectStoreNames.contains(STORES.maps))db.createObjectStore(STORES.maps,{keyPath:'id'});if(!db.objectStoreNames.contains(STORES.recordings))db.createObjectStore(STORES.recordings,{keyPath:'id'});if(!db.objectStoreNames.contains(STORES.trips))db.createObjectStore(STORES.trips,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbAll(store){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function dbPut(store,v){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function dbDelete(store,id){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function hav(a,b){const R=6371,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180,la1=a[0]*Math.PI/180,la2=b[0]*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function distance(c=[]){let d=0;for(let i=1;i<c.length;i++)d+=hav(c[i-1],c[i]);return d}
function gain(c=[]){let g=0;for(let i=1;i<c.length;i++){const a=Number(c[i-1][2]),b=Number(c[i][2]);if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)g+=b-a}return g}
function nearestRouteDistanceM(point,coords=[]){
  if(!point||!coords.length)return null;if(coords.length===1)return hav(point,coords[0])*1000;
  const lat0=point[0]*Math.PI/180,MX=111320*Math.cos(lat0),MY=110540;let best=Infinity;
  for(let i=1;i<coords.length;i++){
    const a=[(coords[i-1][1]-point[1])*MX,(coords[i-1][0]-point[0])*MY],b=[(coords[i][1]-point[1])*MX,(coords[i][0]-point[0])*MY];
    const vx=b[0]-a[0],vy=b[1]-a[1],den=vx*vx+vy*vy;let t=den?-(a[0]*vx+a[1]*vy)/den:0;t=clamp(t,0,1);const x=a[0]+t*vx,y=a[1]+t*vy;best=Math.min(best,Math.hypot(x,y));
  }
  return best;
}

async function load(){
  mountains=await fetch('data/mountains.json').then(r=>r.json()).catch(()=>[]);
  [routes,mapPackages,recordings,tripPlans]=await Promise.all([dbAll(STORES.routes).catch(()=>[]),dbAll(STORES.maps).catch(()=>[]),dbAll(STORES.recordings).catch(()=>[]),dbAll(STORES.trips).catch(()=>[])]);
  for(const rec of recordings){if(rec.active){rec.active=false;rec.recovered=true;rec.endAt=rec.lastAt||new Date().toISOString();dbPut(STORES.recordings,rec).catch(()=>{})}}
  const activeId=localStorage.getItem('jalurnusa_active');activeRoute=routes.find(r=>r.id===activeId)||null;
  const mapId=localStorage.getItem('jalurnusa_map_package');activeMapPackage=mapPackages.find(p=>p.id===mapId)||null;
  const prov=[...new Set(mountains.map(m=>m.province))].sort();$('#provinceFilter').innerHTML='<option value="">Semua wilayah</option>'+prov.map(p=>`<option>${esc(p)}</option>`).join('');
  loadSettings();renderAll();updateNetwork();renderMap();updateStorage();renderPlan();
}
function renderAll(){renderMountains();renderSaved();renderTripPlans();renderMapPackages();renderRecordings();updateHomeCounts();renderPlan()}
function updateHomeCounts(){$('#homeRouteCount').textContent=routes.length;$('#homeMapCount').textContent=mapPackages.length;$('#homeTripCount').textContent=tripPlans.length;$('#homeTrackCount').textContent=recordings.length}

function renderMountains(){
  const q=$('#searchInput').value.trim().toLowerCase(),p=$('#provinceFilter').value;
  const arr=mountains.filter(m=>(!q||`${m.name} ${m.province}`.toLowerCase().includes(q))&&(!p||m.province===p));
  $('#mountainList').innerHTML=arr.length?arr.map(m=>{const rs=routes.filter(r=>r.mountainId===m.id),rc=rs.length,mc=mapPackages.filter(x=>x.mountainId===m.id).length,tc=tripPlans.filter(t=>rs.some(r=>r.id===t.routeId)).length;return `<article class="card"><div><h4>${esc(m.name)}</h4><div class="meta"><span class="tag">${Number(m.elevation).toLocaleString('id-ID')} mdpl</span><span class="tag">${esc(m.province)}</span><span class="tag">${esc(m.difficulty)}</span></div><div class="status-line">${rc?`✓ ${rc} rute`: 'Belum ada rute'} • ${mc?`✓ ${mc} paket peta`:'belum ada peta offline'}${tc?` • ✓ ${tc} rencana`:''}</div></div><div class="actions"><button class="mini" data-map="${m.id}">Buka</button>${rc?`<button class="mini secondary" data-plan-mountain="${m.id}">Rencana</button>`:''}<button class="mini secondary" data-import="${m.id}">Rute</button><button class="mini secondary" data-pm="${m.id}">Peta</button></div></article>`}).join(''):'<div class="empty">Gunung tidak ditemukan.</div>';
  $$('[data-map]').forEach(b=>b.onclick=()=>openMountain(b.dataset.map));
  $$('[data-plan-mountain]').forEach(b=>b.onclick=()=>{const r=routes.find(x=>x.mountainId===b.dataset.planMountain);if(r){activateRoute(r);setView('planView')}});
  $$('[data-import]').forEach(b=>b.onclick=()=>{$('#fileInput').dataset.mountainId=b.dataset.import;$('#fileInput').click()});
  $$('[data-pm]').forEach(b=>b.onclick=()=>{$('#pmtilesInput').dataset.mountainId=b.dataset.pm;$('#pmtilesInput').click()});
}
function renderSaved(){
  $('#savedRoutes').innerHTML=routes.length?routes.map(r=>`<article class="card"><div><h4>${esc(r.name)}</h4><div class="meta"><span class="tag">${distance(r.coords).toFixed(1)} km</span><span class="tag">${r.coords.length} titik</span><span class="tag">${r.waypoints?.length||0} waypoint</span>${r.mountainName?`<span class="tag">${esc(r.mountainName)}</span>`:''}</div><div class="status-line">${dateTimeID(r.savedAt)}${r.sourceFile?` • ${esc(r.sourceFile)}`:''}</div></div><div class="actions"><button class="mini" data-open="${r.id}">Buka</button><button class="mini secondary" data-pack="${r.id}">Paket</button><button class="mini secondary" data-del="${r.id}">Hapus</button></div></article>`).join(''):'<div class="empty">Belum ada rute. Impor GPX atau GeoJSON dari sumber yang Anda percaya.</div>';
  $$('[data-open]').forEach(b=>b.onclick=()=>activateRoute(routes.find(r=>r.id===b.dataset.open)));
  $$('[data-pack]').forEach(b=>b.onclick=()=>exportRoutePackage(routes.find(r=>r.id===b.dataset.pack)));
  $$('[data-del]').forEach(b=>b.onclick=()=>removeRoute(b.dataset.del));
}
function renderTripPlans(){
  $('#tripPlanList').innerHTML=tripPlans.length?tripPlans.slice().sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).map(t=>{const r=routes.find(x=>x.id===t.routeId),done=(t.checklist||[]).filter(x=>x.done).length,total=(t.checklist||[]).length;return `<article class="card"><div><h4>${esc(t.tripName||t.routeName||'Rencana pendakian')}</h4><div class="meta">${t.date?`<span class="tag">${esc(t.date)}</span>`:''}<span class="tag">${t.party||1} orang</span><span class="tag">${done}/${total} checklist</span>${r?.mountainName?`<span class="tag">${esc(r.mountainName)}</span>`:''}</div><div class="status-line">${r?esc(r.name):'Rute terkait tidak ditemukan'}${t.updatedAt?` • ${dateTimeID(t.updatedAt)}`:''}</div></div><div class="actions">${r?`<button class="mini" data-trip-open="${t.id}">Buka</button>`:''}<button class="mini secondary" data-trip-del="${t.id}">Hapus</button></div></article>`}).join(''):'<div class="empty">Belum ada rencana pendakian tersimpan.</div>';
  $$('[data-trip-open]').forEach(b=>b.onclick=()=>{const t=tripPlans.find(x=>x.id===b.dataset.tripOpen),r=routes.find(x=>x.id===t?.routeId);if(!t||!r)return;activeTrip=t;activateRoute(r);setView('planView')});
  $$('[data-trip-del]').forEach(b=>b.onclick=()=>removeTripPlan(b.dataset.tripDel));
}
async function removeTripPlan(id){await dbDelete(STORES.trips,id);tripPlans=tripPlans.filter(t=>t.id!==id);if(activeTrip?.id===id)activeTrip=activeRoute?getPlan(activeRoute):null;renderTripPlans();updateHomeCounts();renderMountains();renderPlan();toast('Rencana dihapus')}

function renderMapPackages(){
  $('#mapPackageList').innerHTML=mapPackages.length?mapPackages.map(p=>{const active=p.id===activeMapPackage?.id,h=p.header||{};return `<article class="card map-package-card"><div><h4>${active?'<span class="active-dot"></span>':''}${esc(p.name||p.fileName)}</h4><div class="meta"><span class="tag">${fmtBytes(p.size)}</span><span class="tag">z${h.minZoom??'?'}–${h.maxZoom??'?'}</span><span class="tag">${esc(p.tileLabel||'Raster')}</span>${p.mountainName?`<span class="tag">${esc(p.mountainName)}</span>`:''}</div><div class="status-line">${active?'AKTIF • ':''}${dateTimeID(p.importedAt)}</div></div><div class="actions"><button class="mini" data-pm-open="${p.id}">${active?'Peta':'Aktifkan'}</button><button class="mini secondary" data-pm-del="${p.id}">Hapus</button></div></article>`}).join(''):'<div class="empty">Belum ada paket peta. Impor PMTiles raster untuk menggunakan peta dasar tanpa internet.</div>';
  $$('[data-pm-open]').forEach(b=>b.onclick=()=>activateMapPackage(mapPackages.find(p=>p.id===b.dataset.pmOpen),true));
  $$('[data-pm-del]').forEach(b=>b.onclick=()=>removeMapPackage(b.dataset.pmDel));
}
function renderRecordings(){
  $('#recordingList').innerHTML=recordings.length?recordings.slice().sort((a,b)=>String(b.startAt).localeCompare(String(a.startAt))).map(r=>`<article class="card"><div><h4>${esc(r.name||'Rekaman perjalanan')}</h4><div class="meta"><span class="tag">${distance(r.coords||[]).toFixed(2)} km</span><span class="tag">${r.coords?.length||0} titik</span><span class="tag">${fmtDuration(new Date(r.endAt||r.lastAt||r.startAt)-new Date(r.startAt))}</span></div><div class="status-line">${dateTimeID(r.startAt)}${r.recovered?' • dipulihkan setelah aplikasi tertutup':''}</div></div><div class="actions"><button class="mini" data-rec-open="${r.id}">Buka</button><button class="mini secondary" data-rec-export="${r.id}">GPX</button><button class="mini secondary" data-rec-del="${r.id}">Hapus</button></div></article>`).join(''):'<div class="empty">Belum ada rekaman perjalanan.</div>';
  $$('[data-rec-open]').forEach(b=>b.onclick=()=>activateRecording(recordings.find(r=>r.id===b.dataset.recOpen)));
  $$('[data-rec-export]').forEach(b=>b.onclick=()=>exportRecording(recordings.find(r=>r.id===b.dataset.recExport)));
  $$('[data-rec-del]').forEach(b=>b.onclick=()=>removeRecording(b.dataset.recDel));
}
function setView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));if(id==='mapView')setTimeout(renderMap,30);if(id==='planView')renderPlan();if(id==='savedView'){renderSaved();renderTripPlans();renderMapPackages();renderRecordings();updateStorage()}}

async function removeRoute(id){await dbDelete(STORES.routes,id);const linked=tripPlans.filter(t=>t.routeId===id);for(const t of linked)await dbDelete(STORES.trips,t.id).catch(()=>{});tripPlans=tripPlans.filter(t=>t.routeId!==id);routes=routes.filter(r=>r.id!==id);if(activeRoute?.id===id){activeRoute=null;activeTrip=null;localStorage.removeItem('jalurnusa_active')}renderAll();renderMap();toast(linked.length?'Rute dan rencana terkait dihapus':'Rute dihapus')}
async function removeMapPackage(id){await dbDelete(STORES.maps,id);mapPackages=mapPackages.filter(p=>p.id!==id);readerCache.delete(id);if(activeMapPackage?.id===id){activeMapPackage=null;localStorage.removeItem('jalurnusa_map_package')}renderAll();renderMap();updateStorage();toast('Paket peta dihapus')}
async function removeRecording(id){await dbDelete(STORES.recordings,id);recordings=recordings.filter(r=>r.id!==id);renderRecordings();updateHomeCounts();toast('Rekaman dihapus')}
function activateRoute(r){if(!r)return;activeRoute=r;localStorage.setItem('jalurnusa_active',r.id);activeTrip=tripPlans.find(t=>t.routeId===r.id)||null;const pkg=mapPackages.find(p=>p.mountainId&&p.mountainId===r.mountainId);if(pkg&&(!activeMapPackage||activeMapPackage.mountainId!==r.mountainId))activateMapPackage(pkg,false);fitActiveRoute();renderPlan();setView('mapView');toast('Rute dibuka offline')}
function activateRecording(rec){if(!rec?.coords?.length)return;activeRoute={id:`recording:${rec.id}`,name:`Rekaman: ${rec.name}`,coords:rec.coords.map(c=>[c[0],c[1],c[2]]),waypoints:[],sourceType:'recording'};activeTrip=null;localStorage.removeItem('jalurnusa_active');fitActiveRoute();renderPlan();setView('mapView');toast('Rekaman dibuka sebagai rute')}
function openMountain(id){
  const pkg=mapPackages.find(x=>x.mountainId===id);if(pkg)activateMapPackage(pkg,false);
  const r=routes.find(x=>x.mountainId===id);if(r)return activateRoute(r);
  const m=mountains.find(x=>x.id===id);if(!m)return;activeRoute=null;localStorage.removeItem('jalurnusa_active');mapState.center=[m.lat,m.lng];mapState.zoom=pkg?packageZoom(pkg.header):12;setView('mapView');$('#activeRouteName').textContent=m.name+' — belum ada rute';renderMap();toast(pkg?'Peta offline tersedia; impor rute terverifikasi':'Impor rute dan/atau paket peta untuk gunung ini')
}

function waypointFromPoint(c,props={}){if(!Array.isArray(c))return null;const lng=Number(c[0]),lat=Number(c[1]),ele=c[2]==null?null:Number(c[2]);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;return{lat,lng,ele:Number.isFinite(ele)?ele:null,name:props.name||props.title||props.label||'Waypoint',desc:props.desc||props.description||'',type:props.type||props.category||''}}
function parseGPX(text){
  const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('GPX tidak valid');
  const readPts=nodes=>[...nodes].map(p=>[+p.getAttribute('lat'),+p.getAttribute('lon'),p.querySelector('ele')?+p.querySelector('ele').textContent:null]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const segments=[];[...d.querySelectorAll('trkseg')].forEach(seg=>{const c=readPts(seg.querySelectorAll('trkpt'));if(c.length>=2)segments.push(c)});[...d.querySelectorAll('rte')].forEach(rte=>{const c=readPts(rte.querySelectorAll('rtept'));if(c.length>=2)segments.push(c)});
  const waypoints=[...d.querySelectorAll('wpt')].map(p=>({lat:+p.getAttribute('lat'),lng:+p.getAttribute('lon'),ele:p.querySelector('ele')?+p.querySelector('ele').textContent:null,name:p.querySelector('name')?.textContent?.trim()||'Waypoint',desc:p.querySelector('desc')?.textContent?.trim()||'',type:p.querySelector('type')?.textContent?.trim()||''})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  let coords=segments.sort((a,b)=>distance(b)-distance(a))[0]||[];if(coords.length<2&&waypoints.length>=2)coords=waypoints.map(w=>[w.lat,w.lng,w.ele]);
  return{name:d.querySelector('trk > name,rte > name,metadata > name')?.textContent?.trim()||'Rute GPX',coords,waypoints};
}
function parseGeoJSON(text){
  let j;try{j=JSON.parse(text)}catch{throw Error('GeoJSON tidak valid / JSON rusak')}
  const lines=[],waypoints=[],orderedPoints=[];
  const addLine=c=>{if(Array.isArray(c)&&c.length>=2)lines.push(c)};
  const walk=(obj,props={})=>{
    if(!obj||typeof obj!=='object')return;
    if(obj.type==='FeatureCollection'){(obj.features||[]).forEach(f=>walk(f,{}));return}
    if(obj.type==='Feature'){walk(obj.geometry,obj.properties||{});return}
    if(obj.type==='GeometryCollection'){(obj.geometries||[]).forEach(g=>walk(g,props));return}
    if(obj.type==='LineString'){addLine(obj.coordinates);return}
    if(obj.type==='MultiLineString'){(obj.coordinates||[]).forEach(addLine);return}
    if(obj.type==='Point'){const w=waypointFromPoint(obj.coordinates,props);if(w){waypoints.push(w);orderedPoints.push(obj.coordinates)}return}
    if(obj.type==='MultiPoint'){(obj.coordinates||[]).forEach((c,i)=>{const w=waypointFromPoint(c,{...props,name:props.name?`${props.name} ${i+1}`:undefined});if(w){waypoints.push(w);orderedPoints.push(c)}});return}
  };
  walk(j);
  if(!lines.length&&orderedPoints.length>=2)addLine(orderedPoints);
  if(!lines.length)throw Error('GeoJSON tidak berisi jalur. Gunakan LineString/MultiLineString, atau minimal 2 Point berurutan.');
  const validLine=c=>c.map(x=>[Number(x?.[1]),Number(x?.[0]),x?.[2]==null?null:Number(x[2])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const candidates=lines.map(validLine).filter(c=>c.length>=2);if(!candidates.length)throw Error('Koordinat GeoJSON tidak valid. Format harus [longitude, latitude].');
  const coords=candidates.sort((a,b)=>distance(b)-distance(a))[0];
  const props=j.type==='Feature'?j.properties:(j.type==='FeatureCollection'?(j.features||[]).find(f=>f?.properties?.name||f?.properties?.title)?.properties:null);
  return{name:props?.name||props?.title||'Rute GeoJSON',coords,waypoints};
}
async function importRoute(file,mountainId=''){
  const text=await file.text();let d=parseJalurNusaPackage(text);if(!d)d=file.name.toLowerCase().endsWith('.gpx')?parseGPX(text):parseGeoJSON(text);if(d.coords.length<2)throw Error('Rute tidak memiliki cukup titik');
  const requested=mountains.find(x=>x.id===mountainId),fromPackage=mountains.find(x=>x.id===d.mountainId),m=requested||fromPackage;const r={id:uid(),name:d.name||file.name,mountainId:m?.id||d.mountainId||'',mountainName:m?.name||d.mountainName||'',coords:d.coords,waypoints:(d.waypoints||[]).map((w,i)=>({...w,id:w.id||uid(),type:wpKind(w)})),guide:d.guide||{},savedAt:new Date().toISOString(),sourceFile:file.name,packageVersion:d.packageVersion||null};
  await dbPut(STORES.routes,r);routes.unshift(r);
  if(d.trip){const t={...d.trip,id:uid(),routeId:r.id,routeName:r.name,importedAt:new Date().toISOString()};delete t.isDraft;await dbPut(STORES.trips,t);tripPlans.unshift(t);activeTrip=t}
  renderAll();activateRoute(r);return r;
}

function inferMountain(header){const inside=mountains.filter(m=>m.lng>=header.minLon&&m.lng<=header.maxLon&&m.lat>=header.minLat&&m.lat<=header.maxLat);if(!inside.length)return null;const c=[header.centerLat,header.centerLon];return inside.sort((a,b)=>hav(c,[a.lat,a.lng])-hav(c,[b.lat,b.lng]))[0]}
function tileTypeLabel(t){return({2:'PNG',3:'JPEG',4:'WebP',5:'AVIF'})[t]||'Tidak didukung'}
async function importPmtiles(file,mountainId=''){
  if(!window.PMTilesLite)throw Error('Pembaca PMTiles tidak tersedia');
  const reader=new PMTilesLite.Reader(file),summary=await reader.summary(),h=summary.header;
  if(!summary.raster)throw Error('V3 saat ini mendukung PMTiles raster (PNG/JPEG/WebP/AVIF), bukan vector MVT.');
  if(!summary.mime)throw Error('Format gambar di dalam PMTiles belum didukung.');
  if(![0,1,2].includes(h.internalCompression)||![0,1,2].includes(h.tileCompression))throw Error('Gunakan PMTiles dengan kompresi none/gzip untuk kompatibilitas browser V3.');
  let m=mountains.find(x=>x.id===mountainId);if(!m)m=inferMountain(h);
  const pkg={id:uid(),name:summary.name||file.name.replace(/\.pmtiles$/i,''),fileName:file.name,size:file.size,blob:file,importedAt:new Date().toISOString(),mountainId:m?.id||'',mountainName:m?.name||'',header:h,attribution:summary.attribution||'',tileLabel:tileTypeLabel(h.tileType)};
  try{await dbPut(STORES.maps,pkg)}catch(e){throw Error('Gagal menyimpan paket peta. Ruang penyimpanan perangkat mungkin tidak cukup.')}
  mapPackages.unshift(pkg);readerCache.set(pkg.id,reader);activateMapPackage(pkg,false);renderAll();updateStorage();setView('mapView');toast(`Paket peta ${pkg.tileLabel} tersimpan offline`);return pkg;
}
function packageZoom(h={}){const lo=Math.max(2,h.minZoom??2),hi=Math.max(lo,h.maxZoom??17);return clamp(h.centerZoom??12,lo,hi)}
function activateMapPackage(pkg,openMap=false){if(!pkg)return;activeMapPackage=pkg;localStorage.setItem('jalurnusa_map_package',pkg.id);const h=pkg.header||{};if(Number.isFinite(h.centerLat)&&Number.isFinite(h.centerLon))mapState.center=[h.centerLat,h.centerLon];mapState.zoom=packageZoom(h);mapState.onlineTiles=false;$('#onlineTilesBtn').textContent='Peta online: MATI';renderMapPackages();renderMap();if(openMap)setView('mapView')}
function packageReader(pkg){if(!pkg?.blob)return null;if(!readerCache.has(pkg.id))readerCache.set(pkg.id,new PMTilesLite.Reader(pkg.blob));return readerCache.get(pkg.id)}

function project(lat,lng,z){const n=2**z,x=(lng+180)/360*n*TILE,rad=clamp(lat,-85.05112878,85.05112878)*Math.PI/180,y=(1-Math.asinh(Math.tan(rad))/Math.PI)/2*n*TILE;return[x,y]}
function unproject(x,y,z){const n=2**z,lng=x/(n*TILE)*360-180,yy=Math.PI*(1-2*y/(n*TILE)),lat=Math.atan(Math.sinh(yy))*180/Math.PI;return[lat,lng]}
function viewport(){const el=$('#mapStage'),w=el.clientWidth,h=el.clientHeight,[cx,cy]=project(mapState.center[0],mapState.center[1],mapState.zoom);return{w,h,cx,cy,left:cx-w/2,top:cy-h/2}}
function revokeTiles(){tileObjectUrls.forEach(u=>URL.revokeObjectURL(u));tileObjectUrls=[]}
function renderMap(){const st=$('#mapStage');if(!st.clientWidth)return;renderTiles();renderRoute();updateRoutePanel()}
async function renderTiles(){
  const seq=++mapRenderSeq,layer=$('#tileLayer');revokeTiles();layer.innerHTML='';
  if(mapState.onlineTiles&&navigator.onLine){renderOnlineTiles(seq);return}
  if(activeMapPackage){const drew=await renderOfflineTiles(activeMapPackage,seq).catch(e=>{if(seq===mapRenderSeq){$('#mapAttrib').textContent='Paket PMTiles gagal dibaca';toast(e.message)}});if(drew||seq!==mapRenderSeq)return}
  if(seq===mapRenderSeq){$('#mapAttrib').textContent='Peta rute offline • tanpa peta dasar';$('#mapModePill').textContent='RUTE OFFLINE'}
}
function renderOnlineTiles(seq){
  if(seq!==mapRenderSeq)return;const layer=$('#tileLayer'),v=viewport(),z=mapState.zoom,n=2**z,x0=Math.floor(v.left/TILE),x1=Math.floor((v.left+v.w)/TILE),y0=Math.floor(v.top/TILE),y1=Math.floor((v.top+v.h)/TILE);
  for(let y=y0;y<=y1;y++){if(y<0||y>=n)continue;for(let x=x0;x<=x1;x++){const xx=((x%n)+n)%n,img=new Image();img.className='map-tile';img.alt='';img.referrerPolicy='origin';img.src=`https://tile.openstreetmap.org/${z}/${xx}/${y}.png`;img.style.left=(x*TILE-v.left)+'px';img.style.top=(y*TILE-v.top)+'px';layer.appendChild(img)}}
  $('#mapAttrib').textContent='© OpenStreetMap contributors';$('#mapModePill').textContent='PETA ONLINE';
}
async function renderOfflineTiles(pkg,seq){
  const layer=$('#tileLayer'),h=pkg.header,reader=packageReader(pkg);if(!reader)return false;
  const zMap=mapState.zoom;if(zMap<h.minZoom){if(seq===mapRenderSeq){$('#mapAttrib').textContent=`${pkg.name} • perbesar ke z${h.minZoom}+`;$('#mapModePill').textContent='PMTILES OFFLINE'}return false}
  const zSrc=Math.min(zMap,h.maxZoom),scale=2**(zMap-zSrc),[cx,cy]=project(mapState.center[0],mapState.center[1],zSrc),w=$('#mapStage').clientWidth,hv=$('#mapStage').clientHeight;
  const srcW=w/scale,srcH=hv/scale,left=cx-srcW/2,top=cy-srcH/2,x0=Math.floor(left/TILE),x1=Math.floor((left+srcW)/TILE),y0=Math.floor(top/TILE),y1=Math.floor((top+srcH)/TILE),n=2**zSrc;
  const jobs=[];for(let y=y0;y<=y1;y++){if(y<0||y>=n)continue;for(let x=x0;x<=x1;x++){if(x<0||x>=n)continue;jobs.push({x,y})}}
  if(jobs.length>64){if(seq===mapRenderSeq)$('#mapAttrib').textContent='Paket offline: perbesar peta';return false}
  let count=0;await Promise.all(jobs.map(async t=>{const data=await reader.getZxy(zSrc,t.x,t.y);if(!data||seq!==mapRenderSeq)return;const url=URL.createObjectURL(new Blob([data],{type:PMTilesLite.tileMime(h.tileType)}));if(seq!==mapRenderSeq){URL.revokeObjectURL(url);return}tileObjectUrls.push(url);const img=new Image();img.className='map-tile offline-tile';img.alt='';img.src=url;const size=TILE*scale;img.style.width=size+'px';img.style.height=size+'px';img.style.left=((t.x*TILE-left)*scale)+'px';img.style.top=((t.y*TILE-top)*scale)+'px';layer.appendChild(img);count++}));
  if(seq!==mapRenderSeq)return false;$('#mapAttrib').textContent=(pkg.attribution?pkg.attribution+' • ':'')+`${pkg.name} • PMTiles offline`;$('#mapModePill').textContent='PMTILES OFFLINE';return count>0;
}
function markerCircle(x,y,r,fill,stroke='#fff'){return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${r+6}" fill="none" stroke="${fill}" stroke-opacity=".25" stroke-width="5"/>`}
function renderRoute(){
  const v=viewport(),line=$('#routeLine'),recLine=$('#recordingLine'),marks=$('#mapMarkers'),wps=$('#waypointMarkers');let pts='';marks.innerHTML='';wps.innerHTML='';
  if(activeRoute?.coords?.length){pts=activeRoute.coords.map(c=>{const [x,y]=project(c[0],c[1],mapState.zoom);return `${(x-v.left).toFixed(1)},${(y-v.top).toFixed(1)}`}).join(' ');const a=activeRoute.coords[0],b=activeRoute.coords.at(-1),p1=project(a[0],a[1],mapState.zoom),p2=project(b[0],b[1],mapState.zoom);marks.innerHTML=markerCircle(p1[0]-v.left,p1[1]-v.top,6,'#6ec28f')+markerCircle(p2[0]-v.left,p2[1]-v.top,6,'#f18475');
    const way=(activeRoute.waypoints||[]).slice(0,80);wps.innerHTML=way.map((w,i)=>{const p=project(w.lat,w.lng,mapState.zoom),x=p[0]-v.left,y=p[1]-v.top,kind=wpKind(w),fill=({water:'#4aa3ff',hazard:'#f18475',summit:'#f0b84b',basecamp:'#6ec28f',camp:'#b79cff',pos:'#f0b84b',custom:'#d6dcd8'})[kind]||'#f0b84b';return `<g><circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="#07110c" stroke-width="2"><title>${esc(w.name||'Waypoint')} • ${esc(kind)}</title></circle><text x="${x+8}" y="${y-8}" class="waypoint-label">${i+1}</text></g>`}).join('');
  }
  line.setAttribute('points',pts);
  if(currentRecording?.coords?.length){recLine.setAttribute('points',currentRecording.coords.map(c=>{const [x,y]=project(c[0],c[1],mapState.zoom);return `${(x-v.left).toFixed(1)},${(y-v.top).toFixed(1)}`}).join(' '))}else recLine.setAttribute('points','');
  renderGpsMarker();
}
function renderGpsMarker(){const g=$('#gpsMarker');if(!gpsPosition){g.innerHTML='';return}const v=viewport(),p=project(gpsPosition[0],gpsPosition[1],mapState.zoom);g.innerHTML=markerCircle(p[0]-v.left,p[1]-v.top,7,'#4aa3ff')}
function updateRoutePanel(){
  if(activeRoute?.coords?.length){$('#activeRouteName').textContent=activeRoute.name;$('#statDistance').textContent=distance(activeRoute.coords).toFixed(1)+' km';const g=gain(activeRoute.coords);$('#statElevation').textContent=g?Math.round(g)+' m':'—';$('#statWaypoints').textContent=activeRoute.waypoints?.length||0;renderElevationProfile(activeRoute.coords);updateOffRoute();updateLiveProgress()}else{if(!$('#activeRouteName').textContent.includes('belum ada rute'))$('#activeRouteName').textContent='Belum ada rute';$('#statDistance').textContent='—';$('#statElevation').textContent='—';$('#statWaypoints').textContent='—';$('#statOffRoute').textContent='—';$('#elevationCard').classList.add('hidden');$('#routeProgressCard').classList.add('hidden');$('#offRouteStat').classList.remove('danger-stat')}
  const active=!!currentRecording?.active;$('#recordingStrip').classList.toggle('hidden',!active);if(active)$('#recordingMapStats').textContent=`${distance(currentRecording.coords).toFixed(2)} km • ${currentRecording.coords.length} titik`;
}
function renderElevationProfile(coords){
  const finite=coords.map((c,i)=>({i,e:Number(c[2])})).filter(x=>Number.isFinite(x.e));if(finite.length<2){$('#elevationCard').classList.add('hidden');return}
  const cum=[0];for(let i=1;i<coords.length;i++)cum[i]=cum[i-1]+hav(coords[i-1],coords[i]);const total=cum.at(-1)||1,vals=finite.map(x=>x.e),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  const points=finite.map(x=>`${(cum[x.i]/total*316+2).toFixed(1)},${(60-(x.e-min)/span*54).toFixed(1)}`).join(' ');$('#elevationLine').setAttribute('points',points);$('#elevationRange').textContent=`${Math.round(min)}–${Math.round(max)} m`;$('#elevationCard').classList.remove('hidden');
}
function fitActiveRoute(){if(!activeRoute?.coords?.length)return;const lats=activeRoute.coords.map(c=>c[0]),lngs=activeRoute.coords.map(c=>c[1]),minLat=Math.min(...lats),maxLat=Math.max(...lats),minLng=Math.min(...lngs),maxLng=Math.max(...lngs);mapState.center=[(minLat+maxLat)/2,(minLng+maxLng)/2];const el=$('#mapStage'),pad=70;for(let z=17;z>=2;z--){const a=project(maxLat,minLng,z),b=project(minLat,maxLng,z);if(Math.abs(b[0]-a[0])<el.clientWidth-pad*2&&Math.abs(b[1]-a[1])<el.clientHeight-300){mapState.zoom=z;break}}renderMap()}
function zoom(delta){const old=mapState.zoom;mapState.zoom=clamp(mapState.zoom+delta,2,19);if(old!==mapState.zoom)renderMap()}
function movePixels(dx,dy){const [cx,cy]=project(mapState.center[0],mapState.center[1],mapState.zoom),ll=unproject(cx-dx,cy-dy,mapState.zoom);mapState.center=ll;renderMap()}

function startGpsWatch(){
  if(gpsWatch!==null)return true;if(!navigator.geolocation){toast('GPS tidak didukung perangkat ini');return false}
  gpsWatch=navigator.geolocation.watchPosition(handleGpsPosition,e=>toast('GPS gagal: '+e.message),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});$('#startGpsBtn').textContent='Hentikan GPS';$('#gpsStatus').textContent='AKTIF';return true;
}
function toggleGps(){if(gpsWatch===null){startGpsWatch();return}if(currentRecording?.active)return toast('Hentikan tracking sebelum mematikan GPS');navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;$('#startGpsBtn').textContent='Mulai GPS';$('#gpsStatus').textContent='NONAKTIF';toast('GPS dihentikan')}
function handleGpsPosition(p){
  const c=p.coords;gpsPosition=[c.latitude,c.longitude];gpsFix={lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,altitude:c.altitude,heading:c.heading,speed:c.speed,time:p.timestamp||Date.now()};
  $('#gpsReadout').textContent=`${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} • akurasi ±${Math.round(c.accuracy)} m${c.altitude!=null?` • alt ${Math.round(c.altitude)} m`:''}`;$('#emergencyLocation').textContent=`${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} • ±${Math.round(c.accuracy)} m`;
  if(currentRecording?.active)appendRecordingFix(gpsFix);updateOffRoute();updateLiveProgress();renderGpsMarker();
}
function centerGps(){if(!gpsPosition){startGpsWatch();return toast('Menunggu lokasi GPS…')}mapState.center=gpsPosition;mapState.zoom=Math.max(14,mapState.zoom);renderMap()}
function headingName(h){return['Utara','Timur Laut','Timur','Tenggara','Selatan','Barat Daya','Barat','Barat Laut'][Math.round(h/45)%8]}
async function startCompass(){
  if(compassHandler){window.removeEventListener('deviceorientation',compassHandler,true);compassHandler=null;$('#startCompassBtn').textContent='Aktifkan kompas';toast('Kompas dihentikan');return}
  compassHandler=e=>{const h=e.webkitCompassHeading??(e.alpha!=null?360-e.alpha:null);if(h!=null){const d=(h+360)%360;$('#compassReadout').textContent=`${Math.round(d)}° • ${headingName(d)}`;$('#compassDegrees').textContent=`${Math.round(d)}°`;$('#compassNeedle').style.transform=`rotate(${d}deg)`}};
  try{if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){if(await DeviceOrientationEvent.requestPermission()!=='granted')throw Error()}window.addEventListener('deviceorientation',compassHandler,true);$('#startCompassBtn').textContent='Matikan kompas';toast('Kompas aktif')}catch{compassHandler=null;toast('Kompas tidak dapat diaktifkan')}
}

function startRecording(){
  if(currentRecording?.active)return stopRecording();if(!startGpsWatch())return;
  const now=new Date(),name=`Pendakian ${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;currentRecording={id:uid(),name,coords:[],startAt:now.toISOString(),lastAt:now.toISOString(),active:true};if(gpsFix)appendRecordingFix(gpsFix,true);$('#recordTrackBtn').textContent='Hentikan tracking';$('#exportCurrentTrackBtn').disabled=false;$('#trackHint').textContent='Jejak disimpan lokal secara berkala.';clearInterval(recordTimer);recordTimer=setInterval(updateRecordingUI,1000);updateRecordingUI();renderMap();toast('Tracking dimulai')
}
async function stopRecording(){
  if(!currentRecording?.active)return;currentRecording.active=false;currentRecording.endAt=new Date().toISOString();currentRecording.lastAt=currentRecording.endAt;clearInterval(recordTimer);recordTimer=null;await dbPut(STORES.recordings,currentRecording);recordings=recordings.filter(r=>r.id!==currentRecording.id);recordings.unshift({...currentRecording});$('#recordTrackBtn').textContent='Mulai tracking';$('#trackHint').textContent='Rekaman tersimpan. Anda dapat mengekspor GPX.';renderRecordings();updateHomeCounts();updateRecordingUI();renderMap();toast('Tracking disimpan offline')
}
function appendRecordingFix(fix,force=false){
  if(!currentRecording?.active)return;if(!force&&Number(fix.accuracy)>100)return;const p=[fix.lat,fix.lng,Number.isFinite(fix.altitude)?fix.altitude:null,new Date(fix.time||Date.now()).toISOString(),fix.accuracy];const last=currentRecording.coords.at(-1);if(!force&&last&&hav(last,p)<0.003)return;currentRecording.coords.push(p);currentRecording.lastAt=p[3];if(currentRecording.coords.length%5===0)dbPut(STORES.recordings,currentRecording).catch(()=>{});updateRecordingUI();renderRoute();
}
function updateRecordingUI(){const r=currentRecording;if(!r){$('#trackDistance').textContent='0.00 km';$('#trackDuration').textContent='00:00:00';$('#trackPoints').textContent='0 titik';return}$('#trackDistance').textContent=distance(r.coords).toFixed(2)+' km';$('#trackDuration').textContent=fmtDuration((r.active?Date.now():new Date(r.endAt||r.lastAt))-new Date(r.startAt));$('#trackPoints').textContent=`${r.coords.length} titik`;updateRoutePanel()}
function recordingToGPX(r){const pts=(r.coords||[]).map(c=>`      <trkpt lat="${c[0]}" lon="${c[1]}">${Number.isFinite(Number(c[2]))?`<ele>${Number(c[2]).toFixed(1)}</ele>`:''}${c[3]?`<time>${xmlEsc(c[3])}</time>`:''}</trkpt>`).join('\n');return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="JalurNusa Offline V3" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${xmlEsc(r.name||'Rekaman JalurNusa')}</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>`}
function safeFileName(s){return String(s||'jalurnusa-track').replace(/[^a-z0-9._-]+/gi,'_').replace(/^_+|_+$/g,'')}
function exportRecording(r){if(!r?.coords?.length)return toast('Belum ada titik untuk diekspor');const blob=new Blob([recordingToGPX(r)],{type:'application/gpx+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeFileName(r.name)+'.gpx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('GPX dibuat')}


const DEFAULT_CHECKLIST=[
  'Izin / registrasi pendakian sudah diverifikasi',
  'Identitas dan kontak darurat',
  'Peta/rute offline sudah diuji tanpa internet',
  'Power bank dan kabel pengisian',
  'Headlamp / senter dan baterai cadangan',
  'Air minum sesuai kebutuhan perjalanan',
  'Makanan utama dan cadangan',
  'Jas hujan / perlindungan cuaca',
  'Lapisan pakaian hangat',
  'P3K pribadi dan kelompok',
  'Peluit / alat pemberi sinyal',
  'Perlengkapan tidur/camp bila diperlukan',
  'Rencana perjalanan dibagikan ke orang tepercaya',
  'Kondisi jalur, cuaca, dan status kawasan dicek ulang'
];
function routeCum(coords=[]){const c=[0];for(let i=1;i<coords.length;i++)c[i]=c[i-1]+hav(coords[i-1],coords[i]);return c}
function routePosition(point,coords=[]){
  if(!point||coords.length<2)return null;const cum=routeCum(coords),lat0=point[0]*Math.PI/180,MX=111320*Math.cos(lat0),MY=110540;let best={distanceM:Infinity,alongKm:0,segmentIndex:0,t:0,ele:null};
  for(let i=1;i<coords.length;i++){
    const a=[(coords[i-1][1]-point[1])*MX,(coords[i-1][0]-point[0])*MY],b=[(coords[i][1]-point[1])*MX,(coords[i][0]-point[0])*MY],vx=b[0]-a[0],vy=b[1]-a[1],den=vx*vx+vy*vy;let t=den?-(a[0]*vx+a[1]*vy)/den:0;t=clamp(t,0,1);const x=a[0]+t*vx,y=a[1]+t*vy,d=Math.hypot(x,y);
    if(d<best.distanceM){const segKm=hav(coords[i-1],coords[i]),e1=Number(coords[i-1][2]),e2=Number(coords[i][2]);best={distanceM:d,alongKm:cum[i-1]+segKm*t,segmentIndex:i-1,t,ele:Number.isFinite(e1)&&Number.isFinite(e2)?e1+(e2-e1)*t:null}}
  }
  best.totalKm=cum.at(-1)||0;best.progress=best.totalKm?clamp(best.alongKm/best.totalKm,0,1):0;best.remainingKm=Math.max(0,best.totalKm-best.alongKm);return best;
}
function wpKind(w={}){const raw=`${w.type||''} ${w.name||''}`.toLowerCase();if(/water|air|minum|spring|mata air/.test(raw))return'water';if(/hazard|rawan|bahaya|jurang|longsor/.test(raw))return'hazard';if(/summit|puncak|peak/.test(raw))return'summit';if(/basecamp|base camp|registrasi/.test(raw))return'basecamp';if(/camp|kemah|shelter/.test(raw))return'camp';if(/pos|checkpoint/.test(raw))return'pos';return w.type||'custom'}
function wpIcon(w={}){return({water:'💧',hazard:'⚠',summit:'▲',basecamp:'⌂',camp:'⛺',pos:'●',custom:'◆'})[wpKind(w)]||'◆'}
function ensureWaypointIds(route){let changed=false;(route.waypoints||[]).forEach((w,i)=>{if(!w.id){w.id=`wp-${route.id}-${i}-${Math.round(w.lat*1e5)}-${Math.round(w.lng*1e5)}`;changed=true}if(!w.type){w.type=wpKind(w);changed=true}});if(changed&&routes.some(r=>r.id===route.id))dbPut(STORES.routes,route).catch(()=>{});return route.waypoints||[]}
function routeWaypoints(route){const wps=ensureWaypointIds(route).map(w=>({...w,_pos:routePosition([w.lat,w.lng],route.coords)})).filter(w=>w._pos).sort((a,b)=>a._pos.alongKm-b._pos.alongKm);return wps}
function segmentGain(coords,aIdx,bIdx){let g=0;for(let i=Math.max(1,aIdx+1);i<=Math.min(coords.length-1,bIdx+1);i++){const a=Number(coords[i-1][2]),b=Number(coords[i][2]);if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)g+=b-a}return g}
function etaHours(km,upM,pace=3){return km/Math.max(.5,Number(pace)||3)+Math.max(0,upM)/500}
function fmtEtaHours(h){if(!Number.isFinite(h))return'—';const mins=Math.max(1,Math.round(h*60));return mins<60?`${mins} mnt`:`${Math.floor(mins/60)}j ${mins%60}m`}
function getPlan(route){if(!route||String(route.id).startsWith('recording:'))return null;let t=tripPlans.find(x=>x.routeId===route.id);if(t)return t;return{id:uid(),routeId:route.id,routeName:route.name,tripName:`Pendakian ${route.mountainName||route.name}`,date:'',start:'06:00',party:1,pace:3,reached:{},checklist:DEFAULT_CHECKLIST.map((text,i)=>({id:`default-${i}`,text,done:false,custom:false})),createdAt:new Date().toISOString(),isDraft:true}}
function renderPlan(){
  const ok=activeRoute?.coords?.length&&!String(activeRoute.id).startsWith('recording:');$('#planEmpty').classList.toggle('hidden',!!ok);$('#planContent').classList.toggle('hidden',!ok);if(!ok){activeTrip=null;return}
  if(!activeTrip||activeTrip.routeId!==activeRoute.id)activeTrip=getPlan(activeRoute);ensureWaypointIds(activeRoute);
  const key=`${activeRoute.id}|${activeTrip.id}`;if($('#planContent').dataset.planKey!==key){$('#planContent').dataset.planKey=key;$('#tripName').value=activeTrip.tripName||'';$('#tripDate').value=activeTrip.date||'';$('#tripStart').value=activeTrip.start||'06:00';$('#tripParty').value=activeTrip.party||1;$('#tripPace').value=String(activeTrip.pace||3)}
  $('#planRouteName').textContent=activeRoute.name;$('#planRouteMeta').textContent=`${distance(activeRoute.coords).toFixed(1)} km • gain ${Math.round(gain(activeRoute.coords))||0} m • ${activeRoute.waypoints?.length||0} waypoint`;
  renderSegments();renderChecklist();updatePlanProgress();
}
function syncTripForm(){if(!activeTrip)return;activeTrip.tripName=$('#tripName').value.trim()||`Pendakian ${activeRoute?.name||''}`;activeTrip.date=$('#tripDate').value;activeTrip.start=$('#tripStart').value||'06:00';activeTrip.party=clamp(Number($('#tripParty').value)||1,1,99);activeTrip.pace=Number($('#tripPace').value)||3}
async function saveTrip(){if(!activeTrip||!activeRoute)return toast('Buka rute terlebih dahulu');syncTripForm();activeTrip.routeId=activeRoute.id;activeTrip.routeName=activeRoute.name;activeTrip.updatedAt=new Date().toISOString();delete activeTrip.isDraft;await dbPut(STORES.trips,activeTrip);const i=tripPlans.findIndex(t=>t.id===activeTrip.id);if(i>=0)tripPlans[i]={...activeTrip};else tripPlans.unshift({...activeTrip});updateHomeCounts();renderMountains();toast('Rencana pendakian tersimpan offline')}
function buildSegments(){if(!activeRoute)return[];const coords=activeRoute.coords,cum=routeCum(coords),wps=routeWaypoints(activeRoute),anchors=[{id:'route-start',name:'Titik mulai',type:'basecamp',_pos:{alongKm:0,segmentIndex:0,ele:Number(coords[0]?.[2])} },...wps,{id:'route-end',name:'Akhir rute',type:'summit',_pos:{alongKm:cum.at(-1)||0,segmentIndex:Math.max(0,coords.length-2),ele:Number(coords.at(-1)?.[2])}}],pace=Number($('#tripPace')?.value)||activeTrip?.pace||3,out=[];for(let i=1;i<anchors.length;i++){const a=anchors[i-1],b=anchors[i],km=Math.max(0,b._pos.alongKm-a._pos.alongKm),up=segmentGain(coords,a._pos.segmentIndex,b._pos.segmentIndex),hours=etaHours(km,up,pace);out.push({from:a,to:b,km,up,hours})}return out}
function renderSegments(){
  if(!activeRoute)return;const segs=buildSegments(),reached=activeTrip?.reached||{},start=($('#tripDate').value&&$('#tripStart').value)?new Date(`${$('#tripDate').value}T${$('#tripStart').value}:00`):null;let acc=0;
  $('#segmentList').innerHTML=segs.length?segs.map((s,i)=>{acc+=s.hours;const arr=start&&!Number.isNaN(start.getTime())?new Date(start.getTime()+acc*3600000).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):null,kind=wpKind(s.to),isReach=!!reached[s.to.id],off=s.to._pos?.distanceM>300;return `<article class="segment-card ${kind==='hazard'?'segment-alert':''} ${isReach?'segment-reached':''}"><div class="segment-head"><div class="waypoint-badge">${wpIcon(s.to)}</div><div><h4>${esc(s.to.name||`Waypoint ${i+1}`)}</h4><p>${esc(kind==='water'?'Sumber air — wajib verifikasi kondisi aktual':kind==='hazard'?'Titik rawan — gunakan catatan sumber tepercaya':s.to.desc||s.to.description||kind)}</p></div></div><div class="segment-metrics"><span>${s.km.toFixed(2)} km</span><span>+${Math.round(s.up)} m</span><span>± ${fmtEtaHours(s.hours)}${arr?` • ${arr}`:''}</span></div>${off?`<div class="status-line source-warning">Waypoint sekitar ${Math.round(s.to._pos.distanceM)} m dari garis rute.</div>`:''}${!['route-end'].includes(s.to.id)?`<button class="mini secondary reached-btn" data-reached="${esc(s.to.id)}">${isReach?'Batalkan tiba':'Tandai tiba'}</button>`:''}</article>`}).join(''):'<div class="empty">Belum ada segmen.</div>';
  $$('[data-reached]').forEach(b=>b.onclick=()=>{if(!activeTrip)return;activeTrip.reached=activeTrip.reached||{};activeTrip.reached[b.dataset.reached]=!activeTrip.reached[b.dataset.reached];renderSegments();updatePlanProgress()});
}
function updateLiveProgress(){
  const card=$('#routeProgressCard');if(!activeRoute?.coords?.length||!gpsPosition){card.classList.add('hidden');updatePlanProgress();return}const pos=routePosition(gpsPosition,activeRoute.coords);if(!pos){card.classList.add('hidden');return}card.classList.remove('hidden');const pct=Math.round(pos.progress*100);$('#routeProgressPercent').textContent=`${pct}%`;$('#routeProgressBar').style.width=`${pct}%`;const next=routeWaypoints(activeRoute).find(w=>w._pos.alongKm>pos.alongKm+.01);$('#routeProgressNext').textContent=next?`Berikut: ${next.name} • sekitar ${(next._pos.alongKm-pos.alongKm).toFixed(2)} km sepanjang rute`:`Sisa rute sekitar ${pos.remainingKm.toFixed(2)} km`;updatePlanProgress(pos)
}
function updatePlanProgress(pos=null){
  if(!activeRoute?.coords?.length||!gpsPosition){$('#planProgressPct').textContent='—';$('#planRemaining').textContent='—';$('#planNextWaypoint').textContent='Aktifkan GPS';return}pos=pos||routePosition(gpsPosition,activeRoute.coords);if(!pos)return;$('#planProgressPct').textContent=`${Math.round(pos.progress*100)}%`;$('#planRemaining').textContent=`${pos.remainingKm.toFixed(2)} km`;const next=routeWaypoints(activeRoute).find(w=>w._pos.alongKm>pos.alongKm+.01);$('#planNextWaypoint').textContent=next?`${wpIcon(next)} ${next.name} • ${(next._pos.alongKm-pos.alongKm).toFixed(2)} km`:'Akhir rute';
}
function renderChecklist(){if(!activeTrip)return;if(!Array.isArray(activeTrip.checklist)||!activeTrip.checklist.length)activeTrip.checklist=DEFAULT_CHECKLIST.map((text,i)=>({id:`default-${i}`,text,done:false,custom:false}));const c=activeTrip.checklist,done=c.filter(x=>x.done).length;$('#checklistProgress').textContent=`${done} / ${c.length} selesai`;$('#checklistList').innerHTML=c.map(x=>`<label class="check-item ${x.done?'checked':''}"><input type="checkbox" data-check="${esc(x.id)}" ${x.done?'checked':''}><span>${esc(x.text)}</span>${x.custom?`<button type="button" data-check-del="${esc(x.id)}" aria-label="Hapus">×</button>`:''}</label>`).join('');$$('[data-check]').forEach(e=>e.onchange=()=>{const x=c.find(y=>y.id===e.dataset.check);if(x)x.done=e.checked;renderChecklist()});$$('[data-check-del]').forEach(b=>b.onclick=e=>{e.preventDefault();activeTrip.checklist=c.filter(x=>x.id!==b.dataset.checkDel);renderChecklist()})}
function addChecklistItem(){if(!activeTrip)return;const el=$('#customCheckInput'),text=el.value.trim();if(!text)return;activeTrip.checklist.push({id:uid(),text,done:false,custom:true});el.value='';renderChecklist()}
function resetChecklist(){if(!activeTrip)return;activeTrip.checklist=DEFAULT_CHECKLIST.map((text,i)=>({id:`default-${i}`,text,done:false,custom:false}));renderChecklist();toast('Checklist direset')}
async function addWaypoint(){
  if(!activeRoute||!routes.some(r=>r.id===activeRoute.id))return toast('Waypoint hanya dapat ditambahkan ke rute tersimpan');const name=$('#wpName').value.trim()||'Waypoint',lat=Number($('#wpLat').value),lng=Number($('#wpLng').value);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return toast('Koordinat waypoint tidak valid');const w={id:uid(),name,type:$('#wpType').value||'custom',desc:$('#wpDesc').value.trim(),lat,lng,ele:null,source:'user',createdAt:new Date().toISOString()};activeRoute.waypoints=activeRoute.waypoints||[];activeRoute.waypoints.push(w);await dbPut(STORES.routes,activeRoute);$('#wpName').value='';$('#wpDesc').value='';$('#wpLat').value='';$('#wpLng').value='';renderPlan();renderMap();const pos=routePosition([lat,lng],activeRoute.coords);toast(pos&&pos.distanceM>300?`Waypoint ditambah (${Math.round(pos.distanceM)} m dari rute)`:'Waypoint ditambahkan')
}
function useGpsWaypoint(){if(!gpsFix){startGpsWatch();return toast('Menunggu posisi GPS…')}$('#wpLat').value=gpsFix.lat.toFixed(6);$('#wpLng').value=gpsFix.lng.toFixed(6);toast('Koordinat GPS dimasukkan')}
function routePackageObject(r){return{format:'JalurNusaRoutePackage',version:3,exportedAt:new Date().toISOString(),route:{name:r.name,mountainId:r.mountainId||'',mountainName:r.mountainName||'',coords:r.coords,waypoints:r.waypoints||[],guide:r.guide||{},sourceFile:r.sourceFile||''},trip:tripPlans.find(t=>t.routeId===r.id)||null}}
function downloadJson(obj,name){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportRoutePackage(r=activeRoute){if(!r||!routes.some(x=>x.id===r.id))return toast('Buka rute tersimpan terlebih dahulu');downloadJson(routePackageObject(r),safeFileName(r.name)+'.jalurnusa.json');toast('Paket rute V3 dibuat')}
function parseJalurNusaPackage(text){let j;try{j=JSON.parse(text)}catch{return null}if(j?.format!=='JalurNusaRoutePackage'||!j.route)return null;const r=j.route;if(!Array.isArray(r.coords)||r.coords.length<2)throw Error('Paket JalurNusa tidak memiliki rute yang valid');return{name:r.name||'Rute JalurNusa',coords:r.coords.map(c=>[Number(c[0]),Number(c[1]),c[2]==null?null:Number(c[2])]).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1])),waypoints:Array.isArray(r.waypoints)?r.waypoints:[],mountainId:r.mountainId||'',mountainName:r.mountainName||'',guide:r.guide||{},trip:j.trip||null,packageVersion:j.version||3}}
async function exportBackup(){const settings={note:localStorage.getItem('jalurnusa_note')||'',offRoute:localStorage.getItem('jalurnusa_offroute')||'0',offRouteThreshold:localStorage.getItem('jalurnusa_offroute_threshold')||'100',emergencyName:localStorage.getItem('jalurnusa_emergency_name')||'',emergencyPhone:localStorage.getItem('jalurnusa_emergency_phone')||''};downloadJson({format:'JalurNusaBackup',version:3,exportedAt:new Date().toISOString(),routes,recordings,tripPlans,settings,note:'Paket PMTiles tidak dimasukkan agar file backup tetap ringan.'},`JalurNusa_Backup_${new Date().toISOString().slice(0,10)}.json`);toast('Backup data V3 dibuat')}

function updateOffRoute(){
  if(!activeRoute?.coords?.length||!gpsPosition){$('#statOffRoute').textContent='—';$('#offRouteReadout').textContent='Butuh rute aktif dan GPS.';$('#offRouteReadout').className='status-box';return}
  const d=nearestRouteDistanceM(gpsPosition,activeRoute.coords);if(d==null)return;$('#statOffRoute').textContent=d<1000?`${Math.round(d)} m`:`${(d/1000).toFixed(1)} km`;
  const enabled=$('#offRouteToggle').checked,threshold=Number($('#offRouteThreshold').value)||100;$('#offRouteReadout').textContent=`Posisi sekitar ${Math.round(d)} m dari rute aktif.`;$('#offRouteReadout').className='status-box '+(enabled&&d>threshold?'danger-box':'ok-box');$('#offRouteStat').classList.toggle('danger-stat',enabled&&d>threshold);
  if(enabled&&d>threshold&&Date.now()-lastOffRouteAlert>60000){lastOffRouteAlert=Date.now();navigator.vibrate?.([180,100,180]);toast(`Peringatan: sekitar ${Math.round(d)} m dari jalur`) }
}

function emergencyText(){if(!gpsFix)return '';const t=new Date(gpsFix.time).toLocaleString('id-ID');return `Lokasi terakhir saya: ${gpsFix.lat.toFixed(6)}, ${gpsFix.lng.toFixed(6)} (akurasi ±${Math.round(gpsFix.accuracy)} m, ${t}). Peta: https://maps.google.com/?q=${gpsFix.lat},${gpsFix.lng}`}
async function shareLocation(){if(!gpsFix){startGpsWatch();return toast('Menunggu posisi GPS…')}const text=emergencyText();try{if(navigator.share)await navigator.share({title:'Lokasi saya - JalurNusa',text});else{await navigator.clipboard.writeText(text);toast('Lokasi disalin')}}catch(e){if(e?.name!=='AbortError')toast('Gagal membagikan lokasi')}}
async function copyLocation(){if(!gpsFix){startGpsWatch();return toast('Menunggu posisi GPS…')}try{await navigator.clipboard.writeText(emergencyText());toast('Koordinat disalin')}catch{toast('Tidak dapat menyalin koordinat')}}
function saveEmergencyContact(){const n=$('#emergencyName').value.trim(),p=$('#emergencyPhone').value.trim();localStorage.setItem('jalurnusa_emergency_name',n);localStorage.setItem('jalurnusa_emergency_phone',p);updateEmergencyButton()}
function updateEmergencyButton(){const p=$('#emergencyPhone').value.trim();$('#callEmergencyContactBtn').disabled=!p;$('#callEmergencyContactBtn').textContent=p?`Hubungi ${$('#emergencyName').value.trim()||'kontak tersimpan'}`:'Hubungi kontak tersimpan'}
function callEmergencyContact(){const p=$('#emergencyPhone').value.replace(/[^0-9+]/g,'');if(!p)return toast('Isi nomor kontak darurat');location.href=`tel:${p}`}

async function updateStorage(){if(!navigator.storage?.estimate){$('#storageReadout').textContent='Informasi penyimpanan tidak tersedia.';return}try{const s=await navigator.storage.estimate(),used=fmtBytes(s.usage),quota=fmtBytes(s.quota),persisted=await navigator.storage.persisted?.();$('#storageReadout').textContent=`Terpakai ${used} dari sekitar ${quota}.${persisted?' Data ditandai persistent.':''}`}catch{$('#storageReadout').textContent='Tidak dapat membaca kapasitas penyimpanan.'}}
async function persistStorage(){if(!navigator.storage?.persist)return toast('Persistent storage tidak didukung');try{const ok=await navigator.storage.persist();toast(ok?'Penyimpanan offline dipertahankan':'Browser belum memberikan izin persistent');updateStorage()}catch{toast('Gagal meminta persistent storage')}}
function loadSettings(){
  $('#fieldNote').value=localStorage.getItem('jalurnusa_note')||'';$('#offRouteToggle').checked=localStorage.getItem('jalurnusa_offroute')==='1';$('#offRouteThreshold').value=localStorage.getItem('jalurnusa_offroute_threshold')||'100';$('#emergencyName').value=localStorage.getItem('jalurnusa_emergency_name')||'';$('#emergencyPhone').value=localStorage.getItem('jalurnusa_emergency_phone')||'';updateEmergencyButton();
}
function updateNetwork(){const on=navigator.onLine;$('#networkTitle').textContent=on?'Online & siap offline':'Mode offline aktif';$('#networkSub').textContent=on?'Rute, PMTiles, tracking, dan catatan tetap tersimpan di perangkat.':'Menggunakan data lokal. GPS dan kompas tidak membutuhkan internet.';$('#networkBadge').textContent=on?'ONLINE':'OFFLINE';$('#networkBadge').style.background=on?'#f0b84b':'#6ec28f';if(!on&&mapState.onlineTiles){mapState.onlineTiles=false;$('#onlineTilesBtn').textContent='Peta online: MATI';renderMap()}}

$$('.nav-item').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('#searchInput').oninput=renderMountains;$('#provinceFilter').onchange=renderMountains;
$('#importBtn').onclick=()=>{delete $('#fileInput').dataset.mountainId;$('#fileInput').click()};
$('#fileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importRoute(f,e.target.dataset.mountainId||'');toast('Rute tersimpan offline')}catch(err){toast(err.message||'Gagal membaca rute')}e.target.value=''};
$('#importPmtilesBtn').onclick=()=>{delete $('#pmtilesInput').dataset.mountainId;$('#pmtilesInput').click()};
$('#pmtilesInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importPmtiles(f,e.target.dataset.mountainId||'')}catch(err){toast(err.message||'Gagal membaca PMTiles')}e.target.value=''};
$('#onlineTilesBtn').onclick=()=>{if(!navigator.onLine)return toast('Tidak ada koneksi');mapState.onlineTiles=!mapState.onlineTiles;$('#onlineTilesBtn').textContent=`Peta online: ${mapState.onlineTiles?'HIDUP':'MATI'}`;renderMap()};
$('#zoomIn').onclick=()=>zoom(1);$('#zoomOut').onclick=()=>zoom(-1);$('#fitRouteBtn').onclick=fitActiveRoute;$('#centerGpsBtn').onclick=centerGps;$('#clearRouteBtn').onclick=()=>{activeRoute=null;activeTrip=null;localStorage.removeItem('jalurnusa_active');$('#activeRouteName').textContent='Belum ada rute';renderPlan();renderMap();toast('Rute ditutup')};
$('#startGpsBtn').onclick=toggleGps;$('#startCompassBtn').onclick=startCompass;$('#recordTrackBtn').onclick=startRecording;$('#exportCurrentTrackBtn').onclick=()=>exportRecording(currentRecording);
$('#offRouteToggle').onchange=()=>{localStorage.setItem('jalurnusa_offroute',$('#offRouteToggle').checked?'1':'0');updateOffRoute()};$('#offRouteThreshold').onchange=()=>{localStorage.setItem('jalurnusa_offroute_threshold',$('#offRouteThreshold').value);updateOffRoute()};
$('#shareLocationBtn').onclick=shareLocation;$('#copyLocationBtn').onclick=copyLocation;$('#emergencyName').onchange=saveEmergencyContact;$('#emergencyPhone').onchange=saveEmergencyContact;$('#emergencyName').oninput=updateEmergencyButton;$('#emergencyPhone').oninput=updateEmergencyButton;$('#callEmergencyContactBtn').onclick=callEmergencyContact;
$('#persistStorageBtn').onclick=persistStorage;$('#saveNoteBtn').onclick=()=>{localStorage.setItem('jalurnusa_note',$('#fieldNote').value);toast('Catatan tersimpan offline')};
$('#saveTripBtn').onclick=saveTrip;$('#exportRoutePackageBtn').onclick=()=>exportRoutePackage(activeRoute);$('#exportBackupBtn').onclick=exportBackup;$('#planStartGpsBtn').onclick=()=>{startGpsWatch();toast('GPS diaktifkan untuk progress jalur')};$('#useGpsWaypointBtn').onclick=useGpsWaypoint;$('#addWaypointBtn').onclick=addWaypoint;$('#resetChecklistBtn').onclick=resetChecklist;$('#addCheckBtn').onclick=addChecklistItem;$('#customCheckInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addChecklistItem()}});
['tripName','tripDate','tripStart','tripParty'].forEach(id=>$('#'+id).addEventListener('change',()=>{syncTripForm();renderSegments()}));$('#tripPace').addEventListener('change',()=>{syncTripForm();renderSegments()});
const stage=$('#mapStage');stage.addEventListener('pointerdown',e=>{mapState.dragging=true;mapState.last=[e.clientX,e.clientY];stage.setPointerCapture(e.pointerId)});stage.addEventListener('pointermove',e=>{if(!mapState.dragging)return;const dx=e.clientX-mapState.last[0],dy=e.clientY-mapState.last[1];mapState.last=[e.clientX,e.clientY];movePixels(dx,dy)});stage.addEventListener('pointerup',()=>mapState.dragging=false);stage.addEventListener('pointercancel',()=>mapState.dragging=false);stage.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1:-1)},{passive:false});
window.addEventListener('resize',renderMap);window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);window.addEventListener('beforeunload',()=>{if(currentRecording?.active)dbPut(STORES.recordings,currentRecording).catch(()=>{})});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$('#installBtn').classList.add('hidden')}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
load();
