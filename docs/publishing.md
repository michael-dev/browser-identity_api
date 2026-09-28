# Publishing

How the browser extension gets into the Chrome Web Store. Firefox: see *Signing and stores* in
the README (`AMO_CHANNEL`, listing data in
`extension/amo/metadata.json`).

## Browser extension in the Chrome Web Store

One-time setup:

1. Register as a developer on <https://chrome.google.com/webstore/devconsole> (one-time fee of 5 USD).
2. *New item*: upload `shop-adressen-chrome-<version>.zip` from the latest release.
3. Fill in the listing and the privacy practices with the texts below, upload the images from
   `store/screenshots/` and submit it for review.
4. After the first publication, set up automatic uploads for later releases: variable
   `CWS_EXTENSION_ID` (the item ID from the developer console) and the secrets `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` (see
   [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)).

Edge (Microsoft Edge Add-ons), Brave and Vivaldi install extensions from the Chrome Web Store.

### Store listing

* **Name:** from the manifest, `Shop-Adressen` (German) / `Shop Addresses` (English)
* **Summary:** from the manifest (≤ 132 characters)
* **Category:** Shopping (alternatively Productivity → Tools)
* **Languages:** German and English (the extension's `_locales`)
* **Icon:** `extension/icons/icon-128.png` (in the package)
* **Screenshots (1280×800):** `store/screenshots/1-panel.png`, `2-filled.png`, `3-connect.png`,
  `4-roundcube-settings.png`, `5-options.png`; for the English listing the same names in
  `store/screenshots-en/`
* **Small promo tile (440×280):** `store/screenshots/promo-440x280.png`
* **Homepage:** <https://github.com/michael-dev/browser-identity_api>
* **Support:** <https://github.com/michael-dev/browser-identity_api/issues>

**Description (German):**

```text
Jeder Onlineshop bekommt seine eigene E-Mail-Adresse – erzeugt direkt im Bestellformular.

Sobald ein E-Mail-Feld den Fokus hat, erscheint darin ein kleiner Button. Er schlägt den Shop-Namen aus der Website vor (z. B. gartenparadies.example → gartenparadies), lässt deinen Mailserver eine neue Adresse wie alex-gartenparadies-2026-k3x9q2ab@deine-domain anlegen und fügt sie ein, auch in Felder wie „E-Mail wiederholen“. Adressen, die es für den Shop schon gibt, werden zur Wiederverwendung angeboten. Das Symbol in der Symbolleiste und das Kontextmenü können dasselbe.

Wozu? Du siehst, welcher Shop deine Adresse weitergegeben hat, und kannst eine einzelne Adresse auf dem Server stilllegen, ohne dein Postfach zu wechseln.

Voraussetzungen:
• Ein Mailserver mit der Shop-Adressen-REST-API (offene Spezifikation), z. B. Roundcube 1.5–1.7 mit dem Plugin identity_api: https://github.com/michael-dev/roundcube-identity_api
• Ein persönliches Token dieses Servers – bei Roundcube per Klick auf „Mit Browser-Erweiterung verbinden“ in den Einstellungen

Datenschutz: Die Erweiterung spricht ausschließlich mit dem Server, dessen API-URL du einträgst. Sie sendet dein Token, den Shop-Namen und ggf. die gewählte Domain und erhält die erzeugte Adresse. Keine Statistik, kein Tracking, keine Dritten. Quelltext: https://github.com/michael-dev/browser-identity_api
```

**Description (English, if you add English as a second language):**

```text
Give every online shop its own e-mail address – created on the fly, right in the checkout form.

When you focus an e-mail field, a small button appears. It suggests the shop name from the website (e.g. gartenparadies.example → gartenparadies), has your mail server create a new address like alex-gartenparadies-2026-k3x9q2ab@your-domain and fills it in, including "repeat e-mail" fields. Addresses you already created for a shop are offered for reuse. The toolbar button and the context menu do the same.

Why? You see which shop leaked or sold your address, and you can shut down a single address on the server.

Requirements:
• A mail server offering the shop address REST API (open specification), e.g. Roundcube 1.5–1.7 with the plugin identity_api: https://github.com/michael-dev/roundcube-identity_api
• A personal access token from that server – in Roundcube one click on "Connect browser extension" in the settings

Privacy: The extension only talks to the server whose API URL you configure. It sends your token, the shop name and the chosen domain and receives the generated address. No analytics, no tracking, no third parties. User interface in English and German. Source code: https://github.com/michael-dev/browser-identity_api
```

### Privacy practices

**Single purpose:**

```text
Creates a new e-mail address for the current online shop on the user's own mail server (through its shop address API) and fills it into the shop's e-mail fields.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the API URL and token of the user's mail server, the settings, shop names the user corrected per website and e-mail fields the user filled manually per website, locally. |
| `scripting` | When the toolbar popup inserts an address, it finds out which frame of the current tab has the focused field, so the address goes into that field. |
| `contextMenus` | Context menu on input fields: "Neue Shop-Adresse erzeugen und einfügen" and "Shop-Adresse auswählen …". |
| `clipboardWrite` | Copies a newly created address to the clipboard (can be switched off in the options). |
| Host permissions (`<all_urls>`) | The e-mail fields of any online shop are detected and filled (content script on all sites), and the API URL of the user's own mail server, which can be any host, is contacted. |

**Remote code:** No, the extension uses no remote code (all scripts are in the package).

**Data usage** (tick these and confirm the three certifications: no sale to third parties, no use
for unrelated purposes, no use for creditworthiness or lending):

* **Authentication information:** the API token of the user's mail server, stored locally and only
  sent to that server.
* **Personally identifiable information:** the e-mail addresses the mail server creates for the user,
  shown and filled into forms.
* **Web history:** the shop name derived from the domain of the current website, sent to the user's
  own mail server to create the address.

**Privacy policy:** <https://github.com/michael-dev/browser-identity_api/blob/main/PRIVACY.md>

## Screenshots

`store/screenshots/` is generated by the end-to-end test against the local test Roundcube (with the
plugin, see *Development* in the README):

```bash
SCREENSHOTS=$PWD/store/screenshots E2E=1 make integration-test
SCREENSHOTS=$PWD/store/screenshots-en E2E_LANG=en-US E2E=1 make integration-test
```

The server name `webmail.example.org` in them replaces the local test server's address, the shop is
fictional.
