const V="gpx-tracker-v5";
const CORE=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./lib/leaflet.js","./lib/leaflet.css","./lib/images/layers.png","./lib/images/layers-2x.png","./lib/images/marker-icon.png","./lib/images/marker-shadow.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin) return;                 // 지도 타일 등 외부는 브라우저 기본 처리
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));  // 온라인이면 최신, 오프라인이면 캐시
});
