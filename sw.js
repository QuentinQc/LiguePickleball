// Service worker minimal pour les notifications push de Dinkeo.
// À déployer à la RACINE du site (à côté de index.html), par ex. dinkeo.ca/sw.js
// — la portée d'un service worker est limitée à son propre dossier et ceux
// en dessous, donc il doit être au même niveau que la page qui l'enregistre.

self.addEventListener('install', function(event){
  self.skipWaiting();
});

// Ouverture de l'app : toujours la page la plus récente depuis le réseau (jamais une vieille copie
// gardée par le téléphone). Sans réseau, on retombe sur la copie habituelle.
self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.mode !== 'navigate' || req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
      // Réponse redirigée : refusée par les navigateurs pour une ouverture de page, on laisse faire la requête normale.
      .then(function(r){ return (r && r.ok && !r.redirected) ? r : fetch(req); })
      .catch(function(){ return fetch(req.url, { cache: 'force-cache', credentials: 'same-origin' }).catch(function(){ return fetch(req); }); })
  );
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
  // L'app ouverte (ou en arrière-plan) est prévenue : elle recharge les données sans attendre.
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      list.forEach(function(c){ try{ c.postMessage({ type: 'push-received', url: options.data.url }); }catch(e){} });
    })
  ]));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  // L'app déjà ouverte : on la ramène et on lui dit quel écran ouvrir (event, historique…).
  // Sinon on l'ouvre directement sur cette adresse (?go=…), qu'elle lit au démarrage.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for(const client of clientList){
        if('focus' in client){
          try{ client.postMessage({ type: 'push-click', url: url }); }catch(e){}
          return client.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
