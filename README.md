# Shop-Adressen – per-shop e-mail addresses

Browser extension for Firefox (desktop and Android) and Chromium based browsers (Chrome, Edge,
Brave, Vivaldi) that gives every online shop its own e-mail address, created on the fly in the
checkout form:

```
<prefix>-<shop>-<year>-<random>@your-domain        e.g. m-bookshop-2026-k3x9q2ab@example.org
```

It detects e-mail fields, suggests the shop name from the website, has your mail server create a new
address (or offers the existing ones for that shop) and fills it in. Why? You can tell which shop
leaked or sold your address, and you can shut down a single address on the server.

The addresses are created by your mail server through the **shop address API**, an open,
token-authenticated REST API. Servers offering it:

* **Roundcube** with the plugin [identity_api](https://github.com/michael-dev/roundcube-identity_api),
  the reference implementation: stores the addresses as Roundcube identities, offers token
  management, an address generator (also for iPhone/iPad) and a guide for Postfix.
* any other mail server or admin panel implementing it, see [Other mail servers](#other-mail-servers).

```
browser extension ──HTTPS + token──▶ mail server (e.g. Roundcube + identity_api)
                  ◀──new address───
```

The same source (`extension/`) is built for Firefox and for Chromium based browsers (`make chrome`
creates the Chromium variant with a service worker; `extension/lib/compat.js` covers the API
differences).

## Installation in Firefox

Use the signed `shop-adressen-<version>-signed.xpi` from the
[releases](https://github.com/michael-dev/browser-identity_api/releases):

* **Desktop:** drag it into a Firefox window, or go to `about:addons` → gear icon → *Install Add-on
  From File*.
* **Android:** open *Settings → About Firefox* and tap the Firefox logo five times. Then choose
  *Settings → Install extension from file*.

For development, load `extension/manifest.json` via `about:debugging` → *This Firefox* → *Load
Temporary Add-on*.

## Installation in Chrome, Edge, Brave, Vivaldi

* **From the Chrome Web Store**, once it is published there ([docs/publishing.md](docs/publishing.md)); Edge, Brave and
  Vivaldi can install extensions from the Chrome Web Store too.
* **Without store:** unzip `shop-adressen-chrome-<version>.zip` from the releases, open
  `chrome://extensions`, enable *Developer mode* and choose *Load unpacked*. Chrome doesn't install
  packed extensions from other sources and doesn't update unpacked ones.

Chrome on Android and iOS doesn't support extensions. On iPhone/iPad, see the
[iOS guide](https://github.com/michael-dev/roundcube-identity_api/blob/main/docs/ios.md) of the plugin.

## Setup

* **One click:** with the extension installed, create a token in the Roundcube settings
  (*Settings → Preferences → Shop address API*) and click **Connect browser extension**. The
  extension checks the token and opens its own confirmation page, which shows the server, the API URL and the account; only after *Verbinden* it
  stores them.
  * Any website could show such a button, so nothing is stored without that confirmation, and it
    warns if the server or the account changes. Confirm only if you just clicked the button in your
    webmail yourself.
  * The API URL must be on the same server as the settings page.
* **Manually:** on the extension's options page, enter the API URL shown in Roundcube under
  *Connection* (e.g. `https://webmail.example.org/api/identity/`; `https://` required, except
  `localhost`) and the token, then click *Verbindung testen* (test connection) and save.

## Usage

The extension's user interface is currently German.

* **Button in e-mail fields:** it opens a panel with the suggested shop name (`checkout.gardenshop.example` →
  `gardenshop`), the domain choice and the **existing addresses for this shop**. *Neue Adresse erzeugen*
  creates an identity and fills the field, including “repeat e-mail” fields.
* **Toolbar popup** (on Firefox for Android in the menu under *Extensions*): the same functions. It
  fills the focused field (otherwise the most likely e-mail field) and, unless switched off in the
  options, copies the address to the clipboard.
* **Context menu** (desktop only): right-click an input field. If the field can't be filled, the new
  address is shown.

The extension rotates its token automatically.

If you change the suggested shop name, the extension remembers it for that website.

**Field detection** doesn't depend on `type="email"`. Fields are recognized by `autocomplete`,
`inputmode="email"`, a placeholder or pattern containing `@`, name/id, `<label>`, `aria-label(ledby)`
and short text right before the field (“E-Mail”, “Mail”, “courriel”, “correo”, …), including
fields inside web components. For a field that gives no hint at all, focus it and use the popup (or,
on desktop, the context menu). If the page has no recognized e-mail field, the focused field is
filled. The extension then remembers the field for that website, and the button appears there from
then on. Remembered fields can be removed on the options page.

**Privacy:** the extension only talks to your mail server. It sends its token and the shop name
and receives the address; there is no tracking. See [PRIVACY.md](PRIVACY.md).

---

## Other mail servers

The extension only depends on the REST API described in
[docs/openapi.yaml of the plugin](https://github.com/michael-dev/roundcube-identity_api/blob/main/docs/openapi.yaml),
so any mail server or admin panel can offer it. What the
extension needs:

* An API base URL (any path, HTTPS) that the user enters in the extension, below it:
  * `GET /v1/me` → `{"user", "domains": [...], "default_domain", "pattern", "prefix"}`
  * `GET /v1/identities?shop=<name>` → `{"items": [{"id", "email", ...}]}`
  * `POST /v1/identities` with JSON `{"shop", "domain"}` (`domain` optional) → 201 with the new
    identity `{"id", "email", "shop", ...}`
* Authentication with `Authorization: Bearer <token>`; errors as `application/problem+json` with a
  `code` (the extension shows German texts for the codes listed in the OpenAPI description).
* Optional token rotation: send `Identity-Api-Token-Rotate: true` when a token should be renewed,
  and offer `POST /v1/token/rotate` and `GET /v1/token`. A server that never sends `true` doesn't
  need them.
* Optional **connect button** on the server's settings page, for setup with one click: an element
  `<div id="identityapi-connect" data-token="<new token>" data-api="<API URL>"><button>…</button><div class="hint"></div></div>`.
  `data-api` is relative to the page or absolute, on the same server as the page. On a real click
  the extension checks the token with `GET /v1/me`, asks the user in its own page and stores the
  connection; the `hint` element shows its progress. Without the extension, the button's own
  handler should explain that the extension is missing.

The extension doesn't need CORS (it has host permissions).

## Development

```
extension/           browser extension, Firefox and Chromium
  lib/               API client, shop name detection, browser compatibility
  tests/             unit tests
  amo/               listing data for addons.mozilla.org (not part of the package)
scripts/             build of the Chromium variant
tests/               tests against Roundcube with the plugin: API client (rotation-client.js) and
                     end-to-end test of the Chrome extension (e2e/), started by client.sh
store/               screenshots for the store listings
docs/                publishing in the stores
```

```bash
make test               # unit tests
make integration-test   # runs Roundcube with the identity_api plugin (cloned into PLUGIN_DIR,
                        # default ../roundcube-identity_api; needs PHP with pdo_sqlite, curl,
                        # python3) and tests the extension's API client against it
E2E=1 make integration-test  # additionally the real Chrome extension in Chromium (needs Playwright:
                        # npm install --no-save playwright && npx playwright install chromium)
make lint               # Mozilla's web-ext lint for the Firefox extension
make xpi chrome         # builds into dist/: shop-adressen-<version>.xpi (Firefox, unsigned) and
                        # shop-adressen-chrome-<version>.zip (Chromium)
```

CI runs lint and the unit tests, and the API client and end-to-end tests against Roundcube 1.5 and
1.7 with the plugin from the `main` branch of its repository. The plugin's CI runs the same tests
against its changes.

Until 2.2 this repository (then `ff-rc-identity`) also contained the Roundcube plugin, which now has
[its own repository](https://github.com/michael-dev/roundcube-identity_api).

### Releases

Running *Actions → Release → Run workflow* with a new version (e.g. `2.2`), or pushing such a tag,
triggers the release workflow. It sets the extension version from the tag, runs the unit tests, the
API client test against the plugin and lint, and builds both packages into a draft release. It then
signs the Firefox extension and publishes the release. Running it again for a failed release
continues the draft; a published release is never rebuilt, release a new version instead. How to
publish the extension in the Chrome Web Store (listing texts, permission justifications,
screenshots): [docs/publishing.md](docs/publishing.md).

**Signing and stores:** with these repository settings (*Settings → Secrets and variables →
Actions*), releases get the Firefox extension signed by Mozilla and upload the Chrome variant to
the Chrome Web Store:

| Name | Kind | Content |
|---|---|---|
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Secrets | API credentials from <https://addons.mozilla.org/developers/addon/api/key/> |
| `GECKO_ID` | Variable (optional) | Your own add-on ID, replaces the one in the manifest (`shop-adressen@ff-rc-identity`, kept from the former repository name: a new ID would be a new add-on on addons.mozilla.org) |
| `AMO_CHANNEL` | Variable (optional) | `unlisted` (default: signed file attached to the release) or `listed` (public on addons.mozilla.org, with listing data from `extension/amo/metadata.json`) |
| `CWS_EXTENSION_ID` | Variable (optional) | ID of the item in the Chrome Web Store (create it once by uploading the zip manually) |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Secrets (optional) | OAuth credentials for the [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) |

Mozilla signs every version only once, so use a new tag for a new signed build.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
