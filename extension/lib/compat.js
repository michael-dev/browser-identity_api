/* Differences between Firefox and Chromium based browsers (Chrome, Edge, Brave, ...). */
(function (g) {
  'use strict';

  // Chromium: chrome.* (promise based in Manifest V3) instead of browser.*
  const isChromium = typeof g.browser === 'undefined' && typeof g.chrome !== 'undefined';
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
