// End-to-end test of the real Chromium extension (dist/chrome) against a running
// Roundcube with the plugin, see tests/client.sh (E2E=1).
// Usage: node chromium-extension.test.js <extension-dir> <roundcube-url> <shop-port> <user> <work-dir>
const { chromium } = require('playwright');

const [ext, rcUrl, shopPort, user, work] = process.argv.slice(2);
// SCREENSHOTS=<dir>: also take the screenshots for the store listings (1280x800)
const shots = process.env.SCREENSHOTS;
const fs = require('fs');
const path = require('path');
const shot = async (page, name) => {
  if (shots) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, name + '.png') });
  }
};
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} e2e: ${name}${cond ? '' : ' ' + extra}`);
  fails += cond ? 0 : 1;
};

let ctx;
(async () => {
  ctx = await chromium.launchPersistentContext(`${work}/chromium-profile`, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, locale: 'de-DE',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
      `--host-resolver-rules=MAP www.test-shop.example 127.0.0.1:${shopPort}, MAP www.gartenparadies.example 127.0.0.1:${shopPort}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  check('service worker started', sw.url().startsWith('chrome-extension://'), sw.url());
  const extId = sw.url().split('/')[2];
  const errors = [];

  // connect the extension from the Roundcube settings
  const rc = await ctx.newPage();
  rc.on('pageerror', (e) => errors.push('roundcube: ' + e.message));
  await rc.goto(`${rcUrl}?_task=login`);
  await rc.fill('#rcmloginuser', user);
  await rc.fill('#rcmloginpwd', 'test');
  await Promise.all([rc.waitForNavigation(), rc.click('#rcmloginsubmit')]);
  await rc.goto(`${rcUrl}?_task=settings&_action=edit-prefs&_section=identityapi&_framed=1`);
  // the page checks that the API answers at the shown URL (rewrite rule) and gets the Authorization header
  await rc.waitForSelector('#identityapi-urlcheck[data-state]', { state: 'attached', timeout: 10000 }).catch(() => {});
  check('settings: API URL shown and reachable', (await rc.inputValue('#identityapi-url')) === `${rcUrl}api/identity/`
    && (await rc.getAttribute('#identityapi-urlcheck', 'data-state')) === 'ok', await rc.textContent('#identityapi-urlcheck'));
  await rc.fill('input[name="_identity_api_new_label"]', 'Chromium e2e');
  await Promise.all([rc.waitForNavigation(), rc.click('button.submit')]);
  const token = await rc.inputValue('#identityapi-newtoken');
  // the extension asks in its own page, nothing is stored before
  const [confirmPage] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 15000 }),
    rc.click('#identityapi-connect button'),
  ]);
  await confirmPage.waitForSelector('#details:not([hidden])', { timeout: 15000 }).catch(() => {});
  check('connect: own confirmation page shows server and account',
    confirmPage.url().startsWith(`chrome-extension://${extId}/connect/connect.html`)
    && (await confirmPage.textContent('#host')) === new URL(rcUrl).host && (await confirmPage.textContent('#user')) === user,
    confirmPage.url());
  if (shots) {
    // illustration: a real server name instead of the local test server
    await confirmPage.evaluate(() => {
      document.querySelector('#host').textContent = 'webmail.example.org';
      document.querySelector('#url').textContent = 'https://webmail.example.org/api/identity/';
      document.querySelector('#warning').hidden = true;
    });
    await shot(confirmPage, '3-connect');
  }
  const before = await sw.evaluate(() => chrome.storage.local.get(['token']));
  check('connect: nothing stored before confirming', !before.token, JSON.stringify(before));
  await confirmPage.click('#confirm');
  await confirmPage.waitForSelector('#status.ok', { timeout: 15000 }).catch(() => {});
  const stored = await sw.evaluate(() => chrome.storage.local.get(['apiUrl', 'token', 'connectedUser']));
  check('connect: token and API URL stored', stored.token === token && stored.apiUrl === `${rcUrl}api/identity/`
    && stored.connectedUser === user, JSON.stringify(stored));

  // another website imitating the connect button: no confirmation page, nothing changes
  const fake = await ctx.newPage();
  await fake.goto('http://www.test-shop.example/fake-connect.html');
  let opened = false;
  const onPage = () => { opened = true; };
  ctx.on('page', onPage);
  await fake.click('#identityapi-connect button');
  await fake.waitForFunction(() => document.querySelector('.hint').textContent.length > 0, null, { timeout: 15000 }).catch(() => {});
  await fake.waitForTimeout(1000);
  ctx.off('page', onPage);
  const after = await sw.evaluate(() => chrome.storage.local.get(['apiUrl', 'token']));
  check('connect from another website refused', !opened && after.token === token && after.apiUrl === stored.apiUrl,
    await fake.textContent('.hint'));
  await fake.close();

  // shop page: inline button -> panel -> create -> fields filled
  const shop = await ctx.newPage();
  shop.on('pageerror', (e) => errors.push('shop: ' + e.message));
  shop.on('console', (m) => m.type() === 'error' && errors.push('shop console: ' + m.text()));
  await shop.goto('http://www.test-shop.example/shop.html');
  await shop.focus('#mail');
  await shop.waitForTimeout(800);
  const box = await shop.locator('#mail').boundingBox();
  await shop.mouse.click(box.x + box.width - 16, box.y + box.height / 2); // inline button (closed shadow DOM)
  await shop.waitForTimeout(1500);
  await shop.keyboard.press('Enter'); // "Neue Adresse erzeugen" is focused once the panel has loaded
  await shop.waitForFunction(() => document.querySelector('#mail').value, null, { timeout: 15000 }).catch(() => {});
  const mail = await shop.inputValue('#mail');
  check('panel: new address for "test-shop"', /^[a-z0-9]+-test-shop-\d{4}-[a-z0-9]{8}@/.test(mail), mail);
  check('panel: confirmation field filled', (await shop.inputValue('#mail2')) === mail);
  await shop.screenshot({ path: `${work}/e2e-shop.png` });

  // popup-like fill via messaging (no e-mail field focused -> heuristic in the top frame)
  await shop.fill('#mail', '');
  await shop.fill('#mail2', '');
  await shop.focus('#phone');
  const reply = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://www.test-shop.example/*' });
    return chrome.tabs.sendMessage(tab.id, { type: 'fill', email: 'x-popup-2026-aaaaaaaa@example.org', mode: 'heuristic' }, { frameId: 0 });
  });
  check('heuristic fill', reply && reply.filled === 2 && (await shop.inputValue('#mail')) === 'x-popup-2026-aaaaaaaa@example.org',
    JSON.stringify(reply));

  // options page
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options/options.html`);
  await opt.waitForFunction(() => /Verbunden|Fehler|nicht|ungültig/.test(document.querySelector('#test-status').textContent),
    null, { timeout: 15000 }).catch(() => {});
  check('options: connection test', (await opt.textContent('#test-status')).includes(`Verbunden als ${user}`),
    await opt.textContent('#test-status'));

  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await storeScreenshots(ctx, rc, opt);
  }

  check('no errors', errors.length === 0, JSON.stringify(errors));
  await ctx.close();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => {
  console.log('FAIL e2e:', e.message.split('\n')[0]);
  // where did it stop?
  for (const [i, page] of (ctx ? ctx.pages() : []).entries()) {
    console.log(`     page ${i}: ${page.url()}`);
    await page.screenshot({ path: `${work}/e2e-failure-${i}.png`, fullPage: true }).catch(() => {});
  }
  process.exit(1);
});

/** Screenshots and promo tile for the store listings (Chrome Web Store, AMO). */
async function storeScreenshots(ctx, rc, opt) {
  const demoUrl = 'https://webmail.example.org/api/identity/';

  // prefix of the demo person in the checkout
  await rc.goto(`${rcUrl}?_task=settings&_action=edit-prefs&_section=identityapi&_framed=1`);
  await rc.fill('#identityapi-prefix', 'alex');
  await Promise.all([rc.waitForNavigation(), rc.click('button.submit')]);

  // checkout page of a (fictional) shop: panel with suggestion and an existing
  // address, then the filled form
  const shop = await ctx.newPage();
  await shop.goto('http://www.gartenparadies.example/store-shop.html');
  const openPanel = async () => {
    await shop.focus('#mail');
    await shop.waitForTimeout(800);
    const box = await shop.locator('#mail').boundingBox();
    await shop.mouse.click(box.x + box.width - 16, box.y + box.height / 2);
    await shop.waitForTimeout(1500);
  };
  await openPanel();
  await shop.keyboard.press('Enter'); // an earlier address for this shop
  await shop.waitForFunction(() => document.querySelector('#mail').value, null, { timeout: 15000 }).catch(() => {});
  await shop.fill('#mail', '');
  await shop.fill('#mail2', '');
  await shop.click('h2');
  await shop.waitForTimeout(3500); // toast gone
  await openPanel();
  await shot(shop, '1-panel');
  await shop.keyboard.press('Enter');
  await shop.waitForFunction(() => document.querySelector('#mail').value, null, { timeout: 15000 }).catch(() => {});
  await shop.waitForTimeout(600);
  await shot(shop, '2-filled');

  // address generator and tokens in the Roundcube settings
  await rc.goto(`${rcUrl}?_task=settings&_action=preferences`);
  await rc.click('#rcmrowidentityapi a, tr#rcmrowidentityapi, a[href*="_section=identityapi"]').catch(() => {});
  await rc.waitForTimeout(2500);
  for (const frame of rc.frames()) {
    await frame.evaluate((url) => {
      const input = document.querySelector('#identityapi-url');
      if (input) input.value = url;
    }, demoUrl).catch(() => {});
  }
  await shot(rc, '4-roundcube-settings');

  await opt.reload();
  await opt.waitForTimeout(1500);
  await opt.fill('#apiUrl', demoUrl); // illustration only, not saved
  await shot(opt, '5-options');

  // small promo tile 440x280
  const tile = await ctx.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  const icon = fs.readFileSync(path.join(__dirname, '../../extension/icons/icon.svg'), 'utf8');
  await tile.setContent(`<body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:20px;
    padding:0 26px;box-sizing:border-box;background:#2b6cb0;color:#fff;font-family:system-ui,sans-serif">
    <div style="width:104px;height:104px;flex:none">${icon}</div>
    <div><div style="font-size:30px;font-weight:700;white-space:nowrap">Shop-Adressen</div>
    <div style="font-size:17px;margin-top:8px;line-height:1.35">Eine eigene E-Mail-Adresse<br>für jeden Onlineshop</div></div></body>`);
  await tile.screenshot({ path: path.join(shots, 'promo-440x280.png') });
  await tile.close();
  await shop.close();
}
