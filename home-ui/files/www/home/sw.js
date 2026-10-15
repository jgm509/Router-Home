/* Router Home service worker.
 * Keeps the app shell available so the installed app opens even when the
 * router is restarting. Router data (/ubus, /cgi-bin) is never cached. */
'use strict';
const VERSION = '2.0.0';
const CACHE = 'router-home-' + VERSION;
const SHELL = ['./', 'index.html', 'app.css', 'qr.js', 'core.js', 'data.js', 'home.js', 'devices.js', 'wifi.js', 'network.js', 'proton.js', 'system.js',
	'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
	e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('router-home-') && k !== CACHE).map(k => caches.delete(k))))
		.then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
	const url = new URL(e.request.url);
	if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/home/')) return;
	/* network first, so updates show right away; cached copy when the router is unreachable */
	e.respondWith(fetch(e.request).then(res => {
		if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
		return res;
	}).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
