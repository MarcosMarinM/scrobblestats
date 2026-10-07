// "Wrapped" style aggregations over the scrobble list.
// Plain script. Depends on js/text.js and js/artists.js (window.SS).
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});
  var key = SS.key;
  var artistKey = SS.artistKey;
  var looseTitleKey = SS.looseTitleKey;
  var trackKey = SS.trackKey;
  var albumBase = SS.albumBase;
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

  // Album names some players write when they do not know the real one.
  var PLACEHOLDER_ALBUMS = { album: 1, unknown: 1, 'unknown album': 1, 'various artists': 1 };

  /**
   * Works out which release each track's plays should count under when singles are
   * consolidated into albums. A track's plays are moved when they come from a junk
   * release (a single: one track or named like the track; a scrobble with no album; or a
   * placeholder album like "Album") and the track also has a real album (two or more
   * tracks by the same artist, with a proper name). Only plays from those junk releases
   * move; plays already on a real album are left where they are. The real album the track
   * is played most becomes the destination.
   * @param {Array} scrobbles
   * @returns {Map} trackKey to { target: { key, album, artist }, sources: Set, empty: boolean }
   */
  function buildAlbumConsolidation(scrobbles) {
    var trackReleases = new Map();
    var releaseTracks = new Map();
    var trackPlays = new Map();
    var nameArtists = new Map();
    var emptyTracks = new Set();

    for (var i = 0; i < scrobbles.length; i++) {
      var s = scrobbles[i];
      var tk = trackKey(s.artist, s.title);
      if (!s.album) { emptyTracks.add(tk); continue; }
      var ak = artistKey(s.artist) + '\u0000' + key(s.album);

      var releases = trackReleases.get(tk);
      if (!releases) { releases = new Map(); trackReleases.set(tk, releases); }
      if (!releases.has(ak)) {
        releases.set(ak, { key: ak, album: s.album, artist: s.artist, titleKey: key(s.title) });
      }

      var tracks = releaseTracks.get(ak);
      if (!tracks) { tracks = new Set(); releaseTracks.set(ak, tracks); }
      tracks.add(tk);

      var plays = trackPlays.get(tk);
      if (!plays) { plays = new Map(); trackPlays.set(tk, plays); }
      plays.set(ak, (plays.get(ak) || 0) + 1);

      var name = key(s.album);
      var artists = nameArtists.get(name);
      if (!artists) { artists = new Set(); nameArtists.set(name, artists); }
      artists.add(artistKey(s.artist));
    }

    // An album name shared by several artists is a compilation, not one artist's album.
    var compilationNames = new Set();
    nameArtists.forEach(function (artists, name) {
      if (artists.size >= 3) compilationNames.add(name);
    });

    var map = new Map();
    trackReleases.forEach(function (releases, tk) {
      var sources = new Set();
      var target = null;
      var targetPlays = -1;
      releases.forEach(function (r) {
        var count = releaseTracks.get(r.key).size;
        var singleLike = count === 1 || r.titleKey === key(r.album);
        var placeholder = !!PLACEHOLDER_ALBUMS[key(r.album)];
        var compilation = compilationNames.has(key(r.album));
        if (singleLike || placeholder || compilation) sources.add(r.key);
        if (singleLike || placeholder || compilation || count < 2) return; // not a real album
        var plays = trackPlays.get(tk).get(r.key) || 0;
        if (plays > targetPlays) { target = r; targetPlays = plays; }
      });

      if (!target) return;
      if (!sources.size && !emptyTracks.has(tk)) return;
      map.set(tk, { target: target, sources: sources, empty: emptyTracks.has(tk) });
    });
    return map;
  }

  /**
   * Groups the different editions of the same album (for example "X" and "X (Deluxe)")
   * so they count as one, and remembers how many versions there are.
   * @param {Array} scrobbles
   * @returns {Map} albumKey to { key, album, versions }
   */
  function buildAlbumVersions(scrobbles) {
    var groups = new Map();
    for (var i = 0; i < scrobbles.length; i++) {
      var s = scrobbles[i];
      if (!s.album) continue;
      var base = artistKey(s.artist) + '\u0000' + key(albumBase(s.album));
      var ak = artistKey(s.artist) + '\u0000' + key(s.album);
      var members = groups.get(base);
      if (!members) { members = new Map(); groups.set(base, members); }
      var m = members.get(ak);
      if (!m) { m = { key: ak, album: s.album, artist: s.artist, plays: 0 }; members.set(ak, m); }
      m.plays++;
    }

    var map = new Map();
    groups.forEach(function (members, base) {
      if (members.size < 2) return;
      var best = null;
      members.forEach(function (m) { if (!best || m.plays > best.plays) best = m; });
      var canonicalName = albumBase(best.album);
      members.forEach(function (m, ak) {
        map.set(ak, { key: base, album: canonicalName, versions: members.size });
      });
    });
    return map;
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
    var albumMap = options.albumMap || null;
    var albumVersions = options.albumVersions || null;
    var hideSingles = !!options.hideSingles;
    var artistMap = options.artistMap || null;

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
        var mapped = artistMap ? artistMap.get(cr.key) : null;
        var akey = mapped ? mapped.key : cr.key;
        var a = bump(artists, akey, function () {
          return { key: akey, nameCounts: new Map(), forcedName: mapped ? mapped.name : null, plays: 0, asPrimary: 0, asFeatured: 0, first: NaN, last: NaN };
        });
        if (mapped) a.forcedName = mapped.name;
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

      var info = albumMap ? albumMap.get(tk) : null;
      var useTarget = false;
      if (info) {
        useTarget = s.album
          ? info.sources.has(artistKey(s.artist) + '\u0000' + key(s.album))
          : info.empty;
      }
      if (s.album || useTarget) {
        var ak = useTarget ? info.target.key : artistKey(s.artist) + '\u0000' + key(s.album);
        var albumName = useTarget ? info.target.album : s.album;
        var albumArtist = useTarget ? info.target.artist : s.artist;
        var version = albumVersions ? albumVersions.get(ak) : null;
        if (version) { ak = version.key; albumName = version.album; }
        var alb = bump(albums, ak, function () {
          return { key: ak, album: albumName, artist: albumArtist, plays: 0, versions: version ? version.versions : 1, tracks: new Set() };
        });
        alb.plays++;
        alb.tracks.add(tk);
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
          name: a.forcedName || canonicalName(a.nameCounts),
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

    var albumList = Array.from(albums.values())
      .filter(function (a) { return !hideSingles || a.tracks.size > 1; })
      .map(function (a) {
        return { key: a.key, album: a.album, artist: a.artist, plays: a.plays, versions: a.versions };
      })
      .sort(function (x, y) {
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

  SS.buildAlbumConsolidation = buildAlbumConsolidation;
  SS.buildAlbumVersions = buildAlbumVersions;
  SS.computeStats = computeStats;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
