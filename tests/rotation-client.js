// Runs the extension's API client (extension/lib/api.js) against a test server
// and checks the automatic token rotation. Usage: node tests/rotation-client.js <base-url> <token>
const fs = require('fs');
const path = require('path');

const [baseUrl, token] = process.argv.slice(2);
const store = { apiUrl: baseUrl, token };
globalThis.browser = {
  storage: {
    local: {
      get: async (defaults) => Object.fromEntries(Object.keys(defaults).map((k) => [k, k in store ? store[k] : defaults[k]])),
      set: async (values) => { Object.assign(store, values); },
    },
  },
};
new Function(fs.readFileSync(path.join(__dirname, '../extension/lib/api.js'), 'utf8'))();
const { RcApi } = globalThis;

const raw = (tok) => fetch(RcApi.endpoint(baseUrl, '/v1/me'), { headers: { Authorization: 'Bearer ' + tok } }).then((r) => r.status);

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`);
  failed += cond ? 0 : 1;
};

// count the rotation requests of the client
let rotations = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url).endsWith('/v1/token/rotate')) rotations++;
  return realFetch(url, init);
};

(async () => {
  // parallel requests while rotation is due: exactly one rotation, all succeed
  const results = await Promise.allSettled([RcApi.info(), RcApi.list('bookshop'), RcApi.info()]);
  check('client: parallel requests succeed', results.every((r) => r.status === 'fulfilled'),
    JSON.stringify(results.map((r) => r.reason && r.reason.message)));
  check('client: exactly one rotation', rotations === 1, `${rotations} rotations`);
  check('client: token rotated', store.token !== token && /^\d+\.[a-f0-9]{8}\./.test(store.token));
  check('client: old token invalid', (await raw(token)) === 401);
  check('client: new token valid', (await raw(store.token)) === 200);
  const status = await RcApi.token();
  check('client: no rotation due afterwards', status.rotate === false, JSON.stringify(status));
  // other endpoints of the client
  const created = await RcApi.create('Client Test');
  check('client: create', created.shop === 'client-test' && /^[a-z0-9]+-client-test-\d{4}-/.test(created.email), JSON.stringify(created));
  const listed = await RcApi.list('client test');
  check('client: list', listed.length === 1 && listed[0].id === created.id, JSON.stringify(listed));
  await RcApi.remove(created.id);
  check('client: delete', (await RcApi.list('client test')).length === 0);
  const err = await RcApi.create('x', 'evil.example').catch((e) => e);
  check('client: error code', err.code === 'domain_not_allowed' && err.status === 403, err.code + ' ' + err.message);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL client:', e.message); process.exit(1); });
