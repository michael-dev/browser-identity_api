# Datenschutz / Privacy – Shop-Adressen

**Deutsch**

Die Browser-Erweiterung „Shop-Adressen“ (Firefox und Chromium-Browser) kommuniziert ausschließlich
mit dem Mailserver, dessen API-URL du in den Einstellungen der Erweiterung einträgst oder per „Mit
Browser-Erweiterung verbinden“ übernimmst (z. B. Roundcube mit dem Plugin identity_api).

* **Übertragen wird:** dein API-Token (zur Anmeldung), der Shop-Name, für den eine Adresse
  erzeugt oder aufgelistet werden soll, und ggf. die gewählte Domain. Der Shop-Name wird aus der Domain der aktuellen Website
  abgeleitet (z. B. `gardenshop.example` → `gardenshop`) und kann vorher geändert werden.
* **Empfangen wird:** die erzeugte bzw. vorhandene E-Mail-Adresse.
* **Lokal gespeichert** (nur im Browser, nicht synchronisiert): API-URL, Token, Kontoname,
  Einstellungen, die von dir geänderten Shop-Namen pro Website und die gemerkten E-Mail-Felder
  (Website und Name bzw. ID des Feldes).
* Es gibt keine Statistik, kein Tracking und keine Übertragung an den Entwickler oder an Dritte.
  Seiteninhalte werden nur lokal ausgewertet, um E-Mail-Felder zu erkennen und auszufüllen.

Verantwortlich für die Daten auf dem Server ist dessen Betreiber.

**English**

The browser extension “Shop-Adressen” (Firefox and Chromium based browsers) only communicates with
the mail server whose API URL the user configured (e.g. Roundcube with the identity_api plugin). It sends the API token, the shop name (derived from the
current website's domain, editable) and the chosen domain, and receives the generated e-mail
address. Settings, the account name, shop names you changed and remembered e-mail fields (website
plus field name/id) are stored locally in the browser and are not synced. There is
no analytics or tracking and no data is sent to the developer or any third party. Page content is only
processed locally to detect and fill e-mail fields.
