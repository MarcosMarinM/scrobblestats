// ScrobbleStats UI: CSV loading, controls and rendering.
// Plain script. Depends on js/text.js, csv.js, artists.js and stats.js (window.SS).
(function (global) {
  'use strict';
  var SS = global.SS;
  var readCSV = SS.readCSV;
  var computeStats = SS.computeStats;
  var nameKey = SS.key;

  var dropzone;
  var fileInput;
  var statusEl;
  var controlsEl;
  var resultsEl;

  var STORE_KEY = 'scrobblestats.v1';
  var PAGE_SIZE = 25;
  var nf = new Intl.NumberFormat('en-GB');
  var dfShort = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'artists', label: 'Artists' },
    { id: 'tracks', label: 'Tracks' },
    { id: 'albums', label: 'Albums' },
    { id: 'features', label: 'Features' },
    { id: 'time', label: 'Time' }
  ];

  var allTimeCache = null;

  var state = {
    parsed: null,
    baseline: null,
    albumConsolidation: null,
    albumVersions: null,
    songIndex: new Map(),
    stats: null,
    meta: null,
    settings: { feats: true, featureDisplay: 'combined', consolidateSingles: false },
    mappings: [],
    artistMerges: [],
    range: { mode: 'all' },
    tab: 'overview',
    page: {}
  };

  // Saved preferences (feature toggle, feature display and manual relationships).
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      if (saved.settings && typeof saved.settings === 'object') {
        state.settings.feats = saved.settings.feats !== false;
        if (['combined', 'separate', 'hidden'].indexOf(saved.settings.featureDisplay) >= 0) {
          state.settings.featureDisplay = saved.settings.featureDisplay;
        }
        state.settings.consolidateSingles = saved.settings.consolidateSingles === true;
      }
      if (Array.isArray(saved.mappings)) state.mappings = saved.mappings;
      if (Array.isArray(saved.artistMerges)) state.artistMerges = saved.artistMerges;
    }
  } catch (e) { /* localStorage unavailable */ }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: state.settings,
        mappings: state.mappings,
        artistMerges: state.artistMerges
      }));
    } catch (e) { /* ignore */ }
  }

  /* Helpers */

  function num(n) { return nf.format(n); }
  function fmtDate(ms) { return ms == null || !isFinite(ms) ? '?' : dfShort.format(new Date(ms)); }
  function monthLabel(value) {
    var p = String(value).split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(p[0], p[1] - 1, 1));
  }

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return;
    var list = Array.isArray(children) ? children : [children];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function opt(value, label) {
    return h('option', { value: value }, label == null ? value : label);
  }

  // Text input with an accent-insensitive suggestion list. Filters with SS.key, so
  // "cancion" matches "Canción" and "mariita" matches "Mariíta".
  function buildCombo(attrs, items, onEnter) {
    var input = h('input', attrs);
    var list = h('ul', { class: 'combo-list' });
    list.hidden = true;
    var el = h('div', { class: 'combo' }, [input, list]);
    var results = [];
    var active = -1;

    function close() {
      list.hidden = true;
      active = -1;
      results = [];
    }

    function setActive(i) {
      active = i;
      for (var c = 0; c < list.children.length; c++) {
        list.children[c].className = 'combo-item' + (c === i ? ' active' : '');
      }
    }

    function pick(i) {
      if (i < 0 || i >= results.length) return false;
      input.value = results[i];
      close();
      return true;
    }

    function refresh() {
      var q = nameKey(input.value);
      results = [];
      for (var i = 0; i < items.length && results.length < 50; i++) {
        if (!q || nameKey(items[i]).indexOf(q) >= 0) results.push(items[i]);
      }
      clear(list);
      if (!results.length) { close(); return; }
      results.forEach(function (it, idx) {
        list.appendChild(h('li', {
          class: 'combo-item', text: it,
          onMouseDown: function (e) { e.preventDefault(); pick(idx); }
        }));
      });
      list.hidden = false;
      active = -1;
    }

    input.addEventListener('input', refresh);
    input.addEventListener('focus', refresh);
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) refresh(); else setActive(Math.min(active + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!list.hidden) setActive(Math.max(active - 1, 0));
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0) { e.preventDefault(); pick(active); }
        else if (onEnter) { e.preventDefault(); onEnter(); }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    return { el: el, input: input };
  }

  /* Components */

  function statCard(value, label) {
    return h('div', { class: 'stat' }, [
      h('span', { class: 'stat-value', text: value }),
      h('span', { class: 'stat-label', text: label })
    ]);
  }

  function card(title, sub, body) {
    return h('section', { class: 'card' }, [
      h('h2', { class: 'card-title', text: title }),
      sub ? h('p', { class: 'card-sub', text: sub }) : null,
      body
    ]);
  }

  function barList(items) {
    var max = items.reduce(function (m, it) { return Math.max(m, it.value); }, 0) || 1;
    function pct(v) { return Math.max(v > 0 ? 1 : 0, Math.round((v / max) * 100)) + '%'; }
    return h(
      'ol',
      { class: 'rank' },
      items.map(function (it, idx) {
        var fills = it.segments
          ? it.segments.map(function (seg) { return h('span', { class: 'bar-fill ' + (seg.cls || ''), style: 'width:' + pct(seg.value) }); })
          : [h('span', { class: 'bar-fill', style: 'width:' + pct(it.value) })];
        return h('li', { class: 'rank-row' }, [
          h('span', { class: 'rank-n', text: it.rank != null ? String(it.rank) : String(idx + 1) }),
          h('div', { class: 'rank-main' }, [
            h('div', { class: 'rank-head' }, [
              h('span', { class: 'rank-name', text: it.label }),
              it.badge ? h('span', { class: 'badge', text: it.badge }) : null
            ]),
            it.sub ? h('span', { class: 'rank-sub', text: it.sub }) : null,
            h('div', { class: 'bar' }, fills)
          ]),
          h('span', { class: 'rank-val', text: num(it.value) })
        ]);
      })
    );
  }

  function paginated(items, tabId) {
    var pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    var page = Math.min(Math.max(1, state.page[tabId] || 1), pages);
    state.page[tabId] = page;
    var start = (page - 1) * PAGE_SIZE;
    var slice = items.slice(start, start + PAGE_SIZE).map(function (it, i) {
      it.rank = start + i + 1;
      return it;
    });
    var wrap = h('div', {});
    wrap.appendChild(barList(slice));
    if (pages > 1) {
      var from = start + 1;
      var to = Math.min(start + PAGE_SIZE, items.length);
      var pageInput = h('input', {
        type: 'number', class: 'page-input', min: '1', max: String(pages),
        value: String(page), 'aria-label': 'Page number'
      });
      function jump() {
        var v = Math.round(Number(pageInput.value));
        if (isNaN(v)) v = page;
        v = Math.min(Math.max(1, v), pages);
        pageInput.value = String(v);
        if (v !== page) {
          state.page[tabId] = v;
          render();
        }
      }
      pageInput.addEventListener('change', jump);
      pageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); jump(); }
      });
      wrap.appendChild(h('div', { class: 'pager' }, [
        h('button', {
          type: 'button', class: 'btn-ghost', text: 'Previous',
          disabled: page <= 1 ? 'disabled' : null,
          onClick: function () { if (page > 1) { state.page[tabId] = page - 1; render(); } }
        }),
        h('span', { class: 'pager-info', text: 'Showing ' + num(from) + ' to ' + num(to) + ' of ' + num(items.length) }),
        h('span', { class: 'pager-jump' }, [
          h('span', { text: 'Page' }),
          pageInput,
          h('span', { text: 'of ' + pages })
        ]),
        h('button', {
          type: 'button', class: 'btn-ghost', text: 'Next',
          disabled: page >= pages ? 'disabled' : null,
          onClick: function () { if (page < pages) { state.page[tabId] = page + 1; render(); } }
        })
      ]));
    }
    return wrap;
  }

  function stripBars(values, labels, titles) {
    var max = Math.max.apply(null, values.concat([1]));
    return h(
      'div',
      { class: 'strip' },
      values.map(function (v, i) {
        return h('div', { class: 'strip-col', title: (titles ? titles[i] : labels[i]) + ': ' + num(v) }, [
          h('div', { class: 'strip-bar' }, [
            h('span', { class: 'strip-fill', style: 'height:' + Math.round((v / max) * 100) + '%' })
          ]),
          h('span', { class: 'strip-label', text: labels[i] })
        ]);
      })
    );
  }

  function yearChart(byYear) {
    var max = byYear.reduce(function (m, y) { return Math.max(m, y.count); }, 0) || 1;
    return h(
      'div',
      { class: 'years' },
      byYear.map(function (y) {
        return h('div', { class: 'year-col', title: y.year + ': ' + num(y.count) + ' scrobbles' }, [
          h('span', { class: 'year-count', text: num(y.count) }),
          h('div', { class: 'year-bar' }, [
            h('span', { class: 'year-fill', style: 'height:' + Math.round((y.count / max) * 100) + '%' })
          ]),
          h('span', { class: 'year-label', text: String(y.year) })
        ]);
      })
    );
  }

  /* Time range */

  function availableYears() {
    var set = {};
    var sc = state.parsed ? state.parsed.scrobbles : [];
    for (var i = 0; i < sc.length; i++) {
      if (isNaN(sc[i].ts)) continue;
      set[new Date(sc[i].ts).getFullYear()] = 1;
    }
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }

  function availableMonths() {
    var set = {};
    var sc = state.parsed ? state.parsed.scrobbles : [];
    for (var i = 0; i < sc.length; i++) {
      if (isNaN(sc[i].ts)) continue;
      var d = new Date(sc[i].ts);
      set[d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')] = 1;
    }
    return Object.keys(set).sort().map(function (v) { return { value: v, label: monthLabel(v) }; });
  }

  function rangeBounds(range) {
    if (!range || range.mode === 'all') return { from: null, to: null };
    if (range.mode === 'year') {
      var y = range.year;
      if (y == null) return { from: null, to: null };
      return { from: +new Date(y, 0, 1, 0, 0, 0, 0), to: +new Date(y, 11, 31, 23, 59, 59, 999) };
    }
    if (range.mode === 'spotifyyear') {
      var ys = range.year;
      if (ys == null) return { from: null, to: null };
      return { from: +new Date(ys - 1, 11, 1, 0, 0, 0, 0), to: +new Date(ys, 10, 30, 23, 59, 59, 999) };
    }
    if (range.mode === 'month') {
      if (!range.month) return { from: null, to: null };
      var p = range.month.split('-').map(Number);
      return { from: +new Date(p[0], p[1] - 1, 1, 0, 0, 0, 0), to: +new Date(p[0], p[1], 1, 0, 0, 0, 0) - 1 };
    }
    if (range.mode === 'custom') {
      return { from: parseDay(range.from, false), to: parseDay(range.to, true) };
    }
    return { from: null, to: null };
  }

  function parseDay(value, endOfDay) {
    if (!value) return null;
    var p = String(value).split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return null;
    return endOfDay ? +new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999) : +new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
  }

  function rangeLabel(range) {
    if (!range || range.mode === 'all') return 'all time';
    if (range.mode === 'year') return String(range.year);
    if (range.mode === 'spotifyyear') return 'Spotify year ' + range.year + ' (Dec ' + (range.year - 1) + ' to Nov ' + range.year + ')';
    if (range.mode === 'month') return range.month ? monthLabel(range.month) : 'month';
    if (range.mode === 'custom') return (range.from || 'the start') + ' to ' + (range.to || 'the end');
    return 'all time';
  }

  function filterByRange(scrobbles, range) {
    var b = rangeBounds(range);
    if (b.from == null && b.to == null) return scrobbles;
    return scrobbles.filter(function (s) {
      if (isNaN(s.ts)) return false;
      if (b.from != null && s.ts < b.from) return false;
      if (b.to != null && s.ts > b.to) return false;
      return true;
    });
  }

  function periodValueFromRange(range) {
    if (!range || range.mode === 'all') return 'all';
    if (range.mode === 'year') return 'year:' + range.year;
    if (range.mode === 'spotifyyear') return 'spotify:' + range.year;
    if (range.mode === 'month') return 'month';
    return 'custom';
  }

  function rangeFromPeriodValue(value) {
    if (value === 'all') return { mode: 'all' };
    var i = value.indexOf(':');
    var kind = i < 0 ? value : value.slice(0, i);
    var rest = i < 0 ? '' : value.slice(i + 1);
    if (kind === 'year') return { mode: 'year', year: Number(rest) };
    if (kind === 'spotify') return { mode: 'spotifyyear', year: Number(rest) };
    if (kind === 'month') return { mode: 'month', month: null };
    return { mode: 'custom', from: null, to: null };
  }

  /* Manual relationships */

  function buildMappingMap() {
    if (!state.mappings.length) return null;
    var m = new Map();
    state.mappings.forEach(function (x) {
      var arr = m.get(x.trackKey);
      if (!arr) { arr = []; m.set(x.trackKey, arr); }
      if (arr.indexOf(x.artist) < 0) arr.push(x.artist);
    });
    return m;
  }

  // Artist aliases: maps a credited artist key to the name it is counted under.
  function buildArtistMap() {
    if (!state.artistMerges.length) return null;
    var direct = new Map();
    state.artistMerges.forEach(function (m) {
      if (!m || !m.from || !m.into) return;
      direct.set(nameKey(m.from), m.into);
    });
    var map = new Map();
    direct.forEach(function (into, fromKey) {
      var target = into;
      var seen = {};
      var guard = 0;
      while (direct.has(nameKey(target)) && !seen[nameKey(target)] && guard++ < 50) {
        seen[nameKey(target)] = 1;
        target = direct.get(nameKey(target));
      }
      map.set(fromKey, { key: nameKey(target), name: target });
    });
    return map;
  }

  function indexSongs() {
    state.songIndex = new Map();
    state.baseline.topTracks.forEach(function (t) {
      var disp = t.title + ' by ' + t.artist;
      if (!state.songIndex.has(disp)) state.songIndex.set(disp, t.key);
    });
  }

  /* Controls */

  function buildControls() {
    clear(controlsEl);
    controlsEl.hidden = false;

    var years = availableYears();
    var months = availableMonths();

    var featsChk = h('input', { type: 'checkbox', id: 'opt-feats' });
    featsChk.checked = state.settings.feats !== false;
    featsChk.addEventListener('change', function () {
      state.settings.feats = featsChk.checked;
      persist();
      recompute();
    });

    var consolidateChk = h('input', { type: 'checkbox', id: 'opt-consolidate' });
    consolidateChk.checked = state.settings.consolidateSingles === true;
    consolidateChk.addEventListener('change', function () {
      state.settings.consolidateSingles = consolidateChk.checked;
      persist();
      recompute();
    });

    var featDisplaySel = h('select', { id: 'feat-display' }, [
      opt('combined', 'Combined with main plays'),
      opt('separate', 'Shown separately'),
      opt('hidden', 'Hidden')
    ]);
    featDisplaySel.value = state.settings.featureDisplay || 'combined';
    featDisplaySel.addEventListener('change', function () {
      state.settings.featureDisplay = featDisplaySel.value;
      persist();
      recompute();
    });

    var periodSel = h('select', { id: 'period', class: 'period' });
    periodSel.appendChild(h('optgroup', { label: 'All time' }, [opt('all', 'All time')]));
    if (years.length) {
      periodSel.appendChild(h('optgroup', { label: 'Calendar years' }, years.map(function (y) {
        return opt('year:' + y, String(y));
      })));
      periodSel.appendChild(h('optgroup', { label: 'Spotify years' }, years.map(function (y) {
        return opt('spotify:' + y, 'Spotify year ' + y + ' (Dec ' + (y - 1) + ' to Nov ' + y + ')');
      })));
    }
    periodSel.appendChild(h('optgroup', { label: 'Other' }, [
      opt('month', 'Specific month...'),
      opt('custom', 'Custom range...')
    ]));

    var wanted = periodValueFromRange(state.range);
    var hasWanted = Array.prototype.some.call(periodSel.options, function (o) { return o.value === wanted; });
    periodSel.value = hasWanted ? wanted : 'all';
    state.range = rangeFromPeriodValue(periodSel.value);

    var monthInput = h('input', { type: 'month', class: 'date' });
    if (months.length) {
      monthInput.min = months[0].value;
      monthInput.max = months[months.length - 1].value;
    }
    if (state.range.month) monthInput.value = state.range.month;

    var fromInput = h('input', { type: 'date', class: 'date' });
    var toInput = h('input', { type: 'date', class: 'date' });
    if (state.range.from) fromInput.value = state.range.from;
    if (state.range.to) toInput.value = state.range.to;

    var monthWrap = h('span', { class: 'inline' }, [
      h('span', { class: 'control-label', text: 'Month' }),
      monthInput
    ]);
    var customWrap = h('span', { class: 'inline' }, [
      h('span', { class: 'control-label', text: 'From' }),
      fromInput,
      h('span', { class: 'control-label', text: 'to' }),
      toInput
    ]);

    function updateContextual() {
      monthWrap.hidden = periodSel.value !== 'month';
      customWrap.hidden = periodSel.value !== 'custom';
    }

    periodSel.addEventListener('change', function () {
      state.range = rangeFromPeriodValue(periodSel.value);
      if (state.range.mode === 'month') {
        if (!monthInput.value && months.length) monthInput.value = months[months.length - 1].value;
        state.range.month = monthInput.value || null;
      }
      if (state.range.mode === 'custom') {
        state.range.from = fromInput.value || null;
        state.range.to = toInput.value || null;
      }
      updateContextual();
      recompute();
    });
    monthInput.addEventListener('change', function () {
      state.range.month = monthInput.value || null;
      recompute();
    });
    function onCustomDate() {
      state.range.from = fromInput.value || null;
      state.range.to = toInput.value || null;
      recompute();
    }
    fromInput.addEventListener('change', onCustomDate);
    toInput.addEventListener('change', onCustomDate);
    updateContextual();

    var songCombo = buildCombo({ type: 'text', id: 'map-song', placeholder: 'Track (type and pick)...' }, Array.from(state.songIndex.keys()), addMapping);
    var artistCombo = buildCombo({ type: 'text', id: 'map-artist', placeholder: 'Artist to credit...' }, state.baseline.topArtists.map(function (a) { return a.name; }), addMapping);
    var songInput = songCombo.input;
    var artistInput = artistCombo.input;
    var addBtn = h('button', { type: 'button', class: 'btn', text: 'Add relationship', onClick: addMapping });

    var mapList = h('ul', { class: 'mapping-list', id: 'maplist' });

    function addMapping() {
      var songVal = songInput.value.trim();
      var artistVal = artistInput.value.trim();
      if (!songVal || !artistVal) return;
      var tk = state.songIndex.get(songVal);
      var resolved = songVal;
      if (!tk) {
        var needle = nameKey(songVal);
        state.songIndex.forEach(function (k, disp) {
          if (tk) return;
          if (nameKey(disp).indexOf(needle) >= 0) { tk = k; resolved = disp; }
        });
      }
      if (!tk) {
        statusEl.textContent = 'Could not find that track in your data. Try picking it from the list.';
        return;
      }
      var dup = state.mappings.some(function (x) { return x.trackKey === tk && nameKey(x.artist) === nameKey(artistVal); });
      if (!dup) {
        state.mappings.push({ trackKey: tk, song: resolved, artist: artistVal });
        persist();
        renderMappingList(mapList);
        recompute();
      }
      songInput.value = '';
      artistInput.value = '';
    }

    function renderMappingList(ul) {
      clear(ul);
      if (!state.mappings.length) {
        ul.appendChild(h('li', { class: 'mapping-empty', text: 'No manual relationships yet.' }));
        return;
      }
      state.mappings.forEach(function (x, idx) {
        ul.appendChild(h('li', {}, [
          h('span', { class: 'mapping-text' }, [h('strong', { text: x.song }), ' also credits ', h('strong', { text: x.artist })]),
          h('button', {
            type: 'button',
            class: 'btn-ghost',
            text: 'Remove',
            onClick: function () {
              state.mappings.splice(idx, 1);
              persist();
              renderMappingList(ul);
              recompute();
            }
          })
        ]));
      });
    }
    renderMappingList(mapList);

    // Config file: export the manual relationships to a JSON file and load one back,
    // so they do not have to be re-entered for every analysis or browser.
    function exportConfig() {
      var payload = {
        version: 1,
        mappings: state.mappings.map(function (x) {
          return { trackKey: x.trackKey, song: x.song, artist: x.artist };
        }),
        artistMerges: state.artistMerges.map(function (m) {
          return { from: m.from, into: m.into };
        })
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: 'scrobblestats-feats.json' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      statusEl.textContent = 'Exported ' + num(state.mappings.length) + ' relationship(s).';
    }

    function loadConfig(file) {
      if (!file) return;
      file.text().then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          statusEl.textContent = 'That config file is not valid JSON.';
          return;
        }
        var list = Array.isArray(data) ? data : data && Array.isArray(data.mappings) ? data.mappings : null;
        if (!list) {
          statusEl.textContent = 'That config file has no "mappings" list.';
          return;
        }
        var added = 0;
        list.forEach(function (item) {
          if (!item || typeof item !== 'object') return;
          var artist = typeof item.artist === 'string' ? item.artist.trim() : '';
          if (!artist) return;
          var tk = typeof item.trackKey === 'string' ? item.trackKey : '';
          var song = typeof item.song === 'string' ? item.song : '';
          if (!tk) tk = state.songIndex.get(song) || '';
          if (!tk) return;
          var dup = state.mappings.some(function (x) {
            return x.trackKey === tk && nameKey(x.artist) === nameKey(artist);
          });
          if (dup) return;
          state.mappings.push({ trackKey: tk, song: song || tk, artist: artist });
          added++;
        });
        var mergesAdded = 0;
        if (Array.isArray(data.artistMerges)) {
          data.artistMerges.forEach(function (m) {
            if (!m || typeof m !== 'object') return;
            var from = typeof m.from === 'string' ? m.from.trim() : '';
            var into = typeof m.into === 'string' ? m.into.trim() : '';
            if (!from || !into || nameKey(from) === nameKey(into)) return;
            var dupMerge = state.artistMerges.some(function (x) {
              return nameKey(x.from) === nameKey(from) && nameKey(x.into) === nameKey(into);
            });
            if (dupMerge) return;
            state.artistMerges.push({ from: from, into: into });
            mergesAdded++;
          });
        }
        if (added || mergesAdded) {
          persist();
          renderMappingList(mapList);
          renderMergeList(mergeList);
          recompute();
        }
        statusEl.textContent = added || mergesAdded
          ? 'Loaded ' + num(added + mergesAdded) + ' setting(s) from the config.'
          : 'Nothing new found in that config.';
      }).catch(function (err) {
        statusEl.textContent = 'Could not read that config: ' + err.message;
      });
    }

    var importInput = h('input', { type: 'file', accept: '.json,application/json' });
    importInput.hidden = true;
    importInput.addEventListener('change', function () {
      loadConfig(importInput.files[0]);
    });
    var exportBtn = h('button', { type: 'button', class: 'btn-ghost', text: 'Export config', onClick: exportConfig });
    var importBtn = h('button', {
      type: 'button',
      class: 'btn-ghost',
      text: 'Load config',
      onClick: function () {
        importInput.value = '';
        importInput.click();
      }
    });

    controlsEl.appendChild(
      h('div', { class: 'control' }, [
        featsChk,
        h('label', { for: 'opt-feats' }, [
          'Attribute features automatically ',
          h('span', { class: 'control-hint', text: '(splits "(feat. X)" between both artists without double counting)' })
        ])
      ])
    );
    controlsEl.appendChild(
      h('div', { class: 'control' }, [
        consolidateChk,
        h('label', { for: 'opt-consolidate' }, [
          'Consolidate singles into albums ',
          h('span', { class: 'control-hint', text: '(counts a single\'s plays under its album)' })
        ])
      ])
    );
    controlsEl.appendChild(
      h('div', { class: 'control' }, [
        h('span', { class: 'control-label', text: 'Time range' }),
        periodSel,
        monthWrap,
        customWrap
      ])
    );
    controlsEl.appendChild(
      h('div', { class: 'control' }, [
        h('span', { class: 'control-label', text: 'Feature plays in rankings' }),
        featDisplaySel
      ])
    );
    controlsEl.appendChild(
      h('div', { class: 'control-mapping' }, [
        h('p', { class: 'control-title', text: 'Credit an artist by hand' }),
        h('p', { class: 'control-hint', text: 'Pick a track from your data and the artist that should count for it too. Choose from the list or type a new one.' }),
        h('div', { class: 'control' }, [songCombo.el, artistCombo.el, addBtn]),
        h('div', { class: 'control' }, [
          h('span', { class: 'control-label', text: 'Config file' }),
          exportBtn,
          importBtn,
          importInput
        ]),
        h('p', { class: 'control-hint', text: 'Export your manual relationships and artist merges to a JSON file and load it back in any analysis or browser.' }),
        mapList
      ])
    );

    var artistIndex = new Map();
    state.baseline.topArtists.forEach(function (a) {
      if (!artistIndex.has(nameKey(a.name))) artistIndex.set(nameKey(a.name), a.name);
    });
    var artistNames = state.baseline.topArtists.map(function (a) { return a.name; });
    var mergeFromCombo = buildCombo({ type: 'text', id: 'merge-from', placeholder: 'Artist...' }, artistNames, addMerge);
    var mergeIntoCombo = buildCombo({ type: 'text', id: 'merge-into', placeholder: '...same artist' }, artistNames, addMerge);
    var mergeFrom = mergeFromCombo.input;
    var mergeInto = mergeIntoCombo.input;
    var mergeList = h('ul', { class: 'mapping-list' });
    var mergeBtn = h('button', { type: 'button', class: 'btn', text: 'Unify', onClick: addMerge });

    function resolveArtist(value) {
      var typed = String(value || '').trim();
      return typed ? artistIndex.get(nameKey(typed)) || '' : '';
    }

    function addMerge() {
      var from = resolveArtist(mergeFrom.value);
      var into = resolveArtist(mergeInto.value);
      if (!from || !into) {
        statusEl.textContent = 'Pick both artists from the list.';
        return;
      }
      if (nameKey(from) === nameKey(into)) return;
      var dup = state.artistMerges.some(function (m) {
        return nameKey(m.from) === nameKey(from) && nameKey(m.into) === nameKey(into);
      });
      if (!dup) {
        state.artistMerges.push({ from: from, into: into });
        persist();
        renderMergeList(mergeList);
        recompute();
      }
      mergeFrom.value = '';
      mergeInto.value = '';
      statusEl.textContent = '';
    }

    function renderMergeList(ul) {
      clear(ul);
      if (!state.artistMerges.length) {
        ul.appendChild(h('li', { class: 'mapping-empty', text: 'No unified artists yet.' }));
        return;
      }
      state.artistMerges.forEach(function (m, idx) {
        ul.appendChild(h('li', {}, [
          h('span', { class: 'mapping-text' }, [h('strong', { text: m.from }), ' is the same as ', h('strong', { text: m.into })]),
          h('button', {
            type: 'button',
            class: 'btn-ghost',
            text: 'Remove',
            onClick: function () {
              state.artistMerges.splice(idx, 1);
              persist();
              renderMergeList(ul);
              recompute();
            }
          })
        ]));
      });
    }
    renderMergeList(mergeList);

    controlsEl.appendChild(
      h('div', { class: 'control-mapping' }, [
        h('p', { class: 'control-title', text: 'Unify two artists' }),
        h('p', { class: 'control-hint', text: 'Pick two names that are the same artist (for example "Lara" and "Lara Ivanova"); their plays are counted together.' }),
        h('div', { class: 'control' }, [
          mergeFromCombo.el,
          h('span', { class: 'control-label', text: 'is the same as' }),
          mergeIntoCombo.el,
          mergeBtn
        ]),
        h('p', { class: 'control-hint', text: 'Saved with your settings and included in Export config.' }),
        mergeList
      ])
    );
  }

  /* Result items */

  function artistItems(stats) {
    var mode = state.settings.featureDisplay || 'combined';
    var list = stats.topArtists.slice();
    if (mode === 'hidden') {
      list.sort(function (a, b) { return b.asPrimary - a.asPrimary || (a.name < b.name ? -1 : 1); });
    }
    return list.map(function (a) {
      if (mode === 'hidden') return { label: a.name, value: a.asPrimary };
      if (mode === 'separate') {
        return {
          label: a.name,
          value: a.plays,
          segments: [{ value: a.asPrimary }, { value: a.asFeatured, cls: 'feature' }],
          sub: a.asFeatured ? a.asPrimary + ' main, ' + a.asFeatured + ' as feature' : a.asPrimary + ' main',
          badge: a.asFeatured ? '+' + a.asFeatured + ' feature' : null
        };
      }
      return { label: a.name, value: a.plays };
    });
  }

  function trackItems(stats) {
    return stats.topTracks.map(function (t) { return { label: t.title, value: t.plays, sub: t.artist }; });
  }

  function albumItems(stats) {
    return stats.topAlbums.map(function (a) {
      return { label: a.album, value: a.plays, sub: a.artist, badge: a.versions > 1 ? '(' + a.versions + ' versions)' : null };
    });
  }

  function featureItems(stats) {
    return stats.topFeatured.map(function (f) {
      return { label: f.name, value: f.asFeatured, sub: num(f.plays) + ' plays in total' };
    });
  }

  /* Share image data */

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function allTimeStats() {
    if (!allTimeCache) allTimeCache = computeStats(state.parsed.scrobbles, statsOptions());
    return allTimeCache;
  }

  // The share card keeps range labels short: a Spotify year reads "Dec 2025 to Nov 2026"
  // rather than repeating the "Spotify year" wording that the picker needs.
  function shareRangeLabel(range) {
    if (!range || range.mode === 'all') return 'all time';
    if (range.mode === 'spotifyyear') return 'Dec ' + (range.year - 1) + ' to Nov ' + range.year;
    return rangeLabel(range);
  }

  function shareItem(it) {
    return { label: it.label, sub: it.sub, value: it.value, segments: it.segments };
  }

  // Builds the card data for one share image. The kind, count and range come from the
  // share dialog; the shaped lists reuse the panel item builders so the image follows the
  // same feature settings as the page.
  function shareData(kind, count, rangeMode) {
    var stats = rangeMode === 'all' ? allTimeStats() : state.stats;
    var total = rangeMode === 'all' ? state.parsed.scrobbles.length : state.meta.inRange;
    var label = capitalize(rangeMode === 'all' ? 'all time' : shareRangeLabel(state.range));
    var card = {
      layout: 'list',
      title: '',
      subtitle: label,
      footRight: num(total) + ' scrobbles',
      sections: [],
      summary: null
    };

    function items(list) { return list.map(shareItem); }
    function take(list, k) { return list.slice(0, k); }

    if (kind === 'overview') {
      card.layout = 'overview';
      card.title = 'Your listening';
      var cells = [
        { value: num(stats.uniqueArtists), label: 'artists' },
        { value: num(stats.uniqueTracks), label: 'tracks' },
        { value: num(stats.uniqueAlbums), label: 'albums' },
        { value: num(stats.activeDays), label: 'days with music' }
      ];
      if (stats.withDate && stats.longestStreak && stats.longestStreak.days) {
        cells.push({ value: String(stats.longestStreak.days), label: 'day streak' });
      }
      if (stats.withDate && stats.peakDay) {
        cells.push({ value: num(stats.peakDay.count), label: 'busiest day' });
      }
      card.summary = { total: num(total), totalLabel: 'scrobbles', cells: cells };
      card.sections = [{ heading: 'Top artists', items: take(items(artistItems(stats)), 5) }];
      card.footRight = '';
    } else if (kind === 'artists') {
      card.title = 'Top ' + count + ' artists';
      card.sections = [{ heading: null, items: take(items(artistItems(stats)), count) }];
    } else if (kind === 'tracks') {
      card.title = 'Top ' + count + ' tracks';
      card.sections = [{ heading: null, items: take(items(trackItems(stats)), count) }];
    } else if (kind === 'albums') {
      card.title = 'Top ' + count + ' albums';
      card.sections = [{ heading: null, items: take(items(albumItems(stats)), count) }];
    } else if (kind === 'artistsTracks') {
      card.layout = 'split';
      card.title = 'Artists and tracks';
      card.sections = [
        { heading: 'Artists', items: take(items(artistItems(stats)), count) },
        { heading: 'Tracks', items: take(items(trackItems(stats)), count) }
      ];
    } else if (kind === 'albumsArtists') {
      card.layout = 'split';
      card.title = 'Albums and artists';
      card.sections = [
        { heading: 'Albums', items: take(items(albumItems(stats)), count) },
        { heading: 'Artists', items: take(items(artistItems(stats)), count) }
      ];
    }
    return card;
  }

  /* Panels */

  function artistSub() {
    var mode = state.settings.featureDisplay || 'combined';
    if (mode === 'hidden') return 'Feature plays are hidden here, so only main artist plays count in this ranking.';
    if (mode === 'separate') return 'Each bar is split: the first part is main artist plays and the lighter part is feature plays.';
    return state.settings.feats !== false
      ? 'Total plays per artist. Features are included in the totals but are not marked.'
      : 'Automatic feature attribution is off, so only the main artist counts.';
  }

  function panelOverview(stats) {
    var nodes = [];
    nodes.push(h('section', { class: 'summary' }, [
      statCard(num(stats.total), 'scrobbles'),
      statCard(num(stats.uniqueArtists), 'artists'),
      statCard(num(stats.uniqueTracks), 'tracks'),
      statCard(num(stats.uniqueAlbums), 'albums'),
      statCard(num(stats.activeDays), 'days with music'),
      statCard(num(Math.round(stats.avgPerActiveDay)), 'average per day')
    ]));
    if (stats.byYear.length > 1) nodes.push(card('Your music by year', null, yearChart(stats.byYear)));
    if (stats.withDate) {
      var streak = stats.longestStreak;
      nodes.push(card('Streaks and peaks', null, h('div', { class: 'facts' }, [
        h('div', { class: 'fact' }, [
          h('span', { class: 'fact-value', text: String(streak.days || 0) }),
          h('span', { class: 'fact-label', text: 'days in a row' }),
          h('span', { class: 'fact-sub', text: streak.days ? fmtDate(streak.from) + ' to ' + fmtDate(streak.to) : '' })
        ]),
        h('div', { class: 'fact' }, [
          h('span', { class: 'fact-value', text: stats.peakDay ? num(stats.peakDay.count) : '?' }),
          h('span', { class: 'fact-label', text: 'your busiest day' }),
          h('span', { class: 'fact-sub', text: stats.peakDay ? fmtDate(stats.peakDay.ts) : '' })
        ])
      ])));
    }
    nodes.push(card(
      'Minutes listened',
      'Coming soon: track durations from MusicBrainz (one request per second, cached).',
      h('p', { class: 'pending', text: 'Not implemented yet' })
    ));
    return nodes;
  }

  function panelArtists(stats) {
    if (!stats.topArtists.length) return [h('p', { class: 'pending', text: 'No artists in this range.' })];
    return [card('Most played artists', artistSub(), paginated(artistItems(stats), 'artists'))];
  }

  function panelTracks(stats) {
    if (!stats.topTracks.length) return [h('p', { class: 'pending', text: 'No tracks in this range.' })];
    return [card('Most played tracks', null, paginated(trackItems(stats), 'tracks'))];
  }

  function panelAlbums(stats) {
    if (!stats.topAlbums.length) return [h('p', { class: 'pending', text: 'No albums in this range.' })];
    var sub = state.settings.consolidateSingles ? 'Singles are counted under their album, and single-only releases are hidden.' : null;
    return [card('Most played albums', sub, paginated(albumItems(stats), 'albums'))];
  }

  function panelFeatures(stats) {
    if ((state.settings.featureDisplay || 'combined') === 'hidden') {
      return [h('p', { class: 'pending', text: 'Feature plays are hidden. Choose "Shown separately" or "Combined" above to see them.' })];
    }
    if (!stats.topFeatured.length) return [h('p', { class: 'pending', text: 'No feature credits detected in this range.' })];
    return [card(
      'Features: who guests most',
      'Plays credited to an artist for appearing as a feature, whether detected or added by hand.',
      paginated(featureItems(stats), 'features')
    )];
  }

  function panelTime(stats) {
    if (!stats.withDate) return [h('p', { class: 'pending', text: 'No dates in this file, so the time statistics are unavailable.' })];
    return [
      card('When you listen', null, stripBars(
        stats.byHour,
        stats.byHour.map(function (_, i) { return i % 3 === 0 ? String(i).padStart(2, '0') : ''; }),
        stats.byHour.map(function (_, i) { return String(i).padStart(2, '0') + ':00'; })
      )),
      card('Your week', null, stripBars(stats.byWeekday, WEEKDAYS_SHORT, WEEKDAYS))
    ];
  }

  /* Render */

  function render() {
    clear(resultsEl);
    resultsEl.hidden = false;
    var stats = state.stats;
    var meta = state.meta;
    var total = state.parsed.scrobbles.length;
    var nodes = [];

    if (state.parsed.warnings && state.parsed.warnings.length) {
      nodes.push(h('div', { class: 'warnings' }, state.parsed.warnings.map(function (w) { return h('p', { text: w }); })));
    }

    var shareBtn = SS.share && stats.total
      ? h('button', {
          type: 'button',
          class: 'btn-ghost share-open',
          text: 'Create share image',
          onClick: function (e) { SS.share.open(shareData, e.currentTarget); }
        })
      : null;

    nodes.push(h('div', { class: 'results-meta' }, [
      h('p', { class: 'range' }, [
        'Period: ' + rangeLabel(state.range) + ' | showing ' + num(meta.inRange) + ' of ' + num(total) + ' scrobbles' +
          (meta.ms ? ' | calculated in ' + Math.round(meta.ms) + ' ms' : '')
      ]),
      shareBtn
    ]));

    if (!stats.total) {
      nodes.push(h('p', { class: 'pending', text: 'No scrobbles in that range. Try another period.' }));
      nodes.forEach(function (n) { resultsEl.appendChild(n); });
      return;
    }

    var tabBar = h('div', { class: 'tabs' }, TABS.map(function (t) {
      return h('button', {
        type: 'button',
        class: 'tab' + (state.tab === t.id ? ' active' : ''),
        text: t.label,
        onClick: function () { state.tab = t.id; render(); }
      });
    }));
    nodes.push(tabBar);

    var panelNodes;
    if (state.tab === 'artists') panelNodes = panelArtists(stats);
    else if (state.tab === 'tracks') panelNodes = panelTracks(stats);
    else if (state.tab === 'albums') panelNodes = panelAlbums(stats);
    else if (state.tab === 'features') panelNodes = panelFeatures(stats);
    else if (state.tab === 'time') panelNodes = panelTime(stats);
    else panelNodes = panelOverview(stats);

    var panel = h('div', { class: 'panel' }, panelNodes);
    nodes.push(panel);

    nodes.forEach(function (n) { resultsEl.appendChild(n); });
  }

  /* Flow */

  function statsOptions() {
    return {
      feats: state.settings.feats,
      mapping: buildMappingMap(),
      artistMap: buildArtistMap(),
      albumMap: state.settings.consolidateSingles ? state.albumConsolidation : null,
      albumVersions: state.settings.consolidateSingles ? state.albumVersions : null,
      hideSingles: state.settings.consolidateSingles === true
    };
  }

  function recompute() {
    if (!state.parsed) return;
    allTimeCache = null;
    statusEl.textContent = 'Recalculating...';
    setTimeout(function () {
      var t0 = performance.now();
      var filtered = filterByRange(state.parsed.scrobbles, state.range);
      state.stats = computeStats(filtered, statsOptions());
      state.meta = { ms: performance.now() - t0, inRange: filtered.length };
      render();
      statusEl.textContent = '';
    }, 0);
  }

  function handleFile(file) {
    if (!file) return;
    statusEl.textContent = 'Reading ' + file.name + '...';
    file.text().then(function (text) {
      statusEl.textContent = 'Analysing...';
      return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
        state.parsed = readCSV(text, file.name);
        if (!state.parsed.scrobbles.length) {
          statusEl.textContent = 'The file did not contain any readable scrobbles.';
          return;
        }
        state.albumConsolidation = SS.buildAlbumConsolidation(state.parsed.scrobbles);
        state.albumVersions = SS.buildAlbumVersions(state.parsed.scrobbles);
        state.baseline = computeStats(state.parsed.scrobbles, { feats: true, mapping: buildMappingMap() });
        indexSongs();
        state.tab = 'overview';
        state.page = {};
        buildControls();
        recompute();
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).catch(function (err) {
      statusEl.textContent = 'Error reading the file: ' + err.message;
    });
  }

  /* Start up */

  function init() {
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('file');
    statusEl = document.getElementById('status');
    controlsEl = document.getElementById('controls');
    resultsEl = document.getElementById('results');

    fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });

    ['dragenter', 'dragover'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('dragover'); });
    });
    dropzone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    // The label already opens the picker on click. This covers the keyboard.
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
  }

  // Exposed for tests.
  SS.rangeBounds = rangeBounds;
  SS.filterByRange = filterByRange;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
