VERSION := $(shell node -p "require('./extension/manifest.json').version")

.PHONY: all xpi chrome plugin test integration-test composer-test postfix-test lint clean

all: xpi chrome plugin

# Unsigned extension package (for about:debugging / Developer Edition / signing)
xpi:
	mkdir -p dist
	rm -f dist/shop-adressen-$(VERSION).xpi
	cd extension && zip -r -X ../dist/shop-adressen-$(VERSION).xpi . -x 'tests/*' 'amo/*' '.*'

# Chromium extension (Chrome, Edge, Brave, ...), zip for the Chrome Web Store or "Load unpacked"
chrome:
	mkdir -p dist
	node scripts/build-chrome.js dist/chrome
	rm -f dist/shop-adressen-chrome-$(VERSION).zip
	cd dist/chrome && zip -r -X ../shop-adressen-chrome-$(VERSION).zip . -x '.*'

PLUGIN_FILES := identity_api.php identity_api.js lib localization config.inc.php.dist composer.json

# Roundcube plugin archives; the zip is also the Composer package
# (Composer can't extract tar archives on PHP < 8)
plugin:
	rm -rf dist/plugin && mkdir -p dist/plugin/identity_api
	cd plugin && cp -R $(PLUGIN_FILES) ../dist/plugin/identity_api/
	cp LICENSE README.md CHANGELOG.md dist/plugin/identity_api/
	rm -f dist/identity_api-$(VERSION).tar.gz dist/identity_api-$(VERSION).zip
	tar -czf dist/identity_api-$(VERSION).tar.gz -C dist/plugin identity_api
	cd dist/plugin && zip -qr -X ../identity_api-$(VERSION).zip identity_api
	rm -rf dist/plugin

test:
	php plugin/tests/generator_test.php
	node --test extension/tests/*.test.js

# Downloads Roundcube and tests the API against it (needs php-sqlite, curl)
integration-test:
	tests/integration.sh

# Installs the plugin archive with Composer into Roundcube (needs composer)
composer-test: plugin
	tests/composer.sh dist/identity_api-$(VERSION).zip

# Tests docs/postfix.md with postmap against MySQL/MariaDB (see script for settings)
postfix-test:
	tests/postfix-guide.sh

lint:
	npx -y web-ext@10.7.0 lint --source-dir extension --ignore-files 'tests/**' 'amo/**'

clean:
	rm -rf dist
