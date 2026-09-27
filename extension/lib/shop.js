/* Shop name helpers, shared by background, popup, options, content script and tests. */
(function (root) {
  'use strict';

  // Public suffixes with two labels that are common for shops. Not complete,
  // the suggested shop name can always be edited by the user.
  const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    'co.at', 'or.at',
    'com.au', 'net.au', 'org.au',
    'co.nz', 'co.jp', 'co.kr', 'co.za', 'co.in', 'co.il',
    'com.br', 'com.cn', 'com.hk', 'com.mx', 'com.pl', 'com.tr', 'com.tw', 'com.ar', 'com.sg',
  ]);

  /** Normalize like the server does (identity_api_generator::sanitize_shop). */
  function sanitize(name, maxLength = 30) {
    let s = String(name || '').trim().toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/&/g, '-und-').replace(/\+/g, '-plus-');
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, maxLength).replace(/-+$/g, '');
  }

  /** "www.shop.example.co.uk" -> "example.co.uk"; returns '' for IPs/localhost-like hosts. */
  function registrableDomain(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) {
      return '';
    }
    const labels = host.split('.');
    const suffixLen = labels.length > 2 && MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
    return labels.slice(-(suffixLen + 1)).join('.');
  }

  /** Decode one punycode label ("xn--bcher-kva" -> "bücher"), RFC 3492. */
  function decodePunycodeLabel(label) {
    if (!/^xn--/i.test(label)) {
      return label;
    }
    const input = label.slice(4).toLowerCase();
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const adapt = (delta, numPoints, first) => {
      delta = first ? Math.floor(delta / damp) : delta >> 1;
      delta += Math.floor(delta / numPoints);
      let k = 0;
      for (; delta > ((base - tMin) * tMax) >> 1; k += base) {
        delta = Math.floor(delta / (base - tMin));
      }
      return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    };
    const digit = (c) => (c >= 48 && c < 58 ? c - 22 : c >= 97 && c < 123 ? c - 97 : base);
    const sep = input.lastIndexOf('-');
    const output = sep > 0 ? [...input.slice(0, sep)].map((c) => c.charCodeAt(0)) : [];
    let n = 128, i = 0, bias = 72;
    for (let pos = sep > 0 ? sep + 1 : 0; pos < input.length;) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        if (pos >= input.length) return label;
        const d = digit(input.charCodeAt(pos++));
        if (d >= base) return label;
        i += d * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (d < t) break;
        w *= base - t;
      }
      bias = adapt(i - oldi, output.length + 1, oldi === 0);
      n += Math.floor(i / (output.length + 1));
      i %= output.length + 1;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
  }

  /** "https://checkout.gardenshop.example/kasse" -> "gardenshop" */
  function shopFromUrl(url) {
    let host;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) {
        return '';
      }
      host = u.hostname;
    } catch (e) {
      return '';
    }
    const reg = registrableDomain(host);
    return reg ? sanitize(decodePunycodeLabel(reg.split('.')[0])) : '';
  }

  /** Key under which a user-chosen shop name is remembered for a site. */
  function siteKey(url) {
    try {
      const u = new URL(url);
      return registrableDomain(u.hostname) || u.hostname;
    } catch (e) {
      return '';
    }
  }

  const api = { sanitize, registrableDomain, shopFromUrl, siteKey };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RcShop = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
