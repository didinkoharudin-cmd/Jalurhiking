const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
let mountains=[], routes=[], activeRoute=null, deferredInstall=null, gpsWatch=null, gpsPosition=null;
let mapState={center:[-2.35,117.6],zoom:5,dragging:false,last:null,onlineTiles:false};
const TILE=256;
const DB_NAME='JalurNusaDB', DB_VERSION=1, STORE='routes';

function toast(msg){const e=$('#toast');e.textContent=msg;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),2300)}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function dbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbAll(){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function dbPut(v){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(v);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function dbDelete(id){const db=await dbOpen();return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function hav(a,b){const R=6371,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180,la1=a[0]*Math.PI/180,la2=b[0]*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function distance(c){let d=0;for(let i=1;i<c.length;i++)d+=hav(c[i-1],c[i]);return d}
function gain(c){let g=0;for(let i=1;i<c.length;i++){let a=c[i-1][2],b=c[i][2];if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)g+=b-a}return g}

async function load(){
  mountains=await fetch('data/mountains.json').then(r=>r.json()).catch(()=>[]);
  routes=await dbAll().catch(()=>[]);
  const activeId=localStorage.getItem('jalurnusa_active'); activeRoute=routes.find(r=>r.id===activeId)||null;
  const prov=[...new Set(mountains.map(m=>m.province))].sort(); $('#provinceFilter').innerHTML='<option value="">Semua wilayah</option>'+prov.map(p=>`<option>${esc(p)}</option>`).join('');
  renderMountains();renderSaved();updateNetwork();renderMap();
}
function renderMountains(){
  const q=$('#searchInput').value.trim().toLowerCase(),p=$('#provinceFilter').value;
  const arr=mountains.filter(m=>(!q||`${m.name} ${m.province}`.toLowerCase().includes(q))&&(!p||m.province===p));
  $('#mountainList').innerHTML=arr.length?arr.map(m=>{const count=routes.filter(r=>r.mountainId===m.id).length;return `<article class="card"><div><h4>${esc(m.name)}</h4><div class="meta"><span class="tag">${Number(m.elevation).toLocaleString('id-ID')} mdpl</span><span class="tag">${esc(m.province)}</span><span class="tag">${esc(m.difficulty)}</span></div><div class="status-line">${count?`✓ ${count} rute tersimpan offline`:'Belum ada rute tersimpan'}</div></div><div class="actions"><button class="mini" data-map="${m.id}">Peta</button><button class="mini secondary" data-import="${m.id}">Impor</button></div></article>`}).join(''):'<div class="empty">Gunung tidak ditemukan.</div>';
  $$('[data-map]').forEach(b=>b.onclick=()=>openMountain(b.dataset.map)); $$('[data-import]').forEach(b=>b.onclick=()=>{ $('#fileInput').dataset.mountainId=b.dataset.import; $('#fileInput').click() });
}
function renderSaved(){
  $('#savedRoutes').innerHTML=routes.length?routes.map(r=>`<article class="card"><div><h4>${esc(r.name)}</h4><div class="meta"><span class="tag">${distance(r.coords).toFixed(1)} km</span><span class="tag">${r.coords.length} titik</span>${r.mountainName?`<span class="tag">${esc(r.mountainName)}</span>`:''}</div><div class="status-line">${new Date(r.savedAt).toLocaleString('id-ID')}</div></div><div class="actions"><button class="mini" data-open="${r.id}">Buka</button><button class="mini secondary" data-del="${r.id}">Hapus</button></div></article>`).join(''):'<div class="empty">Belum ada rute. Impor file GPX atau GeoJSON dari sumber yang Anda percaya.</div>';
  $$('[data-open]').forEach(b=>b.onclick=()=>activate(routes.find(r=>r.id===b.dataset.open))); $$('[data-del]').forEach(b=>b.onclick=()=>removeRoute(b.dataset.del));
}
function setView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));if(id==='mapView')setTimeout(renderMap,30);if(id==='savedView')renderSaved()}
async function removeRoute(id){await dbDelete(id);routes=routes.filter(r=>r.id!==id);if(activeRoute?.id===id){activeRoute=null;localStorage.removeItem('jalurnusa_active')}renderSaved();renderMountains();renderMap();toast('Rute dihapus')}
function activate(r){if(!r)return;activeRoute=r;localStorage.setItem('jalurnusa_active',r.id);fitActiveRoute();setView('mapView');toast('Rute dibuka dari penyimpanan offline')}
function openMountain(id){const r=routes.find(x=>x.mountainId===id);if(r)return activate(r);const m=mountains.find(x=>x.id===id);if(!m)return;activeRoute=null;localStorage.removeItem('jalurnusa_active');mapState.center=[m.lat,m.lng];mapState.zoom=12;setView('mapView');$('#activeRouteName').textContent=m.name+' — belum ada GPX';toast('Impor rute terverifikasi untuk gunung ini')}

function parseGPX(text){const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('GPX tidak valid');const pts=[...d.querySelectorAll('trkpt,rtept')].map(p=>[+p.getAttribute('lat'),+p.getAttribute('lon'),p.querySelector('ele')?+p.querySelector('ele').textContent:null]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));return{name:d.querySelector('trk > name,rte > name,metadata > name')?.textContent?.trim()||'Rute GPX',coords:pts}}
function parseGeoJSON(text){
  let j;try{j=JSON.parse(text)}catch{throw Error('GeoJSON tidak valid / JSON rusak')}
  const lines=[], points=[];
  const addLine=c=>{if(Array.isArray(c)&&c.length>=2)lines.push(c)};
  const walk=g=>{
    if(!g||typeof g!=='object')return;
    if(g.type==='FeatureCollection'){(g.features||[]).forEach(walk);return}
    if(g.type==='Feature'){walk(g.geometry);return}
    if(g.type==='GeometryCollection'){(g.geometries||[]).forEach(walk);return}
    if(g.type==='LineString'){addLine(g.coordinates);return}
    if(g.type==='MultiLineString'){(g.coordinates||[]).forEach(addLine);return}
    if(g.type==='Point'){if(Array.isArray(g.coordinates))points.push(g.coordinates);return}
    if(g.type==='MultiPoint'){(g.coordinates||[]).forEach(c=>points.push(c));return}
  };
  walk(j);
  // Untuk rute yang diekspor sebagai kumpulan waypoint/Point, urutan feature dipakai sebagai urutan jalur.
  if(!lines.length&&points.length>=2)addLine(points);
  if(!lines.length)throw Error('GeoJSON tidak berisi jalur. Gunakan LineString/MultiLineString, atau minimal 2 Point berurutan.');
  const validLine=c=>c.map(x=>[Number(x?.[1]),Number(x?.[0]),x?.[2]==null?null:Number(x[2])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const candidates=lines.map(validLine).filter(c=>c.length>=2);
  if(!candidates.length)throw Error('Koordinat GeoJSON tidak valid. Format harus [longitude, latitude].');
  // Bila file berisi beberapa segmen terpisah, ambil segmen terpanjang agar tidak membuat garis lurus palsu antar-segmen.
  const coords=candidates.sort((a,b)=>distance(b)-distance(a))[0];
  const props=j.type==='Feature'?j.properties:(j.type==='FeatureCollection'?(j.features||[]).find(f=>f?.properties?.name||f?.properties?.title)?.properties:null);
  return{name:props?.name||props?.title||'Rute GeoJSON',coords}
}
async function importRoute(file,mountainId=''){const text=await file.text(),d=file.name.toLowerCase().endsWith('.gpx')?parseGPX(text):parseGeoJSON(text);if(d.coords.length<2)throw Error('Rute tidak memiliki cukup titik');const m=mountains.find(x=>x.id===mountainId);const r={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,name:d.name||file.name,mountainId:mountainId||'',mountainName:m?.name||'',coords:d.coords,savedAt:new Date().toISOString(),sourceFile:file.name};await dbPut(r);routes.unshift(r);renderMountains();renderSaved();activate(r)}

function project(lat,lng,z){const n=2**z,x=(lng+180)/360*n*TILE,rad=lat*Math.PI/180,y=(1-Math.asinh(Math.tan(rad))/Math.PI)/2*n*TILE;return[x,y]}
function unproject(x,y,z){const n=2**z,lng=x/(n*TILE)*360-180,yy=Math.PI*(1-2*y/(n*TILE)),lat=Math.atan(Math.sinh(yy))*180/Math.PI;return[lat,lng]}
function viewport(){const el=$('#mapStage'),w=el.clientWidth,h=el.clientHeight,[cx,cy]=project(mapState.center[0],mapState.center[1],mapState.zoom);return{w,h,cx,cy,left:cx-w/2,top:cy-h/2}}
function renderMap(){
  const st=$('#mapStage');if(!st.clientWidth)return;renderTiles();renderRoute();
  if(activeRoute){$('#activeRouteName').textContent=activeRoute.name;$('#statDistance').textContent=distance(activeRoute.coords).toFixed(1)+' km';$('#statPoints').textContent=activeRoute.coords.length;const g=gain(activeRoute.coords);$('#statElevation').textContent=g?Math.round(g)+' m':'—'}else if(!$('#activeRouteName').textContent.includes('belum ada GPX')){$('#activeRouteName').textContent='Belum ada rute';$('#statDistance').textContent='—';$('#statPoints').textContent='—';$('#statElevation').textContent='—'}
}
function renderTiles(){
  const layer=$('#tileLayer');layer.innerHTML='';if(!mapState.onlineTiles||!navigator.onLine){$('#mapAttrib').textContent='Peta rute offline';return}const v=viewport(),z=mapState.zoom,n=2**z,x0=Math.floor(v.left/TILE),x1=Math.floor((v.left+v.w)/TILE),y0=Math.floor(v.top/TILE),y1=Math.floor((v.top+v.h)/TILE);for(let y=y0;y<=y1;y++){if(y<0||y>=n)continue;for(let x=x0;x<=x1;x++){let xx=((x%n)+n)%n;const img=new Image();img.className='map-tile';img.alt='';img.referrerPolicy='origin';img.src=`https://tile.openstreetmap.org/${z}/${xx}/${y}.png`;img.style.left=(x*TILE-v.left)+'px';img.style.top=(y*TILE-v.top)+'px';layer.appendChild(img)}}$('#mapAttrib').textContent='© OpenStreetMap contributors'}
function markerCircle(x,y,r,fill,stroke='#fff'){return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${r+6}" fill="none" stroke="${fill}" stroke-opacity=".25" stroke-width="5"/>`}
function renderRoute(){
  const v=viewport(),line=$('#routeLine'),marks=$('#mapMarkers');let pts='';marks.innerHTML='';if(activeRoute){pts=activeRoute.coords.map(c=>{const [x,y]=project(c[0],c[1],mapState.zoom);return `${(x-v.left).toFixed(1)},${(y-v.top).toFixed(1)}`}).join(' ');if(activeRoute.coords.length){const a=activeRoute.coords[0],b=activeRoute.coords.at(-1),p1=project(a[0],a[1],mapState.zoom),p2=project(b[0],b[1],mapState.zoom);marks.innerHTML=markerCircle(p1[0]-v.left,p1[1]-v.top,6,'#6ec28f')+markerCircle(p2[0]-v.left,p2[1]-v.top,6,'#f18475')}}line.setAttribute('points',pts);renderGpsMarker()}
function renderGpsMarker(){const g=$('#gpsMarker');if(!gpsPosition){g.innerHTML='';return}const v=viewport(),p=project(gpsPosition[0],gpsPosition[1],mapState.zoom);g.innerHTML=markerCircle(p[0]-v.left,p[1]-v.top,7,'#4aa3ff')}
function fitActiveRoute(){if(!activeRoute?.coords?.length)return;const lats=activeRoute.coords.map(c=>c[0]),lngs=activeRoute.coords.map(c=>c[1]);const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLng=Math.min(...lngs),maxLng=Math.max(...lngs);mapState.center=[(minLat+maxLat)/2,(minLng+maxLng)/2];const el=$('#mapStage'),pad=70;for(let z=16;z>=3;z--){const a=project(maxLat,minLng,z),b=project(minLat,maxLng,z);if(Math.abs(b[0]-a[0])<el.clientWidth-pad*2&&Math.abs(b[1]-a[1])<el.clientHeight-260){mapState.zoom=z;break}}renderMap()}
function zoom(delta){const old=mapState.zoom;mapState.zoom=Math.max(2,Math.min(17,mapState.zoom+delta));if(old!==mapState.zoom)renderMap()}
function movePixels(dx,dy){const [cx,cy]=project(mapState.center[0],mapState.center[1],mapState.zoom),ll=unproject(cx-dx,cy-dy,mapState.zoom);mapState.center=ll;renderMap()}

function startGps(){if(!navigator.geolocation)return toast('GPS tidak didukung');if(gpsWatch!==null){navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;$('#startGpsBtn').textContent='Mulai GPS';toast('GPS dihentikan');return}gpsWatch=navigator.geolocation.watchPosition(p=>{const c=p.coords;gpsPosition=[c.latitude,c.longitude];$('#gpsReadout').textContent=`${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} • akurasi ±${Math.round(c.accuracy)} m${c.altitude!=null?` • alt ${Math.round(c.altitude)} m`:''}`;$('#startGpsBtn').textContent='Hentikan GPS';renderGpsMarker()},e=>toast('GPS gagal: '+e.message),{enableHighAccuracy:true,maximumAge:3000,timeout:15000})}
function centerGps(){if(!gpsPosition){startGps();return toast('Menunggu lokasi GPS…')}mapState.center=gpsPosition;mapState.zoom=Math.max(14,mapState.zoom);renderMap()}
function headingName(h){return['Utara','Timur Laut','Timur','Tenggara','Selatan','Barat Daya','Barat','Barat Laut'][Math.round(h/45)%8]}
async function startCompass(){const fn=e=>{const h=e.webkitCompassHeading??(e.alpha!=null?360-e.alpha:null);if(h!=null)$('#compassReadout').textContent=`${Math.round(h)}° • ${headingName(h)}`};try{if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){if(await DeviceOrientationEvent.requestPermission()!=='granted')throw Error()}window.addEventListener('deviceorientation',fn,true);toast('Kompas aktif')}catch{toast('Kompas tidak dapat diaktifkan')}}
function updateNetwork(){const on=navigator.onLine;$('#networkTitle').textContent=on?'Online & siap offline':'Sedang offline';$('#networkSub').textContent=on?'Impor rute terverifikasi. App shell dan rute tersimpan tetap tersedia saat sinyal hilang.':'Rute tersimpan, GPS, kompas, dan catatan tetap tersedia.';$('#networkBadge').textContent=on?'ONLINE':'OFFLINE';$('#networkBadge').style.background=on?'#f0b84b':'#6ec28f';if(!on&&mapState.onlineTiles){mapState.onlineTiles=false;$('#onlineTilesBtn').textContent='Peta dasar: MATI';renderMap()}}

$$('.nav-item').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('#searchInput').oninput=renderMountains;$('#provinceFilter').onchange=renderMountains;
$('#importBtn').onclick=()=>{delete $('#fileInput').dataset.mountainId;$('#fileInput').click()};$('#fileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importRoute(f,e.target.dataset.mountainId||'');toast('Rute tersimpan offline')}catch(err){toast(err.message||'Gagal membaca rute')}e.target.value=''};
$('#onlineTilesBtn').onclick=()=>{if(!navigator.onLine)return toast('Tidak ada koneksi');mapState.onlineTiles=!mapState.onlineTiles;$('#onlineTilesBtn').textContent=`Peta dasar: ${mapState.onlineTiles?'HIDUP':'MATI'}`;renderMap()};$('#zoomIn').onclick=()=>zoom(1);$('#zoomOut').onclick=()=>zoom(-1);$('#fitRouteBtn').onclick=fitActiveRoute;$('#centerGpsBtn').onclick=centerGps;$('#clearRouteBtn').onclick=()=>{activeRoute=null;localStorage.removeItem('jalurnusa_active');$('#activeRouteName').textContent='Belum ada rute';renderMap();toast('Rute ditutup')};
$('#startGpsBtn').onclick=startGps;$('#startCompassBtn').onclick=startCompass;$('#fieldNote').value=localStorage.getItem('jalurnusa_note')||'';$('#saveNoteBtn').onclick=()=>{localStorage.setItem('jalurnusa_note',$('#fieldNote').value);toast('Catatan tersimpan offline')};
const stage=$('#mapStage');stage.addEventListener('pointerdown',e=>{mapState.dragging=true;mapState.last=[e.clientX,e.clientY];stage.setPointerCapture(e.pointerId)});stage.addEventListener('pointermove',e=>{if(!mapState.dragging)return;const dx=e.clientX-mapState.last[0],dy=e.clientY-mapState.last[1];mapState.last=[e.clientX,e.clientY];movePixels(dx,dy)});stage.addEventListener('pointerup',()=>mapState.dragging=false);stage.addEventListener('pointercancel',()=>mapState.dragging=false);stage.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1:-1)},{passive:false});
window.addEventListener('resize',renderMap);window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;$('#installBtn').classList.add('hidden')}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
load();
