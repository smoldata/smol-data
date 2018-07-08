all: npm fonts jquery highlightjs

npm:
	npm install

fonts:
	mkdir -p public/fonts
	cp -R node_modules/source-sans-pro public/fonts/source-sans-pro

jquery:
	cp node_modules/jquery/dist/jquery.js public/js/jquery.js

highlightjs:
	scripts/highlightjs.sh
