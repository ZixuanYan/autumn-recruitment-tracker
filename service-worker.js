const CACHE_NAME = 'autumn-tracker-app-v4.10.1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/app-icon-512.png',
  './icons/apple-touch-icon.png',
  // v4.9.0 跨端单一事实源：index.html 用 <script src="./shared/…"> 引这四个，
  // 缺一个就会让对应常量变 undefined（阶段下拉空、企业性质只剩「未设置」、判重静默失效）。
  // ⚠️ cache.addAll 是**全有或全无**：任一 URL 404 会让整个 install 事件失败、PWA 离线能力全废，
  // 而不是"少缓存四个文件"。所以这四项必须与 build.js 的 shared/ 白名单同时存在
  // （build.js 用 existsSync 自动纳入 shared/，且构建后会自检全部站内引用是否都在 dist 里）。
  './shared/stages.js',
  './shared/company-types.js',
  './shared/company-key.js',
  './shared/default-resume.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
