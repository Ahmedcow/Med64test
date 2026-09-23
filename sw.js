const CACHE='medex-v5-20260923';
const SHELL=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.pathname.includes('/api/'))return;
  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(res=>{
      if(res.ok && (url.origin===location.origin || url.pathname.includes('/questions/'))){
        const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy));
      }
      return res;
    }).catch(()=>caches.match('./index.html').then(x=>x||caches.match('./'))))
  );
});
