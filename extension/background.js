/* Background (event page): talks to Roundcube, serves popup/content script requests. */
'use strict';

const menus = browser.menus || browser.contextMenus; // not available on Android

function tabUrl(msg, sender) {
  return msg.url || (sender && sender.tab && sender.tab.url) || '';
}

async function suggestShop(url, settings) {
  const key = RcShop.siteKey(url);
  return (key && settings.overrides[key]) || RcShop.shopFromUrl(url);
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
  return RcApi.list(String(shop || '').trim());
}

const MAX_LEARNED_PER_SITE = 20;

async function learnedFields(url) {
  const { learnedFields: all } = await browser.storage.local.get({ learnedFields: {} });
  return all[RcShop.siteKey(url)] || [];
}

async function learnField(url, sig) {
  const key = RcShop.siteKey(url);
  if (!key || typeof sig !== 'string' || !/^(name|id):.{1,200}$/.test(sig)) {
    return false;
  }
  const { learnedFields: all } = await browser.storage.local.get({ learnedFields: {} });
  const list = (all[key] || []).filter((s) => s !== sig);
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
 * Webmail URL for the "connect" button: always derived from the address of
 * the page the click happened on (never from page data), and only from a
 * Roundcube settings page. The token is verified against exactly that server
 * and the confirmation names account and URL, so another website can't point
 * the extension to a server of its choice without the user seeing it.
 */
function connectUrl(sender) {
  const page = sender && sender.url ? new URL(sender.url) : null;
  // after saving, Roundcube shows the settings as POST response to "./" (no _task in the URL)
  const task = page ? page.searchParams.get('_task') : null;
  if (!page || (task !== null && task !== 'settings')) {
    throw new Error('Verbinden ist nur aus den Roundcube-Einstellungen möglich.');
  }
  return RcApi.normalizeBaseUrl(new URL('./', page).toString());
}

async function connectCheck(token, sender) {
  const apiUrl = connectUrl(sender);
  const current = await RcApi.getSettings();
  const info = await RcApi.info(Object.assign({}, current, { apiUrl, token }), { rotate: false });
  return {
    url: apiUrl,
    user: info.user,
    previousUrl: current.apiUrl && current.token ? current.apiUrl : '',
  };
}

async function connect(token, sender) {
  const apiUrl = connectUrl(sender);
  const settings = Object.assign({}, await RcApi.getSettings(), { apiUrl, token });
  const info = await RcApi.info(settings, { rotate: false }); // only store working credentials
  await browser.storage.local.set({ apiUrl, token, pendingToken: '' });
  return { url: apiUrl, user: info.user };
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
    case 'connectCheck':
      return wrap(connectCheck(msg.token, sender));
    case 'connect':
      return wrap(connect(msg.token, sender));
    case 'openOptions':
      return wrap(browser.runtime.openOptionsPage());
  }
  return undefined;
});

// ---------------------------------------------------------------------------
// Context menu on input fields (desktop only)

if (menus) {
  browser.runtime.onInstalled.addListener(() => {
    menus.removeAll().then(() => {
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
      const settings = await RcApi.getSettings();
      const identity = await create(await suggestShop(tab.url, settings), settings.defaultDomain, tab.url);
      await browser.tabs.sendMessage(tab.id, { type: 'fill', email: identity.email, targetElementId: info.targetElementId }, target);
    } catch (e) {
      await browser.tabs.sendMessage(tab.id, { type: 'notify', text: e.message }, target).catch(() => {});
    }
  });
}
