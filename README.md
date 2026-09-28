# Shop-Adressen – per-shop e-mail addresses

Give every online shop its own e-mail address, created on the fly in the checkout form:

```
<prefix>-<shop>-<year>-<random>@your-domain        e.g. m-bookshop-2026-k3x9q2ab@example.org
```

The project consists of:

* **Shop address API** ([docs/openapi.yaml](docs/openapi.yaml)): an open, token-authenticated REST
  API a mail server offers to create such addresses for the logged in account. Any mail server can
  implement it, see [Other mail servers](#other-mail-servers).
* **Browser extension “Shop-Adressen”** for Firefox (desktop and Android) and Chromium based
  browsers (Chrome, Edge, Brave, Vivaldi; `extension/`): detects e-mail fields, suggests the
  shop name from the website, creates or reuses an address through the API and fills it in. It
  works with every server offering the API.
* **Roundcube plugin `identity_api`** (`plugin/`), the reference implementation: creates the
  addresses as Roundcube identities, and lets users create addresses, manage tokens and set their
  pattern, prefix and domains in the Roundcube settings.
* **iPhone/iPad** (no extensions on iOS): an address generator in the Roundcube settings, and an iOS
  Shortcut for the share sheet, see [docs/ios.md](docs/ios.md).
* **Postfix**: how to deliver mail to the identities from Roundcube's MySQL database, see
  [docs/postfix.md](docs/postfix.md).

Why? You can tell which shop leaked or sold your address, and you can shut down a single address by
deleting its identity.

```
browser extension ─┐                   Shop address API
iOS Shortcut ──────┼─HTTPS + token─▶ identity_api plugin ──▶ Roundcube "identities" table
other clients ─────┘◀──new address── (or another server)                 │
                                                          your mail server delivers per identity
```

> **Requirement (Roundcube plugin):** your mail server has to accept mail for the addresses stored as Roundcube
> identities, e.g. through an SQL lookup on the `identities` table, see
> [docs/postfix.md](docs/postfix.md) for Postfix. The plugin only manages the identities. A
> catch-all for the domain works too, but then deleting an identity doesn't stop its mail.

---

## Roundcube plugin

Supported: Roundcube 1.5, 1.6 and 1.7 (tested with 1.5.15, 1.6.19 and 1.7.4), PHP 7.3 or later.
Tested with SQLite and MySQL/MariaDB. PostgreSQL uses only standard SQL but isn't tested. The PHP
extension `intl` is recommended; without it, shop names are transliterated with `iconv`, which
handles fewer characters.

### Installation

With Composer, from the Roundcube directory. The releases contain a Composer repository, add it
once:

```bash
composer config repositories.identity_api composer https://github.com/michael-dev/ff-rc-identity/releases/latest/download
composer require michael-dev/identity_api
```

Or manually: extract `identity_api-<version>.tar.gz` (or `.zip`) from the
[releases](https://github.com/michael-dev/ff-rc-identity/releases) into `plugins/`, so that
`plugins/identity_api/identity_api.php` exists, and enable it in `config/config.inc.php`:

```php
$config['plugins'][] = 'identity_api';
```

Optional: copy `plugins/identity_api/config.inc.php.dist` to `config.inc.php` and adjust it (the
Composer installer creates it automatically).

Set up the **rewrite rule** for the API URL in the web server, see [REST API](#rest-api).

List `identity_api` **after** plugins that restrict access in their `startup` hook (IP filters,
maintenance mode), because API requests end in this plugin's `startup` hook.

### Upgrading from 2.0

2.1 uses the API only through its own URL (`<roundcube-url>/api/identity/`):

1. Set up the rewrite rule (see [REST API](#rest-api)) and check the API URL in the Roundcube settings
   (no warning below it).
2. Update the plugin. Extensions and Shortcuts of 2.0 keep working.
3. Update the extension, open its options and replace the webmail URL with the API URL shown in
   Roundcube (the token stays valid), or create a new token and click *Connect browser extension*.
4. Change iOS Shortcuts to `<API URL>v1/identities`, see [docs/ios.md](docs/ios.md).

### Configuration

| Option | Default | Description |
|---|---|---|
| `identity_api_template` | `{prefix}-{shop}-{year}-{random}` | Default pattern for new addresses (users can set their own). Placeholders: `{prefix}`, `{shop}`, `{year}`, `{random}` (`{shop}` and `{random}` are required). |
| `identity_api_default_prefix` | `''` | Default for `{prefix}`. Empty: first letter of the username (`michael@…` → `m`). |
| `identity_api_url` | `'api/identity/'` | URL of the REST API, relative to Roundcube's URL or absolute. The web server maps it to Roundcube with a rewrite rule (see [REST API](#rest-api)). |
| `identity_api_domains` | `[]` | Default domains if a user hasn't configured any. The first one is the default. The placeholders `%n`, `%t` and `%d` (e.g. `%d`: `webmail.example.org` → `example.org`) come from the Host header and are only used if Roundcube's `trusted_host_patterns` is set. Empty: domain of the user's default identity. |
| `identity_api_allowed_domains` | `[]` | Restricts the domains users may configure themselves, e.g. `['example.org', '*.example.org']`. Empty: any domain (like `identities_level` 0). It doesn't apply to `identity_api_domains` or the fallback. |
| `identity_api_random_length` | `8` | Length of `{random}`, at least 4 |
| `identity_api_random_chars` | `'abcdefghijklmnopqrstuvwxyz0123456789'` | Characters used for `{random}` (listed one by one, no ranges) |

Changing the pattern, `identity_api_random_length` or `identity_api_random_chars` later hides older
addresses from listing and deleting when they no longer match, and the Postfix lookup
([docs/postfix.md](docs/postfix.md)) has to match the new format.
| `identity_api_shop_maxlength` | `30` | Maximum length of `{shop}` |
| `identity_api_token_rotation` | `30` | Clients are asked to rotate their token after this many days (0 = no rotation), see below. |
| `identity_api_token_lifetime` | `90` | A token that was not rotated for this many days expires, e.g. on a device that is no longer used (0 = never). Values not larger than the rotation interval are raised to twice the interval. |
| `identity_api_static_tokens` | `false` | Allow tokens without rotation and expiry, for clients that can't rotate (scripts, iOS Shortcuts) |
| `identity_api_max_tokens` | `10` | Maximum number of tokens per user |
| `identity_api_max_identities` | `5000` | Maximum number of identities per user, all identities counted (0 = unlimited) |
| `identity_api_rate_limit` | `30` | Maximum number of identities a user can create per hour through the API or the address generator in the settings (0 = unlimited) |
| `identity_api_max_login_age` | `0` | Reject tokens of users who haven't logged in to the webmail for this many days (0 = off) |
| `identity_api_unique_identities` | `true` | Refuse identities, also in the Roundcube settings, whose address another user has or had (deleted identities included). Set to `false` for deliberately shared addresses. |
| `identity_api_ignore_identities_level` | `false` | Also create identities if `identities_level` is 1 or higher (users may not choose addresses, or single identity mode) |

To stop users from changing a setting, add its user preference to Roundcube's `dont_override`:
`identity_api_user_template`, `identity_api_prefix`, `identity_api_user_domains`. The admin default
then applies.

### User settings

**Settings → Preferences → Shop address API**:

* **New shop address:** create an address for a shop name or website (`gardenshop.example` → `gardenshop`) and copy
  it, or list the existing ones. This works in any browser, e.g. on an iPhone.
* **Connection:** the API URL to use in the extension. After creating a token (see *Create
  token*), it is shown here **once**, together with a **Connect browser extension** button.
* **Addresses:** the **pattern** (e.g. `{prefix}.{shop}.{random}` without the year; empty = admin
  pattern), a personal **prefix** (letters and digits; empty = default) and **domains**, one per
  line. The first domain is the default, the others can be chosen in the extension. An example of the
  resulting address is shown.
* **Access tokens:** one token per device. Tokens can be revoked individually and are shown with
  their creation, last-use, renewal and expiry dates, together with the server's rotation policy.
* **Create token:** enter a device name and save. If the admin allows it, a token can be created
  **without automatic renewal** (for scripts and iOS Shortcuts).

Deleting an identity (in the Roundcube settings or through the API) marks it as deleted
(`del = 1`). If your mail server's lookup filters on `del = 0`, this shuts down the address.

### REST API

The plugin offers a versioned REST API (v1) that other systems can use too. The complete description
is in [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1), so you can generate clients from it.

**Base URL.** The API lives below `<roundcube-url>/api/identity/`, e.g.

```
https://webmail.example.org/api/identity/v1/identities
https://webmail.example.org/api/identity/v1/identities?shop=gardenshop
```

**Rewrite rule (required).** Roundcube has no URL routing, so the web server has to pass these URLs
to Roundcube. For Roundcube at the root of its host:

```nginx
# nginx, in the server block of Roundcube, before the location for PHP
location ^~ /api/identity/ {
    rewrite ^/api/identity(/.*)$ /index.php?_task=identity_api&_path=$1 last;
}
```

```apache
# Apache: in Roundcube's .htaccess, directly after "RewriteEngine On"
# (before Roundcube's own rules, which would answer 403)
RewriteRule ^api/identity(/.*)$ index.php?_task=identity_api&_path=$1 [QSA,L]
# pass the "Authorization" header to PHP (PHP-FPM / FastCGI)
CGIPassAuth On
```

Both rules are tested in CI with PHP-FPM, the Apache rule in Roundcube's own `.htaccess` (1.6 and
1.7). `CGIPassAuth` in `.htaccess` needs `AllowOverride AuthConfig` (or `All`). If `.htaccess` files
are disabled (`AllowOverride None`), put the lines with `RewriteEngine On` into the `<Directory>` block
of Roundcube's document root instead.

For Roundcube in a subdirectory, e.g. `/roundcube/` (not tested): nginx
`location ^~ /roundcube/api/identity/ { rewrite ^/roundcube/api/identity(/.*)$ /roundcube/index.php?_task=identity_api&_path=$1 last; }`,
Apache the same lines in that directory's `.htaccess`. For another location of the API, set
`identity_api_url`.

The settings page shows the API URL and warns if the API doesn't answer there or the web server
drops the `Authorization` header. The browser extension sends the token only in `Authorization`.

**Authentication:** `Authorization: Bearer <token>`, or `X-Identity-Api-Token: <token>` for servers
that drop the `Authorization` header.

| Method and path | Description | Success |
|---|---|---|
| `GET /v1/me` | User, name, prefix, pattern, allowed domains, default domain, limits | 200 |
| `GET /v1/identities[?shop=…]` | Generated identities, newest first, optionally for one shop | 200 `{"items": [...]}` |
| `POST /v1/identities` | Create an address. JSON or form: `shop` (name or website address), optional `url` (website address, if `shop` is empty), `domain`, `name` | 201 + `Location` |
| `GET /v1/identities/{id}` | One generated identity | 200 |
| `DELETE /v1/identities/{id}` | Delete a generated identity (Roundcube marks it deleted) | 204 |
| `GET /v1/token` | Status of the token in use: created, renewed, last use, expiry, rotation due | 200 |
| `POST /v1/token/rotate` | New token (see rotation) | 200 `{"token": ...}` |

An identity looks like
`{"id": 42, "email": "m-bookshop-2026-k3x9q2ab@example.org", "name": "…", "shop": "bookshop", "prefix": "m", "year": 2026, "changed": "2026-09-27T20:21:12Z"}`.
Only identities created by the plugin (their ids are recorded) that still match the user's or the
admin's pattern can be listed or deleted, never addresses the user entered by hand.

**Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details
(`application/problem+json`) with a machine readable `code`, e.g.
`{"status": 403, "code": "domain_not_allowed", "detail": "domain not allowed", …}`. 401 comes with
`WWW-Authenticate`, 405 with `Allow`, and 429 (`rate_limit_exceeded`) with `Retry-After`.

```bash
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"shop":"Gärtnerei Grün"}' 'https://webmail.example.org/api/identity/v1/identities'
# 201 {"id":42,"email":"m-gaertnerei-gruen-2026-2zw1w368@example.org","shop":"gaertnerei-gruen",...}
```

The server normalizes shop names: lower case, transliteration (`ä→ae`, `ß→ss`, `Ł→l`, …), other
characters become `-`, at most `identity_api_shop_maxlength` characters. A website address
(`https://checkout.gardenshop.example/kasse`) is accepted as shop too; the shop name is then derived from its
host (`gardenshop`).

**Token rotation.** Every authenticated response carries `Identity-Api-Token-Rotate: true|false` and,
unless the token never expires (`identity_api_token_lifetime` = 0, or a token without rotation),
`Identity-Api-Token-Expires: <time>`. On `true`, call `POST /v1/token/rotate` and switch to the
returned token. The old token stays valid until the new one is used for the first time, so a lost
response doesn't lock the client out; of several unused new tokens, the first one used wins. A token
that isn't rotated before its expiry stops working (`identity_api_token_lifetime`). For clients that
can't rotate (scripts, iOS Shortcuts), the admin can allow tokens without rotation
(`identity_api_static_tokens`); they get no `Identity-Api-Token-Expires` header.

### Security

* Tokens have the form `<user_id>.<token_id>.<256 random bits>`. Only the SHA-256 hash is stored in
  the user's preferences, and tokens are compared in constant time.
* Tokens are rotated regularly and expire if they are not rotated, so a leaked token of a
  device that is no longer used stops working on its own. Tokens without rotation (if allowed) are
  the exception: they stay valid until revoked.
* A token can **only** list, create and delete the user's generated identities (new ones only on the
  configured domains) and rotate itself. It grants no access to mail or other settings.
* New addresses are checked against the identities of all users, deleted ones included.
* API requests don't create Roundcube sessions. They still run the standard `identity_create`,
  `identity_create_after` and `identity_delete` hooks, and every created or deleted address is
  logged to `logs/identity_api`.
* Tokens don't depend on the IMAP login. To lock out a user, revoke their tokens (or delete the
  Roundcube user). Optionally, `identity_api_max_login_age` requires regular webmail logins, and a
  plugin can veto tokens through the `identity_api_authenticate` hook
  (`['user' => rcube_user, 'token_id' => …, 'valid' => true]`). Tokens of users locked by
  `login_rate_limit` are rejected.
* Use one token per device: with rotation, a token copied to a second device stops working there
  after the first rotation.
* Use HTTPS. The extension refuses plain HTTP (except `localhost`) and doesn't follow redirects.

---

## Browser extension

The extension “Shop-Adressen” is a client of the shop address API and works with every mail server
offering it; the Roundcube plugin above is one. The same source (`extension/`) is built for Firefox
and for Chromium based browsers (`make chrome` creates the Chromium variant with a service worker;
`extension/lib/compat.js` covers the API differences).

### Installation in Firefox

Use the signed `shop-adressen-<version>-signed.xpi` from the
[releases](https://github.com/michael-dev/ff-rc-identity/releases):

* **Desktop:** drag it into a Firefox window, or go to `about:addons` → gear icon → *Install Add-on
  From File*.
* **Android:** open *Settings → About Firefox* and tap the Firefox logo five times. Then choose
  *Settings → Install extension from file*.

For development, load `extension/manifest.json` via `about:debugging` → *This Firefox* → *Load
Temporary Add-on*.

### Installation in Chrome, Edge, Brave, Vivaldi

* **From the Chrome Web Store**, once it is published there (see *Releases*); Edge, Brave and
  Vivaldi can install extensions from the Chrome Web Store too.
* **Without store:** unzip `shop-adressen-chrome-<version>.zip` from the releases, open
  `chrome://extensions`, enable *Developer mode* and choose *Load unpacked*. Chrome doesn't install
  packed extensions from other sources and doesn't update unpacked ones.

Chrome on Android and iOS doesn't support extensions. On iPhone/iPad, see [docs/ios.md](docs/ios.md).

### Setup

* **One click:** with the extension installed, create a token in the Roundcube settings (see above)
  and click **Connect browser extension**. The extension checks the token and opens its own
  confirmation page, which shows the server, the API URL and the account; only after *Verbinden* it
  stores them.
  * Any website could show such a button, so nothing is stored without that confirmation, and it
    warns if the server or the account changes. Confirm only if you just clicked the button in your
    webmail yourself.
  * The API URL must be on the same server as the settings page.
* **Manually:** on the extension's options page, enter the API URL shown in Roundcube under
  *Connection* (e.g. `https://webmail.example.org/api/identity/`; `https://` required, except
  `localhost`) and the token, then click *Verbindung testen* (test connection) and save.

### Usage

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

**Privacy:** the extension only talks to your Roundcube server. It sends its token and the shop name
and receives the address; there is no tracking. See [PRIVACY.md](PRIVACY.md).

---

## Other mail servers

The browser extension and the iOS Shortcut only depend on the REST API described in
[docs/openapi.yaml](docs/openapi.yaml), so any mail server or admin panel can offer it. What the
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

The extension doesn't need CORS (it has host permissions); the Roundcube plugin still allows the
extension origins.

## Development

```
plugin/              Roundcube plugin (installed as plugins/identity_api/)
  lib/, localization/
  tests/             unit tests (generator) and settings UI test
extension/           browser extension, Firefox and Chromium
  lib/               API client, shop name detection, browser compatibility
  tests/             unit tests
  amo/               listing data for addons.mozilla.org (not part of the package)
docs/                OpenAPI description, Postfix guide, iOS guide
scripts/             build of the Chromium variant and the Composer repository
tests/               integration tests: Roundcube + API, Composer install, Postfix guide,
                     end-to-end test of the extension (e2e/)
```

```bash
make test               # PHP generator tests + extension unit tests
make integration-test   # downloads Roundcube (RC_VERSION, default 1.6.19) and runs it with SQLite;
                        # tests the API over HTTP, the settings hooks and the extension's API client
E2E=1 make integration-test  # additionally the real Chrome extension in Chromium (needs python3 and Playwright)
                        # Playwright: npm install --no-save playwright && npx playwright install chromium
WEB=nginx make integration-test  # through nginx or Apache (WEB=apache) with PHP-FPM and the README rewrite rule
DB=mysql make integration-test  # on MySQL/MariaDB instead (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE)
make composer-test      # installs the plugin archive with Composer into Roundcube
make postfix-test       # checks docs/postfix.md with postmap and the triggers (MYSQL_HOST, MYSQL_PORT, MYSQL_ROOT_PASSWORD)
make lint               # Mozilla's web-ext lint for the Firefox extension
make xpi chrome plugin  # builds into dist/, see below
```

`make xpi chrome plugin` creates `shop-adressen-<version>.xpi` (Firefox, unsigned),
`shop-adressen-chrome-<version>.zip` (Chromium) and `identity_api-<version>.tar.gz` and `.zip` (plugin).

CI runs:
* the integration test with SQLite on Roundcube 1.5/PHP 7.3, 1.6/PHP 8.1 and 1.7/PHP 8.4, each
  including the end-to-end test of the Chrome extension and the Composer install,
* the integration test through nginx and Apache with the rewrite rules from this README,
* the integration test on MariaDB,
* the Postfix guide test with a real `postmap`,
* lint and unit tests of the extension.

### Releases

Running *Actions → Release → Run workflow* with a new version (e.g. `2.2`), or pushing such a tag,
triggers the release workflow. It sets the extension version from the tag, runs the unit tests, the
SQLite integration test and lint, and builds everything into a draft release. It then signs the
Firefox extension, adds the Composer repository (`packages.json`, listing the plugin archives of all
releases) and publishes the release. Running it again for a failed release continues the draft; a
published release is never rebuilt, release a new version instead. The plugin archives are
reproducible (same bytes for the same commit).

Composer installs a package from the root of its source, so it can't install the plugin from this
repository directly; the plugin archive has the plugin files at its root. This also rules out
Packagist, which reads `composer.json` from the repository root. To list the plugin there (and on
plugins.roundcube.net), publish `plugin/` as a separate repository, e.g. with `git subtree split
--prefix plugin`.

**Signing and stores:** with these repository settings (*Settings → Secrets and variables →
Actions*), releases get the Firefox extension signed by Mozilla and upload the Chrome variant to
the Chrome Web Store:

| Name | Kind | Content |
|---|---|---|
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Secrets | API credentials from <https://addons.mozilla.org/developers/addon/api/key/> |
| `GECKO_ID` | Variable (optional) | Your own add-on ID, replaces the one in the manifest |
| `AMO_CHANNEL` | Variable (optional) | `unlisted` (default: signed file attached to the release) or `listed` (public on addons.mozilla.org, with listing data from `extension/amo/metadata.json`) |
| `CWS_EXTENSION_ID` | Variable (optional) | ID of the item in the Chrome Web Store (create it once by uploading the zip manually) |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Secrets (optional) | OAuth credentials for the [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) |

Mozilla signs every version only once, so use a new tag for a new signed build.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
