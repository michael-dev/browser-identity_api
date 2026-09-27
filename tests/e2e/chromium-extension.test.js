// End-to-end test of the real Chromium extension (dist/chrome) against a running
// Roundcube with the plugin, see tests/integration.sh (E2E=1).
// Usage: node chromium-extension.test.js <extension-dir> <roundcube-url> <shop-port> <user> <work-dir>
const { chromium } = require('playwright');

const [ext, rcUrl, shopPort, user, work] = process.argv.slice(2);
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} e2e: ${name}${cond ? '' : ' ' + extra}`);
  fails += cond ? 0 : 1;
};

let ctx;
(async () => {
  ctx = await chromium.launchPersistentContext(`${work}/chromium-profile`, {
    channel: 'chromium', headless: true, viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
      `--host-resolver-rules=MAP www.test-shop.example 127.0.0.1:${shopPort}`],
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
  await rc.fill('input[name="_identity_api_new_label"]', 'Chromium e2e');
  await Promise.all([rc.waitForNavigation(), rc.click('button.submit')]);
  const token = await rc.inputValue('#identityapi-newtoken');
  const dialogs = [];
  rc.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  await rc.click('#identityapi-connect button');
  await rc.waitForFunction(() => document.querySelector('#identityapi-connect button').textContent.includes('Verbunden'),
    null, { timeout: 15000 }).catch(() => {});
  check('connect: confirmation names the account', Boolean(dialogs[0] && dialogs[0].includes(`Konto: ${user}`)), JSON.stringify(dialogs));
  const stored = await sw.evaluate(() => chrome.storage.local.get(['apiUrl', 'token']));
  check('connect: token stored', stored.token === token && stored.apiUrl === rcUrl, JSON.stringify(stored));

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
