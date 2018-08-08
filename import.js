
const process = require('process');
if (process.argv.length < 3) {
	console.log('Usage: node import.js [wordpress-export.xml]');
	process.exit(1);
}

const data_dir = `${__dirname}/_data`;

const XmlStream = require('xml-stream');
const fs = require('fs');
const dirname = require('path').dirname;
const mkdirp = require('mkdirp');
const request = require('request');
const dateFormat = require('dateformat');

const stream = fs.createReadStream(process.argv[2]);
const xml = new XmlStream(stream);

mkdirp(data_dir, (err) => {
	if (err) {
		console.error(err);
	} else {
		mkdirp(`${data_dir}/_categories`);
		mkdirp(`${data_dir}/_tags`);
		mkdirp(`${data_dir}/media`);
	}
});

var categories = {};

xml.on('endElement: wp:category', (item) => {

	const id = item['wp:term_id'];
	const slug = item['wp:category_nicename'];
	const name = item['wp:cat_name'];
	const path = `${data_dir}/_categories/${slug}.json`;

	console.log(`category: ${slug}`);
	categories[id] = slug;

	const json = JSON.stringify({
		"slug": slug,
		"name": name
	}, null, 4);

	if (! fs.existsSync(path)) {
		fs.writeFile(path, json, (err) => {
			if (err) {
				console.error(err);
			}
		});
	}
});

var tags = {};

xml.on('endElement: wp:tag', (item) => {

	const id = item['wp:term_id'];
	const slug = item['wp:tag_slug'];
	const name = item['wp:tag_name'];
	const path = `${data_dir}/_tags/${slug}.json`;

	console.log(`tag: ${slug}`);
	tags[id] = slug;

	const json = JSON.stringify({
		"slug": slug,
		"name": name
	}, null, 4);

	if (! fs.existsSync(path)) {
		fs.writeFile(path, json, (err) => {
			if (err) {
				console.error(err);
			}
		});
	}
});

var attachments = {};
var download_queue = [];
var download_conn = 0;

const download_max_conn = 4;

function download_attachment(url) {
	if (download_conn < download_max_conn) {
		download_conn++;
		let upload = url.match(/wp-content\/[^\/]+\/(.+)$/, url)[1];
		upload = upload.replace(/^http:/, 'https:');
		const path = `${data_dir}/media/${upload}`;
		mkdirp(dirname(path), (err) => {
			if (err) {
				console.error(err);
			} else {
				request
					.get(url)
					.on('response', (rsp) => {
						download_conn--;
						if (rsp.statusCode != 200) {
							console.log(`http ${rsp.statusCode}: ${url}`);
						} else {
							console.log(`downloading: ${url}`);
						}
						if (download_queue.length > 0 &&
						    download_conn < download_max_conn) {
							let url = download_queue.shift();
							download_attachment(url);
						}
					})
					.on('error', (err) => {
						console.error(err);
					})
					.pipe(fs.createWriteStream(path));
			}
		});
	} else {
		download_queue.push(url);
	}
}

xml.on('endElement: item', (item) => {

	if (item['wp:post_type'] != 'attachment') {
		return;
	}

	const id = item['wp:post_id'];
	const url = item['wp:attachment_url'].replace(/^http:/, 'https:');

	const upload = url.match(/wp-content\/[^\/]+\/(.+)$/, url)[1];
	const path = `${data_dir}/media/${upload}`;

	console.log(`attachment: ${upload}`);
	attachments[id] = upload;

	if (! fs.existsSync(path)) {
		download_attachment(url);
	}
});

xml.on('end', () => {

	const stream2 = fs.createReadStream(process.argv[2]);
	const xml2 = new XmlStream(stream2);

	const shortcode_handlers = {

		caption: (shortcode) => {

			const regex = /^\[caption([^\]]+)\](<a [^>]+>)?(<img[^>]+>)(<\/a>)?(.*)\[\/caption\]$/;
			const matches = shortcode.match(regex);

			if (! matches) {
				console.log(`Warning: could not parse ${shortcode}`);
				return shortcode;
			}

			const attrs = matches[1];
			const link = matches[2] || '';

			let image = matches[3];
			let caption = matches[5].trim();

			const id_match = attrs.match(/id="attachment_(\d+)"/);
			const src_match = image.match(/src="([^"]+)"/);
			const alt_match = image.match(/alt="([^"]*)"/);
			const href_match = link.match(/href="([^"]+)"/);

			let alt = alt_match[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
			alt = alt.replace(/\[/g, '\\[');
			alt = alt.replace(/\]/g, '\\]');

			if (id_match && id_match[1] in attachments) {
				const id = id_match[1];
				const src = `/media/${attachments[id]}`;
				image = `![${alt}](${src})`;
			} else if (src_match) {
				image = `![${alt}](${src_match[1]})`
			}

			if (href_match) {
				let href = href_match[1];
				let upload_match = href.match(/wp-content\/[^\/]+\/(.+)$/);
				if (upload_match) {
					href = `/media/${upload_match[1]}`;
				}
				image = `[${image}](${href})`;
			}

			const caption_match = attrs.match(/caption="([^"]+)"/);
			if (caption_match) {
				caption = caption_match[1];
			}

			const figure = `<figure>
	${image}
	<figcaption>${caption}</figcaption>
</figure>`;
			return figure;
		},

		gallery: (shortcode) => {

			const ids_match = shortcode.match(/ids="([^"]+)"/);
			if (! ids_match) {
				return shortcode;
			}

			let items = [];
			const ids = ids_match[1].split(',');
			for (let id of ids) {
				if (! id in attachments) {
					console.log(`Warning: could not find attachment ${id}`);
				} else {
					let src = `/media/${attachments[id]}`;
					items.push(`\t<li><figure>![](${src})</figure></li>`);
				}
			}

			const gallery = `<ul class="gallery">\n${items.join('\n')}\n</ul>`;
			return gallery;
		},

		audio: (shortcode) => {

			const mp3_match = shortcode.match(/mp3="([^"]+)"/);
			if (! mp3_match) {
				return shortcode;
			}

			let src = mp3_match[1];
			const upload_match = src.match(/wp-content\/[^\/]+\/(.+)$/);
			if (upload_match) {
				src = `/media/${upload_match[1]}`;
			}

			const audio = `<audio src="${src}" controls></audio>`;
			return audio;
		},

		video: (shortcode) => {

			const mp4_match = shortcode.match(/mp4="([^"]+)"/);
			if (! mp4_match) {
				return shortcode;
			}

			let attrs = {};

			let src = mp4_match[1];
			let upload_match = src.match(/wp-content\/[^\/]+\/(.+)$/);
			if (upload_match) {
				src = `/media/${upload_match[1]}`;
			}
			attrs['src'] = src;

			const width_match = shortcode.match(/width="(\d+)"/);
			if (width_match) {
				attrs['width'] = width_match[1];
			}

			const height_match = shortcode.match(/height="(\d+)"/);
			if (height_match) {
				attrs['height'] = height_match[1];
			}

			const poster_match = shortcode.match(/poster="([^"]+)"/);
			if (poster_match) {
				let poster = poster_match[1];
				let upload_match = poster.match(/wp-content\/[^\/]+\/(.+)$/);
				if (upload_match) {
					poster = `/media/${upload_match[1]}`;
				}
				attrs['poster'] = poster;
			}

			attrs_html = '';
			for (let key in attrs) {
				attrs_html += ` ${key}="${attrs[key]}"`;
			}

			const video = `<video${attrs_html}></video>`;
			return video;
		},

		tweet: (shortcode) => {

			const tweet_match = shortcode.match(/https?:\/\/twitter\.com\/([^\/]+)\/status(es)?\/\d+/);
			if (! tweet_match) {
				return shortcode;
			}

			const url = tweet_match[0];
			const user = tweet_match[1];
			const tweet = `<div class="tweet"><a href="${url}">Tweet by @${user}</a></div>`;

			return tweet;
		}
	};

	xml2.collect('category');
	xml2.collect('wp:postmeta');
	xml2.collect('wp:meta_key');
	xml2.collect('wp:meta_value');

	var content = [];
	var shortcode_tags = [];

	xml2.on('text: content:encoded', (text) => {
		content.push(text.$text);
	});

	xml2.on('endElement: item', (item) => {

		try {
			if (item['wp:post_type'] != 'post' &&
			    item['wp:post_type'] != 'page') {
				return;
			}

			let title = item['title'];
			let slug = item['wp:post_name'];

			if (! slug) {
				slug = title.replace(/[^a-z0-9_-]+/gi, '-');
				slug = slug.toLowerCase();
			}

			let meta = `title: "${title.replace(/"/g, '\\"')}"`;
			let date_path;

			if (item['wp:status'] != 'publish') {
				const status = item['wp:status'];
				date_path = `_${status}`;
			} else {
				const pub_date = new Date(item['pubDate']);
				const date = JSON.stringify(pub_date)
					.replace(/"/g, '')
					.replace('.000', '');
				date_path = dateFormat(pub_date, 'yyyy/mm/dd');
				meta += `\ndate: ${date}`;
			}

			const path = `${data_dir}/${date_path}/${slug}.md`;

			if (fs.existsSync(path)) {
				console.log(`exists: ${date_path}/${slug}.md (skipped)`);
				content = [];
				return;
			}

			if ('dc:creator' in item) {
				let author = item['dc:creator'];
				meta += `\nauthors: ${author}`;
			}

			let categories = [];
			let tags = [];
			if ('category' in item) {
				for (let term of item.category) {
					if (term.$.domain == 'category') {
						categories.push(term.$.nicename);
					} else if (term.$.domain == 'post_tag') {
						tags.push(term.$.nicename);
					}
				}
			}

			if (categories.length > 0) {
				meta += `\ncategories: ${categories.join(', ')}`;
			}

			if (tags.length > 0) {
				meta += `\ntags: ${tags.join(', ')}`;
			}

			let meta_values = {};
			if ('wp:postmeta' in item) {
				for (let postmeta of item['wp:postmeta']) {
					let meta_key = postmeta['wp:meta_key'][0];
					let meta_value = postmeta['wp:meta_value'][0];
					if (meta_key == 'href' || meta_key == 'background') {
						meta_values[meta_key] = meta_value;
					} else if (meta_key == '_thumbnail_id') {
						meta_values['image'] = attachments[meta_value];
					} else if (meta_key == 'enclosure') {
						let meta_match = meta_value.match(/wp-content\/[^\/]+\/(.+\.mp3)/);
						if (meta_match) {
							meta_values['audio'] = meta_match[1];
						}
					} else if (meta_key.match(/^vimeo_poster_image_/) ||
					           meta_key == 'youtube_poster_image') {
						if (meta_value != 'default') {
							let upload_match = meta_value.match(/wp-content\/[^\/]+\/(.+)$/);
							if (upload_match) {
								meta_value = `/media/${upload_match[1]}`;
							}
							meta_values['poster'] = meta_value;
						}
					} else if (meta_key == '_wp_old_slug' &&
					           meta_value != '') {
						if ('old_slugs' in meta_values) {
							meta_values['old_slugs'] += `, ${meta_value}`;
						} else {
							meta_values['old_slugs'] = meta_value;
						}
					}
				}
			}

			for (let key in meta_values) {
				meta += `\n${key}: ${meta_values[key]}`;
			}

			let body = content.join('');
			body = body.replace(/\[(caption|gallery|audio|video|tweet)[^\]]*\](.*?\[\/\1\])?/msg, (shortcode) => {
				let tag = shortcode.match(/\[(\w+)/)[1];
				if (tag in shortcode_handlers) {
					return shortcode_handlers[tag](shortcode);
				} else {
					return shortcode;
				}
			});

			body = body.replace(/https?:\/\/[a-z0-9._%-]+\/wp-content\/[\/a-z0-9._%-]+/msgi, (url) => {

				let image_match = url.match(/^(.+)-\d+x\d+\.(jpeg|jpg|png|gif)$/i);
				if (image_match) {
					url = `${image_match[1]}.${image_match[2]}`;
				}

				let upload_match = url.match(/wp-content\/[^\/]+\/(.+)$/);
				if (upload_match) {
					return `/media/${upload_match[1]}`;
				}
				return url;
			});

			body = body.replace(/(<a[^>+]+>)?<img[^>]+>(<\/a>)?/mg, (img, link) => {

				let src_match = img.match(/src="([^"]+)"/);
				if (! src_match) {
					return img;
				}

				let alt = '';
				let alt_match = img.match(/alt="([^"]+)"/);
				if (alt_match) {
					alt = alt_match[1];
				}

				let markdown = `![${alt}](${src_match[1]})`;

				if (link) {
					let href_match = link.match(/href="([^"]+)"/);
					if (href_match) {
						markdown = `[${markdown}](${href_match[1]})`;
					}
				}

				return `<figure>${markdown}</figure>`;
			});

			const markdown = `---
${meta}
---
${body}
`;

			console.log(`saving: ${date_path}/${slug}.md`);
			mkdirp(`${data_dir}/${date_path}`, (err) => {
				if (err) {
					console.error(err);
				} else {
					fs.writeFile(path, markdown, 'utf8', (err) => {
						if (err) {
							console.error(err);
						}
					});
				}
			});
			content = [];
		} catch(err) {
			console.error(err);
		}

	});

});
