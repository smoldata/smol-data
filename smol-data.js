// Load config.js
const fs = require('fs');
if (! fs.existsSync(`${__dirname}/config.js`)) {
	console.log('Please set up config.js');
	process.exit(1);
}
const config = require('./config.js');

// Setup HTTPS server
let https_options = {};
for (let key in config.ssl) {
	https_options[key] = fs.readFileSync(`${__dirname}/${config.ssl[key]}`);
}
const express = require('express');
const app = express();
const https = require('https').createServer(https_options, app);
const io = require('socket.io')(https);
const bodyParser = require('body-parser');

// Setup CORS
io.origins((origin, callback) => {
	if (config.cors_origins.indexOf('*') !== -1) {
		callback(null, true);
	} else if (config.cors_origins.indexOf(origin) !== -1 ||
	    config.cors_origins.indexOf(origin + '/') !== -1) {
		callback(null, true);
	} else {
		console.log(`CORS blocked origin: ${origin}`);
		return callback('origin not allowed', false);
	}
});

// Create HTTPS server
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));
https.listen(config.port, () => {
	console.log(`listening on *:${config.port}`);
});

// Homepage
app.get('/', (req, res) => {
	res.render('page', {
		title: 'Smol Data',
		page: '¡Hola, mundo!'
	});
});
