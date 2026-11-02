// 나의 시간표 — 서비스 워커
// 시간표 내용을 바꾼 뒤에는 아래 CACHE 버전 숫자를 꼭 올려주세요.
const CACHE = 'dshs-study-v92';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './dshs-study.js',
  './updates.js',
  './icon-144.png',
  './icon-192.png',
  './icon-256.png',
  './icon-384.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

// 캐시해도 되는 외부 정적 파일 서버 (버전이 URL 에 박혀 있어 내용이 바뀌지 않음)
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'esm.sh'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

// 네트워크 우선. 다만 네트워크가 느리면(SLOW_MS) 기다리지 않고 저장해 둔 것을 먼저 보여 주고,
// 늦게 온 새 응답은 저장만 해 두었다가 다음에 열 때 씁니다. 저장해 둔 게 없으면 네트워크를 끝까지 기다립니다.
const SLOW_MS = 2500;
function networkFirst(req, key) {
  const net = fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
    }
    return res;
  });
  const cached = () => caches.match(key).then(hit => hit || (key === './index.html' ? caches.match('./') : undefined));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (res) => { if (!done && res) { done = true; resolve(res); } };
    const timer = setTimeout(() => cached().then(finish), SLOW_MS);
    net.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); cached().then(hit => hit ? finish(hit) : (!done && reject(new Error('offline')))); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 리소스는 바뀌지 않는 정적 파일(폰트·라이브러리)만 캐시합니다.
  // Supabase 같은 데이터 요청은 건드리지 않습니다 — 캐시하면 고친 일정 대신 예전 응답이 나옵니다.
  if (url.origin !== location.origin) {
    if (!STATIC_HOSTS.includes(url.hostname)) return;
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // 스크립트·설정·데이터 파일(학사일정 academic.json 등): 항상 최신을 먼저 (고치면 새로고침 한 번에 반영되도록)
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.json')) {
    e.respondWith(networkFirst(req, req));
    return;
  }

  // 앱 문서: 네트워크 우선(최신 시간표), 실패하면 캐시로 오프라인 동작
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 그 외 정적 파일: 캐시 우선
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});

// ---------- 웹 푸시 ----------
self.addEventListener('push', e => {
  let d = { title: 'dshs42.app', body: '새 알림이 있어요', url: './' };
  try { if (e.data) d = { ...d, ...e.data.json() }; } catch (err) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'dshs-study',
    renotify: true,
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin)) return c.focus();
    }
    return self.clients.openWindow(target);
  }));
});
