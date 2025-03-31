// Service Worker for Video Streaming PWA
const CACHE_NAME = 'video-stream-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/style.css'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip handling for video files - we'll stream these directly
  if (isVideoRequest(event.request.url)) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached response if found
        if (response) {
          return response;
        }
        
        // Otherwise, fetch from network
        return fetch(event.request).then(networkResponse => {
          // Don't cache API calls or other non-GET requests
          if (!networkResponse || networkResponse.status !== 200 || event.request.method !== 'GET') {
            return networkResponse;
          }
          
          // Clone the response as it can only be consumed once
          let responseToCache = networkResponse.clone();
          
          // Cache the fetched response
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        });
      })
      .catch(error => {
        console.error('Fetch error:', error);
        // You could return a custom offline page here
      })
  );
});

// Helper function to check if a request is for a video file
function isVideoRequest(url) {
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.mkv'];
  return videoExtensions.some(ext => url.toLowerCase().endsWith(ext));
}