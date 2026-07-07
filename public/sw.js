// ─────────────────────────────────────────────────────────────
//  TownScribe Service Worker
//  Handles: Push notifications + smart tab focus
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'townscribe-v1';

// ── INSTALL: activate immediately, no waiting ──────────────────
self.addEventListener('install', () => self.skipWaiting());

// ── ACTIVATE: take control of all open tabs instantly ──────────
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ── PUSH: show notification ────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = {
      title: 'TownScribe',
      body:  event.data.text() || 'New article published.',
      url:   '/',
    };
  }

  const options = {
    body:              data.body  || 'New article published.',
    icon:              data.icon  || '/townscribe-img.jpg',
    badge:                          '/townscribe-img.jpg',
    image:             data.image || null,
    data:              { url: data.url || '/' },
    vibrate:           [200, 100, 200],
    requireInteraction: false,
    tag:               'townscribe-news',   // replaces previous notification of same tag
    renotify:          true,                // vibrate even if replacing
    actions: [
      { action: 'open',    title: 'Read Now' },
      { action: 'dismiss', title: 'Dismiss'  },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'TownScribe', options)
  );
});

// ── NOTIFICATION CLICK: focus existing tab or open new one ─────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // Dismissed via the "Dismiss" action — do nothing
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // If the article is already open in a tab, focus it
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
