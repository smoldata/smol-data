all: npm fonts jquery

npm:
	npm install

fonts:
	mkdir -p _data/assets/fonts
	cp -R node_modules/source-sans-pro _data/assets/fonts/source-sans-pro

jquery:
	cp node_modules/jquery/dist/jquery.js _data/assets/js/jquery.js

codemirror:
	cp node_modules/codemirror/lib/codemirror.js _data/assets/js/codemirror.js
	cp node_modules/codemirror/lib/codemirror.css _data/assets/css/codemirror.css
