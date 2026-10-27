/**
 * sw.js — سرویس‌ورکر استاندارد PWA با کش تفکیک‌شده و نسخه خودکار
 * - فایل‌های پوسته برنامه (App Shell): استراتژی Cache-First
 * - فایل‌های داده پویا (data/prices.json, data/history.json, data/symbols.json, data/alerts.json): استراتژی Network-First
 * - عدم کش درخواست‌های غیر GET، درخواست‌های Cross-Origin و پاسخ‌های غیر 200
 */

const APP_VERSION = '2026.10.27-v21-premium';
const SHELL_CACHE = `wealth-shell-${APP_VERSION}`;
const DATA_CACHE = `wealth-data-${APP_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/premium-overrides.css',
  './js/data.js',
  './js/compute.js',
  './js/render.js',
  './js/sync.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg'
];

const DYNAMIC_DATA_PATHS = [
  '/data/prices.json',
  '/data/history.json',
  '/data/symbols.json',
  '/data/alerts.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async cache => {
      for (const asset of APP_SHELL_FILES) {
        try {
          const req = new Request(asset, { cache: 'reload' });
          const res = await fetch(req);
          if (res && res.status === 200 && res.type === 'basic') {
            await cache.put(req, res);
          }
        } catch (_) {
          // در صورت نبود یکی از فایل‌های اختیاری، نصب متوقف نشود
        }
      }
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // ۱. فقط درخواست‌های GET کش شوند
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ۲. درخواست‌های Cross-Origin (مانند APIهای خارجی، فونت‌ها یا CDNها) کش نشوند
  if (url.origin !== self.location.origin) return;

  const isDataJson = DYNAMIC_DATA_PATHS.some(p => url.pathname.endsWith(p));

  // ۳. استراتژی Network-First برای فایل‌های داده (prices.json و history.json)
  if (isDataJson) {
    event.respondWith(
      fetch(request)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            const copy = networkRes.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  // ۴. استراتژی Cache-First برای فایل‌های خود برنامه (App Shell)
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cachedRes => {
      if (cachedRes) return cachedRes;
      return fetch(request).then(networkRes => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const copy = networkRes.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        }
        return networkRes;
      });
    })
  );
});
