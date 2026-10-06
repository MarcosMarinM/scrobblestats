// Reads a CSV of scrobbles (lastfmstats.com format or similar).
// Plain script. Depends on js/text.js (window.SS).
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});
  var key = SS.key;
  var normaliseText = SS.normaliseText;

  /** Full CSV parser: configurable delimiter, double quotes, escaped quotes ("") and newlines inside a field. */
  function parseCSV(text, delimiter) {
    delimiter = delimiter || ',';
    var rows = [];
    var row = [];
    var field = '';
    var i = 0;
    var n = text.length;
    var inQuotes = false;
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      if (c === delimiter) {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function detectDelimiter(text) {
    var sample = text.slice(0, 20000).split('\n').slice(0, 20).join('\n');
    var candidates = [';', ',', '\t', '|'];
    var best = ';';
    var bestCount = -1;
    for (var i = 0; i < candidates.length; i++) {
      var d = candidates[i];
      var count = 0;
      var inQuotes = false;
      for (var j = 0; j < sample.length; j++) {
        var c = sample[j];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === d && !inQuotes) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = d;
      }
    }
    return best;
  }

  function looksLikeTimestamp(v) {
    var s = String(v).trim();
    if (!/^\d{9,14}$/.test(s)) return false;
    var n = Number(s);
    return n > 100000000 && n < 4102444800000;
  }

  function looksLikeISODate(v) {
    return /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(String(v).trim());
  }

  /** Epoch (seconds or milliseconds) or ISO date to milliseconds. */
  function parseDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    if (/^\d{9,14}$/.test(s)) {
      var n = Number(s);
      return n < 1e11 ? n * 1000 : n; // below 1e11 means seconds
    }
    if (looksLikeISODate(s)) {
      var t = Date.parse(s.replace(' ', 'T'));
      return isNaN(t) ? NaN : t;
    }
    var t2 = Date.parse(s);
    return isNaN(t2) ? NaN : t2;
  }

  function guessColumns(headers, rows) {
    var col = { artist: -1, album: -1, albumId: -1, track: -1, date: -1 };
    var normalised = headers.map(function (h) {
      return key(h);
    });
    var used = {};

    function find(re, exclude) {
      for (var i = 0; i < normalised.length; i++) {
        if (used[i]) continue;
        if (exclude && exclude.test(normalised[i])) continue;
        if (re.test(normalised[i])) return i;
      }
      return -1;
    }
    col.albumId = find(/album.*(id|mbid|identificador)/);
    if (col.albumId >= 0) used[col.albumId] = true;
    col.artist = find(/^(artist|artista|artist name|nombre del artista)$/);
    if (col.artist < 0) col.artist = find(/^(artist|artista)/, /album/);
    if (col.artist < 0) col.artist = find(/artist/, /album/);
    if (col.artist >= 0) used[col.artist] = true;
    col.album = find(/album/, /album.*(id|mbid|artist)/);
    if (col.album >= 0) used[col.album] = true;
    col.track = find(/^(track|track name|title|titulo|song|name|nombre)$/);
    if (col.track < 0) col.track = find(/track|title|song|titulo|canci/);
    if (col.track >= 0) used[col.track] = true;
    col.date = find(/^(date|fecha|uts|timestamp|played at|played_at|time)$/);
    if (col.date < 0) col.date = find(/date|fecha|uts|timestamp|time|when/);

    var sampleRows = rows.slice(0, 30);
    var validCount = function (index) {
      if (index < 0) return 0;
      var ok = 0;
      for (var i = 0; i < sampleRows.length; i++) {
        if (looksLikeTimestamp(sampleRows[i][index]) || looksLikeISODate(sampleRows[i][index])) ok++;
      }
      return ok;
    };
    if (col.date < 0 || validCount(col.date) < sampleRows.length / 2) {
      for (var c = 0; c < headers.length; c++) {
        if (validCount(c) >= sampleRows.length / 2 && c !== col.artist && c !== col.track && c !== col.album) {
          col.date = c;
          break;
        }
      }
    }
    return col;
  }

  /**
   * Reads a CSV of scrobbles.
   * @returns {{scrobbles: Array, headers: string[], columns: Object, warnings: string[]}}
   */
  function readCSV(text, fileName) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var delimiter = detectDelimiter(text);
    var rows = parseCSV(text, delimiter);
    var warnings = [];
    if (!rows.length) return { scrobbles: [], headers: [], columns: {}, warnings: ['The file is empty.'] };

    var headers = rows[0].map(function (h) {
      return normaliseText(h);
    });
    var body = rows.slice(1);

    var hasHeader = !looksLikeTimestamp(headers[headers.length - 1]) && body.length > 0;
    var columns = guessColumns(headers, body);
    if (!hasHeader) {
      columns = { artist: 0, album: 1, albumId: -1, track: 3, date: 4 };
      body = rows;
      headers = ['(no header)'];
      if (body[0] && body[0].length > 4 && !looksLikeTimestamp(body[0][4])) {
        columns = { artist: 0, album: 1, albumId: -1, track: 2, date: 3 };
      }
    }

    if (columns.artist < 0 || columns.track < 0) {
      warnings.push(
        'I could not identify the artist and track columns. Assuming the usual order ' +
          '(Artist;Album;AlbumId;Track;Date).'
      );
      columns = { artist: 0, album: 1, albumId: 2, track: 3, date: 4 };
    }
    if (columns.date < 0) {
      warnings.push('No date column was found, so the time based statistics are switched off.');
    }

    var fieldAt = function (row, index) {
      if (index < 0 || !row) return '';
      var v = row[index];
      return v == null ? '' : normaliseText(v);
    };

    var scrobbles = [];
    var withoutDate = 0;
    for (var i = 0; i < body.length; i++) {
      var row2 = body[i];
      if (!row2 || (row2.length === 1 && row2[0] === '')) continue;
      var ts = columns.date >= 0 ? parseDate(row2[columns.date]) : NaN;
      if (isNaN(ts)) withoutDate++;
      scrobbles.push({
        i: scrobbles.length,
        artist: fieldAt(row2, columns.artist),
        album: fieldAt(row2, columns.album),
        albumId: fieldAt(row2, columns.albumId),
        title: fieldAt(row2, columns.track),
        ts: ts,
        source: fileName || ''
      });
    }
    if (withoutDate) warnings.push(num(withoutDate) + ' rows have no recognisable date.');
    scrobbles.sort(function (a, b) {
      var av = isNaN(a.ts) ? Infinity : a.ts;
      var bv = isNaN(b.ts) ? Infinity : b.ts;
      return av - bv;
    });
    scrobbles.forEach(function (s, index) {
      s.i = index;
    });
    return { scrobbles: scrobbles, headers: headers, columns: columns, warnings: warnings };
  }

  function num(n) {
    try {
      return Number(n).toLocaleString('en-GB');
    } catch (e) {
      return String(n);
    }
  }

  SS.parseCSV = parseCSV;
  SS.detectDelimiter = detectDelimiter;
  SS.parseDate = parseDate;
  SS.readCSV = readCSV;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
