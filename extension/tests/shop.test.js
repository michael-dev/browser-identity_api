// node --test extension/tests/
const test = require('node:test');
const assert = require('node:assert');
const shop = require('../lib/shop.js');

test('sanitize matches server rules', () => {
  assert.strictEqual(shop.sanitize('Bookshop'), 'bookshop');
  assert.strictEqual(shop.sanitize('Gärtnerei Grün'), 'gaertnerei-gruen');
  assert.strictEqual(shop.sanitize('Großhandel'), 'grosshandel');
  assert.strictEqual(shop.sanitize('  --Gardenshop.example!! '), 'gardenshop-example');
  assert.strictEqual(shop.sanitize('Café Crème'), 'cafe-creme');
  assert.strictEqual(shop.sanitize('Haus&Garten'), 'haus-und-garten');
  assert.strictEqual(shop.sanitize('!!!'), '');
  assert.ok(shop.sanitize('abcd-'.repeat(20)).length <= 30);
  assert.ok(!shop.sanitize('abcd-'.repeat(20)).endsWith('-'));
});

test('shop from url', () => {
  assert.strictEqual(shop.shopFromUrl('https://www.bookshop.example/cart'), 'bookshop');
  assert.strictEqual(shop.shopFromUrl('https://checkout.gardenshop.example/kasse'), 'gardenshop');
  assert.strictEqual(shop.shopFromUrl('https://www.example-tea.co.uk/basket'), 'example-tea');
  assert.strictEqual(shop.shopFromUrl('https://shop.grocer.example/'), 'grocer');
  assert.strictEqual(shop.shopFromUrl('https://www.example-tech.at/'), 'example-tech');
  assert.strictEqual(shop.shopFromUrl('https://www.bücherstube.example/'), 'buecherstube');
  assert.strictEqual(shop.shopFromUrl('https://www.gärtnerei-grün.example/'), 'gaertnerei-gruen');
  assert.strictEqual(shop.shopFromUrl('https://xn--mnchen-3ya.de/'), 'muenchen');
  assert.strictEqual(shop.shopFromUrl('https://bookshop.myshopify.com/cart'), 'bookshop');
  assert.strictEqual(shop.shopFromUrl('http://192.168.1.10/shop'), '');
  assert.strictEqual(shop.shopFromUrl('about:blank'), '');
  assert.strictEqual(shop.shopFromUrl('not a url'), '');
});

test('site key', () => {
  assert.strictEqual(shop.siteKey('https://checkout.gardenshop.example/x'), 'gardenshop.example');
  assert.strictEqual(shop.siteKey('https://www.example-tea.co.uk/'), 'example-tea.co.uk');
  assert.strictEqual(shop.siteKey('http://localhost:8080/'), 'localhost');
  assert.strictEqual(shop.siteKey('https://bookshop.myshopify.com/'), 'bookshop.myshopify.com');
});
