// Load config.js
const fs = require('fs');
const path = require('path');
if (! fs.existsSync(`${__dirname}/config.js`)) {
	console.log('Please set up config.js');
	process.exit(1);
}
const config = require('./config.js');
const express = require('express');
const app = express();
var server;

if ('ssl' in config) {
	// Setup HTTPS server
	let https_options = {};
	for (let key in config.ssl) {
		https_options[key] = fs.readFileSync(`${__dirname}/${config.ssl[key]}`);
	}
	server = require('https').createServer(https_options, app);
} else {
	// Setup HTTP server
	server = require('http').createServer(app);
}

const io = require('socket.io')(server);
const body_parser = require('body-parser');
const marked = require('marked');
const yaml = require('js-yaml');
const date_format = require('dateformat');
const mime = require('mime');
const sharp = require('sharp');
const session = require('express-session');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mkdirp = require('mkdirp');

marked.setOptions({
	gfm: true,
	smartypants: true
});

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

app.set('view engine', 'ejs');
app.use(express.static('_data'));
app.use(body_parser.urlencoded({ extended: false }));
app.use(session({
	secret: config.session_secret,
	resave: false,
	saveUninitialized: false,
	cookie: {
		secure: true,
		maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
	}
}));

server.listen(config.port, () => {
	console.log(`listening on *:${config.port}`);
});

// Connect to PostgreSQL
const pg = require('pg');
const db = new pg.Client(config.db_dsn);
db.connect();

db.query(`

	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		name VARCHAR(255),
		username VARCHAR(255),
		password VARCHAR(255),
		email VARCHAR(255),
		created TIMESTAMP
	);

	DROP TABLE IF EXISTS timelines;
	CREATE TABLE timelines (
		timeline VARCHAR(255),
		path VARCHAR(255),
		filename VARCHAR(255),
		published TIMESTAMP
	);

`, (err, rsp) => {
	if (err) {
		console.log(err);
	} else {
		index_directory(`${__dirname}/_data`);
	}
});

function get_meta(head) {

	let meta;
	try {
		meta = yaml.safeLoad(head);
	} catch(err) {
		console.error(err);
		return {};
	}

	if ('tags' in meta) {
		let tags = [];
		for (let tag of meta.tags.split(',')) {
			tags.push(tag);
		}
		tags = tags.map(tag => tag.trim());
		tags.sort();
		meta.tag_list = tags;
		meta.tags = tags.map(tag => get_tag(tag));
	}

	if ('categories' in meta) {
		let categories = [];
		for (let category of meta.categories.split(',')) {
			categories.push(category);
		}
		categories = categories.map(category => category.trim());
		categories.sort();
		meta.category_list = categories;
		meta.categories = categories.map(category => get_category(category));
	}

	if ('date' in meta) {
		meta.date = new Date(meta.date);
		meta.date_formatted = date_format(meta.date, 'mmm d, yyyy');
		meta.time_formatted = date_format(meta.date, 'h:MMtt');
	}

	if ('authors' in meta) {
		meta.authors = meta.authors.split(',');
		meta.authors = meta.authors.map(author => author.trim());
		meta.authors = meta.authors.map((author) => { return {
			name: author,
			url: `/${author}`
		}});
	}

	return meta;
}

function get_content(post, context) {
	let markdown = post.markdown;
	let read_more = markdown.split(/<!--\s*more\s*-->/);
	if (context == 'index') {
		if (read_more.length > 1) {
			let url = get_path(post);
			markdown = `${read_more[0]}\n<a href="${url}#more" class="read-more">Read more →</a>`;
		}
	} else {
		markdown = read_more.join('<span id="more"></span>');
	}

	if (context == 'index' &&
	    'category_list' in post.meta &&
	    post.meta.category_list.indexOf('photos') !== -1) {
		if (post.meta.image) {
			let url = get_path(post);
			markdown = `
<figure><a href="${url}"><img src="/media/${post.meta.image}" alt=""></a></figure>

[View all photos →](${url})
			`;
		}
	}

	let content = marked(markdown);
	let sm_width = 700;
	let lg_width = 1400;
	if (context == 'single' &&
	    'category_list' in post.meta &&
	    post.meta.category_list.indexOf('photos') !== -1) {
		sm_width = 1065;
		lg_width = 2130;
	}

	content = content.replace(/<img[^>]+>/mg, (img) => {
		img = img.replace(/src="([^"]+)(\.jpe?g)"/, (src, base, ext) => {
			let sm = `${base}-${sm_width}w${ext}`;
			let lg = `${base}-${lg_width}w${ext}`;
			let srcset = `srcset="${sm} 1x, ${lg} 2x"`;
			return `src="${sm}" ${srcset}`;
		});
		return img;
	});

	return content;
}

function get_href(post) {
	if ('href' in post.meta) {
		return post.meta.href;
	} else {
		return get_path(post);
	}
}

function get_path(post) {
	if (post === null ||
	    ! 'filename' in post) {
		return '#';
	}
	let path = post.filename.replace(/\.md$/, '');
	return `/${path}`;
}

function get_authors(post) {

	let authors = [];
	for (let author of post.meta.authors) {
		authors.push(`<a href="${author.url}">${author.name}</a>`);
	}

	let authors_html;
	if (authors.length == 1) {
		authors_html = authors[0];
	} else if (authors.length == 2) {
		authors_html = authors.join(' and ');
	} else {
		let last_author = authors.pop();
		authors_html = `${authors.join(', ')}, and ${last_author}`;
	}

	return authors_html;
}

function get_slug(title) {
	if (typeof title != 'string') {
		console.log(`Tried to get slug of ${title}`);
		return '#';
	}
	let slug = title.replace(/[^a-z0-9_-]+/gi, '-');
	slug = slug.toLowerCase();
	return slug;
}

var category_cache = {};

function get_category(slug) {

	let category = {
		name: slug,
		slug: slug
	}

	if (slug in category_cache) {
		return category_cache[slug];
	}

	const path = `${__dirname}/_data/_categories/${slug}.json`;
	if (fs.existsSync(path)) {
		const json = fs.readFileSync(path);
		category = JSON.parse(json);
	}

	category_cache[slug] = category;
	return category;
}

var tag_cache = {};

function get_tag(slug) {

	let tag = {
		name: slug,
		slug: slug
	};

	if (slug in tag_cache) {
		return tag_cache[slug];
	}

	const path = `${__dirname}/_data/_tags/${slug}.json`;
	if (fs.existsSync(path)) {
		const json = fs.readFileSync(path);
		tag = JSON.parse(json);
	}

	tag_cache[slug] = tag;
	return tag;
}

function get_post_class(post, context) {
	let classname = 'post';
	if ('category_list' in post.meta) {
		for (let category of post.meta.category_list) {
			classname += ` category-${category}`;
			classname += ` category-${category}-${context}`;
		}
	}
	return classname;
}

app.locals.get_href = get_href;
app.locals.get_path = get_path;
app.locals.get_content = get_content;
app.locals.get_authors = get_authors;
app.locals.get_category = get_category;
app.locals.get_tag = get_tag;
app.locals.get_post_class = get_post_class;

function parse_post(data, filename) {
	const doc = data.match(/^---\n(^\w+:.+\n)+---$(.+)/ms);
	if (! doc) {
		return null;
	}
	const meta = get_meta(doc[1]);
	const markdown = doc[2];

	if ('category_list' in meta &&
	    meta.category_list.indexOf('photos') !== -1) {
		if (! ('image' in meta)) {
			let single = markdown.match(/\/media\/([^)]+)/m);
			let all = markdown.match(/\/media\/([^)]+)/gm);
			if (single && all.length > 1) {
				meta.image = single[1];
			}
		}
	}

	const post = {
		filename: filename,
		markdown: markdown,
		meta: meta
	};
	return post;
}

function get_post(filename) {
	return new Promise((resolve, reject) => {

		const path = `${__dirname}/_data/${filename}`;
		fs.readFile(path, 'utf8', (err, data) => {

			if (err) {
				return reject(err);
			}

			const post = parse_post(data, filename);
			if (! post) {
				return reject(post);
			}
			return resolve(post);
		});
	});
}

function index_post(filename) {
	return new Promise((resolve, reject) => {

		var log_error = (err) => {
			if (err) {
				console.log(err);
			}
		};

		fs.readFile(filename, 'utf8', (err, data) => {

			const rel_path = filename.replace(`${__dirname}/_data/`, '');
			const post = parse_post(data, rel_path);
			if (! post) {
				return reject(post);
			}
			const path = get_path(post);
			add_permalink(path, rel_path);

			let values = [
				'/',
				path,
				rel_path,
				post.meta.date
			];

			db.query(`
				INSERT INTO timelines
				(timeline, path, filename, published)
				VALUES ($1, $2, $3, $4)
			`, values, log_error);

			if ('category_list' in post.meta) {
				for (let category of post.meta.category_list) {
					values = [
						`/${category}`,
						path,
						rel_path,
						post.meta.date
					];
					db.query(`
						INSERT INTO timelines
						(timeline, path, filename, published)
						VALUES ($1, $2, $3, $4)
					`, values, log_error);
				}
			}

			if ('tag_list' in post.meta) {
				for (let tag of post.meta.tag_list) {
					values = [
						`/tags/${tag}`,
						path,
						rel_path,
						post.meta.date
					];
					db.query(`
						INSERT INTO timelines
						(timeline, path, filename, published)
						VALUES ($1, $2, $3, $4)
					`, values, log_error);
				}
			}
		});
	});
}

function index_directory(path) {
	fs.readdir(path, (err, files) => {
		for (let file of files) {
			if (file.substr(0, 1) == '_') {
				continue;
			}
			if (fs.statSync(`${path}/${file}`).isDirectory()) {
				index_directory(`${path}/${file}`);
			} else if (file.match(/\.md$/)) {
				index_post(`${path}/${file}`)
					.catch((err) => {
						if (err) {
							console.error(err);
						}
					});
			}
		}
	});
}

function add_permalink(path, filename) {
	app.get(path, (req, rsp) => {
		get_post(filename).then((post) => {
			rsp.render('page', {
				title: post.meta.title,
				main: 'single',
				content: {
					post: post
				},
				user: get_user(req)
			});
		})
		.catch((err) => {
			console.error(err.stack);
			res.status(500).send('oh no!');
		});
	});
}

function get_user(req) {
	if ('session' in req &&
	    'user' in req.session) {
		return req.session.user;
	}
	return null;
}

function password_hash(cleartext) {
	return new Promise((resolve, reject) => {

		const hmac = crypto.createHmac('sha256', config.password_salt);
		let hmac_read = false;

		hmac.on('readable', () => {
			if (hmac_read) {
				return;
			}
			hmac_read = true;

			const hash = hmac.read();
			if (hash) {
				resolve(hash.toString('hex'));
			} else {
				reject();
			}
		});
		hmac.write(cleartext);
		hmac.end();

	});
}

function confirm_email(email, username) {
	password_hash(email).then((hash) => {
		let url = `${config.base_url}confirm/${hash}`;
		let transporter = nodemailer.createTransport(config.smtp);
		let mailOptions = {
			from: config.email_from,
			to: email,
			subject: 'Smol Data email confirmation',
			text: `Hello ${username},

Please click the link below to confirm your email address at ${base_url}:
${url}

Warmly,
The Smol Data mailerbot
`,
			html: `<p>Hello ${username},</p>

<p>Please click the link below to confirm your email address at <a href="${base_url}">${host_port}</a>:<br>
<strong><a href="${url}">Confirm my email address</a></strong></p>

<p>Warmly,<br>
The Smol Data mailerbot</p>
`
		};
		transporter.sendMail(mailOptions, (err, info) => {
			if (err) {
				return console.error(err);
			}
			rsp.send('Message sent: ' + info.messageId);
		});
	});
}


function get_pagination(timeline, posts, rsp) {

	return new Promise((resolve, reject) => {

		if (posts.length == 0) {
			rsp.status(404).send('Not found.');
			return reject('No posts found');
		}

		let last_index = posts.length - 1;
		let param_format = 'yyyymmddHHMMss';
		let first_date = posts[0].meta.date;
		let last_date = posts[last_index].meta.date;
		let after_param = date_format(first_date, param_format);
		let before_param = date_format(last_date, param_format);

		db.query(`
			SELECT *
			FROM timelines
			WHERE timeline = $1
			  AND published > $2
			LIMIT 1
		`, [timeline, first_date], (err, res) => {

			if (err) {
				return reject(err);
			}

			if (res.rows.length == 0) {
				after_param = false;
			}

			db.query(`
				SELECT *
				FROM timelines
				WHERE timeline = $1
				  AND published < $2
				LIMIT 1
			`, [timeline, last_date], (err, res) => {

				if (err) {
					return reject(err);
				}

				if (res.rows.length == 0) {
					before_param = false;
				}

				resolve({
					posts: posts,
					before_param: before_param,
					after_param: after_param
				});

			});
		});
	});
}

function load_index(timeline, res, rsp, index_title, user) {

	let get_posts = [];
	for (let row of res.rows) {
		get_posts.push(get_post(row.filename));
	}

	Promise.all(get_posts).then((posts) => {
		posts.sort((a, b) => {
			if (a.meta.timestamp > b.meta.timestamp) {
				return -1;
			} else {
				return 1;
			}
		});

		let site_title = 'phiffer.org';
		let page_title = site_title;
		if (index_title) {
			page_title = `${index_title} / ${site_title}`;
		}

		get_pagination(timeline, posts, rsp).then((index) => {
			rsp.render('page', {
				title: page_title,
				main: 'index',
				content: index,
				user: user,
				index_title: index_title
			});
		})
		.catch((err) => {
			console.error(err);
			rsp.header(500).send('Oh no, something has gone awry!');
			return;
		});
	});
}

function get_timeline(timeline, req, rsp, index_title) {
	let where_clause = '';
	let date_regex = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
	let order_by = 'published DESC';

	if ('before' in req.query) {
		let match = req.query.before.match(date_regex);
		if (match) {
			let date = `${match[1]}-${match[2]}-${match[3]}`;
			let time = `${match[4]}:${match[5]}:${match[6]}`;
			let before = `${date}T${time}Z`;
			where_clause = `AND published < '${before}'`;
		}
	} else if ('after' in req.query) {
		let match = req.query.after.match(date_regex);
		if (match) {
			let date = `${match[1]}-${match[2]}-${match[3]}`;
			let time = `${match[4]}:${match[5]}:${match[6]}`;
			let after = `${date}T${time}Z`;
			where_clause = `AND published > '${after}'`;
			order_by = 'published';
		}
	}

	db.query(`
		SELECT *
		FROM timelines
		WHERE timeline = $1
		${where_clause}
		ORDER BY ${order_by}
		LIMIT 10
	`, [timeline], (err, res) => {

		if (err) {
			console.error(err);
			rsp.status(500).send('Oh no! Errrror.');
			return;
		}

		if ('after' in req.query) {
			res.rows.reverse();
		}
		const user = get_user(req);
		load_index(timeline, res, rsp, index_title, user);
	});
}

app.get('/', (req, rsp) => {
	get_timeline('/', req, rsp);
});

app.get('/:category', (req, rsp) => {
	let category = get_category(req.params.category);
	get_timeline(`/${category.slug}`, req, rsp, category.name);
});

app.get('/tags/:tag', (req, rsp) => {
	let tag = get_tag(req.params.tag);
	get_timeline(`/tags/${tag.slug}`, req, rsp, tag.name);
});

app.get(/\d+w\.jpe?g$/, (req, rsp) => {
	let path = req.url.replace(/^\/media/, `${__dirname}/_data/media`);
	path = path.replace(/\?.*$/, '');
	let width = req.url.match(/(\d+)w\.jpe?g/)[1];
	width = parseInt(width);

	if (config.image_widths.indexOf(width) === -1) {
		rsp.status(404).send('Not found.');
		return;
	}

	let source = path.replace(/-\d+w(\.jpe?g)/, '$1');
	if (fs.existsSync(source)) {
		sharp(source)
			.rotate()
			.resize(width, null)
			.toFile(path)
			.then(() => {
				rsp.sendFile(path);
			});
	} else {
		rsp.status(404).send('Not found.');
	}
});

app.post('/api/join', (req, rsp) => {

	if (! 'body' in req ||
	    ! 'email' in req.body ||
		! 'username' in req.body ||
	    ! 'password' in req.body ||
	    ! 'password_again' in req.body) {
		return rsp.status(400).send({
			'ok': 0,
			'error': "Please include 'email', 'username', 'password', and 'password_again' params."
		});
	}

	// Something something validate

	const email_path = `${__dirname}/_accounts/${req.body.email}.json`;
	const username_path = `${__dirname}/_accounts/${req.body.username}.json`;

	if (fs.existsSync(email_path)) {
		return rsp.status(400).send({
			'ok': 0,
			'error': "That email address has already signed up."
		});
	} else if (fs.existsSync(username_path)) {
		return rsp.status(400).send({
			'ok': 0,
			'error': "That username has already signed up."
		});
	} else {
		password_hash(req.body.password).then((hash) => {

			const account = {
				username: req.body.username,
				email: req.body.email,
				password: hash,
				status: 'pending'
			};

			const email_json = JSON.stringify(account, null, 4);
			const username_json = JSON.stringify({
				email: req.body.email
			}, null, 4);

			const dirname = path.dirname(email_path);
			if (! fs.existsSync(dirname)) {
				fs.mkdirSync(dirname, 0o755);
			}

			fs.writeFile(email_path, email_json, (err) => {
				if (err) {
					console.error(err);
					return rsp.send({
						'ok': 0,
						'error': 'Could not write account to disk.'
					});
				}
				fs.writeFile(username_path, username_json, (err) => {
					if (err) {
						console.error(err);
						return rsp.send({
							'ok': 0,
							'error': 'Could not write account pointer to disk.'
						});
					}
					req.session.user = account;
					confirm_email(req.body.email, req.body.username);
					return rsp.send({
						'ok': 1
					});
				});
			});
		})
		.catch(() => {
			return rsp.send({
				'ok': 0,
				'error': 'Could not create user account.'
			});
		});
	}
});

var passwords = {};

app.post('/api/login', (req, rsp) => {

	if (! 'body' in req ||
	    ! 'email' in req.body ||
	    ! 'password' in req.body) {
		return rsp.status(400).send({
			'ok': 0,
			'error': "Please include 'email' and 'password' params."
		});
	}

	const filename = `${__dirname}/_accounts/${req.body.email}.json`;
	if (! fs.existsSync(filename)) {
		return rsp.status(400).send({
			'ok': 0,
			'error': "Login failed."
		});
	}

	fs.readFile(filename, 'utf8', (err, json) => {

		if (err) {
			return rsp.send({
				'ok': 0,
				'error': 'Login failed.'
			});
		}

		const account = JSON.parse(json);
		password_hash(req.body.password).then((hash) => {

			if (account.password == hash) {
				passwords[req.body.email] = req.body.password;
				req.session.user = account;
				return rsp.send({
					'ok': 1,
					'username': account.username
				});
			}
			return rsp.send({
				'ok': 0,
				'error': 'Login failed.'
			});
		})
		.catch(() => {
			return rsp.send({
				'ok': 0,
				'error': 'Login failed.'
			});
		});
	});
});

app.post('/api/logout', (req, rsp) => {
	if (! 'session' in req ||
	    ! 'user' in req.session) {
		return rsp.send({
			'ok': 0,
			'error': 'Not logged in.'
		});
	} else {
		delete req.session.user;
		return rsp.send({
			'ok': 1
		});
	}
});

app.get('/confirm/:hash', (req, rsp) => {
	if (! req.session ||
	    ! req.session.user) {
		// TODO redirect to login page
		return rsp.status(400).send('Sorry, you need to login before you can confirm your email address.');
	}
	console.log(req.session);
	password_hash(req.session.user.email).then((hash) => {
		if (req.params.hash != hash) {
			return rsp.status(400).send('Invalid email hash.');
		}
		req.session.user.status = 'active';
		let account_json = JSON.stringify(req.session.user, null, 4);
		let account_path = `${__dirname}/_accounts/${req.session.user.email}.json`;
		fs.writeFile(account_path, account_json, (err) => {
			if (err) {
				console.error(err);
				return rsp.status(400).send('Error updating account record.');
			}
			return rsp.redirect('/?confirmed=1');
		});
	});
});

app.post('/private', (req, rsp) => {

	if (! req.session ||
	    ! req.session.user) {
		return rsp.status(400).send({
			ok: 0,
			error: 'Sorry, you need to login.'
		});
	}

	let email = req.session.user.email;
	if (! email in passwords) {
		return rsp.status(400).send({
			ok: 0,
			error: 'Cannot encrypt, please login again.'
		});
	}

	let filename = req.body.name.replace('..', '');
	let filepath = `${__dirname}/_private/${email}/${filename}`;

	const cipher = crypto.createCipher('aes192', passwords[email]);
	let encrypted = cipher.update(req.body.value, 'utf8', 'hex');
	encrypted += cipher.final('hex');

	mkdirp(path.dirname(filepath), (err) => {

		if (err) {
			console.error(err);
			return rsp.status(400).send({
				ok: 0,
				error: 'Error creating directory.'
			});
		}

		fs.writeFile(filepath, encrypted, (err) => {
			if (err) {
				console.error(err);
				return rsp.status(400).send({
					ok: 0,
					error: 'Error writing file.'
				});
			}
			return rsp.send({
				ok: 1
			});
		});
	});
});

app.get('/private', (req, rsp) => {

	if (! req.session ||
	    ! req.session.user) {
		return rsp.status(400).send({
			ok: 0,
			error: 'Sorry, you need to login.'
		});
	}

	let email = req.session.user.email;
	if (! email in passwords) {
		return rsp.status(400).send({
			ok: 0,
			error: 'Cannot decrypt, please login again.'
		});
	}

	let filename = req.query.name.replace('..', '');
	let filepath = `${__dirname}/_private/${email}/${filename}`;

	const decipher = crypto.createDecipher('aes192', passwords[email]);
	let decrypted = '';

	decipher.on('readable', () => {
		const data = decipher.read();
		if (data) {
			decrypted += data.toString('utf8');
		}
	});
	decipher.on('end', () => {
		let match = filename.match(/\.(\w+)$/);
		if (match) {
			let type_map = {
				default: () => {
					rsp.status(406).send('Not Acceptable');
				}
			};
			let type = mime.getType(match[1]);
			type_map[type] = () => {
				rsp.send(decrypted);
			};
			if (type != 'application/json') {
				type_map['application/json'] = () => {
					rsp.send({
						ok: 1,
						value: decrypted
					});
				};
			}
			rsp.format(type_map);
		} else {
			rsp.send(new Buffer(decrypted));
		}
	});

	fs.readFile(filepath, 'utf8', (err, data) => {

		if (err) {
			console.error(err);
			return rsp.status(400).send({
				ok: 0,
				error: 'Error reading file.'
			});
		}

		decipher.write(data, 'hex');
		decipher.end();
	});
});
