/* Client for the Roundcube identity_api plugin. Used by background and options page. */
(function (root) {
  'use strict';

  const DEFAULTS = {
    apiUrl: '',
    token: '',
    defaultDomain: '',
    inlineButton: true,
    fillConfirm: true,
    copyToClipboard: true,
    pendingToken: '', // rotated token not yet confirmed, see doRotate()
    overrides: {}, // siteKey -> shop name chosen by the user
    learnedFields: {}, // siteKey -> ["name:foo", "id:bar"], unrecognized e-mail fields filled by the user
  };

  const TIMEOUT_MS = 20000;

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.status = status || 0;
      this.code = code || ''; // error string of the server, e.g. "domain not allowed"
    }
  }

  async function getSettings() {
    return browser.storage.local.get(DEFAULTS);
  }

  /** "https://webmail.example.org/?_task=mail#x" -> "https://webmail.example.org/" */
  function normalizeBaseUrl(url) {
    url = String(url || '').trim();
    if (!url) {
      return '';
    }
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    if (!u.pathname.endsWith('/')) {
      u.pathname += '/';
    }
    return u.toString();
  }

  /**
   * REST API v1 URL below the API base URL, e.g.
   * endpoint('https://webmail.example.org/api/identity/', '/v1/identities', { shop: 'gardenshop' })
   * -> https://webmail.example.org/api/identity/v1/identities?shop=gardenshop
   */
  function endpoint(baseUrl, path, params) {
    const u = new URL(String(path).replace(/^\/+/, ''), normalizeBaseUrl(baseUrl));
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') {
        u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  // error codes of the REST API (docs/openapi.yaml)
  const ERRORS = {
    unauthorized: 'Token ungültig, widerrufen oder abgelaufen.',
    domain_not_allowed: 'Diese Domain ist auf dem Server nicht freigegeben.',
    shop_missing: 'Bitte einen Shop-Namen angeben.',
    invalid_shop: 'Ungültiger Shop-Name.',
    identity_limit_reached: 'Maximale Anzahl an Identitäten erreicht.',
    rate_limit_exceeded: 'Zu viele neue Adressen in kurzer Zeit. Bitte später erneut versuchen.',
    address_too_long: 'Adresse zu lang. Bitte einen kürzeren Shop-Namen verwenden.',
    identities_disabled: 'Der Server erlaubt keine zusätzlichen Identitäten.',
  };

  /** The token must never travel unencrypted (localhost excepted, for testing). */
  function isSecureUrl(url) {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
  }

  /**
   * One HTTP request, no rotation handling.
   * Returns { data, rotate } with rotate = server asks for token rotation.
   */
  async function request(path, { method = 'GET', params, body, settings }) {
    if (!settings.apiUrl || !settings.token) {
      throw new ApiError('Erweiterung ist noch nicht eingerichtet (API-URL und Token in den Einstellungen).', -1);
    }
    if (!isSecureUrl(settings.apiUrl)) {
      throw new ApiError('Die API-URL muss mit https:// beginnen.', -1);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const headers = { 'Authorization': 'Bearer ' + settings.token, 'Accept': 'application/json' };
    // no redirects: they could send the token to another host or downgrade to http
    const init = { method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: ctrl.signal };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(endpoint(settings.apiUrl, path, params), init);
    } catch (e) {
      throw new ApiError(e.name === 'AbortError'
        ? 'Zeitüberschreitung beim Webmail-Server.'
        : 'Webmail-Server nicht erreichbar (' + e.message + ').');
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    if (res.status !== 204) {
      try {
        data = await res.json();
      } catch (e) {
        throw new ApiError('Keine gültige API-Antwort (HTTP ' + res.status + '). Stimmt die API-URL (wie in Roundcube unter Einstellungen → Shop-Adressen-API angezeigt)?', res.status);
      }
    }

    if (!res.ok) {
      // RFC 9457 problem details with a machine readable "code"
      const code = (data && data.code) || ('http_' + res.status);
      throw new ApiError(ERRORS[code] || ('Serverfehler: ' + ((data && data.detail) || code)), res.status, code);
    }

    return { data, rotate: res.headers.get('Identity-Api-Token-Rotate') === 'true' };
  }

  const sameConnection = (a, b) => a.apiUrl === b.apiUrl && a.token === b.token;

  /**
   * Request with automatic token rotation (for the stored connection):
   * if the server says rotation is due, fetch a new token, confirm it with a
   * request and only then store it. Until the new token is used, the server
   * keeps accepting the old one, so a failed rotation just retries later.
   */
  async function call(path, { method = 'GET', params, body, settings, rotate = true } = {}) {
    settings = settings || (await getSettings());
    let res;
    try {
      res = await request(path, { method, params, body, settings });
    } catch (e) {
      if (!rotate || e.status !== 401) {
        throw e;
      }
      const latest = await getSettings();
      if (latest.apiUrl !== settings.apiUrl) {
        throw e;
      }
      if (latest.token && latest.token !== settings.token) {
        // a rotation replaced the token while this request was running
        settings = latest;
      } else if (latest.pendingToken) {
        // a rotation was interrupted after the server switched to the new token
        settings = Object.assign({}, latest, { token: latest.pendingToken });
        res = await request(path, { method, params, body, settings });
        await browser.storage.local.set({ token: settings.token, pendingToken: '' });
        return res.data;
      } else {
        throw e;
      }
      res = await request(path, { method, params, body, settings });
    }

    if (rotate && res.rotate) {
      await rotateToken(settings).catch((e) => console.warn('Token rotation failed, retrying later:', e.message));
    }
    return res.data;
  }

  let rotation = null;
  function rotateToken(settings) {
    // one rotation at a time, parallel callers wait for it
    if (!rotation) {
      rotation = doRotate(settings).finally(() => { rotation = null; });
    }
    return rotation;
  }

  async function doRotate(settings) {
    const current = await getSettings();
    if (!sameConnection(current, settings)) {
      return; // already rotated or reconfigured meanwhile
    }
    const { data } = await request('/v1/token/rotate', { method: 'POST', settings: current });
    // keep the new token before the server switches to it: if the browser stops
    // in between, the next 401 falls back to it (see call())
    await browser.storage.local.set({ pendingToken: data.token });
    // first use of the new token makes it the current one on the server
    await request('/v1/token', { settings: Object.assign({}, current, { token: data.token }) });
    if (sameConnection(await getSettings(), current)) {
      await browser.storage.local.set({ token: data.token, pendingToken: '' });
    }
  }

  root.RcApi = {
    DEFAULTS,
    ApiError,
    getSettings,
    normalizeBaseUrl,
    isSecureUrl,
    endpoint,
    // rotate: false for credentials that are not (yet) the stored ones
    info: (settings, { rotate = true } = {}) => call('/v1/me', { settings, rotate }),
    list: (shop, settings) => call('/v1/identities', { params: { shop }, settings }).then((d) => d.items),
    create: (shop, domain, settings) => call('/v1/identities', { method: 'POST', body: { shop, domain: domain || undefined }, settings }),
    remove: (id, settings) => call('/v1/identities/' + encodeURIComponent(id), { method: 'DELETE', settings }),
    token: (settings) => call('/v1/token', { settings }),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
