import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Tesseract fetches its worker/core/language data from these CDNs; cache them so OCR works offline.
registerRoute(
  ({ url }) => /(^|\.)jsdelivr\.net$|projectnaptha\.com$/.test(url.hostname),
  new CacheFirst({ cacheName: 'ocr-assets', plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })] }),
);

// Android "Share to app": the shared PDF arrives as a multipart POST. Stash it and redirect to the app.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const file = (await request.formData()).get('pdf');
      if (file) {
        const cache = await caches.open('shared');
        await cache.put('file', new Response(file, { headers: { 'x-name': encodeURIComponent(file.name || 'shared.pdf') } }));
      }
      return Response.redirect(self.registration.scope + '?shared=1', 303);
    })(),
  );
});
