(function(){
"use strict";
const PAGE=document.body.dataset.page;           // "view"(기록) | "nav"(트래커) — 페이지마다 지도·GPX 보관함이 따로다
const PFX=PAGE==="nav"?"gpxt.":"gpxv.";           // 페이지별 localStorage 키 접두사 (주행기록 gpxv.day.* 만 두 페이지가 공유)
const $=s=>document.querySelector(s)||document.createElement("input");   // 이 페이지에 없는 요소는 무동작 더미로 대체
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- 화면 높이 실측 + 바텀시트(모바일) ---------- */
const mq=matchMedia("(max-width:760px)");
const root=document.documentElement;
let appH=innerHeight, sheetIdx=PAGE==="nav"?0:1, sheetH=0;
const snaps=()=>[64,Math.round(appH*.42),Math.round(appH*.88)];   // 접힘 / 중간 / 펼침
function applySheet(h){ sheetH=h==null?snaps()[sheetIdx]:h; root.style.setProperty("--sheet-h",sheetH+"px"); }
function setAppH(){
  appH=Math.round((window.visualViewport&&visualViewport.height)||innerHeight);
  root.style.setProperty("--app-h",appH+"px"); applySheet();
  try{ map.invalidateSize(); }catch(e){}
}
setAppH();
addEventListener("resize",setAppH); addEventListener("orientationchange",()=>setTimeout(setAppH,200));
if(window.visualViewport) visualViewport.addEventListener("resize",setAppH);
(function(){
  const grab=document.getElementById("grab"),sheet=document.getElementById("sheet");
  let y0=0,h0=0,moved=false,drag=false;
  grab.addEventListener("pointerdown",e=>{ drag=true; moved=false; y0=e.clientY; h0=sheetH; sheet.classList.add("drag"); grab.setPointerCapture(e.pointerId); });
  grab.addEventListener("pointermove",e=>{ if(!drag) return; const dy=y0-e.clientY; if(Math.abs(dy)>5) moved=true; if(moved) applySheet(Math.max(64,Math.min(appH*.92,h0+dy))); });
  const end=()=>{ if(!drag) return; drag=false; sheet.classList.remove("drag");
    if(!moved){ sheetIdx=(sheetIdx+1)%3; }
    else { const sn=snaps(); sheetIdx=sn.reduce((bi,v,i)=>Math.abs(v-sheetH)<Math.abs(sn[bi]-sheetH)?i:bi,0); }
    applySheet(); setTimeout(()=>map.invalidateSize(),250); };
  grab.addEventListener("pointerup",end); grab.addEventListener("pointercancel",end);
})();
const fit=(b,o={})=>map.fitBounds(b,{...o,paddingBottomRight:[0,mq.matches?sheetH:0]});   // 시트에 가려지지 않게 여백

/* ---------- 지도 ---------- */
const BASES={
  "거리 지도 (Esri)":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}","Esri, HERE, Garmin, OSM contributors"],
  "밝은 회색 (Esri)":["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}","Esri, HERE, Garmin"],
  "어두운 회색 (Esri)":["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}","Esri, HERE, Garmin"],
  "OpenStreetMap":["https://tile.openstreetmap.org/{z}/{x}/{y}.png","© OpenStreetMap contributors"],
  "위성 (Esri)":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}","Esri, Maxar"],
  "위성 + 지명 (Esri)":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}","Esri, Maxar",
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
  "지형 (OpenTopoMap)":["https://tile.opentopomap.org/{z}/{x}/{y}.png","© OpenStreetMap, SRTM | © OpenTopoMap"]
};
const map=L.map("map",{preferCanvas:true,zoomSnap:0.5,rotate:true,bearing:0,touchRotate:false,rotateControl:false}).setView([20.9,106.3],6);
let baseLayer=null;
const baseSel=$("#base");
Object.keys(BASES).forEach(k=>baseSel.add(new Option(k,k)));
function setBase(k){
  if(baseLayer) baseLayer.eachLayer ? baseLayer.eachLayer(l=>map.removeLayer(l)) : map.removeLayer(baseLayer);
  baseLayer=L.tileLayer(BASES[k][0],{attribution:BASES[k][1],maxZoom:19,maxNativeZoom:k.includes("회색")?16:19}).addTo(map);
  if(BASES[k][2]) baseLayer=L.layerGroup([baseLayer,L.tileLayer(BASES[k][2],{maxZoom:19,maxNativeZoom:16,pane:"shadowPane"}).addTo(map)]);
  else baseLayer.bringToBack();
  try{localStorage.setItem(PFX+"base",k)}catch(e){}
}
let savedBase=null;try{savedBase=localStorage.getItem(PFX+"base")}catch(e){}
if(!BASES[savedBase]) savedBase=matchMedia("(prefers-color-scheme: dark)").matches?"어두운 회색 (Esri)":"거리 지도 (Esri)";
baseSel.value=savedBase; setBase(savedBase);
baseSel.onchange=()=>setBase(baseSel.value);

/* ---------- 데이터 ---------- */
let tracks=[];        // {id,date,name,segs,km,pts,t0,t1,color,group,link,visible,month}
let wpts=[], files=[];
let selId=null, nextId=1, nextFid=1;
const hl=L.layerGroup().addTo(map);       // 선택 강조/시작·끝 마커
const wptLayer=L.layerGroup().addTo(map);

function hav(a,b){
  const p=Math.PI/180,h=Math.sin((b[0]-a[0])*p/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin((b[1]-a[1])*p/2)**2;
  return 12742*Math.asin(Math.sqrt(h));
}
function tzOff(lat,lon){ return (lat>30&&lon>120&&lon<135)?9:(lon>=95&&lon<115?7:Math.round(lon/15)); }
function localDay(p){
  if(!p[2]) return "날짜 없음";
  const d=new Date(p[2]+tzOff(p[0],p[1])*3600e3);
  return d.toISOString().slice(0,10);
}
function parseGpx(text,fname){
  const doc=new DOMParser().parseFromString(text,"application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error(fname+": XML 파싱 실패");
  const out=[];
  for(const trk of doc.getElementsByTagName("trk")){
    const nm=(trk.getElementsByTagName("name")[0]||{}).textContent||"";
    const segs=[];
    for(const sg of trk.getElementsByTagName("trkseg")){
      const pts=[];
      for(const p of sg.getElementsByTagName("trkpt")){
        const lat=+p.getAttribute("lat"),lon=+p.getAttribute("lon");
        if(!isFinite(lat)||!isFinite(lon)) continue;
        const te=p.getElementsByTagName("time")[0],ee=p.getElementsByTagName("ele")[0];
        const t=te?Date.parse(te.textContent):NaN;
        pts.push([lat,lon,isNaN(t)?0:t,ee?+ee.textContent:null]);
      }
      if(pts.length) segs.push(pts);
    }
    if(segs.length) out.push({name:nm,segs});
  }
  const w=[];
  for(const p of doc.getElementsByTagName("wpt")){
    const n=(p.getElementsByTagName("name")[0]||{}).textContent||"";
    w.push([+p.getAttribute("lat"),+p.getAttribute("lon"),n]);
  }
  return {trks:out,wpts:w};
}
// 이름에 날짜가 없는 단일 큰 트랙(변환기 출력 등)은 현지 날짜 + 45분 공백 기준으로 자동 분할
function normalize(raw,fname){
  const res=[];
  for(const t of raw){
    if(/^\d{4}-\d\d-\d\d/.test(t.name)){ res.push(t); continue; }
    const all=t.segs.flat().filter(p=>p[2]).sort((a,b)=>a[2]-b[2]);
    if(!all.length){ res.push({name:t.name||fname,segs:t.segs}); continue; }
    const days=new Map();
    for(const p of all){ const d=localDay(p); if(!days.has(d)) days.set(d,[]); days.get(d).push(p); }
    for(const [d,ps] of days){
      const segs=[];let cur=[ps[0]];
      for(let i=1;i<ps.length;i++){ if(ps[i][2]-cur[cur.length-1][2]>45*60e3){segs.push(cur);cur=[]} cur.push(ps[i]); }
      segs.push(cur);
      res.push({name:d+" "+(t.name||fname.replace(/\.gpx$/i,"")),segs});
    }
  }
  return res;
}
function addTracks(list,fname,fid){
  for(const t of list){
    let km=0,n=0,t0=Infinity,t1=-Infinity;
    for(const sg of t.segs){ n+=sg.length; for(let i=0;i<sg.length;i++){ if(i) km+=hav(sg[i-1],sg[i]); const tt=sg[i][2]; if(tt){t0=Math.min(t0,tt);t1=Math.max(t1,tt)} } }
    const m=/^(\d{4}-\d\d-\d\d)/.exec(t.name);
    const date=m?m[1]:(isFinite(t0)?localDay([t.segs[0][0][0],t.segs[0][0][1],t0]):"날짜 없음");
    tracks.push({id:nextId++,date,month:date.slice(0,7),name:t.name||fname,segs:t.segs,km,pts:n,
      t0:isFinite(t0)?t0:0,t1:isFinite(t1)?t1:0,file:fname,fid,visible:true,shown:false,group:null,link:null,color:"#2563eb"});
  }
}

/* ---------- 색상 ---------- */
function assignColors(){
  const mode=$("#colorBy").value;
  // 날짜 정보 없는 트랙(시간·날짜 이름 없는 GPX)은 트랙마다 별개 키로 취급해 서로 다른 색을 준다
  const dk=t=>t.date==="날짜 없음"?"~"+String(t.id).padStart(6,"0"):t.date;
  const mk=t=>t.date==="날짜 없음"?dk(t):t.month;
  const dates=[...new Set(tracks.map(dk))].sort();
  const months=[...new Set(tracks.map(mk))].sort();
  const dark=baseSel.value.includes("어두운")||baseSel.value.includes("위성");
  for(const t of tracks){
    if(mode==="one") t.color=dark?"#ffd24a":"#7c3aed";
    else if(mode==="month"){ const i=months.indexOf(mk(t)); t.color=`hsl(${150+(i*47)%140} 75% ${dark?62:42}%)`; }
    else { const i=dates.indexOf(dk(t)),f=dates.length>1?i/(dates.length-1):0; t.color=`hsl(${Math.round(290-f*140)} 80% ${dark?60:45}%)`; }
  }
}

/* ---------- 렌더링 ---------- */
function build(t){
  const opt={color:t.color,weight:3,opacity:.9,lineJoin:"round"};
  const lines=t.segs.map(sg=>L.polyline(sg.map(p=>[p[0],p[1]]),opt));
  t.group=L.featureGroup(lines);
  t.group.on("click",e=>{select(t.id,false);L.popup().setLatLng(e.latlng).setContent(popupHtml(t)).openOn(map)});
  t.group.on("mouseover",()=>lines.forEach(l=>l.setStyle({weight:6})));
  t.group.on("mouseout",()=>lines.forEach(l=>l.setStyle({weight:t.id===selId?5:3})));
  // 구간 사이 점선
  const links=[];
  for(let i=1;i<t.segs.length;i++){
    const a=t.segs[i-1][t.segs[i-1].length-1],b=t.segs[i][0];
    links.push(L.polyline([[a[0],a[1]],[b[0],b[1]]],{color:t.color,weight:1.5,opacity:.6,dashArray:"4 6",interactive:false}));
  }
  t.link=L.featureGroup(links);
}
function popupHtml(t){
  const f=x=>x?new Date(x).toLocaleString("ko-KR",{hour12:false}):"-";
  return `<b>${esc(t.name)}</b><br>${f(t.t0)} ~ ${f(t.t1)}<br>${t.km.toFixed(1)} km · ${t.pts.toLocaleString()}점 · 구간 ${t.segs.length}`;
}
function applyVisibility(){
  setTimeout(()=>{ try{ bringRecFront(); }catch(e){} },0);
  const q=$("#q").value.trim().toLowerCase(),from=$("#from").value,to=$("#to").value,minkm=+$("#minkm").value||0;
  const link=$("#link").checked;
  let nTr=0,km=0,pt=0;
  for(const t of tracks){
    t.visible=(!q||t.name.toLowerCase().includes(q))&&(!from||t.date>=from)&&(!to||t.date<=to)&&t.km>=minkm&&!t.hidden;
    if(t.visible){
      if(!t.group) build(t);
      if(!t.shown){ t.group.addTo(map); t.shown=true; }
      if(link) t.link.addTo(map); else map.removeLayer(t.link);
      nTr++;km+=t.km;pt+=t.pts;
    }else if(t.shown){ map.removeLayer(t.group); map.removeLayer(t.link); t.shown=false; }
  }
  $("#sTr").textContent=nTr; $("#sAll").textContent=tracks.length;
  $("#sKm").textContent=Math.round(km).toLocaleString(); $("#sPt").textContent=pt.toLocaleString();
  drawWpts();
  if(selId!=null){ const st=tracks.find(x=>x.id===selId); if(!st||!st.visible){ selId=null; hl.clearLayers(); } }   // 선택한 트랙이 숨겨지면 출발/도착 마커도 같이 지운다
  renderList(); drawArrows();
}
function recolor(){
  assignColors();
  for(const t of tracks){ if(t.group){ t.group.eachLayer(l=>l.setStyle({color:t.color})); t.link.eachLayer(l=>l.setStyle({color:t.color})); } }
  renderList(); drawArrows();
}

/* ---------- 진행 방향 화살표 (점 순서 = 이동 방향) ----------
   화면에 보이는 영역의 트랙에만, 확대 수준에 맞는 간격(약 120px)으로 그린다. 너무 멀리서는 숨김. */
const arrowLayer=L.layerGroup().addTo(map);
const ARROW_MIN_ZOOM=9, ARROW_MAX=1500;
function bearing(a,b){
  const r=Math.PI/180,y=Math.sin((b[1]-a[1])*r)*Math.cos(b[0]*r);
  const x=Math.cos(a[0]*r)*Math.sin(b[0]*r)-Math.sin(a[0]*r)*Math.cos(b[0]*r)*Math.cos((b[1]-a[1])*r);
  return (Math.atan2(y,x)/r+360)%360;
}
function segCum(sg){                         // 누적 거리(km) 캐시
  if(sg.cum) return sg.cum;
  const c=new Float64Array(sg.length);
  for(let i=1;i<sg.length;i++) c[i]=c[i-1]+hav(sg[i-1],sg[i]);
  return sg.cum=c;
}
function drawArrows(){
  arrowLayer.clearLayers();
  const z=map.getZoom(); if(z<ARROW_MIN_ZOOM) return;
  const bnd=map.getBounds().pad(.1), step=14400/Math.pow(2,z);     // km (위도 ~20° 기준 120px)
  let n=0;
  for(const t of tracks){
    if(!t.visible||!t.group) continue;
    const tb=t.group.getBounds(); if(!tb.isValid()||!bnd.intersects(tb)) continue;
    const dot=t.segs[0][0];
    if(bnd.contains([dot[0],dot[1]])) L.circleMarker([dot[0],dot[1]],{radius:4,color:"#fff",weight:1.5,fillColor:"#16a34a",fillOpacity:1,interactive:false}).addTo(arrowLayer);
    for(const sg of t.segs){
      if(sg.length<2) continue;
      const cum=segCum(sg); let k=0;
      for(let d=step/2;d<cum[cum.length-1];d+=step){
        while(k<cum.length-1&&cum[k]<d) k++;
        if(k>=sg.length-1) break;                  // 마지막 점에는 다음 점이 없어 방위를 못 구함
        const p=sg[k]; if(!bnd.contains([p[0],p[1]])) continue;
        let j=k+1; while(j<sg.length-1&&hav(p,sg[j])<0.03) j++;    // 30m 이상 앞의 점과 방위 계산
        if(hav(p,sg[j])<0.005) continue;
        L.marker([p[0],p[1]],{interactive:false,keyboard:false,rotateWithView:true,icon:L.divIcon({className:"arr",iconSize:[16,16],iconAnchor:[8,8],
          html:`<svg width="16" height="16" viewBox="-8 -8 16 16" style="transform:rotate(${bearing(p,sg[j]).toFixed(0)}deg)"><path d="M0-6.5L5 5.5L0 2.5L-5 5.5Z" fill="${t.color}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`})}).addTo(arrowLayer);
        if(++n>=ARROW_MAX) return;
      }
    }
  }
}
map.on("moveend",drawArrows);

/* ---------- 목록 ---------- */
function renderList(){
  const box=$("#list");
  const shown=tracks.filter(t=>matchFilter(t));
  if(!tracks.length){ box.innerHTML='<div class="empty">GPX 파일을 불러오면 일자별 트랙이 여기에 표시됩니다.</div>'; return; }
  if(!shown.length){ box.innerHTML='<div class="empty">조건에 맞는 트랙이 없습니다.</div>'; return; }
  const by=new Map();
  for(const t of shown){ if(!by.has(t.month)) by.set(t.month,[]); by.get(t.month).push(t); }
  let h="";
  for(const m of [...by.keys()].sort()){
    const ts=by.get(m).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.id-b.id);
    const km=ts.reduce((s,t)=>s+t.km,0),allOn=ts.every(t=>!t.hidden);
    h+=`<div class="month" data-m="${m}"><input type="checkbox" ${allOn?"checked":""} data-mc="${m}"><span>${m}</span><span class="sub">${ts.length}일 · ${Math.round(km).toLocaleString()} km</span></div>`;
    for(const t of ts){
      const nm=t.name.replace(/^\d{4}-\d\d-\d\d\s*/,"")||"(이름 없음)";
      h+=`<div class="item ${t.id===selId?"sel":""}" data-id="${t.id}"><input type="checkbox" ${t.hidden?"":"checked"} data-c="${t.id}" style="margin-top:3px">
        <span class="sw" style="background:${t.color}"></span><div class="t"><div class="d">${t.date.slice(5)} <span style="font-weight:400;color:var(--muted)">${t.km.toFixed(1)}km</span></div><div class="n">${esc(nm)}</div></div></div>`;
    }
  }
  const sc=box.scrollTop; box.innerHTML=h; box.scrollTop=sc;
}
function matchFilter(t){
  const q=$("#q").value.trim().toLowerCase(),from=$("#from").value,to=$("#to").value,minkm=+$("#minkm").value||0;
  return (!q||t.name.toLowerCase().includes(q))&&(!from||t.date>=from)&&(!to||t.date<=to)&&t.km>=minkm;
}
$("#list").addEventListener("click",e=>{
  const c=e.target.closest("[data-c]"),mc=e.target.closest("[data-mc]");
  if(c){ const t=tracks.find(x=>x.id==c.dataset.c); t.hidden=!c.checked; applyVisibility(); return; }
  if(mc){ tracks.filter(t=>t.month===mc.dataset.mc&&matchFilter(t)).forEach(t=>t.hidden=!mc.checked); applyVisibility(); return; }
  const it=e.target.closest(".item"); if(it) select(+it.dataset.id,true);
});

function select(id,zoom){
  selId=id; hl.clearLayers();
  const t=tracks.find(x=>x.id===id); if(!t) return;
  if(t.hidden){ t.hidden=false; applyVisibility(); }
  if(t.group){
    tracks.forEach(o=>o.group&&o.group.eachLayer(l=>l.setStyle({weight:3})));
    t.group.eachLayer(l=>l.setStyle({weight:5})); t.group.bringToFront();
    const a=t.segs[0][0],z=t.segs[t.segs.length-1],zz=z[z.length-1];
    L.circleMarker([a[0],a[1]],{radius:7,color:"#fff",weight:2,fillColor:"#16a34a",fillOpacity:1}).bindTooltip("출발").addTo(hl);
    L.circleMarker([zz[0],zz[1]],{radius:7,color:"#fff",weight:2,fillColor:"#111827",fillOpacity:1}).bindTooltip("도착").addTo(hl);
    if(zoom) fit(t.group.getBounds().pad(.15),{maxZoom:15});
  }
  renderList();
}

/* ---------- 파일 로드 ---------- */
function toast(msg,ms=3500){ const el=$("#toast"); el.textContent=msg; el.style.display="block"; clearTimeout(toast.t); toast.t=setTimeout(()=>el.style.display="none",ms); }
/* ---------- 불러온 GPX 보관 (IndexedDB): 새로고침·앱 재시작 후에도 유지 ---------- */
const idb=new Promise(res=>{ try{ const r=indexedDB.open(PAGE==="nav"?"gpxt":"gpxv",1); r.onupgradeneeded=()=>r.result.createObjectStore("gpx",{keyPath:"name"}); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }catch(e){ res(null); } });
const dbDo=async(mode,fn)=>{ const db=await idb; if(!db) return null; return new Promise(res=>{ try{ const tx=db.transaction("gpx",mode),st=tx.objectStore("gpx"),rq=fn(st); tx.oncomplete=()=>res(rq&&rq.result); tx.onerror=tx.onabort=()=>res(null); }catch(e){ res(null); } }); };
const dbPut=(name,text)=>dbDo("readwrite",st=>st.put({name,text}));
const dbDel=name=>dbDo("readwrite",st=>st.delete(name));
const dbClear=()=>dbDo("readwrite",st=>st.clear());
const dbAll=async()=>(await dbDo("readonly",st=>st.getAll()))||[];

async function loadTexts(items,persist=true){           // items: [{name,text}]
  let added=0;
  toast("읽는 중…",60000);
  await new Promise(r=>setTimeout(r,20));
  for(const it of items){
    try{
      const {trks,wpts:w}=parseGpx(it.text,it.name);
      const dup=files.find(f=>f.name===it.name); if(dup) removeFile(dup.id,true);   // 같은 이름은 교체
      const list=normalize(trks,it.name);
      const fid=nextFid++;
      addTracks(list,it.name,fid); added+=list.length;
      w.forEach(p=>wpts.push([...p,fid])); files.push({id:fid,name:it.name});
      if(persist) dbPut(it.name,it.text);
    }catch(err){ toast(String(err.message||err),6000); }
  }
  assignColors(); applyVisibility();
  renderFiles();
  drawWpts();
  const b=L.latLngBounds([]);
  tracks.forEach(t=>t.group&&t.visible&&b.extend(t.group.getBounds()));
  if(b.isValid()&&added){ if(mode!=="view"){ follow=false; refreshUi(); } fit(b.pad(.05)); }   // 트래커 중 코스를 불러오면 코스 전체를 보여주고 따라가기는 해제
  recLine.bringToFront();
  if(added) toast(`트랙 ${added}개 추가`);
}
function renderFiles(){
  $("#fileinfo").textContent=files.length?`${files.length}개 파일 · 트랙 ${tracks.length}개`:"로드된 파일 없음";
  $("#filelist").innerHTML=files.map(f=>{
    const n=tracks.filter(t=>t.fid===f.id).length;
    return `<div class="f"><span class="fn" title="${esc(f.name)}">${esc(f.name)}</span><span class="fc">${n}</span><button data-rm="${f.id}" title="이 파일 빼기">✕</button></div>`;
  }).join("");
}
$("#filelist").addEventListener("click",e=>{
  const b=e.target.closest("[data-rm]"); if(!b) return;
  e.stopPropagation(); removeFile(+b.dataset.rm);
});
function removeFile(fid,quiet){
  const gone=tracks.filter(t=>t.fid===fid);
  gone.forEach(t=>{ if(t.group){map.removeLayer(t.group);map.removeLayer(t.link);} if(t.id===selId){selId=null;hl.clearLayers();} });
  tracks=tracks.filter(t=>t.fid!==fid);
  wpts=wpts.filter(p=>p[3]!==fid);
  const f=files.find(x=>x.id===fid); files=files.filter(x=>x.id!==fid);
  if(f) dbDel(f.name);
  assignColors(); applyVisibility(); renderFiles(); drawWpts();
  const b=L.latLngBounds([]);
  tracks.forEach(t=>t.group&&t.visible&&b.extend(t.group.getBounds()));
  if(b.isValid()) fit(b.pad(.05));
  if(!quiet) toast(`${f?f.name:"파일"} 제거 (트랙 ${gone.length}개)`);
}
const WPT_NEAR_KM=1.0;
function nearTrack(p,t){                     // 점 p(위경도)와 트랙 선분들 사이 최단거리 ≤ WPT_NEAR_KM ?
  const kx=Math.cos(p[0]*Math.PI/180)*111.32, ky=110.57, pad=WPT_NEAR_KM/ky;
  for(const sg of t.segs){
    for(let i=1;i<sg.length;i++){
      const a=sg[i-1], b=sg[i];
      if(Math.abs(a[0]-p[0])>pad&&Math.abs(b[0]-p[0])>pad) continue;     // 위도 차가 크면 건너뜀
      const ax=(a[1]-p[1])*kx, ay=(a[0]-p[0])*ky, bx=(b[1]-p[1])*kx, by=(b[0]-p[0])*ky;
      const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
      const u=l2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/l2)):0;
      if(Math.hypot(ax+u*dx,ay+u*dy)<=WPT_NEAR_KM) return true;
    }
  }
  return false;
}
function drawWpts(){
  wptLayer.clearLayers();
  const vis=tracks.filter(t=>t.visible);   // 웨이포인트는 트랙 소속 정보가 없어서, 지금 보이는 트랙 경로 가까이(WPT_NEAR_KM)에 있는 것만 표시
  wpts.filter(p=>vis.some(t=>t.fid===p[3]&&nearTrack(p,t))).forEach(p=>L.circleMarker([p[0],p[1]],{radius:5,color:"#fff",weight:1.5,fillColor:"#f59e0b",fillOpacity:1}).bindTooltip(esc(p[2]||"waypoint")).addTo(wptLayer));
}
async function readFiles(fl){
  const items=[];
  for(const f of fl) items.push({name:f.name,text:await f.text()});
  loadTexts(items);
}
const drop=$("#drop"),file=$("#file");
drop.onclick=()=>file.click();
file.onchange=()=>{ if(file.files.length) readFiles(file.files); file.value=""; };
["dragenter","dragover"].forEach(ev=>addEventListener(ev,e=>{e.preventDefault();drop.classList.add("over")}));
["dragleave","drop"].forEach(ev=>addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("over")}));
addEventListener("drop",e=>{ const fl=[...e.dataTransfer.files].filter(f=>/\.gpx$/i.test(f.name)); if(fl.length) readFiles(fl); else toast("GPX 파일만 지원합니다."); });

["q","from","to","minkm"].forEach(id=>$("#"+id).addEventListener("input",()=>{clearTimeout(applyVisibility.t);applyVisibility.t=setTimeout(applyVisibility,150)}));
$("#colorBy").onchange=recolor;
$("#link").onchange=applyVisibility;
baseSel.addEventListener("change",recolor);
$("#reset").onclick=()=>{
  tracks.forEach(t=>{ if(t.group){map.removeLayer(t.group);map.removeLayer(t.link);} });
  tracks=[];wpts=[];files=[];selId=null;hl.clearLayers();wptLayer.clearLayers(); dbClear();
  renderFiles(); applyVisibility();
};

/* ---------- 내 위치 / 주행 기록 ----------
   모드: view("기록" 탭, GPS 꺼짐, 저장된 GPX·지난 기록 열람) · nav("트래커" 탭, 내 위치 표시+따라가기+지나온 길 자동 기록)
   기록은 localStorage에 계속 저장되어 새로고침/재실행 후에도 이어지고, GPX로 내보낼 수 있다. */
const DAY_KEY="gpxv.day.";                   // 일자별 저장: gpxv.day.2026-10-26 → 그날 점 배열
const p2=n=>String(n).padStart(2,"0");
const dayOf=t=>{ const d=new Date(t); return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; };
const dirty=new Set();
let recHidden=new Set();                      // 지도에서 숨긴 일자 (체크 해제)
try{ recHidden=new Set(JSON.parse(localStorage.getItem("gpxv.rechidden")||"[]")); }catch(e){}
const saveHidden=()=>{ try{localStorage.setItem("gpxv.rechidden",JSON.stringify([...recHidden]))}catch(e){} };
let mode="view", watchId=null, follow=true, wake=null, recKm=0, lastFix=null, recording=false;   // recording: 트래커 탭에서 "기록 시작"을 눌렀을 때만 true
let rec=[];                                  // [lat,lon,time,ele,새구간여부]
try{
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith(DAY_KEY)){ try{ const a=JSON.parse(localStorage.getItem(k)); if(Array.isArray(a)) rec.push(...a); }catch(e){} } }
  rec.sort((a,b)=>a[2]-b[2]);
  const old=localStorage.getItem("gpxv.rec");   // 이전 단일 키 → 일자별로 이전
  if(old){ const a=JSON.parse(old); if(Array.isArray(a)&&a.length){ rec.push(...a); rec.sort((x,y)=>x[2]-y[2]); rec.forEach(q=>dirty.add(dayOf(q[2]))); } localStorage.removeItem("gpxv.rec"); }
}catch(e){}
const recCase=L.polyline([],{color:"#fff",weight:8,opacity:.95,dashArray:"11 5 3 5",lineCap:"butt",lineJoin:"round",interactive:false}).addTo(map);   // 흰 테두리 점
const recLine=L.polyline([],{color:"#ff1f1f",weight:4.5,opacity:1,dashArray:"11 5 3 5",lineCap:"butt",lineJoin:"round",interactive:false}).addTo(map);   // 빨강 점선: 실시간 이동 기록 전용
const meAcc=L.circle([0,0],{radius:0,color:"#f97316",weight:1,fillOpacity:.12,interactive:false});
const me=L.marker([0,0],{interactive:false,zIndexOffset:1000,
  icon:L.divIcon({className:"me",html:'<div class="mewrap"><svg viewBox="0 0 32 32" width="28" height="28"><path d="M16 3 27 28 16 22 5 28z" fill="#f97316" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg></div>',iconSize:[28,28],iconAnchor:[14,14]})});

function recSegs(){ const s=[]; let cur=null; for(const p of rec){ if(!cur||p[4]){cur=[];s.push(cur)} cur.push(p); } return s; }
function calcRecKm(){ recKm=0; for(const s of recSegs()) for(let i=1;i<s.length;i++) recKm+=hav(s[i-1],s[i]); }
function bringRecFront(){ try{ recCase.bringToFront(); recLine.bringToFront(); }catch(e){} }   // 내 이동 기록은 항상 GPX 경로 위에 그림
function drawRec(){
  const segs=[]; for(const [d,ss] of groupDays()) if(mode==="nav"||!recHidden.has(d)) segs.push(...ss);   // 트래커는 기록 탭 체크와 별개로 전부 표시
  const ll=segs.map(s=>s.map(p=>[p[0],p[1]])); recCase.setLatLngs(ll); recLine.setLatLngs(ll); bringRecFront();
}
function saveRec(){
  const byDay=new Map();
  for(const q of rec){ const d=dayOf(q[2]); if(dirty.has(d)){ if(!byDay.has(d)) byDay.set(d,[]); byDay.get(d).push(q); } }
  for(const [d,pts] of byDay){
    for(let i=0;i<6;i++){
      try{ localStorage.setItem(DAY_KEY+d,JSON.stringify(pts)); break; }
      catch(e){                                // 공간 부족: 가장 오래된 날짜부터 정리
        const olds=Object.keys(localStorage).filter(k=>k.startsWith(DAY_KEY)&&k!==DAY_KEY+d).sort();
        if(!olds.length) break;
        const od=olds[0].slice(DAY_KEY.length); localStorage.removeItem(olds[0]); rec=rec.filter(q=>dayOf(q[2])!==od);
        if(rec[0]) rec[0][4]=1; calcRecKm(); drawRec(); renderRecDays();
        toast(`저장 공간이 부족해 가장 오래된 ${od} 기록을 정리했습니다. 필요하면 미리 GPX로 내려받아 두세요.`,7000);
      }
    }
  }
  dirty.clear();
}

function addRec(c,t){
  if(c.accuracy>50) return;                  // 정확도 나쁜 점 버림
  const ll=[+c.latitude.toFixed(6),+c.longitude.toFixed(6)], last=rec[rec.length-1];
  let start=0;
  if(last){
    const d=hav(last,ll), dt=(t-last[2])/1000;
    if(d<0.01) return;                       // 10m 미만 이동은 기록 안 함
    if((c.speed||0)<2&&d<Math.min(c.accuracy||0,30)*1.2/1000) return;   // 정차·저속 중 GPS 흔들림(정확도 범위 안의 움직임)은 기록 안 함
    // 정차는 점을 안 찍고 시각 차이로 남긴다(도착 점 → 출발 점). 멀리 떨어진 채 5분 넘게 끊겼을 때만 새 구간
    if(dt>300&&d>0.1) start=1;
    else if(dt<=300&&d*1000/Math.max(dt,1)>70) return;// 250km/h 초과 = 튀는 점
    else recKm+=d;
  }else start=1;
  rec.push([ll[0],ll[1],t,c.altitude==null?null:Math.round(c.altitude),start]); dirty.add(dayOf(t));
  drawRec();
  if(rec.length%5===0) saveRec();
}
function setMeArrow(){                       // 내 화살표: 진행방향(없으면 흐리게 위쪽) — 지도가 회전 중이면 화면 기준으로 보정
  const w=me.getElement()&&me.getElement().firstChild; if(!w) return;
  const fixedUp=headUp&&mode==="nav"&&follow&&hdg!=null;   // 지도 회전 모드: 화살표는 화면 위쪽 고정, 지도만 돈다
  w.style.opacity=hdg==null?".55":"1"; w.style.transform=fixedUp?"rotate(0deg)":`rotate(${(hdg||0)+map.getBearing()}deg)`;
}
function effSpd(){                          // 현재 속도(m/s): 새 위치값이 한동안 없으면(정차) 0 — 마지막 속도가 남아 있지 않게
  if(!lastFix||lastFix.spd==null||isNaN(lastFix.spd)) return 0;
  const age=(Date.now()-lastFix.at)/1000, lim=Math.min(12,Math.max(4,7.5/Math.max(lastFix.spd,0.5)+1.5));
  return age>lim?0:lastFix.spd;
}
function placeMe(c){                        // 내 위치 점 + 정확도 원 + 방향
  const ll=[c.latitude,c.longitude];
  lastFix={acc:c.accuracy,spd:c.speed,at:Date.now()};
  if(!map.hasLayer(me)){ meAcc.addTo(map); me.addTo(map); }
  me.setLatLng(ll); meAcc.setLatLng(ll).setRadius(c.accuracy||0);
  setMeArrow();
  return ll;
}
let headUp=false; try{ headUp=localStorage.getItem("gpxv.headup")==="1"; }catch(e){}
let hdg=null, hdgAnchor=null;                // 현재 진행방향(도) / 방향 계산 기준점
/* 방향 = 달릴 땐 GPS 방향, 정차·저속엔 폰 나침반(+ GPS와의 차이를 학습한 보정값) */
let cmp=null, cmpOff=0, cmpN=0, spd=0, hdgSrc="";
const nrm=a=>((a%360)+360)%360, adiff=(a,b)=>((a-b+540)%360)-180;
function cmpHeading(al,be,ga){               // 센서 각도 → 폰이 향한 방위(세워 들면 뒷면, 눕히면 윗변)
  const r=Math.PI/180,cA=Math.cos(al*r),sA=Math.sin(al*r),cB=Math.cos(be*r),sB=Math.sin(be*r),cG=Math.cos(ga*r),sG=Math.sin(ga*r);
  const m12=-cB*sA, m13=cA*sG+cG*sA*sB, m22=cA*cB, m23=sA*sG-cA*cG*sB, bx=-m13, by=-m23, back=Math.hypot(bx,by)>0.6;
  return nrm(Math.atan2(back?bx:m12,back?by:m22)*180/Math.PI);
}
function useCompass(){ if(cmp==null) return false; hdg=nrm(cmp+cmpOff); hdgSrc="센서"; return true; }
let orientT=0;
function onOrient(e){
  if(e.alpha==null||e.beta==null||e.gamma==null||e.absolute===false) return;
  const h=cmpHeading(e.alpha,e.beta,e.gamma);
  cmp=cmp==null?h:nrm(cmp+adiff(h,cmp)*0.25);                  // 떨림 완화(원형 평균)
  const now=Date.now(); if(now-orientT<100) return; orientT=now;
  spd=effSpd(); if(mode==="nav"&&spd<3&&useCompass()){ applyHeading(); setMeArrow(); }
}
addEventListener("deviceorientationabsolute",onOrient,true);
addEventListener("deviceorientation",onOrient,true);
function updateHeading(c,ll){
  spd=c.speed||0;
  if(c.heading!=null&&!isNaN(c.heading)&&spd>=3){                // 시속 11km 이상: GPS 방향 사용 + 나침반 차이 학습
    hdg=c.heading; hdgAnchor=ll; hdgSrc="GPS";
    if(cmp!=null){ cmpOff=cmpN?nrm(cmpOff+adiff(adiff(c.heading,cmp),cmpOff)*0.15):adiff(c.heading,cmp); cmpOff=nrm(cmpOff); cmpN++; }
    return;
  }
  if(useCompass()) return;                                       // 저속·정차: 보정된 나침반
  if(c.heading!=null&&!isNaN(c.heading)&&spd>=1){ hdg=c.heading; hdgAnchor=ll; hdgSrc="GPS"; return; }
  if(!hdgAnchor){ hdgAnchor=ll; return; }
  if(hav(hdgAnchor,ll)>=0.008){ hdg=bearing(hdgAnchor,ll); hdgAnchor=ll; hdgSrc="GPS"; }
}
let tgtB=null, navTimer=null;
function recenter(ll){                       // 구글맵 네비처럼: 내 위치를 화면 아래쪽에 두고 진행방향 앞쪽이 더 보이게
  const z=map.getZoom(), off=0, a=((360-map.getBearing())%360)*Math.PI/180;
  const p=map.project(ll,z); map.setView(map.unproject(p.add([Math.sin(a)*off,-Math.cos(a)*off]),z),z,{animate:false});
}
function navStep(){                          // 0.1초마다 목표 방향으로 부드럽게 회전(최대 8°/틱)
  if(!(headUp&&mode==="nav"&&follow&&tgtB!=null&&map.hasLayer(me))){ clearInterval(navTimer); navTimer=null; return; }
  const cur=map.getBearing(), diff=((tgtB-cur+540)%360)-180;
  if(Math.abs(diff)<0.4) return;
  const st=Math.max(-8,Math.min(8,diff*0.3)); map.setBearing((cur+st+360)%360); recenter(me.getLatLng());
}
function applyHeading(){                     // 진행방향 위 모드: 방향이 잡혀 있고 따라가는 중일 때 목표 방향 갱신 → navStep이 부드럽게 따라감
  if(!headUp||mode!=="nav"||!follow||hdg==null) return;
  tgtB=(360-hdg)%360; if(!navTimer) navTimer=setInterval(navStep,100);
}
function refreshNorth(){ $("#btnNorth").classList.toggle("on",headUp); }
$("#btnNorth").onclick=()=>{
  headUp=!headUp; try{ localStorage.setItem("gpxv.headup",headUp?"1":"0"); }catch(e){}
  if(!headUp) map.setBearing(0);
  else if(mode==="nav"){ follow=true; if(lastFix&&map.hasLayer(me)) map.setView(me.getLatLng(),Math.max(map.getZoom(),16),{animate:false}); applyHeading(); }
  refreshNorth(); refreshUi();
  toast(headUp?(hdg==null?"진행방향이 위쪽 — 조금 움직이면 방향이 잡혀 지도가 회전합니다":"진행방향이 위쪽"):"북쪽이 위쪽",3000);
};
map.on("rotate",()=>{ setMeArrow(); $("#northIcon").style.transform=`rotate(${map.getBearing()}deg)`; });
refreshNorth();
let zoomedOnce=false;
function fitAllTracks(){                     // 불러온 GPX 경로 전체(+내 위치)가 보이게
  const b=L.latLngBounds([]); tracks.forEach(t=>t.group&&t.visible&&b.extend(t.group.getBounds()));
  if(lastFix&&map.hasLayer(me)) b.extend(me.getLatLng());
  if(b.isValid()) fit(b.pad(.05)); else toast("불러온 경로가 없습니다.");
}
function onPos(pos){
  const c=pos.coords; updateHeading(c,[c.latitude,c.longitude]); applyHeading(); const ll=placeMe(c); wxPosUpdate(ll);
  if(follow){ if(!zoomedOnce&&map.getZoom()<15) map.setView(ll,16,{animate:false}); else map.panTo(ll,{animate:false}); zoomedOnce=true; if(headUp&&mode==="nav") recenter(ll); }   // 첫 위치에서만 확대(이후 사용자가 줌을 바꿔도 되돌리지 않음)
  if(recording) addRec(c,pos.timestamp);     // "기록 시작" 중일 때만 지나온 길 기록
  refreshUi();
}
function locateMe(){                         // 양쪽 탭 공통 "내 위치로 이동"
  if(mode==="nav"){
    if(follow){                              // 켜져 있으면 끄기 → 전체 경로 보기(지도는 북쪽 위로)
      follow=false; map.setBearing(0); fitAllTracks(); refreshUi();
      toast("전체 경로 보기 — 내 위치 버튼을 다시 누르면 내 위치로 돌아갑니다",3500); return;
    }
    follow=true; refreshUi(); applyHeading();
    if(lastFix&&map.hasLayer(me)) map.setView(me.getLatLng(),Math.max(map.getZoom(),16),{animate:false}); else toast("위치 찾는 중…",3000);
    return;
  }
  if(!navigator.geolocation){ toast("이 브라우저는 위치 기능을 지원하지 않습니다."); return; }
  toast("내 위치 찾는 중…",8000);
  navigator.geolocation.getCurrentPosition(pos=>{          // 기록 탭: GPS는 꺼둔 채 한 번만 확인
    const ll=placeMe(pos.coords); map.setView(ll,Math.max(map.getZoom(),16),{animate:false}); if(mq.matches) map.panBy([0,sheetH/2],{animate:false}); $("#toast").style.display="none";
  },onErr,{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
}
function onErr(e){
  if(e.code===1){ toast("위치 권한이 거부되었습니다. 브라우저 사이트 설정에서 위치를 허용해 주세요. (file:// 로 열면 막히는 브라우저가 있어 https 로 여는 것이 안전합니다)",9000); setMode("view"); }
  else toast("위치를 받는 중… (실외/하늘이 보이는 곳에서 더 잘 잡힙니다)",4000);
}
const NATIVE=!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());   // 앱(APK)으로 실행 중이면 화면이 꺼져도 위치를 받는 플러그인 사용
let bgId=null, bgPlugin=null;
if(NATIVE&&PAGE==="view"){ let first=false; try{ if(!sessionStorage.getItem("gpx.launched")){ sessionStorage.setItem("gpx.launched","1"); first=true; } }catch(e){} if(first){ location.replace("tracker.html"); } }   // 앱을 켜면 바로 Tracking(자동 기록) 화면으로 시작
function bgBegin(){                          // 네이티브 백그라운드 위치(포그라운드 서비스+알림) — 기록 중일 때만 사용
  if(!bgPlugin) bgPlugin=(Capacitor.registerPlugin?Capacitor.registerPlugin("BackgroundGeolocation"):Capacitor.Plugins.BackgroundGeolocation);
  Promise.resolve(bgPlugin.addWatcher({backgroundTitle:"GPX Tracker",backgroundMessage:"경로 기록 중",requestPermissions:true,stale:false,distanceFilter:0},(l,err)=>{
    if(err){ if(err.code==="NOT_AUTHORIZED"){ toast("위치 권한이 필요합니다. 설정에서 '항상 허용'으로 바꿔 주세요.",8000); try{bgPlugin.openSettings()}catch(e){} } return; }
    onPos({coords:{latitude:l.latitude,longitude:l.longitude,accuracy:l.accuracy,speed:l.speed,heading:l.bearing},timestamp:l.time||Date.now()});
  })).then(id=>{ bgId=id; });
}
function bgEnd(){ if(bgPlugin&&bgId!=null){ try{bgPlugin.removeWatcher({id:bgId})}catch(e){} bgId=null; } }
function webWatchStart(){ if(navigator.geolocation&&watchId==null) watchId=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:1000,timeout:20000}); }
function webWatchStop(){ if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; } }
function swapWatch(){                        // 앱: 기록 중이면 백그라운드 서비스(알림 있음), 아니면 화면 위치만(알림 없음)
  if(!NATIVE) return;
  if(recording){ webWatchStop(); if(bgId==null) bgBegin(); } else { bgEnd(); webWatchStart(); }
}
function startWatch(){
  if(!navigator.geolocation&&!NATIVE){ toast("이 브라우저는 위치 기능을 지원하지 않습니다."); return false; }
  if(NATIVE) swapWatch(); else webWatchStart();
  reqWake(); return true;
}
function stopWatch(){
  if(NATIVE) bgEnd();
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  if(wake){ try{wake.release()}catch(e){} wake=null; }
  map.removeLayer(me); map.removeLayer(meAcc); lastFix=null;
}
function reqWake(){ if("wakeLock" in navigator && !wake) navigator.wakeLock.request("screen").then(l=>{wake=l;l.addEventListener("release",()=>{wake=null})}).catch(()=>{}); }
document.addEventListener("visibilitychange",()=>{ if(document.hidden) saveRec(); else if(mode!=="view") reqWake(); });
addEventListener("pagehide",saveRec);

function setMode(m){
  if(m===mode) return;
  if(m!=="view" && !startWatch()) return;
  mode=m; follow=true;
  drawRec();                                  // 탭별 표시 기준이 다르므로 전환 시 다시 그림
  if(m==="view"){ recording=false; map.setBearing(0); stopWatch(); saveRec(); renderRecDays(); }
  document.body.classList.toggle("live",m!=="view");
  document.querySelectorAll("#seg button").forEach(b=>b.classList.toggle("on",b.dataset.m===m));
  setTimeout(()=>map.invalidateSize(),50);
  if(m==="nav") toast("내 위치 표시 중 — 지나온 길은 '기록 시작'을 눌러야 빨간 선으로 기록됩니다",4000);
  refreshUi();
}
function refreshUi(){
  const hud=$("#hud"), acts=$("#acts");
  const live=mode!=="view";
  hud.classList.toggle("show",live);
  if(live){
    const a=lastFix?`정확도 ${Math.round(lastFix.acc)}m · ${Math.round(effSpd()*3.6)}km/h`:"위치 찾는 중…";
    const idle=rec.length&&lastFix?Math.floor((Date.now()-rec[rec.length-1][2])/60000):0;
    hud.textContent=(recording?"● 기록 중 · ":"")+(headUp?(hdg==null?"방향 대기 · ":`방향 ${Math.round(hdg)}°${hdgSrc?"("+hdgSrc+")":""} · `):"")+a+(rec.length?` · 기록 ${recKm.toFixed(1)}km`:"")+(recording&&idle>=1?` · 정차 ${idle>=60?Math.floor(idle/60)+"시간 "+idle%60:idle}분`:"");
  }
  const br=$("#btnRec"); br.textContent=recording?"■ 기록 종료":"● 기록 시작"; br.classList.toggle("recording",recording);
  acts.classList.toggle("show",live);
  $("#btnLocate").classList.toggle("on",live&&follow);
}
function groupDays(){                       // 일자별 구간 묶음 (자정 넘으면 새 구간)
  const days=new Map(); let prev=null;
  for(const q of rec){
    const day=dayOf(q[2]);
    if(!days.has(day)) days.set(day,[]);
    const segs=days.get(day);
    if(!segs.length||q[4]||(prev&&dayOf(prev[2])!==day)) segs.push([]);
    segs[segs.length-1].push(q); prev=q;
  }
  return days;
}
function dayStats(segs){
  let km=0,stop=0;
  segs.forEach(sg=>{ for(let i=1;i<sg.length;i++){ const d=hav(sg[i-1],sg[i]),dt=(sg[i][2]-sg[i-1][2])/1000; km+=d; if(dt>60&&d<0.1) stop+=dt; } });
  const f=segs[0][0][2],l=segs[segs.length-1][segs[segs.length-1].length-1][2];
  return {km,stop:Math.round(stop/60),f,l};
}
function exportDay(day){
  const segs=groupDays().get(day); if(!segs){ toast("기록이 없습니다."); return; }
  const st=dayStats(segs);
  const name=`${day} 주행기록 ${st.km.toFixed(1)}km`;
  const x='<?xml version="1.0" encoding="UTF-8"?>'+"\n"+'<gpx version="1.1" creator="gpx_viewer" xmlns="http://www.topografix.com/GPX/1/1">'+"\n"+'<trk><name>'+esc(name)+'</name>'+
    segs.map(sg=>"<trkseg>"+sg.map(q=>`<trkpt lat="${q[0]}" lon="${q[1]}">${q[3]!=null?`<ele>${q[3]}</ele>`:""}<time>${new Date(q[2]).toISOString()}</time></trkpt>`).join("")+"</trkseg>").join("\n")+
    "</trk>\n</gpx>\n";
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([x],{type:"application/gpx+xml"}));
  a.download=`주행기록_${day}.gpx`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);
  toast(`${day} GPX 내려받기 요청`);
}
const hm=t=>{ const d=new Date(t); return p2(d.getHours())+":"+p2(d.getMinutes()); };
function renderRecDays(){
  const box=$("#recdays"); if(!box) return;
  const days=[...groupDays()].sort((a,b)=>a[0]<b[0]?1:-1);
  if(!days.length){ box.style.display="none"; return; }
  box.style.display="block";
  const allOn=days.every(([d])=>!recHidden.has(d));
  box.innerHTML=`<div class="rdh"><input type="checkbox" id="rcall" ${allOn?"checked":""} title="전체 선택/해제"><span>내 주행기록 ${days.length}일</span><span style="margin-left:auto;font-weight:400">폰에 자동 저장</span></div><div class="rdl">`+days.map(([d,segs])=>{
    const st=dayStats(segs);
    return `<div class="rd" data-d="${d}"><input type="checkbox" data-rc="${d}" ${recHidden.has(d)?"":"checked"}><span class="sw" style="background:#ff1f1f"></span><div class="t"><div class="d">${d.slice(5)} <span style="font-weight:400;color:var(--muted)">${st.km.toFixed(1)}km</span></div><div class="n">${hm(st.f)}~${hm(st.l)}${st.stop?` · 정차 ${st.stop}분`:""}</div></div><button data-x="${d}" title="GPX로 내려받기">⬇</button><button data-del="${d}" title="삭제">삭제</button></div>`;
  }).join("")+"</div>";
}
$("#recdays").addEventListener("click",e=>{
  if(e.target.id==="rcall"){ const on=e.target.checked; recHidden=on?new Set():new Set([...groupDays().keys()]); saveHidden(); drawRec(); renderRecDays(); return; }
  const c=e.target.closest("[data-rc]"); if(c){ if(c.checked) recHidden.delete(c.dataset.rc); else recHidden.add(c.dataset.rc); saveHidden(); drawRec(); renderRecDays(); return; }
  const x=e.target.closest("[data-x]"); if(x){ exportDay(x.dataset.x); return; }
  const del=e.target.closest("[data-del]"); if(del){ deleteDay(del.dataset.del); return; }
  const r=e.target.closest(".rd"); if(!r) return;
  const segs=groupDays().get(r.dataset.d); if(!segs) return;
  if(recHidden.has(r.dataset.d)){ recHidden.delete(r.dataset.d); saveHidden(); drawRec(); renderRecDays(); }
  fit(L.latLngBounds(segs.flat().map(q=>[q[0],q[1]])).pad(.15),{maxZoom:16});
});
$("#seg").addEventListener("click",e=>{ const b=e.target.closest("[data-go]"); if(b&&!b.classList.contains("on")){ saveRec(); location.href=b.dataset.go; } });   // 탭 = 별도 페이지 이동
$("#btnRec").onclick=()=>{
  recording=!recording;
  swapWatch();                                         // 앱: 기록 시작=백그라운드 서비스(알림) 켜기, 종료=끄기
  if(!recording) saveRec();
  else { follow=true; if(lastFix&&map.hasLayer(me)){ map.setView(me.getLatLng(),Math.max(map.getZoom(),16),{animate:false}); applyHeading(); } }   // 시작하면 내 위치 버튼처럼 화살표를 정중앙에 두고 확대
  toast(recording?"기록 시작 — 지나온 길을 빨간 선으로 남깁니다":"기록 종료 — 저장되었습니다",3000);
  refreshUi();
};
function deleteDay(day){
  const segs=groupDays().get(day); if(!segs) return;
  if(!confirm(`${day} 주행기록(${dayStats(segs).km.toFixed(1)}km)을 삭제합니다. 되돌릴 수 없습니다.\n필요하면 먼저 ⬇로 GPX를 내려받으세요.\n\n삭제할까요?`)) return;
  try{ localStorage.removeItem(DAY_KEY+day); }catch(e){}
  rec=rec.filter(q=>dayOf(q[2])!==day); dirty.delete(day); recHidden.delete(day); saveHidden();
  if(rec[0]) rec[0][4]=1;
  calcRecKm(); drawRec(); renderRecDays(); refreshUi(); toast(`${day} 기록을 삭제했습니다.`);
}
$("#btnLocate").onclick=locateMe;
setInterval(()=>{ if(mode!=="view") refreshUi(); },2000);   // 정차 시간·속도 갱신
map.on("dragstart",()=>{ if(follow&&mode!=="view"){ follow=false; refreshUi(); } });
calcRecKm(); drawRec(); refreshUi(); renderRecDays();
if(PAGE==="nav") setMode("nav");               // 트래커 페이지는 열자마자 내 위치 추적 시작

const APP_V="v0.50"; $("#ver").textContent=APP_V;
if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
  const had=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(r=>r.update()).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(had&&!window.__rl){ window.__rl=1; saveRec(); location.reload(); } });   // 새 버전이 적용되면 한 번 자동 새로고침
}
$("#upd").onclick=async()=>{                  // 캐시만 비우고 다시 받기 (localStorage의 주행기록은 그대로)
  toast("업데이트 중…",5000);
  try{ for(const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for(const k of await caches.keys()) if(k!=="gpx-tiles") await caches.delete(k); }catch(e){}
  saveRec(); location.reload();
};

dbAll().then(a=>{ if(a.length) loadTexts(a.map(x=>({name:x.name,text:x.text})),false); });   // 지난번에 불러온 GPX 복원

/* ---------- 자동 로드: http(s)로 열었을 때 ?src=a.gpx,b.gpx 또는 기본 경로 ---------- */
(async function auto(){
  if(!/^https?:$/.test(location.protocol)) return;
  const src=new URLSearchParams(location.search).get("src");
  const cand=src?src.split(","):["gpx_전체/타임라인_전체.gpx"];
  const items=[];
  for(const u of cand){ try{ const r=await fetch(u); if(r.ok) items.push({name:u.split("/").pop(),text:await r.text()}); }catch(e){} }
  if(items.length) loadTexts(items);
})();
/* ---------- 오프라인 지도 (경로 주변 타일을 폰에 저장) ---------- */
const OFF_PLAN=[[7,25],[8,25],[9,25],[10,20],[11,15],[12,8],[13,4],[14,2.5],[15,1.2]];   // [줌, 경로에서 반경 km]
function tileUrls(tpl){
  const set=new Map();
  const pts=[]; for(const t of tracks) for(const sg of t.segs){ let last=null; for(const p of sg){ if(!last||hav(last,p)>0.4){ pts.push(p); last=p; } } }
  for(const [z,r] of OFF_PLAN){ const n=2**z;
    for(const p of pts){ const x=(p[1]+180)/360*n, s=Math.sin(p[0]*Math.PI/180), y=(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n;
      const k=Math.ceil(r/(40075*Math.cos(p[0]*Math.PI/180)/n)), fx=Math.floor(x), fy=Math.floor(y);
      for(let a=Math.max(0,fx-k);a<=Math.min(n-1,fx+k);a++) for(let b=Math.max(0,fy-k);b<=Math.min(n-1,fy+k);b++) set.set(z+"/"+a+"/"+b,[z,a,b]); } }
  return [...set.values()].map(([z,x,y])=>tpl.replace("{z}",z).replace("{x}",x).replace("{y}",y));
}
async function offStatus(){
  try{ const c=await caches.open("gpx-tiles"); const n=(await c.keys()).length; $("#offinfo").textContent=n?`저장된 지도 ${n.toLocaleString()}장 (인터넷 없이도 표시)`:"저장된 지도 없음"; return n; }catch(e){ $("#offinfo").textContent="이 브라우저는 오프라인 지도 저장을 지원하지 않음"; return 0; }
}
let offBusy=false;
async function offDownload(){
  if(offBusy) return;
  if(!tracks.length){ toast("먼저 위에서 GPX 파일을 불러오세요."); return; }
  if(!navigator.onLine){ toast("인터넷 연결 상태에서 받아야 합니다."); return; }
  const k=baseSel.value, tpls=BASES[k].slice(0,1).concat(BASES[k][2]?[BASES[k][2]]:[]);
  let urls=[]; for(const t of tpls) urls=urls.concat(tileUrls(t));
  if(!confirm(`경로 주변 지도 ${urls.length.toLocaleString()}장(약 ${Math.round(urls.length*25/1024)}MB)을 저장합니다.
선택된 지도: ${k}
Wi-Fi 권장. 계속할까요?`)) return;
  offBusy=true; const btn=$("#btnOff"); btn.disabled=true;
  const c=await caches.open("gpx-tiles"); let done=0, fail=0, idx=0;
  async function worker(){
    while(idx<urls.length){ const u=urls[idx++];
      try{ if(!(await c.match(u))){ let r; try{ r=await fetch(u); }catch(e){ r=await fetch(u,{mode:"no-cors"}); } if(r.ok||r.type==="opaque") await c.put(u,r); else fail++; } }catch(e){ fail++; }
      done++; if(done%25===0||done===urls.length) $("#offinfo").textContent=`받는 중 ${done.toLocaleString()} / ${urls.length.toLocaleString()}${fail?` (실패 ${fail})`:""}`;
    } }
  await Promise.all(Array.from({length:6},worker));
  offBusy=false; btn.disabled=false; await offStatus();
  toast(fail?`완료 (실패 ${fail}장 — 다시 누르면 빠진 것만 받음)`:"오프라인 지도 저장 완료",6000);
}
/* ---------- 상단 날씨 한 줄 (Open-Meteo, 모델 3개 비교 · 오프라인이면 마지막 값) ---------- */
let wxPos=null; try{ wxPos=JSON.parse(localStorage.getItem("gpx.wxpos")||"null"); }catch(e){}
function wxText(d){
  const cur=d.current, h=d.hourly, key=p=>Object.keys(h).filter(k=>k.startsWith(p+"_"));
  const pr=key("precipitation"), wg=key("wind_gusts_10m"), wc=key("weather_code");
  const i0=h.time.findIndex(t=>t.slice(0,13)>=cur.time.slice(0,13)); if(i0<0||!pr.length) return "";
  const end=Math.min(h.time.length,i0+12), hr=i=>+h.time[i].slice(11,13), rng=f=>{ for(let i=i0;i<end;i++){ const r=f(i); if(r) return [i,r]; } return null; };
  const nR=i=>pr.filter(k=>(h[k][i]||0)>=0.3).length, mm=i=>Math.max(...pr.map(k=>h[k][i]||0)), gust=i=>Math.max(0,...wg.map(k=>h[k][i]||0));
  const issues=[];
  const storm=rng(i=>wc.some(k=>h[k][i]>=95)); if(storm) issues.push(`${hr(storm[0])}시 뇌우 가능성`);
  if((cur.precipitation||0)>=0.2||nR(i0)>=2){ let e=i0; while(e+1<end&&nR(e+1)>=1) e++; issues.push(`지금 비 · ${hr(e)+1}시까지 이어질 수 있음`); }
  else { const r=rng(i=>nR(i)>=1&&nR(i)); if(r) issues.push(`${hr(r[0])}시부터 ${r[1]>=2?"비 예상":"비 가능성(일부 모델)"} · 최대 ${mm(r[0]).toFixed(1)}mm/h`); }
  const w=rng(i=>gust(i)>=50&&gust(i)); if(w){ const g=Math.round(w[1]); issues.push(`${hr(w[0])}시 ${g>=90?"태풍급 강풍":g>=65?"강풍":"바람 강함"}(돌풍 ${g}km/h)`); }
  return `현재 ${Math.round(cur.temperature_2m)}° · 습도 ${Math.round(cur.relative_humidity_2m)}%`+(issues.length?" · "+issues.join(" · "):"");
}
async function wxRefresh(){
  const el=$("#wx"); if(!el||el.tagName==="INPUT") return;
  const c=wxPos||(()=>{ const m=map.getCenter(); return [m.lat,m.lng]; })();
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0].toFixed(3)}&longitude=${c[1].toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation&hourly=precipitation,wind_gusts_10m,weather_code&models=ecmwf_ifs025,gfs_seamless,icon_seamless&forecast_days=2&timezone=auto`);
    const t=wxText(await r.json()); if(!t) throw 0;
    el.textContent=t; el.hidden=false; try{ localStorage.setItem("gpx.wx",JSON.stringify({t,at:Date.now()})); }catch(e){}
  }catch(e){
    let o=null; try{ o=JSON.parse(localStorage.getItem("gpx.wx")||"null"); }catch(x){}
    if(o){ const d=new Date(o.at); el.textContent=`${o.t} (${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")} 기준)`; el.hidden=false; }
  }
}
function wxPosUpdate(ll){ if(!wxPos||hav(wxPos,ll)>15){ wxPos=ll; try{ localStorage.setItem("gpx.wxpos",JSON.stringify(ll)); }catch(e){} wxRefresh(); } }   // 15km 이상 이동하면 그 위치 날씨로 갱신
setTimeout(wxRefresh,1200); setInterval(wxRefresh,15*60e3);

if($("#btnOff")&&$("#btnOff").tagName==="BUTTON"){ $("#btnOff").onclick=offDownload; offStatus(); }

/* ---------- 절전 화면: 검은 화면(OLED 소등)에 방향·속도만 — 탭: 방향만↔방향+속도, 길게: 종료 ---------- */
(function(){
  const dim=$("#dim"); if(!dim||dim.tagName==="INPUT"||!$("#btnDim")) return;
  let ver=1, timer=null, hold=null, hintT=null; try{ ver=+localStorage.getItem("gpx.dimv")||1; }catch(e){}
  const setBright=v=>{ try{ window.AndroidBright&&window.AndroidBright.setBrightness(v); }catch(e){} };
  const NAMES=["북","북북동","북동","동북동","동","동남동","남동","남남동","남","남남서","남서","서남서","서","서북서","북서","북북서"];
  /* --- 경로 안내(보기 3): GPX 좌표 순서를 따라 진행 위치를 기억하고, 앞쪽 목표점 방향을 화살표로 --- */
  let route=null, rIdx=-1, shown=0, saveT=0;
  function buildRoute(){
    const vis=tracks.filter(t=>t.visible!==false), sig=vis.map(t=>t.id+":"+t.pts).join(",");
    if(route&&route.sig===sig) return route;
    const pts=[], ends=[]; for(const t of vis){ for(const sg of t.segs) for(const p of sg) pts.push([p[0],p[1]]); ends.push(pts.length-1); }   // ends: 트랙(=하루)별 마지막 점 번호
    const cum=[0]; for(let i=1;i<pts.length;i++) cum.push(cum[i-1]+hav(pts[i-1],pts[i]));
    rIdx=-1; try{ const o=JSON.parse(localStorage.getItem("gpx.ridx")||"null"); if(o&&o.sig===sig&&o.i<pts.length&&Date.now()-(o.t||0)<12*3600e3) rIdx=o.i; }catch(e){}     // 앱을 껐다 켜도 진행 위치 복원(12시간 지나면 새 주행으로 보고 버림)
    return (route={sig,pts,cum,ends});
  }
  function nearest(pts,ll,from,to,ref){          // [인덱스, 거리(m)] — ref가 있으면 최단거리+20m 이내 후보 중 ref에 가장 가까운 번호(겹치는 구간에서 진행 위치 우선, ref=0이면 가장 앞 번호)
    const cl=Math.cos(ll[0]*Math.PI/180), lo=Math.max(0,from), hi=Math.min(pts.length-1,to); let bi=-1,bd=1e18;
    for(let i=lo;i<=hi;i++){ const dy=pts[i][0]-ll[0], dx=(pts[i][1]-ll[1])*cl, d=dy*dy+dx*dx; if(d<bd){ bd=d; bi=i; } }
    const m=Math.sqrt(bd)*111320;
    if(ref!=null&&bi>=0){ const lim=(m+20)/111320; let best=bi, bg=1e9; for(let i=lo;i<=hi;i++){ const dy=pts[i][0]-ll[0], dx=(pts[i][1]-ll[1])*cl; if(Math.sqrt(dy*dy+dx*dx)<=lim){ const g=Math.abs(i-ref); if(g<bg){ bg=g; best=i; } } } bi=best; }
    return [bi,m];
  }
  function guide(){
    const R=buildRoute(); if(!R.pts.length||!lastFix||!map.hasLayer(me)) return null;
    const p=me.getLatLng(), ll=[p.lat,p.lng]; let i,d;
    if(rIdx<0){ [i,d]=nearest(R.pts,ll,0,R.pts.length-1,0); }
    else{
      [i,d]=nearest(R.pts,ll,rIdx-60,rIdx+400,null);                                    // 진행 위치 근처(앞쪽 위주)에서만 찾음
      if(d>400){ const [gi,gd]=nearest(R.pts,ll,0,R.pts.length-1,rIdx); if(gd<150){ i=gi; d=gd; } }   // 경로에서 크게 벗어났다가 다른 곳의 경로 위에 서면 그 위치로 재설정(앞뒤 무관)
    }
    if(i!==rIdx||saveT++%20===0){ try{ localStorage.setItem("gpx.ridx",JSON.stringify({sig:R.sig,i,t:Date.now()})); }catch(e){} }
    rIdx=i;
    const look=Math.max(0.12,effSpd()*8/1000); let j=i; while(j<R.pts.length-1&&R.cum[j]-R.cum[i]<look) j++;
    const e=R.ends.find(x=>x>=i); const today=e==null?null:R.cum[e]-R.cum[i];
    return {d,brg:bearing(ll,R.pts[j]),rem:R.cum[R.cum.length-1]-R.cum[i],today:R.ends.length>1?today:null};
  }
  const VNAME=["방향만","방향+속도","경로 안내"];
  function render(){
    const h=(typeof hdg==="number")?hdg:null, sp=Math.round(effSpd()*3.6);
    const g=ver===3?guide():null;
    $("#dimRose").style.display=ver===3?"none":""; $("#dimGo").style.display=ver===3?"":"none";
    $("#roseRot").style.transform=`rotate(${h==null?0:-h}deg)`;                       // 진행방향이 항상 위, 북쪽 표시가 돈다
    if(ver===3){
      if(!g) $("#dimDir").textContent="경로·위치 대기";
      else{
        const rel=h==null?g.brg:g.brg-h, dl=((rel-shown+540)%360)-180; shown=shown+dl;     // 화면 위=직진, 오른쪽=우회전 쪽
        $("#goArrow").parentElement.style.transform=`rotate(${shown}deg)`;
        $("#dimDir").textContent=(g.d<40?"경로 위":`경로 이탈 ${Math.round(g.d)}m`)+(h==null?" · 방향 미확정":"");
      }
    }else $("#dimDir").textContent=h==null?"방향 --":`${NAMES[Math.round(h/22.5)%16]} ${Math.round(h)}°`;
    $("#dimSpd").innerHTML=ver>=2?`${sp}<small>km/h</small>`:"";
    $("#dimRec").textContent=recording?"● REC":"";
  }
  function hint(){ const el=$("#dimHint"); el.textContent=`보기: ${VNAME[ver-1]} · 탭: ${VNAME[ver%3]}(으)로 · 길게 누르기: 종료`; el.classList.add("show"); clearTimeout(hintT); hintT=setTimeout(()=>el.classList.remove("show"),3500); }
  function open_(){ dim.hidden=false; reqWake(); render(); hint(); timer=setInterval(render,250); }
  function close_(){ dim.hidden=true; clearInterval(timer); timer=null; }
  $("#btnDim").onclick=open_;
  dim.addEventListener("pointerdown",()=>{ clearTimeout(hold); hold=setTimeout(()=>{ hold=null; close_(); },700); });
  dim.addEventListener("pointerup",()=>{ if(hold){ clearTimeout(hold); hold=null; ver=ver%3+1; try{localStorage.setItem("gpx.dimv",ver)}catch(e){} render(); hint(); } });
  dim.addEventListener("pointercancel",()=>{ clearTimeout(hold); hold=null; });
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&!dim.hidden) reqWake(); });
})();
})();
