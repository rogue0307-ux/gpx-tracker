const V="gpx-tracker-v0.33";
const CORE=["./","./index.html","./tracker.html","./app.js","./app.css","./manifest.webmanifest","./icon-192.png","./icon-512.png","./lib/leaflet.js","./lib/leaflet-rotate.js","./lib/leaflet.css","./lib/images/layers.png","./lib/images/layers-2x.png","./lib/images/marker-icon.png","./lib/images/marker-shadow.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!=="gpx-tiles").map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin){                        // 지도 타일: 저장분 우선, 없으면 네트워크 (오프라인 지도)
    if(e.request.method==="GET"&&/arcgisonline\.com|tile\.openstreetmap\.org|opentopomap\.org/.test(u.host)){
      e.respondWith(caches.open("gpx-tiles").then(c=>c.match(u.href).then(r=>r||fetch(e.request))));
    }
    return;
  }
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));  // 온라인이면 최신, 오프라인이면 캐시
});
