'use strict';

const $ = (id) => document.getElementById(id);
const t = rcidT;
rcidLocalize(document);
const ALL_SITES = { origins: ['<all_urls>'] };

function status(id, text, kind) {
  $(id).textContent = text || '';
  $(id).className = 'status' + (kind ? ' ' + kind : '');
}

function formSettings() {
  return {
    apiUrl: RcApi.normalizeBaseUrl($('apiUrl').value),
    token: $('token').value.trim(),
    defaultDomain: $('defaultDomain').value,
    inlineButton: $('inlineButton').checked,
    fillConfirm: $('fillConfirm').checked,
    copyToClipboard: $('copyToClipboard').checked,
  };
}

function setDomains(domains, selected) {
  const sel = $('defaultDomain');
  sel.replaceChildren(new Option(t('serverDefault'), ''));
  for (const d of domains) {
    sel.append(new Option('@' + d, d));
  }
  if (selected && !domains.includes(selected)) {
    sel.append(new Option('@' + selected, selected));
  }
  sel.value = selected || '';
}

async function checkPermission() {
  const granted = await browser.permissions.contains(ALL_SITES);
  $('permission').hidden = granted;
  return granted;
}

async function test() {
  let s;
  try {
    s = formSettings();
  } catch (e) {
    status('test-status', t('invalidUrl'), 'error');
    return;
  }
  status('test-status', t('testing'));
  try {
    const info = await RcApi.info(Object.assign({}, RcApi.DEFAULTS, s), { rotate: false });
    setDomains(info.domains, $('defaultDomain').value);
    status('test-status', t('connectedAs', [info.user, info.domains.join(', ')]), 'ok');
  } catch (e) {
    status('test-status', e.message, 'error');
  }
}

async function save(e) {
  e.preventDefault();
  let s;
  try {
    s = formSettings();
  } catch (err) {
    status('save-status', t('invalidUrl'), 'error');
    return;
  }
  if (s.apiUrl && !RcApi.isSecureUrl(s.apiUrl)) {
    status('save-status', t('httpsRequiredToken'), 'error');
    return;
  }
  // a pending rotated token belongs to the old connection only
  const old = await RcApi.getSettings();
  const changed = old.apiUrl !== s.apiUrl || old.token !== s.token;
  await browser.storage.local.set(Object.assign(changed ? { pending: null, connectedUser: '' } : {}, s));
  $('apiUrl').value = s.apiUrl;
  status('save-status', t('saved'), 'ok');
  test();
}

function renderOverrides(overrides) {
  const tbody = document.querySelector('#overrides tbody');
  tbody.replaceChildren();
  const entries = Object.entries(overrides || {}).sort();
  for (const [site, shop] of entries) {
    const tr = document.createElement('tr');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('remove');
    btn.addEventListener('click', async () => {
      const { overrides: current } = await browser.storage.local.get({ overrides: {} });
      delete current[site];
      await browser.storage.local.set({ overrides: current });
      renderOverrides(current);
    });
    for (const text of [site, shop]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const td = document.createElement('td');
    td.append(btn);
    tr.append(td);
    tbody.append(tr);
  }
  $('overrides').hidden = !entries.length;
  $('no-overrides').hidden = Boolean(entries.length);
}

function renderLearned(learnedFields) {
  const tbody = document.querySelector('#learned tbody');
  tbody.replaceChildren();
  const rows = Object.entries(learnedFields || {}).sort()
    .flatMap(([site, sigs]) => sigs.map((sig) => [site, sig]));
  for (const [site, sig] of rows) {
    const tr = document.createElement('tr');
    for (const value of [site, sig.replace(/^(name|id):/, '')]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('remove');
    btn.addEventListener('click', async () => {
      const { learnedFields: current } = await browser.storage.local.get({ learnedFields: {} });
      current[site] = (current[site] || []).filter((s) => s !== sig);
      if (!current[site].length) delete current[site];
      await browser.storage.local.set({ learnedFields: current });
      renderLearned(current);
    });
    const td = document.createElement('td');
    td.append(btn);
    tr.append(td);
    tbody.append(tr);
  }
  $('learned').hidden = !rows.length;
  $('no-learned').hidden = Boolean(rows.length);
}

async function init() {
  const s = await RcApi.getSettings();
  $('apiUrl').value = s.apiUrl;
  $('token').value = s.token;
  setDomains([], s.defaultDomain);
  $('inlineButton').checked = s.inlineButton;
  $('fillConfirm').checked = s.fillConfirm;
  $('copyToClipboard').checked = s.copyToClipboard;
  renderOverrides(s.overrides);
  renderLearned(s.learnedFields);

  $('form').addEventListener('submit', save);
  $('test').addEventListener('click', test);
  // permissions.request() needs a user gesture, don't await anything before it
  $('grant').addEventListener('click', () => browser.permissions.request(ALL_SITES).then(checkPermission));

  // token rotated or connected from the webmail while this page is open:
  // show the new values, otherwise saving would write back a stale token
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.token) $('token').value = changes.token.newValue || '';
    if (changes.apiUrl) $('apiUrl').value = changes.apiUrl.newValue || '';
    if (changes.overrides) renderOverrides(changes.overrides.newValue);
    if (changes.learnedFields) renderLearned(changes.learnedFields.newValue);
  });

  await checkPermission();
  if (s.apiUrl && s.token) {
    test();
  }
}

init();
