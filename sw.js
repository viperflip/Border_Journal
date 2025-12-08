// ===== SERVICE WORKER ДЛЯ ЖУРНАЛА ЗАЯВОК =====
// Версия кэша - меняйте при обновлении файлов
const CACHE_NAME = 'journal-v1.0';
const RUNTIME_CACHE = 'journal-runtime';

// Файлы для предварительного кэширования
const PRECACHE_URLS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// ===== УСТАНОВКА =====
self.addEventListener('install', event => {
    console.log('[Service Worker] Установка');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Кэширование основных файлов');
                return cache.addAll(PRECACHE_URLS);
            })
            .then(() => {
                console.log('[Service Worker] Пропускаем фазу ожидания');
                return self.skipWaiting();
            })
    );
});

// ===== АКТИВАЦИЯ =====
self.addEventListener('activate', event => {
    console.log('[Service Worker] Активация');

    // Удаляем старые кэши
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
                        console.log('[Service Worker] Удаляем старый кэш:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
            .then(() => {
                console.log('[Service Worker] Запрашиваем контроль над клиентами');
                return self.clients.claim();
            })
    );
});

// ===== ОБРАБОТКА ЗАПРОСОВ =====
self.addEventListener('fetch', event => {
    // Пропускаем POST запросы и chrome-extension
    if (event.request.method !== 'GET' ||
        event.request.url.startsWith('chrome-extension://')) {
        return;
    }

    // Для API и динамических данных - сеть с fallback
    if (event.request.url.includes('/api/') ||
        event.request.url.includes('github.com')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Кэшируем успешные ответы
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(RUNTIME_CACHE).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Оффлайн режим
                    return caches.match(event.request).then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // Если в кэше нет, возвращаем fallback
                        if (event.request.destination === 'document') {
                            return caches.match('./index.html');
                        }

                        return new Response('Оффлайн режим', {
                            status: 503,
                            statusText: 'Нет подключения к интернету',
                            headers: new Headers({
                                'Content-Type': 'text/plain; charset=utf-8'
                            })
                        });
                    });
                })
        );
        return;
    }

    // Для статических файлов - кэш с fallback на сеть
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    console.log('[Service Worker] Из кэша:', event.request.url);
                    return cachedResponse;
                }

                // Если нет в кэше, загружаем из сети
                return fetch(event.request)
                    .then(response => {
                        // Проверяем валидный ответ
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Клонируем ответ для кэша
                        const responseToCache = response.clone();
                        caches.open(RUNTIME_CACHE)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(error => {
                        console.log('[Service Worker] Ошибка загрузки:', error);

                        // Для HTML страниц возвращаем главную
                        if (event.request.destination === 'document') {
                            return caches.match('./index.html');
                        }

                        return new Response('Ошибка загрузки ресурса', {
                            status: 408,
                            headers: { 'Content-Type': 'text/plain' }
                        });
                    });
            })
    );
});

// ===== ФОНОВАЯ СИНХРОНИЗАЦИЯ =====
self.addEventListener('sync', event => {
    console.log('[Service Worker] Фоновая синхронизация:', event.tag);

    if (event.tag === 'sync-data') {
        event.waitUntil(
            syncDataWithServer()
                .then(() => {
                    console.log('[Service Worker] Данные синхронизированы');
                    return self.clients.matchAll()
                        .then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'SYNC_COMPLETE',
                                    timestamp: new Date().toISOString()
                                });
                            });
                        });
                })
                .catch(error => {
                    console.error('[Service Worker] Ошибка синхронизации:', error);
                })
        );
    }
});

// Функция синхронизации (заглушка)
function syncDataWithServer() {
    return new Promise((resolve) => {
        console.log('[Service Worker] Синхронизация данных...');
        setTimeout(resolve, 1000);
    });
}

// ===== PUSH УВЕДОМЛЕНИЯ =====
self.addEventListener('push', event => {
    console.log('[Service Worker] Push уведомление получено');

    const data = event.data ? event.data.json() : {};

    const options = {
        body: data.body || 'Новое уведомление из журнала',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || './',
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'open',
                title: 'Открыть'
            },
            {
                action: 'close',
                title: 'Закрыть'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Журнал заявок', options)
    );
});

self.addEventListener('notificationclick', event => {
    console.log('[Service Worker] Клик по уведомлению');

    event.notification.close();

    if (event.action === 'open' || event.action === '') {
        event.waitUntil(
            clients.matchAll({ type: 'window' })
                .then(windowClients => {
                    // Если окно уже открыто - фокусируем
                    for (const client of windowClients) {
                        if (client.url.includes('./') && 'focus' in client) {
                            return client.focus();
                        }
                    }

                    // Иначе открываем новое окно
                    if (clients.openWindow) {
                        return clients.openWindow(event.notification.data.url || './');
                    }
                })
        );
    }
});