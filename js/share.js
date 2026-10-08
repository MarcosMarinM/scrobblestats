// Share image: draws a 1080x1920 story card to a canvas and downloads it as a PNG.
// Plain script. It owns the drawing and the options dialog; js/app.js supplies the
// data through the function passed to SS.share.open.
(function (global) {
  'use strict';
  var SS = (global.SS = global.SS || {});

  var W = 1080;
  var H = 1920;
  var M = 88;
  var CW = W - M * 2;
  var SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';
  var SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var nf = new Intl.NumberFormat('en-GB');

  var THEMES = {
    paper: {
      bg: '#f5f1e8', ink: '#1c1a16', muted: '#6b6252',
      line: '#ddd4c2', rule: '#1c1a16', kicker: '#b3271d',
      accent: '#b3271d', track: '#e7e0d1', feature: '#b0741a'
    },
    ink: {
      bg: '#16140f', ink: '#f3efe6', muted: '#988f7c',
      line: '#38331f', rule: '#f3efe6', kicker: '#e2543f',
      accent: '#e2543f', track: '#2c281f', feature: '#d9a441'
    },
    red: {
      bg: '#b3271d', ink: '#fbeee9', muted: '#e7bcb4',
      line: '#c9645c', rule: '#fbeee9', kicker: '#fbeee9',
      accent: '#fbeee9', track: '#a8211a', feature: '#f2cf8f'
    }
  };

  var KINDS = [
    { id: 'overview', label: 'Overview' },
    { id: 'artists', label: 'Top artists' },
    { id: 'tracks', label: 'Top tracks' },
    { id: 'albums', label: 'Top albums' },
    { id: 'artistsTracks', label: 'Artists and tracks' },
    { id: 'albumsArtists', label: 'Albums and artists' }
  ];

  var st = { kind: 'artists', count: 10, range: 'current', theme: 'paper', getData: null, data: null };
  var dialog = null;
  var canvas = null;
  var ctx = null;
  var countField = null;
  var opener = null;

  /* Canvas helpers */

  function font(c, weight, size, family) {
    c.font = weight + ' ' + Math.round(size) + 'px ' + family;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function spaced(c, str, x, y, sp) {
    if (c.letterSpacing !== undefined) {
      c.letterSpacing = sp + 'px';
      c.fillText(str, x, y);
      c.letterSpacing = '0px';
      return;
    }
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      c.fillText(str[i], cx, y);
      cx += c.measureText(str[i]).width + sp;
    }
  }

  function truncate(c, str, max) {
    str = String(str == null ? '' : str);
    if (c.measureText(str).width <= max) return str;
    var ell = '\u2026';
    var lo = 0;
    var hi = str.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (c.measureText(str.slice(0, mid) + ell).width <= max) lo = mid + 1;
      else hi = mid;
    }
    return str.slice(0, Math.max(0, lo - 1)) + ell;
  }

  // Wraps text into at most maxLines lines. Returns the lines plus whether the whole string
  // fitted. Only the final line is ever ellipsised, and only when it genuinely has to be.
  function wrap2(c, str, max, maxLines) {
    var words = String(str == null ? '' : str).split(' ');
    var lines = [];
    var cur = '';
    var start = 0;
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (!cur) {
        start = i;
        cur = test;
      } else if (c.measureText(test).width <= max) {
        cur = test;
      } else {
        lines.push({ text: cur, start: start });
        cur = words[i];
        start = i;
      }
    }
    if (cur) lines.push({ text: cur, start: start });

    var out = [];
    var full = lines.length <= maxLines;
    if (full) {
      for (var j = 0; j < lines.length; j++) out.push(lines[j].text);
    } else {
      for (var k = 0; k < maxLines - 1; k++) out.push(lines[k].text);
      out.push(truncate(c, words.slice(lines[maxLines - 1].start).join(' '), max));
    }
    return { lines: out, full: full };
  }

  function wrap(c, str, max, maxLines) {
    return wrap2(c, str, max, maxLines).lines;
  }

  function roundPath(c, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    c.beginPath();
    if (c.roundRect) {
      c.roundRect(x, y, w, h, r);
      return;
    }
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBar(c, x, y, w, h, ratio, segments, t) {
    var r = h / 2;
    roundPath(c, x, y, w, h, r);
    c.fillStyle = t.track;
    c.fill();
    if (!(ratio > 0)) return;
    var fillW = Math.max(h * 0.9, ratio * w);
    if (fillW > w) fillW = w;
    c.save();
    roundPath(c, x, y, fillW, h, r);
    c.clip();
    if (segments && segments.length) {
      var sum = 0;
      var i;
      for (i = 0; i < segments.length; i++) sum += segments[i].value;
      if (!sum) sum = 1;
      var sx = x;
      for (i = 0; i < segments.length; i++) {
        var sw = fillW * (segments[i].value / sum);
        c.fillStyle = segments[i].cls === 'feature' ? t.feature : t.accent;
        c.fillRect(sx, y, sw, h);
        sx += sw;
      }
    } else {
      c.fillStyle = t.accent;
      c.fillRect(x, y, fillW, h);
    }
    c.restore();
  }

  function drawEmpty(c, t, x, y) {
    font(c, 400, 36, SANS);
    c.fillStyle = t.muted;
    c.fillText('No data in this range.', x, y);
  }

  // A ranked list. Names wrap onto as many lines as a row allows, a row gives up its subtitle
  // before it truncates a name, and the whole list shares one name size chosen so that the
  // longest name still fits. Only names that cannot fit even at the floor are ellipsised.
  // opts: { showSub, rankW, maxName, maxVal, maxLines }
  function drawList(c, items, t, x, yTop, yBottom, width, opts) {
    if (!items || !items.length) {
      drawEmpty(c, t, x, yTop);
      return;
    }
    var n = items.length;
    var rowH = (yBottom - yTop) / n;
    var max = 0;
    for (var k = 0; k < n; k++) max = Math.max(max, items[k].value || 0);
    if (!max) max = 1;
    var rankW = Math.min(opts.rankW, 46 + 16 * String(n).length);
    var nameX = x + rankW;
    var rightX = x + width;
    var barH = 8;
    var barGap = 16;
    var lineCap = opts.maxLines || 3;

    var valSize = clamp(rowH * 0.27, 20, opts.maxVal);
    var subSize = clamp(rowH * 0.19, 16, 26);
    var rankSize = clamp(rowH * 0.32, 20, opts.maxVal);
    var subRoom = subSize + 12 + barGap + barH + 20 <= rowH;

    function nameWidthOf(item) {
      font(c, 700, valSize, SANS);
      return Math.max(40, rightX - nameX - c.measureText(nf.format(item.value || 0)).width - 22);
    }

    // Layouts one name at a given size, dropping the subtitle for an extra line if that helps.
    function layout(label, nameMax, size, wantsSub) {
      var lh = Math.round(size * 1.16);
      var sub = wantsSub;
      var fit = Math.max(1, Math.min(lineCap, Math.floor((rowH - barGap - barH - (sub ? subSize + 12 : 0) - 2) / lh)));
      font(c, 600, size, SERIF);
      var res = wrap2(c, label, nameMax, fit);
      if (!res.full && sub) {
        var fitNo = Math.max(1, Math.min(lineCap, Math.floor((rowH - barGap - barH - 2) / lh)));
        if (fitNo > fit) {
          var resNo = wrap2(c, label, nameMax, fitNo);
          if (resNo.lines.length > res.lines.length) { res = resNo; sub = false; }
        }
      }
      return { lh: lh, lines: res.lines, sub: sub, full: res.full };
    }

    var baseSize = clamp(rowH * 0.29, 20, opts.maxName);
    var floorSize = Math.max(20, Math.round(baseSize * 0.72));
    var sizes = [];
    for (var s = baseSize; ; s = Math.max(floorSize, Math.round(s * 0.9))) {
      sizes.push(s);
      if (s <= floorSize) break;
    }

    // One name size for the whole list: the largest that still lets every name fit. A name too
    // long to fit even at the floor is left out of the vote so it does not shrink the others.
    var nameSize = baseSize;
    var anyFit = false;
    for (var q = 0; q < n; q++) {
      var qItem = items[q];
      var qMax = nameWidthOf(qItem);
      var qWants = !!(opts.showSub && qItem.sub) && subRoom;
      for (var si = 0; si < sizes.length; si++) {
        if (layout(qItem.label, qMax, sizes[si], qWants).full) {
          anyFit = true;
          if (sizes[si] < nameSize) nameSize = sizes[si];
          break;
        }
      }
    }
    if (!anyFit) nameSize = floorSize;

    for (var i = 0; i < n; i++) {
      var it = items[i];
      var rt = yTop + i * rowH;
      if (i > 0) {
        c.fillStyle = t.line;
        c.fillRect(x, rt, width, 2);
      }

      var nameMax = nameWidthOf(it);
      var hasSub = !!(opts.showSub && it.sub) && subRoom;
      var lay = layout(it.label, nameMax, nameSize, hasSub);
      var lines = lay.lines;
      var lineHeight = lay.lh;
      hasSub = lay.sub;

      var valText = nf.format(it.value || 0);
      var nameBlockH = lines.length * lineHeight;
      var gap = barGap;
      var contentH = nameBlockH + (hasSub ? subSize + 12 : 0) + gap + barH;
      if (contentH > rowH) {
        if (hasSub) { hasSub = false; contentH = nameBlockH + gap + barH; }
        if (contentH > rowH) { gap = Math.max(4, rowH - nameBlockH - barH); contentH = nameBlockH + gap + barH; }
      }
      var top = rt + Math.max(2, (rowH - contentH) / 2);

      // Rank, lined up with the first name line.
      font(c, 700, rankSize, SANS);
      c.fillStyle = t.accent;
      c.textAlign = 'end';
      c.fillText(String(i + 1), x + rankW - 22, top + Math.max(0, (nameSize - rankSize) / 2));
      c.textAlign = 'start';

      // Name, wrapped onto one or more lines.
      font(c, 600, nameSize, SERIF);
      c.fillStyle = t.ink;
      var ly = top;
      for (var l = 0; l < lines.length; l++) {
        c.fillText(truncate(c, lines[l], nameMax), nameX, ly);
        ly += lineHeight;
      }

      // Subtitle.
      if (hasSub) {
        font(c, 400, subSize, SANS);
        c.fillStyle = t.muted;
        c.fillText(truncate(c, it.sub, rightX - nameX), nameX, ly + 1);
        ly += subSize + 12;
      }

      // Value, lined up with the first name line.
      font(c, 700, valSize, SANS);
      c.fillStyle = t.ink;
      c.textAlign = 'end';
      c.fillText(valText, rightX, top + Math.max(0, (nameSize - valSize) / 2));
      c.textAlign = 'start';

      // Bar.
      drawBar(c, nameX, ly + gap, rightX - nameX, barH, it.value / max, it.segments, t);
    }
  }

  function drawSplit(c, card, t, yTop, yBottom) {
    var gap = 64;
    var colW = (CW - gap) / 2;
    for (var s = 0; s < card.sections.length; s++) {
      var colX = M + s * (colW + gap);
      var y = yTop;
      font(c, 700, 28, SANS);
      c.fillStyle = t.kicker;
      spaced(c, String(card.sections[s].heading || '').toUpperCase(), colX, y, 6);
      y += 28 + 20;
      c.fillStyle = t.rule;
      c.fillRect(colX, y, colW, 4);
      y += 4 + 26;
      drawList(c, card.sections[s].items, t, colX, y, yBottom, colW, {
        showSub: false, rankW: 52, maxName: 40, maxVal: 34, maxLines: 3
      });
    }
  }

  function drawOverview(c, card, t, yTop, yBottom) {
    var s = card.summary || { total: '0', totalLabel: 'scrobbles', cells: [] };
    var x = M;
    var y = yTop;

    var heroSize = 190;
    font(c, 600, heroSize, SERIF);
    var heroW = c.measureText(s.total).width;
    if (heroW > CW) {
      heroSize = Math.max(96, Math.floor(heroSize * (CW / heroW)));
      font(c, 600, heroSize, SERIF);
    }
    c.fillStyle = t.ink;
    c.fillText(s.total, x, y);
    y += heroSize + 4;

    font(c, 700, 32, SANS);
    c.fillStyle = t.kicker;
    spaced(c, String(s.totalLabel || 'scrobbles').toUpperCase(), x, y, 8);
    y += 32 + 46;

    var cells = s.cells || [];
    var cols = 3;
    var rows = Math.max(1, Math.ceil(cells.length / cols));
    var cellH = 112;
    var colW = CW / cols;
    var gridH = rows * cellH;

    // Ledger dividers
    c.fillStyle = t.line;
    for (var d = 1; d < cols; d++) c.fillRect(x + d * colW - 1, y + 6, 2, gridH - 12);
    for (var r = 1; r < rows; r++) c.fillRect(x, y + r * cellH - 1, CW, 2);

    for (var i = 0; i < cells.length; i++) {
      var cx = x + (i % cols) * colW;
      var cy = y + Math.floor(i / cols) * cellH + 22;
      font(c, 700, 48, SANS);
      c.fillStyle = t.ink;
      c.fillText(cells[i].value, cx, cy);
      font(c, 700, 22, SANS);
      c.fillStyle = t.muted;
      spaced(c, String(cells[i].label).toUpperCase(), cx, cy + 58, 2);
    }
    y += gridH + 20;

    c.fillStyle = t.line;
    c.fillRect(x, y, CW, 2);
    y += 42;

    var sec = card.sections[0];
    if (sec) {
      font(c, 700, 28, SANS);
      c.fillStyle = t.kicker;
      spaced(c, String(sec.heading || '').toUpperCase(), x, y, 6);
      y += 28 + 24;
      drawList(c, sec.items, t, x, y, yBottom, CW, {
        showSub: false, rankW: 72, maxName: 54, maxVal: 44, maxLines: 4
      });
    }
  }

  function drawCard(c, card, t) {
    c.save();
    c.textBaseline = 'top';
    c.textAlign = 'start';
    c.fillStyle = t.bg;
    c.fillRect(0, 0, W, H);

    var x = M;
    var y = M;

    // Nameplate rule
    c.fillStyle = t.rule;
    c.fillRect(x, y, CW, 8);
    y += 8 + 40;

    // Kicker
    font(c, 700, 30, SANS);
    c.fillStyle = t.kicker;
    spaced(c, 'SCROBBLESTATS', x, y, 9);
    y += 30 + 26;

    // Title
    var titleSize = 104;
    font(c, 600, titleSize, SERIF);
    c.fillStyle = t.ink;
    var tl = wrap(c, card.title, CW, 2);
    for (var i = 0; i < tl.length; i++) {
      c.fillText(tl[i], x, y);
      y += Math.round(titleSize * 1.06);
    }
    y += 10;

    // Range line
    font(c, 400, 38, SANS);
    c.fillStyle = t.muted;
    var sl = wrap(c, card.subtitle, CW, 2);
    for (var j = 0; j < sl.length; j++) {
      c.fillText(sl[j], x, y);
      y += Math.round(38 * 1.3);
    }
    y += 20;

    // Hairline
    c.fillStyle = t.line;
    c.fillRect(x, y, CW, 2);
    y += 46;

    var bodyBottom = H - M - 120;

    if (card.layout === 'overview' && card.summary) drawOverview(c, card, t, y, bodyBottom);
    else if (card.layout === 'split') drawSplit(c, card, t, y, bodyBottom);
    else drawList(c, card.sections[0] ? card.sections[0].items : [], t, x, y, bodyBottom, CW, {
      showSub: true, rankW: 92, maxName: 62, maxVal: 48, maxLines: 4
    });

    // Footer
    c.fillStyle = t.line;
    c.fillRect(x, bodyBottom + 40, CW, 2);
    var fy = bodyBottom + 40 + 26;
    font(c, 600, 34, SERIF);
    c.fillStyle = t.ink;
    c.fillText('ScrobbleStats', x, fy);
    c.fillStyle = t.accent;
    c.fillText('.', x + c.measureText('ScrobbleStats').width, fy);
    if (card.footRight) {
      font(c, 700, 26, SANS);
      c.fillStyle = t.muted;
      c.textAlign = 'end';
      spaced(c, String(card.footRight).toUpperCase(), x + CW, fy + 8, 3);
      c.textAlign = 'start';
    }
    c.restore();
  }

  /* Dialog */

  function el(tag, attrs, children) {
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
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child == null || child === false) return;
        node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
      });
    }
    return node;
  }

  function segmented(name, options, get, set) {
    var wrap = el('div', { class: 'seg', role: 'group', 'aria-label': name });
    var buttons = options.map(function (o) {
      var b = el('button', { type: 'button', text: o.label });
      b.addEventListener('click', function () {
        set(o.value);
        sync();
        refresh();
      });
      wrap.appendChild(b);
      return { el: b, value: o.value };
    });
    function sync() {
      buttons.forEach(function (b) {
        b.el.setAttribute('aria-pressed', String(get() === b.value));
      });
    }
    sync();
    return wrap;
  }

  function fieldSelect(labelText, id, value, options, onChange) {
    var sel = el('select', { id: id });
    options.forEach(function (o) {
      sel.appendChild(el('option', { value: o.value }, o.label));
    });
    sel.value = value;
    sel.addEventListener('change', function () {
      onChange(sel.value);
      refresh();
    });
    return el('div', { class: 'share-field' }, [
      el('label', { class: 'share-label', for: id, text: labelText }),
      sel
    ]);
  }

  function fieldGroup(labelText, control) {
    return el('div', { class: 'share-field' }, [
      el('span', { class: 'share-label', text: labelText }),
      control
    ]);
  }

  function ensureDialog() {
    if (dialog) return;
    canvas = el('canvas', { width: W, height: H, role: 'img', class: 'share-canvas', 'aria-label': 'Share image preview' });
    ctx = canvas.getContext('2d');
    if (ctx) ctx.imageSmoothingEnabled = true;

    countField = fieldGroup('Items', segmented('Number of items', [
      { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 15, label: '15' },
      { value: 20, label: '20' }, { value: 25, label: '25' }
    ], function () { return st.count; }, function (v) { st.count = v; }));

    var body = el('div', { class: 'share-body' }, [
      el('div', { class: 'share-preview' }, canvas),
      el('div', { class: 'share-options' }, [
        fieldSelect('Show', 'share-kind', st.kind, KINDS.map(function (k) {
          return { value: k.id, label: k.label };
        }), function (v) { st.kind = v; syncCountVisibility(); }),
        countField,
        fieldGroup('Range', segmented('Time range', [
          { value: 'current', label: 'This range' }, { value: 'all', label: 'All time' }
        ], function () { return st.range; }, function (v) { st.range = v; })),
        fieldGroup('Style', segmented('Style', [
          { value: 'paper', label: 'Paper' }, { value: 'ink', label: 'Ink' }, { value: 'red', label: 'Red' }
        ], function () { return st.theme; }, function (v) { st.theme = v; }))
      ])
    ]);

    var exportBtn = el('button', { type: 'button', class: 'btn share-export', text: 'Download PNG', onClick: exportPng });

    dialog = el('dialog', { class: 'share', 'aria-labelledby': 'share-title' }, [
      el('div', { class: 'share-head' }, [
        el('h2', { id: 'share-title', text: 'Create a share image' }),
        el('button', { type: 'button', class: 'btn-ghost share-close', text: 'Close', onClick: function () { dialog.close(); } })
      ]),
      body,
      el('div', { class: 'share-foot' }, [
        el('p', { class: 'share-note', text: 'A story sized PNG, 1080 by 1920, drawn in your browser.' }),
        exportBtn
      ])
    ]);

    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', function () {
      if (opener && typeof opener.focus === 'function') opener.focus();
      opener = null;
    });

    document.body.appendChild(dialog);
  }

  function syncCountVisibility() {
    if (countField) countField.hidden = st.kind === 'overview';
  }

  function describe() {
    var d = st.data;
    if (!d) return 'Share image preview';
    return 'Share image preview: ' + d.title + '. ' + d.subtitle + '.';
  }

  function refresh() {
    if (!dialog || !ctx || !st.getData) return;
    st.data = st.getData(st.kind, st.count, st.range);
    drawCard(ctx, st.data, THEMES[st.theme] || THEMES.paper);
    canvas.setAttribute('aria-label', describe());
  }

  function fileName() {
    var base = 'scrobblestats-' + st.kind;
    if (st.kind === 'artists' || st.kind === 'tracks' || st.kind === 'albums') base += '-' + st.count;
    return base + '.png';
  }

  function exportPng() {
    if (!canvas) return;
    var done = function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: fileName() });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };
    if (canvas.toBlob) canvas.toBlob(done, 'image/png');
    else done(null);
  }

  function open(getData, trigger) {
    ensureDialog();
    st.getData = getData;
    opener = trigger || document.activeElement;
    syncCountVisibility();
    refresh();
    if (!dialog.open) dialog.showModal();
  }

  SS.share = { open: open, THEMES: THEMES };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
