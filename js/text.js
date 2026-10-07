// Text normalisation for comparing artists and titles.
// Plain script so it also works over file://. Exposes helpers on window.SS.
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});

  var RE_SPACES = /\s+/g;
  var RE_NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
  var RE_SINGLE_QUOTES = /[\u2018\u2019\u201B\u2032\u02B9\u02BB\u02BC\u02BD\u02BE\u02BF`\u00B4]/g;

  /** Strips accents and diacritics without destroying non Latin scripts. */
  function stripAccents(s) {
    try {
      return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
      return s;
    }
  }

  /** Cleans a tag: unifies dashes and odd spaces, collapses runs of spaces. */
  function normaliseText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200F\u2028\u2029\uFEFF\uFFFD]/g, '')
      .replace(RE_SPACES, ' ')
      .trim();
  }

  /** Comparison key: no accents, lower case, no punctuation. */
  function key(s) {
    var h = stripAccents(normaliseText(s)).toLowerCase();
    h = h
      .replace(RE_SINGLE_QUOTES, ' ')
      .replace(RE_NON_ALPHANUMERIC, ' ')
      .replace(RE_SPACES, ' ')
      .trim();
    return h;
  }

  var RE_FEAT = /\b(?:feat|featuring|ft|con)\b\.?|\bf\//g;

  /** Title with the featuring credit removed. */
  function stripFeat(s) {
    return String(s == null ? '' : s).replace(RE_FEAT, ' ').replace(RE_SPACES, ' ').trim();
  }

  /** Splits "Track (X) - Y" into a base plus its qualifiers (already normalised). */
  function titleParts(t) {
    var h = normaliseText(t);
    var qualifiers = [];
    var base = h.replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, function (match, inner) {
      var q = key(inner);
      if (q) qualifiers.push(q);
      return ' ';
    });
    var m;
    var guard = 0;
    while (guard++ < 5) {
      m = base.match(/\s+-\s+(.{2,})$/);
      if (!m) break;
      var q2 = key(m[1]);
      if (!q2) break;
      qualifiers.push(q2);
      base = base.slice(0, m.index);
    }
    return { base: base.replace(RE_SPACES, ' ').trim(), qualifiers: qualifiers.filter(Boolean) };
  }

  function strictTitleKey(t) {
    return key(t);
  }

  function looseTitleKey(t) {
    return key(stripFeat(titleParts(t).base)) || key(t);
  }

  /** Artist key: no featuring credit, no brackets, no leading article. */
  function artistKey(a) {
    var h = normaliseText(a);
    h = h.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
    h = stripFeat(h);
    var k = key(h);
    k = k.replace(/^(the|los|las|el|la|le|les|il|lo)\s+/, '');
    return k || key(a);
  }

  /** Stable key for a track (artist plus title). */
  function trackKey(artist, title) {
    return artistKey(artist) + '\u0000' + looseTitleKey(title);
  }

  var RE_EDITION = /\b(deluxe|deluxe edition|special edition|expanded edition|expanded|anniversary edition|bonus track version|bonus version|remastered|remaster)\b/;
  var RE_TRAILING_QUALIFIER = /\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]\s*$/;

  /** Album name without a trailing edition qualifier, so "X (Deluxe)" and "X" match. */
  function albumBase(name) {
    var n = normaliseText(name);
    var m = n.match(RE_TRAILING_QUALIFIER);
    if (m && RE_EDITION.test(key(m[1]))) return n.slice(0, m.index).trim();
    return n;
  }

  SS.RE_SPACES = RE_SPACES;
  SS.RE_FEAT = RE_FEAT;
  SS.stripAccents = stripAccents;
  SS.normaliseText = normaliseText;
  SS.key = key;
  SS.stripFeat = stripFeat;
  SS.titleParts = titleParts;
  SS.strictTitleKey = strictTitleKey;
  SS.looseTitleKey = looseTitleKey;
  SS.artistKey = artistKey;
  SS.trackKey = trackKey;
  SS.albumBase = albumBase;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
