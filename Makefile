all: npm fonts jquery highlightjs

npm:
	npm install

fonts:
	mkdir -p _data/assets/fonts
	cp -R node_modules/source-sans-pro _data/assets/fonts/source-sans-pro

jquery:
	cp node_modules/jquery/dist/jquery.js _data/assets/js/jquery.js

highlightjs:
	scripts/highlightjs.sh
