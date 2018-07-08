// See: https://jakearchibald.com/2014/offline-cookbook/

const version = `v0.0.1`;
const static_cache = `smol-static-${version}`;
const dynamic_cache = `smol-dynamic-${version}`;

// On install
self.addEventListener('install', function(event) {
	console.log('worker: install');
	event.waitUntil(
		caches.open(static_cache).then(function(cache) {
			console.log(`caching ${static_cache}`);
			const files = [
				'/css/smol.css',
				'/js/smol.js'
			];
			for (let file of files) {
				console.log(`caching: ${file}`);
			}
			return cache.addAll(files);
		})
	);
});

// On activate
self.addEventListener('activate', function(event) {
	event.waitUntil(
		caches.keys().then(function(names) {
			return Promise.all(
				names.filter(function(name) {
					return (
						name != static_cache &&
						name != dynamic_cache
					);
				}).map(function(name) {
					console.log(`deleting cache ${name}`);
					return caches.delete(name);
				})
			);
		})
	);
});

// Cache, falling back to network
self.addEventListener('fetch', function(event) {
	event.respondWith(
		caches.match(event.request).then(function(response) {
			return response || fetch(event.request);
		})
	);
});
