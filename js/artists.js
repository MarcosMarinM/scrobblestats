// Artist attribution: splits each scrobble between main artists and features.
// Plain script. Depends on js/text.js (window.SS).
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});
  var normaliseText = SS.normaliseText;
  var key = SS.key;

  // Separators that really do join several artists. "and" and "x" are left out on
  // purpose: they would split genuine names ("Nina and the Wild").
  var PRIMARY_SPLIT = /,\s*|;\s*|\s+&\s+|\s+y\s+|\s+vs\.?\s+|\s+\|\s+/i;

  // Feature credit markers. feat, featuring, ft, with and f/ are recognised anywhere
  // inside a bracket. con and y are ambiguous words, so they only count when the
  // bracket starts with them. "prod. by" and similar are NOT features and are ignored.
  var RE_FEAT_ANY = /(?:\b(?:feat|featuring|ft|with)\b)|(?:\bf\/)/i;
  var RE_FEAT_LEAD = /^\s*(?:(?:feat|featuring|ft|with)\b\.?|f\/|(?:con|y)\b\.?)\s*/i;
  var RE_LEAD_WITH = /^\s*with\b\.?\s*/i;
  var BRACKET = /[\(\[\{]([^\)\]\}]*)[\)\]\}]/g;
  // Unbracketed feature in the artist field, for example "A feat. B".
  var INLINE_FEAT = /^(.*?)\s+(?:feat|featuring|ft|f\/|with|con)\.?\s+(.*)$/i;

  function cleanName(n) {
    return normaliseText(n).replace(/^[\s\-]+|[\s\-]+$/g, '').trim();
  }

  function splitNames(s) {
    return String(s)
      .split(PRIMARY_SPLIT)
      .map(cleanName)
      .filter(Boolean);
  }

  /** True when a bracket is a feature credit, for example "(feat. X)", "(f/ X)", "(con X)". */
  function isFeatSegment(inner) {
    return RE_FEAT_ANY.test(inner) || RE_FEAT_LEAD.test(inner);
  }

  /** "feat. Pepito" to ["Pepito"]; "featuring with A & B" to ["A", "B"]; "f/ X" to ["X"]. */
  function namesFromFeatSegment(inner) {
    var rest = normaliseText(inner).replace(RE_FEAT_LEAD, '').replace(RE_LEAD_WITH, '');
    return splitNames(rest);
  }

  /** Bracketed parts of the title that are a featuring credit. */
  function featSegments(title) {
    var segs = [];
    String(title || '').replace(BRACKET, function (m, inner) {
      segs.push(inner);
      return m;
    });
    return segs.filter(isFeatSegment);
  }

  /**
   * Splits the artist field into main artists and features.
   * "Mariíta (feat. Pepito)" gives { primaries: ["Mariíta"], featured: ["Pepito"] }
   * "A feat. B" gives { primaries: ["A"], featured: ["B"] }
   * "A & B" gives { primaries: ["A", "B"], featured: [] }
   */
  function parseArtistCredits(rawArtist) {
    var clean = normaliseText(rawArtist);
    var featured = [];

    var base = clean.replace(BRACKET, function (m, inner) {
      if (isFeatSegment(inner)) namesFromFeatSegment(inner).forEach(function (n) { featured.push(n); });
      return ' ';
    });

    var primaryPart = base;
    var inline = base.match(INLINE_FEAT);
    if (inline) {
      primaryPart = inline[1];
      splitNames(normaliseText(inline[2]).replace(RE_LEAD_WITH, '')).forEach(function (n) { featured.push(n); });
    }

    var primaries = splitNames(normaliseText(primaryPart));
    if (!primaries.length) {
      var fallback = cleanName(clean);
      if (fallback) primaries = [fallback];
    }

    return { primaries: primaries, featured: featured.map(cleanName).filter(Boolean) };
  }

  /**
   * Artists a scrobble is credited to, without duplicates.
   * @param {Object} scrobble
   * @param {Object} [opts]
   * @param {boolean} [opts.feats=true]  Adds automatically detected features.
   * @param {string[]} [opts.extra]      Artists added by hand (always applied, role featured).
   * @returns {Array<{name: string, key: string, role: 'primary'|'featured'}>}
   */
  function creditedArtists(scrobble, opts) {
    opts = opts || {};
    var withFeats = opts.feats !== false;
    var map = new Map();

    function add(name, role) {
      var c = cleanName(name);
      if (!c) return;
      var k = key(c);
      if (!k) return;
      var cur = map.get(k);
      if (!cur) map.set(k, { name: c, key: k, role: role });
      else if (role === 'primary') cur.role = 'primary';
    }

    var credits = parseArtistCredits(scrobble.artist);
    credits.primaries.forEach(function (n) { add(n, 'primary'); });

    if (withFeats) {
      featSegments(scrobble.title).forEach(function (seg) {
        namesFromFeatSegment(seg).forEach(function (n) { add(n, 'featured'); });
      });
      credits.featured.forEach(function (n) { add(n, 'featured'); });
    }

    // Manual relationships from the user are always applied.
    (opts.extra || []).forEach(function (n) { add(n, 'featured'); });

    return Array.from(map.values());
  }

  SS.parseArtistCredits = parseArtistCredits;
  SS.creditedArtists = creditedArtists;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
