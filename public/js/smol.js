if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/js/worker.js?v0.0.1').then(function() {
		console.log('registered worker');
	}).catch(function() {
		console.log('did not register worker');
	});
} else {
	console.log('workers not supported');
}
