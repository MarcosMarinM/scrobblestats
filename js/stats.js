// "Wrapped" style aggregations over the scrobble list.
// Plain script. Depends on js/text.js and js/artists.js (window.SS).
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});
  var key = SS.key;
  var artistKey = SS.artistKey;
  var looseTitleKey = SS.looseTitleKey;
  var trackKey = SS.trackKey;
  var creditedArtists = SS.creditedArtists;

  var DAY_MS = 86400000;

  function bump(map, k, init) {
    var e = map.get(k);
    if (!e) {
      e = init();
      map.set(k, e);
    }
    return e;
  }

  function dayNumber(dayKeyStr) {
    var parts = dayKeyStr.split('-').map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY_MS;
  }

  function dayKeyOf(date) {
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }

  function canonicalName(nameCounts) {
    var name = '';
    var best = -1;
    nameCounts.forEach(function (c, n) {
      if (c > best) {
        best = c;
        name = n;
      }
    });
    return name;
  }

  /**
   * @param {Array} scrobbles
   * @param {Object} [options]
   * @param {boolean} [options.feats=true]  Attribute features automatically.
   * @param {Map} [options.mapping]          trackKey to array of artist names added by hand.
   */
  function computeStats(scrobbles, options) {
    options = options || {};
    var feats = options.feats !== false;
    var mapping = options.mapping || null;

    var artists = new Map();
    var tracks = new Map();
    var albums = new Map();
    var yearCounts = new Map();
    var monthCounts = new Map();
    var hourCounts = new Array(24).fill(0);
    var weekdayCounts = new Array(7).fill(0); // 0 is Monday
    var dayCounts = new Map();

    var total = 0;
    var withDate = 0;
    var first = null;
    var last = null;

    for (var i = 0; i < scrobbles.length; i++) {
      var s = scrobbles[i];
      total++;

      var tk = trackKey(s.artist, s.title);
      var extras = mapping ? mapping.get(tk) : null;
      var credited = creditedArtists(s, { feats: feats, extra: extras });
      for (var c = 0; c < credited.length; c++) {
        var cr = credited[c];
        var a = bump(artists, cr.key, function () {
          return { key: cr.key, nameCounts: new Map(), plays: 0, asPrimary: 0, asFeatured: 0, first: NaN, last: NaN };
        });
        a.plays++;
        if (cr.role === 'primary') a.asPrimary++;
        else a.asFeatured++;
        a.nameCounts.set(cr.name, (a.nameCounts.get(cr.name) || 0) + 1);
        if (!isNaN(s.ts)) {
          if (isNaN(a.first) || s.ts < a.first) a.first = s.ts;
          if (isNaN(a.last) || s.ts > a.last) a.last = s.ts;
        }
      }

      bump(tracks, tk, function () {
        return { key: tk, title: s.title, artist: s.artist, plays: 0 };
      }).plays++;

      if (s.album) {
        var ak = artistKey(s.artist) + '\u0000' + key(s.album);
        bump(albums, ak, function () {
          return { key: ak, album: s.album, artist: s.artist, plays: 0 };
        }).plays++;
      }

      if (!isNaN(s.ts)) {
        withDate++;
        if (first === null || s.ts < first) first = s.ts;
        if (last === null || s.ts > last) last = s.ts;
        var d = new Date(s.ts);
        var y = d.getFullYear();
        yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
        var ym = y + '-' + String(d.getMonth() + 1).padStart(2, '0');
        monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);
        hourCounts[d.getHours()]++;
        weekdayCounts[(d.getDay() + 6) % 7]++;
        var dk = dayKeyOf(d);
        dayCounts.set(dk, (dayCounts.get(dk) || 0) + 1);
      }
    }

    var artistList = Array.from(artists.values())
      .map(function (a) {
        return {
          key: a.key,
          name: canonicalName(a.nameCounts),
          plays: a.plays,
          asPrimary: a.asPrimary,
          asFeatured: a.asFeatured,
          first: a.first,
          last: a.last
        };
      })
      .sort(function (x, y) {
        return y.plays - x.plays || (x.name < y.name ? -1 : 1);
      });

    var trackList = Array.from(tracks.values()).sort(function (x, y) {
      return y.plays - x.plays || (x.title < y.title ? -1 : 1);
    });

    var albumList = Array.from(albums.values()).sort(function (x, y) {
      return y.plays - x.plays || (x.album < y.album ? -1 : 1);
    });

    var featuredList = artistList
      .filter(function (a) { return a.asFeatured > 0; })
      .sort(function (x, y) { return y.asFeatured - x.asFeatured || y.plays - x.plays; })
      .map(function (a) { return { name: a.name, key: a.key, asFeatured: a.asFeatured, plays: a.plays }; });

    var byYear = Array.from(yearCounts.entries())
      .map(function (e) { return { year: e[0], count: e[1] }; })
      .sort(function (a, b) { return a.year - b.year; });

    var byMonth = Array.from(monthCounts.entries())
      .map(function (e) {
        var parts = e[0].split('-');
        return { ym: e[0], year: Number(parts[0]), month: Number(parts[1]), count: e[1] };
      })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });

    var days = Array.from(dayCounts.keys()).map(dayNumber).sort(function (a, b) { return a - b; });
    var streak = { days: 0, from: null, to: null };
    if (days.length) {
      var runStart = days[0];
      var prev = days[0];
      var bestLen = 1;
      var bestStart = days[0];
      var bestEnd = days[0];
      for (var j = 1; j < days.length; j++) {
        if (days[j] === prev + 1) {
          prev = days[j];
          continue;
        }
        var len = prev - runStart + 1;
        if (len > bestLen) { bestLen = len; bestStart = runStart; bestEnd = prev; }
        runStart = days[j];
        prev = days[j];
      }
      var lastLen = prev - runStart + 1;
      if (lastLen > bestLen) { bestLen = lastLen; bestStart = runStart; bestEnd = prev; }
      streak = { days: bestLen, from: bestStart * DAY_MS, to: bestEnd * DAY_MS };
    }

    var peakDay = null;
    dayCounts.forEach(function (count, dk2) {
      if (!peakDay || count > peakDay.count) peakDay = { key: dk2, count: count, ts: dayNumber(dk2) * DAY_MS };
    });

    return {
      total: total,
      withDate: withDate,
      first: first,
      last: last,
      uniqueArtists: artistList.length,
      uniqueTracks: trackList.length,
      uniqueAlbums: albumList.length,
      byYear: byYear,
      byMonth: byMonth,
      byHour: hourCounts,
      byWeekday: weekdayCounts,
      activeDays: dayCounts.size,
      avgPerActiveDay: dayCounts.size ? total / dayCounts.size : 0,
      longestStreak: streak,
      peakDay: peakDay,
      topArtists: artistList,
      topTracks: trackList,
      topAlbums: albumList,
      topFeatured: featuredList
    };
  }

  SS.computeStats = computeStats;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
