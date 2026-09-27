/* Confirmation of a "connect" request from the Roundcube settings (see background.js). */
'use strict';

const $ = (id) => document.getElementById(id);
const id = location.hash.slice(1);

// text from the server: no control characters (fake line breaks), limited length
const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, 100);

function status(text, kind) {
  $('status').textContent = text;
  $('status').className = kind || '';
}

async function closeTab() {
  const tab = await browser.tabs.getCurrent().catch(() => null);
  if (tab) {
    browser.tabs.remove(tab.id).catch(() => window.close());
  } else {
    window.close();
  }
}

async function load() {
  const res = await browser.runtime.sendMessage({ type: 'connectDetails', id });
  if (!res || !res.ok) {
    status(res ? res.error : 'Unbekannter Fehler', 'error');
    return;
  }
  const d = res.data;
  const url = new URL(d.url);
  $('host').textContent = url.host;
  $('url').textContent = d.url;
  $('user').textContent = clean(d.user);

  const warnings = [];
  if (d.previousUrl && new URL(d.previousUrl).origin !== url.origin) {
    warnings.push(`Die Erweiterung ist bisher mit ${new URL(d.previousUrl).host} verbunden. Diese Verbindung wird ersetzt.`);
  } else if (d.previousUrl && d.previousUser && d.previousUser !== d.user) {
    warnings.push(`Anderes Konto: bisher ${clean(d.previousUser)}, neu ${clean(d.user)}.`);
  } else if (d.previousUrl) {
    warnings.push('Das bisherige Token wird durch das neue ersetzt.');
  }
  if (url.protocol !== 'https:') {
    warnings.push('Unverschlüsselte Verbindung (nur für Tests auf localhost).');
  }
  $('warning').textContent = warnings.join(' ');
  $('warning').hidden = !warnings.length;

  status('');
  $('details').hidden = false;
  $('confirm').focus();
}

$('confirm').addEventListener('click', async () => {
  $('confirm').disabled = $('cancel').disabled = true;
  const res = await browser.runtime.sendMessage({ type: 'connectConfirm', id });
  $('details').hidden = true;
  if (res && res.ok) {
    status(`Verbunden mit ${new URL(res.data.url).host} (${clean(res.data.user)}). Du kannst jetzt in Bestellformularen Shop-Adressen erzeugen.`, 'ok');
    setTimeout(closeTab, 2500);
  } else {
    status(res ? res.error : 'Unbekannter Fehler', 'error');
  }
});

$('cancel').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'connectCancel', id });
  closeTab();
});

load();
