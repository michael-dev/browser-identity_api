VERSION := $(shell node -p "require('./extension/manifest.json').version")
# fixed timestamps make the plugin archives reproducible (same bytes on a rebuild)
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || date +%s)

.PHONY: all xpi chrome plugin test integration-test composer-test postfix-test lint clean

all: xpi chrome plugin

# Unsigned extension package (for about:debugging / Developer Edition / signing)
xpi:
	mkdir -p dist
	rm -f dist/shop-adressen-$(VERSION).xpi
	cd extension && zip -r -X ../dist/shop-adressen-$(VERSION).xpi . -x 'tests/*' 'amo/*' '.*' '*/.*'

# Chromium extension (Chrome, Edge, Brave, ...), zip for the Chrome Web Store or "Load unpacked"
chrome:
	mkdir -p dist
	node scripts/build-chrome.js dist/chrome
	rm -f dist/shop-adressen-chrome-$(VERSION).zip
	cd dist/chrome && zip -r -X ../shop-adressen-chrome-$(VERSION).zip . -x '.*' '*/.*'

PLUGIN_FILES := identity_api.php identity_api.js lib localization config.inc.php.dist composer.json README.md

# Roundcube plugin archives; the zip is also the Composer package
# (Composer can't extract tar archives on PHP < 8)
plugin:
	rm -rf dist/plugin && mkdir -p dist/plugin/identity_api
	cd plugin && cp -R $(PLUGIN_FILES) ../dist/plugin/identity_api/
	cp LICENSE CHANGELOG.md dist/plugin/identity_api/
	chmod -R u=rwX,go=rX dist/plugin
	find dist/plugin -exec touch -h -d @$(SOURCE_DATE_EPOCH) {} +
	rm -f dist/identity_api-$(VERSION).tar.gz dist/identity_api-$(VERSION).zip
	tar -c --sort=name --owner=0 --group=0 --numeric-owner --mtime=@$(SOURCE_DATE_EPOCH) -C dist/plugin identity_api \
		| gzip -n > dist/identity_api-$(VERSION).tar.gz
	cd dist/plugin && find identity_api | LC_ALL=C sort | TZ=UTC zip -q -X -@ ../identity_api-$(VERSION).zip
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
	npx -y web-ext@10.7.0 lint --warnings-as-errors --source-dir extension --ignore-files 'tests/**' 'amo/**'

clean:
	rm -rf dist
