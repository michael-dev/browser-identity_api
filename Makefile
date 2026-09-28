VERSION := $(shell node -p "require('./extension/manifest.json').version")
# Roundcube plugin for the integration test (cloned if missing)
PLUGIN_DIR ?= ../roundcube-identity_api
PLUGIN_REPO ?= https://github.com/michael-dev/roundcube-identity_api

.PHONY: all xpi chrome test integration-test lint clean

all: xpi chrome

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

test:
	node --test extension/tests/*.test.js

# Runs Roundcube with the identity_api plugin (its integration test, needs PHP with
# pdo_sqlite, curl, python3) and tests the extension against it, see tests/client.sh
integration-test:
	@[ -f "$(PLUGIN_DIR)/tests/integration.sh" ] || git clone --depth 1 $(PLUGIN_REPO) "$(PLUGIN_DIR)"
	CLIENT_TEST="$(CURDIR)/tests/client.sh" "$(PLUGIN_DIR)/tests/integration.sh"

lint:
	npx -y web-ext@10.7.0 lint --warnings-as-errors --source-dir extension --ignore-files 'tests/**' 'amo/**'

clean:
	rm -rf dist
