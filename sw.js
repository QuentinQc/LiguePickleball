// Service worker minimal pour les notifications push de Dinkeo.
// À déployer à la RACINE du site (à côté de index.html), par ex. dinkeo.ca/sw.js
// — la portée d'un service worker est limitée à son propre dossier et ceux
// en dessous, donc il doit être au même niveau que la page qui l'enregistre.

self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event){
  let data = {};
  try{
    data = event.data ? event.data.json() : {};
  }catch(e){
    data = { title: 'Dinkeo', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Dinkeo';
  const options = {
    body: data.body || '',
    data: { url: data.url || '/' }
  };
  if(data.icon) options.icon = data.icon;
  if(data.badge) options.badge = data.badge;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for(const client of clientList){
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
