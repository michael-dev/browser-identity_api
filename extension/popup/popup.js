'use strict';

const $ = (id) => document.getElementById(id);
const t = rcidT;
rcidLocalize(document);
let tab = null;
let settings = { copyToClipboard: true };
let template = '';
let prefix = '';

function setStatus(text, kind) {
  $('status').textContent = text || '';
  $('status').className = 'status' + (kind ? ' ' + kind : '');
}

async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (!res || !res.ok) {
    throw new Error(res ? res.error : t('noAnswer'));
  }
  return res.data;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Frame that has the focused element. Frames keep their activeElement when
 * the focus leaves them, so a subframe only counts if the top frame's focus
 * is on a frame element (otherwise the user moved on to the top page).
 */
async function focusedFrameId() {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) return 'none';
        return /^(IFRAME|FRAME)$/.test(a.tagName) ? 'frame' : 'field';
      },
    });
    const top = results.find((r) => r.frameId === 0);
    if (!top || top.result !== 'frame') {
      return 0;
    }
    const hit = results.find((r) => r.frameId !== 0 && r.result === 'field');
    return hit ? hit.frameId : 0;
  } catch (e) {
    return 0;
  }
}

/** Insert into the page: the focused field of the focused frame, else best guess in the top frame. */
async function insert(email) {
  if (!tab) return 0;
  try {
    const frameId = await focusedFrameId();
    // a frame without answer: Firefox resolves with undefined, Chromium rejects
    const ask = (msg, frame) => browser.tabs.sendMessage(tab.id, msg, { frameId: frame }).catch(() => undefined);
    let res = await ask({ type: 'fill', email, mode: 'focused' }, frameId);
    if (!res) {
      res = await ask({ type: 'fill', email, mode: 'heuristic' }, 0);
    }
    return res ? res.filled : 0;
  } catch (e) {
    return 0; // no content script (about:, addons.mozilla.org, PDF viewer, ...)
  }
}

async function use(email) {
  const filled = await insert(email);
  const copied = settings.copyToClipboard ? await copy(email) : false;
  if (filled) {
    const key = (filled > 1 ? 'insertedFields' : 'inserted') + (copied ? 'Copied' : '');
    setStatus(t(key, filled), 'ok');
    // on Android the popup covers the page, close it to show the result
    setTimeout(() => window.close(), 900);
  } else {
    setStatus(t(copied ? 'noFieldCopied' : 'noField'), copied ? 'ok' : 'error');
  }
}

function renderList(identities) {
  const ul = $('list');
  ul.replaceChildren();
  for (const id of identities || []) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = id.email;
    code.title = id.email;
    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.textContent = t('insert');
    insertBtn.addEventListener('click', () => use(id.email));
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = t('copy');
    copyBtn.addEventListener('click', async () => setStatus(t((await copy(id.email)) ? 'copied' : 'copyFailed')));
    li.append(code, insertBtn, copyBtn);
    ul.append(li);
  }
  $('existing').hidden = !(identities && identities.length);
}

function updatePreview() {
  const shop = RcShop.sanitize($('shop').value);
  const domain = $('domain').value || $('domain').dataset.default || 'domain';
  const local = (template || '{prefix}-{shop}-{year}-{random}')
    .replace('{prefix}', prefix || 'x').replace('{shop}', shop).replace('{year}', new Date().getFullYear()).replace('{random}', 'xxxxxxxx');
  $('preview').textContent = shop ? `${local}@${domain}` : '';
  $('create').disabled = !shop;
}

let listTimer = null;
function refreshList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(async () => {
    const shop = $('shop').value.trim();
    if (!RcShop.sanitize(shop)) return renderList([]);
    try {
      renderList(await send({ type: 'list', shop }));
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }, 400);
}

async function create() {
  // raw input: the server's transliteration is better than the preview's
  const shop = $('shop').value.trim();
  if (!RcShop.sanitize(shop) || $('create').disabled) return;
  $('create').disabled = true;
  setStatus(t('creating'));
  try {
    const identity = await send({ type: 'create', shop, domain: $('domain').value, url: tab && tab.url });
    $('result-email').textContent = identity.email;
    $('result').hidden = false;
    await use(identity.email);
    refreshList();
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    $('create').disabled = false;
  }
}

async function init() {
  $('options').addEventListener('click', () => browser.runtime.openOptionsPage().then(() => window.close()));
  $('setup').addEventListener('click', () => browser.runtime.openOptionsPage().then(() => window.close()));
  $('create').addEventListener('click', create);
  $('result-copy').addEventListener('click', async () =>
    setStatus(t((await copy($('result-email').textContent)) ? 'copied' : 'copyFailed')));
  $('shop').addEventListener('input', () => { updatePreview(); refreshList(); });
  $('shop').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  $('domain').addEventListener('change', updatePreview);

  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  settings = await send({ type: 'settings' });

  if (!settings.configured) {
    $('unconfigured').hidden = false;
    return;
  }
  $('main').hidden = false;
  setStatus(t('loading'));

  const ctx = await send({ type: 'context', url: tab ? tab.url : '' });
  $('shop').value = ctx.shop;
  if (ctx.domains.length > 1) {
    for (const d of ctx.domains) {
      const o = document.createElement('option');
      o.value = d;
      o.textContent = '@' + d;
      $('domain').append(o);
    }
    $('domain').value = ctx.defaultDomain;
    $('domain').hidden = false;
  }
  $('domain').dataset.default = ctx.defaultDomain || '';
  template = ctx.template;
  prefix = ctx.prefix;
  renderList(ctx.identities);
  updatePreview();
  setStatus(ctx.error || (ctx.shop ? '' : t('enterShop')), ctx.error ? 'error' : '');
  // focus the button (Enter creates), avoids popping up the keyboard on Android
  $('create').focus();
}

init().catch((e) => setStatus(e.message, 'error'));
