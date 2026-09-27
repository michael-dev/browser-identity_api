/* Content script: inline button on e-mail fields, address panel, filling. */
(() => {
  'use strict';

  if (window.__rcidLoaded) {
    return;
  }
  window.__rcidLoaded = true;

  // e-mail hints in field attributes and nearby text (en, de, fr, es, it, nl, nordic)
  const EMAIL_HINT = /e-?mail|mail[-_ ]?addr|\bmail\b|courriel|correo|posta elettronica|emailadres|e-?post\b|sähköposti/i;
  const CONFIRM_HINT = /confirm|repeat|retype|verif|again|wiederhol|bestaetig|bestätig|kontroll|[-_]?2$/i;
  const TEXT_TYPES = new Set(['text', 'email', 'search', '']);

  let settings = null; // lazily loaded, see loadSettings()
  let lastInput = null; // last focused recognized e-mail field
  let lastTextInput = null; // last focused text field of any kind
  let learned = null; // Set of field signatures the user filled manually on this site
  let ui = null; // shadow DOM overlay, created on demand
  let panelInput = null; // input the panel/button belongs to
  let hideTimer = null;

  // -------------------------------------------------------------------------
  // Field detection

  const text = (node) => (node && node.textContent ? node.textContent.replace(/\s+/g, ' ').trim() : '');
  const shortText = (node) => { const t = text(node); return t.length <= 80 ? t : ''; };
  const FIELDS = 'input, select, textarea';

  function describe(el) {
    const own = [el.getAttribute('aria-label'), el.title];
    try {
      for (const label of el.labels || []) {
        own.push(text(label));
      }
    } catch (e) { /* ignore */ }
    for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
      own.push(shortText(el.getRootNode().getElementById ? el.getRootNode().getElementById(id) : null));
    }

    const parts = [el.name, el.id, el.getAttribute('autocomplete'), el.placeholder, el.getAttribute('data-testid'), ...own];

    // no proper label: use text right before the field, e.g. <span>E-Mail</span><input>
    if (!own.some(Boolean)) {
      const prev = el.previousElementSibling;
      if (prev && !prev.matches(FIELDS) && !prev.querySelector(FIELDS)) {
        parts.push(shortText(prev));
      } else if (el.parentElement && el.parentElement.querySelectorAll(FIELDS).length === 1) {
        const before = el.parentElement.previousElementSibling;
        if (before && !before.querySelector(FIELDS)) {
          parts.push(shortText(before));
        }
      }
    }
    return parts.filter(Boolean).join(' ');
  }

  /** Stable identifier of a field for learning: its name or id. */
  function signature(el) {
    if (el.name) return 'name:' + el.name;
    if (el.id) return 'id:' + el.id;
    return '';
  }

  function isTextInput(el) {
    return el instanceof HTMLInputElement && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
  }

  function isEmailInput(el) {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) {
      return false;
    }
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'email') {
      return true;
    }
    if (!TEXT_TYPES.has(type)) {
      return false;
    }
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return ac.split(/\s+/).includes('email')
      || (el.getAttribute('inputmode') || '').toLowerCase() === 'email'
      || /@/.test(el.placeholder || '') // "name@example.com"
      || /@/.test(el.getAttribute('pattern') || '')
      || Boolean(learned && learned.has(signature(el)))
      || EMAIL_HINT.test(describe(el));
  }

  /** All inputs, including those in (open or closed) shadow roots of web components. */
  function allInputs(root = document, out = []) {
    for (const el of root.querySelectorAll('*')) {
      if (el instanceof HTMLInputElement) {
        out.push(el);
      }
      // web components, but not our own overlay
      const shadow = el.localName === 'rcid-overlay' ? null : rcidShadowRoot(el);
      if (shadow) {
        allInputs(shadow, out);
      }
    }
    return out;
  }

  /** Real event target / focused element, looking into shadow DOM. */
  function realTarget(e) {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    // closed shadow roots are hidden from composedPath(): ask the host
    return target && target instanceof Element && rcidShadowRoot(target) && e.type === 'focusin'
      ? deepActiveElement() : target;
  }
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && rcidShadowRoot(el) && rcidShadowRoot(el).activeElement) {
      el = rcidShadowRoot(el).activeElement;
    }
    return el;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      return false;
    }
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  }

  function findBestInput() {
    const candidates = allInputs().filter((el) => isEmailInput(el) && isVisible(el));
    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] || null;

    function score(el) {
      let s = 0;
      if ((el.getAttribute('type') || '').toLowerCase() === 'email') s += 2;
      if (/\bemail\b/i.test(el.getAttribute('autocomplete') || '')) s += 2;
      if (!el.value) s += 1;
      if (CONFIRM_HINT.test(describe(el))) s -= 3;
      return s;
    }
  }

  // -------------------------------------------------------------------------
  // Filling

  function setValue(el, value) {
    el.focus({ preventScroll: true });
    // Content scripts see the native value setter (Xray), which also works
    // with frameworks that wrap the value property (React & co).
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(el, email) {
    setValue(el, email);
    let count = 1;

    if (!settings || settings.fillConfirm) {
      const scope = el.form || el.closest('form') || el.getRootNode();
      for (const other of scope.querySelectorAll('input')) {
        if (other !== el && isEmailInput(other) && isVisible(other) && CONFIRM_HINT.test(describe(other))) {
          setValue(other, email);
          count++;
        }
      }
    }
    el.focus({ preventScroll: true });
    return count;
  }

  function usable(el) {
    return el && el.isConnected && !el.disabled && !el.readOnly && isVisible(el);
  }

  function targetFromMenu(targetElementId) {
    try {
      if (targetElementId !== undefined && browser.menus && browser.menus.getTargetElement) {
        const target = browser.menus.getTargetElement(targetElementId);
        // contenteditable etc. can't take a value, fall back to field detection
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Field for a fill request without explicit target: the last focused
   * recognized e-mail field; if the page has none, the text field the user
   * focused last (covers e-mail fields without any usable hint).
   */
  function focusedTarget() {
    if (usable(lastInput)) {
      return lastInput;
    }
    return usable(lastTextInput) && lastTextInput === deepActiveElement() && !findBestInput() ? lastTextInput : null;
  }

  /**
   * Remember a manually filled, unrecognized field so it gets the button next
   * time. Only for the field the user explicitly chose (focused or right-clicked).
   */
  function learn(el, explicit) {
    const sig = signature(el);
    if (sig && (explicit || el === deepActiveElement()) && isTextInput(el) && !isEmailInput(el)) {
      (learned = learned || new Set()).add(sig);
      browser.runtime.sendMessage({ type: 'learnField', signature: sig }).catch(() => {});
    }
  }

  async function loadLearned() {
    if (!learned) {
      const res = await browser.runtime.sendMessage({ type: 'learnedFields' }).catch(() => null);
      learned = new Set(res && res.ok ? res.data : []);
    }
    return learned;
  }

  // -------------------------------------------------------------------------
  // Settings

  async function loadSettings() {
    if (!settings) {
      const res = await browser.runtime.sendMessage({ type: 'settings' });
      settings = res && res.ok ? res.data : { configured: false, inlineButton: false, fillConfirm: true };
    }
    return settings;
  }

  browser.storage.onChanged.addListener(() => {
    settings = null;
    learned = null;
  });

  // -------------------------------------------------------------------------
  // Overlay UI (closed shadow DOM, isolated from page styles)

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .btn { position: absolute; width: 24px; height: 24px; border-radius: 6px; border: 1px solid #2b6cb0;
      background: #ebf4ff; color: #2b6cb0; cursor: pointer; display: flex; align-items: center; justify-content: center;
      padding: 0; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
    .btn:hover { background: #2b6cb0; color: #fff; }
    .btn svg { width: 16px; height: 16px; }
    .panel { position: absolute; background: #fff; color: #1a202c; border: 1px solid #cbd5e0; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 12px; width: 320px; max-width: calc(100vw - 16px); }
    .row { display: flex; gap: 6px; margin-bottom: 8px; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 600; }
    input, select { flex: 2; min-width: 0; padding: 6px 8px; border: 1px solid #cbd5e0; border-radius: 6px; background: #fff; color: #1a202c; }
    select { flex: 1; }
    button.primary { width: 100%; padding: 8px; border: 0; border-radius: 6px; background: #2b6cb0; color: #fff; font-weight: 600; cursor: pointer; }
    button.primary:disabled { opacity: .6; cursor: default; }
    button.close { border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #718096; padding: 2px 6px; }
    .list { margin-top: 10px; max-height: 180px; overflow: auto; }
    .list .title { font-size: 12px; color: #718096; margin-bottom: 4px; }
    .item { display: block; width: 100%; text-align: left; border: 1px solid #e2e8f0; background: #f7fafc; border-radius: 6px;
      padding: 6px 8px; margin-bottom: 4px; cursor: pointer; font-family: ui-monospace, monospace; font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1a202c; }
    .item:hover { background: #ebf4ff; border-color: #90cdf4; }
    .status { margin-top: 8px; font-size: 12px; color: #4a5568; min-height: 1em; }
    .status.error { color: #c53030; }
    a { color: #2b6cb0; cursor: pointer; }
    .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #2d3748; color: #fff;
      padding: 8px 14px; border-radius: 8px; max-width: calc(100vw - 32px); box-shadow: 0 4px 12px rgba(0,0,0,.3); }
    @media (prefers-color-scheme: dark) {
      .panel { background: #1a202c; color: #e2e8f0; border-color: #4a5568; }
      input, select { background: #2d3748; color: #e2e8f0; border-color: #4a5568; }
      .item { background: #2d3748; border-color: #4a5568; color: #e2e8f0; }
      .item:hover { background: #2c5282; }
      .status { color: #a0aec0; }
    }
  `;

  function icon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
      svg.setAttribute(k, v);
    }
    const rect = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: '2', y: '5', width: '16', height: '12', rx: '2' })) {
      rect.setAttribute(k, v);
    }
    svg.append(rect);
    for (const d of ['M2 7l8 5 8-5', 'M20 13v8M16 17h8']) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.append(c);
    return node;
  }

  function ensureUi() {
    if (ui && ui.host.isConnected) {
      return ui;
    }
    const host = document.createElement('rcid-overlay');
    for (const [k, v] of Object.entries({ all: 'initial', position: 'absolute', top: '0', left: '0',
      width: '0', height: '0', 'z-index': '2147483647', overflow: 'visible' })) {
      host.style.setProperty(k, v, 'important');
    }
    const root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', { text: CSS }));

    const button = el('button', { class: 'btn', type: 'button', title: 'Shop-Adresse erzeugen / wählen' });
    button.append(icon());
    button.hidden = true;
    // keep focus in the page input
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(panelInput);
    });
    root.append(button);

    document.documentElement.append(host);
    ui = { host, root, button, panel: null };
    return ui;
  }

  function place(node, input, below) {
    const r = input.getBoundingClientRect();
    const sx = window.scrollX;
    const sy = window.scrollY;
    if (below) {
      const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
      let left = r.left + sx;
      left = Math.max(sx + 8, Math.min(left, sx + window.innerWidth - width - 8));
      node.style.width = width + 'px';
      node.style.left = left + 'px';
      node.style.top = (r.bottom + sy + 4) + 'px';
    } else {
      node.style.left = (r.right + sx - 28) + 'px';
      node.style.top = (r.top + sy + (r.height - 24) / 2) + 'px';
    }
  }

  function reposition() {
    if (!ui || !panelInput) return;
    if (!panelInput.isConnected) {
      hideAll();
      return;
    }
    if (!ui.button.hidden) place(ui.button, panelInput, false);
    if (ui.panel) place(ui.panel, panelInput, true);
  }

  let rafPending = false;
  function scheduleReposition() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        reposition();
      });
    }
  }
  window.addEventListener('scroll', scheduleReposition, true);
  window.addEventListener('resize', scheduleReposition);

  function showButton(input) {
    const u = ensureUi();
    panelInput = input;
    u.button.hidden = false;
    place(u.button, input, false);
  }

  function hideAll() {
    if (!ui) return;
    ui.button.hidden = true;
    closePanel();
  }

  function closePanel() {
    if (ui && ui.panel) {
      ui.panel.remove();
      ui.panel = null;
    }
  }

  function toast(text) {
    const u = ensureUi();
    const t = el('div', { class: 'toast', text });
    u.root.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  async function openPanel(input) {
    if (!usable(input)) {
      input = findBestInput();
    }
    if (!input) {
      toast('Kein E-Mail-Feld gefunden.');
      return;
    }
    const u = ensureUi();
    closePanel();
    panelInput = input;
    await loadSettings().catch(() => {});

    const status = el('div', { class: 'status', text: 'Lade …' });
    const shopInput = el('input', { type: 'text', placeholder: 'Shop-Name', autocomplete: 'off', spellcheck: 'false' });
    const domainSelect = el('select', {});
    domainSelect.hidden = true;
    const createBtn = el('button', { class: 'primary', type: 'button', text: 'Neue Adresse erzeugen' });
    const list = el('div', { class: 'list' });
    const panel = el('div', { class: 'panel', role: 'dialog' }, [
      el('div', { class: 'head' }, [
        el('span', { text: 'Shop-Adresse' }),
        el('button', { class: 'close', type: 'button', title: 'Schließen', text: '×', onclick: closePanel }),
      ]),
      el('div', { class: 'row' }, [shopInput, domainSelect]),
      createBtn,
      list,
      status,
    ]);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePanel();
        input.focus();
      }
      e.stopPropagation();
    });
    u.root.append(panel);
    u.panel = panel;
    place(panel, input, true);

    const setStatus = (text, error) => {
      status.textContent = text || '';
      status.className = 'status' + (error ? ' error' : '');
    };

    const use = (email) => {
      learn(input, true);
      const n = fill(input, email);
      closePanel();
      toast(n > 1 ? `${email} eingefügt (${n} Felder)` : `${email} eingefügt`);
    };

    const renderList = (identities) => {
      list.replaceChildren();
      if (identities && identities.length) {
        list.append(el('div', { class: 'title', text: 'Vorhandene Adressen für diesen Shop:' }));
        for (const id of identities) {
          list.append(el('button', { class: 'item', type: 'button', title: id.email, text: id.email, onclick: () => use(id.email) }));
        }
      }
    };

    let listTimer = null;
    shopInput.addEventListener('input', () => {
      clearTimeout(listTimer);
      listTimer = setTimeout(async () => {
        const shop = shopInput.value.trim();
        if (!RcShop.sanitize(shop)) return renderList([]);
        const res = await browser.runtime.sendMessage({ type: 'list', shop });
        if (res && res.ok) renderList(res.data);
      }, 400);
    });
    shopInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createBtn.click();
      }
    });

    createBtn.addEventListener('click', async () => {
      const shop = shopInput.value.trim();
      if (!RcShop.sanitize(shop)) {
        setStatus('Bitte einen Shop-Namen angeben.', true);
        return;
      }
      createBtn.disabled = true;
      setStatus('Erzeuge Adresse …');
      const res = await browser.runtime.sendMessage({ type: 'create', shop, domain: domainSelect.value });
      createBtn.disabled = false;
      if (res && res.ok) {
        use(res.data.email);
      } else {
        setStatus(res ? res.error : 'Unbekannter Fehler', true);
      }
    });

    const res = await browser.runtime.sendMessage({ type: 'context' });
    if (!res || !res.ok) {
      setStatus(res ? res.error : 'Unbekannter Fehler', true);
      return;
    }
    const ctx = res.data;
    if (!ctx.configured) {
      setStatus('');
      createBtn.disabled = true;
      status.append('Noch nicht eingerichtet: im Webmail unter Einstellungen → Shop-Adressen-API ein Token erzeugen und „Mit Browser-Erweiterung verbinden“ wählen, oder ',
        el('a', { text: 'manuell einrichten', onclick: () => browser.runtime.sendMessage({ type: 'openOptions' }) }), '.');
      return;
    }
    shopInput.value = ctx.shop;
    if (ctx.domains.length > 1) {
      for (const d of ctx.domains) {
        domainSelect.append(el('option', { value: d, text: '@' + d }));
      }
      domainSelect.value = ctx.defaultDomain;
      domainSelect.hidden = false;
    }
    renderList(ctx.identities);
    setStatus(ctx.error || '', Boolean(ctx.error));
    if (!ctx.error) {
      createBtn.focus();
    }
  }

  // -------------------------------------------------------------------------
  // Page events

  document.addEventListener('focusin', async (e) => {
    const target = realTarget(e);
    if (!isTextInput(target)) {
      return;
    }
    lastTextInput = target;
    if (!isEmailInput(target)) {
      if (learned) {
        return;
      }
      await loadLearned();
      if (!isEmailInput(target)) {
        return;
      }
    }
    lastInput = target;
    clearTimeout(hideTimer);
    const s = await loadSettings().catch(() => null);
    if (s && s.configured && s.inlineButton && deepActiveElement() === target) {
      showButton(target);
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    const target = realTarget(e);
    const own = target === panelInput || (panelInput && panelInput.getRootNode().host === target);
    if (own && !(ui && ui.panel)) {
      hideTimer = setTimeout(() => {
        if (ui && !ui.panel && deepActiveElement() !== panelInput) ui.button.hidden = true;
      }, 250);
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (ui && ui.panel && !e.composedPath().includes(ui.host)) {
      closePanel();
    }
  }, true);

  // -------------------------------------------------------------------------
  // "Connect" button in the Roundcube settings (shown once after creating a token)

  // Only reacts to a real click on the button; the page is not modified before,
  // so websites can't detect the extension through it.
  document.addEventListener('click', async (e) => {
    const button = e.target instanceof Element ? e.target.closest('#identityapi-connect button') : null;
    const box = button && button.parentElement;
    if (!box || !e.isTrusted || !box.dataset.token) {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation(); // the page's own handler only shows "extension not found"
    const hint = box.querySelector('.hint');
    const say = (text) => { if (hint) hint.textContent = text; };

    // test the token first, so the question can name account and server
    say('Prüfe …');
    const check = await browser.runtime.sendMessage({ type: 'connectCheck', token: box.dataset.token });
    if (!check || !check.ok) {
      say(check ? check.error : 'Unbekannter Fehler');
      return;
    }
    const { url, user, previousUrl } = check.data;
    let question = `Erweiterung „Shop-Adressen“ verbinden?\n\nKonto: ${user}\nWebmail: ${url}`;
    if (previousUrl) {
      question += previousUrl === url
        ? '\n\nDas bisherige Token wird durch das neue ersetzt.'
        : `\n\nDie bisherige Verbindung zu ${previousUrl} wird ersetzt.`;
    }
    if (!window.confirm(question)) {
      say('');
      return;
    }
    button.disabled = true;
    say('Verbinde …');
    const res = await browser.runtime.sendMessage({ type: 'connect', token: box.dataset.token });
    if (res && res.ok) {
      button.textContent = '✓ Verbunden';
      say(`Die Erweiterung ist mit ${res.data.url} verbunden (${res.data.user}). Du kannst jetzt in Bestellformularen Shop-Adressen erzeugen.`);
    } else {
      button.disabled = false;
      say(res ? res.error : 'Unbekannter Fehler');
    }
  }, true);

  // -------------------------------------------------------------------------
  // Messages from popup / context menu

  rcidOnMessage((msg) => {
    switch (msg && msg.type) {
      case 'fill': {
        let target = targetFromMenu(msg.targetElementId);
        if (!target && msg.mode !== 'heuristic') {
          target = focusedTarget();
          if (!target && msg.mode === 'focused') {
            return undefined; // let another frame answer
          }
        }
        if (!target && msg.mode === 'heuristic' && window !== window.top) {
          return undefined;
        }
        target = target || findBestInput();
        if (!target) {
          return Promise.resolve({ filled: 0 });
        }
        learn(target, msg.targetElementId !== undefined);
        const filled = fill(target, msg.email);
        if (msg.targetElementId !== undefined) {
          toast(`${msg.email} eingefügt`);
        }
        return Promise.resolve({ filled });
      }
      case 'openPanel':
        openPanel(targetFromMenu(msg.targetElementId) || lastInput);
        return Promise.resolve(true);
      case 'notify':
        toast(msg.text);
        return Promise.resolve(true);
    }
    return undefined;
  });
})();
