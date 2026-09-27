/* Background (event page): talks to Roundcube, serves popup/content script requests. */
'use strict';

const menus = browser.menus || browser.contextMenus; // not available on Android

/** Page the request is about: the sender's tab, or the tab the popup names. */
function tabUrl(msg, sender) {
  if (sender && sender.tab) {
    return sender.tab.url || ''; // content scripts can't choose another page
  }
  return msg.url || '';
}

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

function suggestShop(url, settings) {
  const key = RcShop.siteKey(url);
  return (key && own(settings.overrides, key) && settings.overrides[key]) || RcShop.shopFromUrl(url);
}

/** Everything a UI needs to show: suggestion, domains, existing addresses. */
async function context(url) {
  const settings = await RcApi.getSettings();
  const configured = Boolean(settings.apiUrl && settings.token);
  const shop = await suggestShop(url, settings);
  const result = { configured, shop, domains: [], defaultDomain: '', template: '', prefix: '', identities: [], error: null };

  if (!configured) {
    return result;
  }

  try {
    const [info, list] = await Promise.all([
      RcApi.info(settings),
      shop ? RcApi.list(shop, settings) : Promise.resolve([]),
    ]);
    result.domains = info.domains;
    result.defaultDomain = info.domains.includes(settings.defaultDomain) ? settings.defaultDomain : info.default_domain;
    result.template = info.pattern;
    result.prefix = info.prefix;
    result.identities = list;
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

async function create(shop, domain, url) {
  const settings = await RcApi.getSettings();
  shop = String(shop || '').trim(); // the server normalizes (better transliteration than ours)
  let res;
  try {
    res = await RcApi.create(shop, domain || settings.defaultDomain, settings);
  } catch (e) {
    // stored default domain no longer allowed on the server: use the server's default
    if (e.code !== 'domain_not_allowed' || domain || !settings.defaultDomain) {
      throw e;
    }
    res = await RcApi.create(shop, '', settings);
  }

  // remember a deviating shop name for this site
  const key = RcShop.siteKey(url);
  if (key) {
    const overrides = Object.assign({}, settings.overrides);
    if (res.shop && res.shop !== RcShop.shopFromUrl(url)) {
      overrides[key] = res.shop;
    } else {
      delete overrides[key];
    }
    await browser.storage.local.set({ overrides });
  }
  return res;
}

async function list(shop) {
  shop = String(shop || '').trim();
  return shop ? RcApi.list(shop) : [];
}

const MAX_LEARNED_PER_SITE = 20;

async function learnedFields(url) {
  const { learnedFields: all } = await browser.storage.local.get({ learnedFields: {} });
  const key = RcShop.siteKey(url);
  return (own(all, key) && Array.isArray(all[key])) ? all[key] : [];
}

async function learnField(url, sig) {
  const key = RcShop.siteKey(url);
  if (!key || typeof sig !== 'string' || !/^(name|id):.{1,200}$/.test(sig)) {
    return false;
  }
  const { learnedFields: all } = await browser.storage.local.get({ learnedFields: {} });
  const list = (own(all, key) && Array.isArray(all[key]) ? all[key] : []).filter((s) => s !== sig);
  all[key] = [...list, sig].slice(-MAX_LEARNED_PER_SITE);
  await browser.storage.local.set({ learnedFields: all });
  return true;
}

async function uiSettings() {
  const s = await RcApi.getSettings();
  return {
    configured: Boolean(s.apiUrl && s.token),
    inlineButton: s.inlineButton,
    fillConfirm: s.fillConfirm,
    copyToClipboard: s.copyToClipboard,
  };
}

/**
 * "Connect" button in the Roundcube settings. Any website can show such a
 * button, so the page only makes an offer: the API URL (resolved against the
 * page, same server only) and the token are checked, and the user confirms
 * them in the extension's own page connect/connect.html, which shows the
 * server prominently. Nothing is stored before that confirmation.
 */
function connectUrl(sender, api) {
  const page = sender && sender.tab && sender.url ? new URL(sender.url) : null;
  // after saving, Roundcube shows the settings as POST response to "./" (no _task in the URL)
  const task = page ? page.searchParams.get('_task') : null;
  if (!page || (task !== null && task !== 'settings')) {
    throw new Error('Verbinden ist nur aus den Roundcube-Einstellungen möglich.');
  }
  const url = new URL(String(api || 'api/identity/'), new URL('./', page));
  if (url.origin !== page.origin) {
    throw new Error('Die API liegt auf einem anderen Server als das Webmail. Bitte URL und Token in den Einstellungen der Erweiterung eintragen.');
  }
  return RcApi.normalizeBaseUrl(url.toString());
}

// offers wait for the confirmation in storage.session (not readable by content
// scripts, survives the end of a Chromium service worker), else in memory
const OFFER_TTL = 10 * 60 * 1000;
const offers = new Map();
const session = browser.storage && browser.storage.session;

async function putOffer(id, offer) {
  if (session) {
    await session.set({ ['offer:' + id]: offer });
  } else {
    offers.set(id, offer);
  }
}

async function takeOffer(id, remove) {
  const key = 'offer:' + id;
  let offer = session ? (await session.get(key))[key] : offers.get(id);
  if (remove || (offer && offer.created < Date.now() - OFFER_TTL)) {
    if (session) await session.remove(key); else offers.delete(id);
    offer = remove ? offer : null;
  }
  return offer && offer.created >= Date.now() - OFFER_TTL ? offer : null;
}

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function connectOffer(token, api, sender) {
  const apiUrl = connectUrl(sender, api);
  if (typeof token !== 'string' || !/^\d+\.[0-9a-f]{8}\.[\w-]{20,}$/.test(token)) {
    throw new Error('Ungültiges Token.');
  }
  const current = await RcApi.getSettings();
  const info = await RcApi.info(Object.assign({}, current, { apiUrl, token }), { rotate: false });
  const id = randomId();
  await putOffer(id, { apiUrl, token, user: String(info.user || ''), created: Date.now() });
  await browser.tabs.create({ url: browser.runtime.getURL('connect/connect.html') + '#' + id });
  return true;
}

const CONNECT_PAGE = browser.runtime.getURL('connect/connect.html');
const fromConnectPage = (sender) => Boolean(sender && typeof sender.url === 'string' && sender.url.startsWith(CONNECT_PAGE));

async function connectDetails(id, sender) {
  if (!fromConnectPage(sender)) {
    throw new Error('not allowed');
  }
  const offer = await takeOffer(id, false);
  if (!offer) {
    throw new Error('Die Anfrage ist abgelaufen. Bitte in Roundcube erneut „Mit Browser-Erweiterung verbinden“ wählen.');
  }
  const current = await RcApi.getSettings();
  const connected = Boolean(current.apiUrl && current.token);
  return {
    url: offer.apiUrl,
    user: offer.user,
    previousUrl: connected ? current.apiUrl : '',
    previousUser: connected ? current.connectedUser : '',
  };
}

async function connectConfirm(id, sender) {
  if (!fromConnectPage(sender)) {
    throw new Error('not allowed');
  }
  const offer = await takeOffer(id, true);
  if (!offer) {
    throw new Error('Die Anfrage ist abgelaufen. Bitte in Roundcube erneut „Mit Browser-Erweiterung verbinden“ wählen.');
  }
  await browser.storage.local.set({ apiUrl: offer.apiUrl, token: offer.token, pending: null, connectedUser: offer.user });
  return { url: offer.apiUrl, user: offer.user };
}

async function connectCancel(id, sender) {
  if (fromConnectPage(sender)) {
    await takeOffer(id, true);
  }
  return true;
}

// Wrap results so errors survive messaging as plain data.
function wrap(promise) {
  return promise.then(
    (data) => ({ ok: true, data }),
    (e) => ({ ok: false, error: e.message || String(e) })
  );
}

rcidOnMessage((msg, sender) => {
  switch (msg && msg.type) {
    case 'context':
      return wrap(context(tabUrl(msg, sender)));
    case 'list':
      return wrap(list(msg.shop));
    case 'create':
      return wrap(create(msg.shop, msg.domain, tabUrl(msg, sender)));
    case 'settings':
      return wrap(uiSettings());
    case 'learnedFields':
      return wrap(learnedFields(tabUrl({}, sender)));
    case 'learnField':
      return wrap(learnField(tabUrl({}, sender), msg.signature));
    case 'connectOffer':
      return wrap(connectOffer(msg.token, msg.api, sender));
    case 'connectDetails':
      return wrap(connectDetails(msg.id, sender));
    case 'connectConfirm':
      return wrap(connectConfirm(msg.id, sender));
    case 'connectCancel':
      return wrap(connectCancel(msg.id, sender));
    case 'openOptions':
      return wrap(browser.runtime.openOptionsPage());
  }
  return undefined;
});

// ---------------------------------------------------------------------------
// Context menu on input fields (desktop only)

if (menus) {
  browser.runtime.onInstalled.addListener(() => {
    // Chromium before 123 returns no Promise here
    Promise.resolve(menus.removeAll()).then(() => {
      menus.create({ id: 'rcid-create', title: 'Neue Shop-Adresse erzeugen und einfügen', contexts: ['editable'] });
      menus.create({ id: 'rcid-panel', title: 'Shop-Adresse auswählen …', contexts: ['editable'] });
    });
  });

  menus.onClicked.addListener(async (info, tab) => {
    const target = { frameId: info.frameId || 0 };
    try {
      if (info.menuItemId === 'rcid-panel') {
        await browser.tabs.sendMessage(tab.id, { type: 'openPanel', targetElementId: info.targetElementId }, target);
        return;
      }
      if (info.menuItemId !== 'rcid-create') {
        return;
      }
      // only create an address if the frame can take it (no content script on some pages)
      const alive = await browser.tabs.sendMessage(tab.id, { type: 'ping' }, target).catch(() => false);
      if (!alive) {
        return;
      }
      const settings = await RcApi.getSettings();
      const identity = await create(suggestShop(tab.url, settings), '', tab.url);
      const res = await browser.tabs.sendMessage(tab.id,
        { type: 'fill', email: identity.email, mode: 'context', targetElementId: info.targetElementId }, target);
      if (!res || !res.filled) {
        await browser.tabs.sendMessage(tab.id, { type: 'notify', text: `Neue Adresse ${identity.email} – kein Feld zum Einfügen gefunden.` }, target);
      }
    } catch (e) {
      await browser.tabs.sendMessage(tab.id, { type: 'notify', text: e.message }, target).catch(() => {});
    }
  });
}
