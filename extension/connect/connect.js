/* Confirmation of a "connect" request from the mail server's settings page (see background.js). */
'use strict';

const $ = (id) => document.getElementById(id);
const t = rcidT;
rcidLocalize(document);
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
    status(res ? res.error : t('unknownError'), 'error');
    return;
  }
  const d = res.data;
  const url = new URL(d.url);
  $('host').textContent = url.host;
  $('url').textContent = d.url;
  $('user').textContent = clean(d.user);

  const warnings = [];
  if (d.previousUrl && new URL(d.previousUrl).origin !== url.origin) {
    warnings.push(t('warnReplaceServer', new URL(d.previousUrl).host));
  } else if (d.previousUrl && d.previousUser && d.previousUser !== d.user) {
    warnings.push(t('warnOtherAccount', [clean(d.previousUser), clean(d.user)]));
  } else if (d.previousUrl) {
    warnings.push(t('warnReplaceToken'));
  }
  if (url.protocol !== 'https:') {
    warnings.push(t('warnInsecure'));
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
    status(t('connectedTo', [new URL(res.data.url).host, clean(res.data.user)]), 'ok');
    setTimeout(closeTab, 2500);
  } else {
    status(res ? res.error : t('unknownError'), 'error');
  }
});

$('cancel').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'connectCancel', id });
  closeTab();
});

load();
