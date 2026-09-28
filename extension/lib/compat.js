/* Differences between Firefox and Chromium based browsers (Chrome, Edge, Brave, ...). */
(function (g) {
  'use strict';

  // Chromium: chrome.* (promise based in Manifest V3) instead of browser.*
  // decided by the extension APIs, not by "browser" existing: in content scripts an
  // element with id="browser" would show up as window.browser (DOM clobbering)
  const hasApi = (ns) => Boolean(ns && ns.runtime && ns.runtime.id);
  const isChromium = !hasApi(g.browser) && hasApi(g.chrome);
  if (isChromium) {
    g.browser = g.chrome;
  }

  /**
   * runtime.onMessage with handlers that return a Promise for the reply
   * (Firefox) or undefined for "not handled here". Chromium needs
   * sendResponse and "return true" instead.
   */
  g.rcidOnMessage = function (handler) {
    g.browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      let result;
      try {
        result = handler(msg, sender);
      } catch (e) {
        console.error('Shop-Adressen: message handler failed', e);
        throw e;
      }
      if (!isChromium) {
        return result;
      }
      if (result && typeof result.then === 'function') {
        result.then(sendResponse, function () { sendResponse(undefined); });
        return true;
      }
      return false;
    });
  };

  /** Translated text from _locales/<lang>/messages.json; subs fill $1, $2, ... */
  g.rcidT = function (key, subs) {
    const i18n = g.browser && g.browser.i18n;
    return (i18n && i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String))) || key;
  };

  /**
   * Translates an extension page: data-i18n (text), data-i18n-title,
   * data-i18n-placeholder (attributes); sets <html lang>.
   */
  g.rcidLocalize = function (doc) {
    doc.documentElement.lang = g.rcidT('@@ui_locale').replace('_', '-');
    for (const el of doc.querySelectorAll('[data-i18n]')) {
      el.textContent = g.rcidT(el.dataset.i18n);
    }
    for (const attr of ['title', 'placeholder']) {
      for (const el of doc.querySelectorAll(`[data-i18n-${attr}]`)) {
        el.setAttribute(attr, g.rcidT(el.getAttribute(`data-i18n-${attr}`)));
      }
    }
  };

  /** Open or closed shadow root of a web component (extensions may see closed ones). */
  g.rcidShadowRoot = function (el) {
    if (el.openOrClosedShadowRoot) {
      return el.openOrClosedShadowRoot; // Firefox
    }
    // Chromium content scripts; only HTML elements can host shadow roots (SVG throws)
    if (g.chrome && g.chrome.dom && g.chrome.dom.openOrClosedShadowRoot && el instanceof HTMLElement) {
      try {
        return g.chrome.dom.openOrClosedShadowRoot(el) || el.shadowRoot;
      } catch (e) {
        return el.shadowRoot;
      }
    }
    return el.shadowRoot;
  };
})(globalThis);
