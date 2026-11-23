(function () {
  'use strict';

  const root = document.getElementById('board');
  if (!root) return;

  const RADAR = (typeof window !== 'undefined' && window.RADAR) ? window.RADAR : null;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const neg = n < 0;
    const a = Math.abs(n);
    let out;
    if (a >= 1e9) out = (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) out = (a / 1e6).toFixed(2) + 'M';
    else if (a >= 1e3) out = (a / 1e3).toFixed(1) + 'K';
    else out = a.toFixed(0);
    return (neg ? '-' : '') + '$' + out;
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  function fmtNum(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toFixed(4);
  }

  function changeClass(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'neutral';
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'neutral';
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  if (!RADAR) {
    root.innerHTML = '<div class="empty-state">No radar data available.</div>';
    return;
  }

  const rows = Array.isArray(RADAR.rows) ? RADAR.rows : [];
  const live = Array.isArray(RADAR.live) ? RADAR.live : [];

  // State
  let sortKey = 'rank';
  let sortDir = 'asc';
  let filterText = '';
  let categoryFilter = 'all';
  let detailSlug = null;
  let returnHash = '';
  let showLive = true;

  // Elements
  const container = document.createElement('div');
  container.className = 'radar-app';
  root.appendChild(container);

  const categories = Array.from(new Set(rows.map(function (r) { return r && r.category; }).filter(Boolean))).sort();

  container.innerHTML = [
    '<header class="radar-header">',
    '  <div class="title-block">',
    '    <h1>Token Launch Radar</h1>',
    '    <p class="meta">As of ' + esc(RADAR.as_of) + ' &middot; ' + esc(RADAR.source) + ' &middot; Floor ' + fmtMoney(RADAR.floor_usd) +
    ' &middot; ' + rows.length + ' board rows &middot; ' + live.length + ' live</p>',
    '  </div>',
    '</header>',
    '<details class="model-panel" open>',
    '  <summary>Scoring model &amp; formula</summary>',
    '  <div class="model-body">',
    '    <p class="model-formula">implied_value_usd = TVL x base x growth x maturity, computed per protocol.</p>',
    '    <ul class="model-constants">',
    '      <li><strong>base_multiple</strong>: ' + esc(RADAR.model.base_multiple) + '</li>',
    '      <li><strong>growth_weight</strong>: ' + esc(RADAR.model.growth_weight) + ' (growth_pct clamped to ' + esc(RADAR.model.growth_floor) + '..' + esc(RADAR.model.growth_cap) + ')</li>',
    '      <li><strong>maturity</strong>: ' + esc(RADAR.model.maturity_floor) + '..1.0 over ' + esc(RADAR.model.maturity_days) + ' days</li>',
    '      <li><strong>unknown_age_days</strong>: ' + esc(RADAR.model.unknown_age_days) + ' (fallback when listed_at is missing)</li>',
    '    </ul>',
    '  </div>',
    '</details>',
    '<section class="controls">',
    '  <input id="search" type="search" placeholder="Search name, slug, category…" autocomplete="off" />',
    '  <select id="category"><option value="all">All categories</option></select>',
    '  <button id="live-toggle" type="button" class="btn">Hide live tokens</button>',
    '</section>',
    '<section class="board-wrap">',
    '  <div class="table-wrap">',
    '    <table class="board-table">',
    '      <thead id="board-head">',
    '        <tr>',
    '          <th data-key="rank" data-label="#" class="sortable num">#</th>',
    '          <th data-key="name" data-label="Name" class="sortable">Name</th>',
    '          <th data-key="category" data-label="Category" class="sortable">Category</th>',
    '          <th data-key="chains" data-label="Chains" class="sortable">Chains</th>',
    '          <th data-key="tvl_usd" data-label="TVL" class="sortable num">TVL</th>',
    '          <th data-key="change_7d" data-label="7d" class="sortable num">7d</th>',
    '          <th data-key="implied_value_usd" data-label="Implied value" class="sortable num">Implied value</th>',
    '          <th data-key="age_days" data-label="Age" class="sortable num">Age</th>',
    '        </tr>',
    '      </thead>',
    '      <tbody id="board-body"></tbody>',
    '    </table>',
    '  </div>',
    '</section>',
    '<section class="live-section">',
    '  <h2>Live tokens</h2>',
    '  <div class="table-wrap">',
    '    <table class="live-table">',
    '      <thead><tr><th class="num">#</th><th>Name</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead>',
    '      <tbody id="live-body"></tbody>',
    '    </table>',
    '  </div>',
    '</section>'
  ].join('\n');

  const searchInput = container.querySelector('#search');
  const categorySelect = container.querySelector('#category');
  const tableHead = container.querySelector('#board-head');
  const tableBody = container.querySelector('#board-body');
  const liveBody = container.querySelector('#live-body');
  const liveToggle = container.querySelector('#live-toggle');
  const liveSection = container.querySelector('.live-section');

  categories.forEach(function (c) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  // Modal
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = [
    '<div class="modal" role="dialog" aria-modal="true">',
    '  <button class="modal-close" aria-label="Close" type="button">&times;</button>',
    '  <div class="modal-body"></div>',
    '</div>'
  ].join('\n');
  document.body.appendChild(modal);

  function getVal(row, key) {
    if (key === 'chains') return (row.chains || []).join(', ');
    return row[key];
  }

  function compareRows(a, b, key, dir) {
    const va = getVal(a, key);
    const vb = getVal(b, key);
    const mult = dir === 'asc' ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    }
    const sa = (va === null || va === undefined) ? '' : String(va);
    const sb = (vb === null || vb === undefined) ? '' : String(vb);
    const r = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
    return r * mult;
  }

  function getFilteredRows() {
    const q = filterText.trim().toLowerCase();
    let list = rows.slice();
    if (categoryFilter !== 'all') {
      list = list.filter(function (r) { return (r.category || '') === categoryFilter; });
    }
    if (q) {
      list = list.filter(function (r) {
        return (r.name || '').toLowerCase().indexOf(q) !== -1 ||
          (r.slug || '').toLowerCase().indexOf(q) !== -1 ||
          (r.category || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    list.sort(function (a, b) { return compareRows(a, b, sortKey, sortDir); });
    return list;
  }

  function renderBoard() {
    const list = getFilteredRows();
    if (!list.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-cell">No matching protocols.</td></tr>';
      return;
    }
    tableBody.innerHTML = list.map(function (r) {
      const isBelow = (typeof r.tvl_usd === 'number') && (r.tvl_usd < RADAR.floor_usd);
      const badgeClass = isBelow ? 'badge badge-below' : 'badge badge-watch';
      const badgeLabel = isBelow ? 'Below floor' : 'Watchlist';
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="num">' + esc(r.rank) + '</td>' +
        '<td class="name-cell">' + esc(r.name) + ' <span class="' + badgeClass + '">' + badgeLabel + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains-cell" title="' + esc((r.chains || []).join(', ')) + '">' + esc((r.chains || []).join(', ')) + '</td>' +
        '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
        '<td class="num ' + changeClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtMoney(r.implied_value_usd) + '</td>' +
        '<td class="num">' + (r.age_days === null || r.age_days === undefined ? '—' : esc(r.age_days)) + '</td>' +
        '</tr>';
    }).join('');

    tableBody.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug'), true); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug'), true); }
      });
    });
  }

  function updateSortIndicators() {
    tableHead.querySelectorAll('th[data-key]').forEach(function (th) {
      const base = th.getAttribute('data-label') || th.textContent.replace(/\s*[▲▼]\s*$/, '');
      const arrow = th.getAttribute('data-key') === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      th.textContent = base + arrow;
    });
  }

  function renderLive() {
    if (!liveBody) return;
    const list = live.slice().sort(function (a, b) {
      return (b.mcap_usd || 0) - (a.mcap_usd || 0) || (b.tvl_usd || 0) - (a.tvl_usd || 0);
    });
    if (!list.length) {
      liveBody.innerHTML = '<tr><td colspan="7" class="empty-cell">No live tokens.</td></tr>';
      return;
    }
    liveBody.innerHTML = list.map(function (r, i) {
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="name-cell">' + esc(r.name) + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains-cell" title="' + esc((r.chains || []).join(', ')) + '">' + esc((r.chains || []).join(', ')) + '</td>' +
        '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtMoney(r.mcap_usd) + '</td>' +
        '<td class="num ' + changeClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '</tr>';
    }).join('');
  }

  function openDetail(slug, updateHash) {
    const row = rows.find(function (r) { return r.slug === slug; });
    if (!row) {
      if (updateHash) location.hash = '';
      return;
    }
    detailSlug = slug;
    renderDetail(row);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    if (updateHash) {
      returnHash = filterText.trim() ? '#filter/' + encodeURIComponent(filterText.trim()) : '';
      location.hash = '#detail/' + encodeURIComponent(slug);
    }
  }

  function closeDetailUser() {
    detailSlug = null;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    const rh = returnHash;
    returnHash = '';
    if (rh) location.hash = rh;
    else location.hash = '';
  }

  function renderDetail(row) {
    const body = modal.querySelector('.modal-body');
    const age = row.age_days;
    const holdDays = (age !== null && age !== undefined && age < 180) ? 60 :
      (age !== null && age !== undefined && age < 365) ? 45 : 30;
    const capital = row.tvl_usd >= 5e9 ? 250 : row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
    const chain = (row.chains && row.chains[0]) || 'its main chain';
    const cat = (row.category || '').toLowerCase();
    let primaryAction;
    if (cat.indexOf('lend') !== -1 || cat.indexOf('borrow') !== -1) {
      primaryAction = 'Supply a modest amount to ' + row.name + ' on ' + chain + ', then check the position and any available rewards.';
    } else if (cat.indexOf('dex') !== -1 || cat.indexOf('exchange') !== -1 || cat.indexOf('amm') !== -1) {
      primaryAction = 'Make a small swap on ' + row.name + ' on ' + chain + ', then review the route and transaction in the app.';
    } else if (cat.indexOf('bridge') !== -1) {
      primaryAction = 'Bridge a test amount through ' + row.name + ' to ' + chain + ', confirming the destination before signing.';
    } else if (cat.indexOf('stake') !== -1) {
      primaryAction = 'Stake a small amount through ' + row.name + ' on ' + chain + ', then verify the receipt or staking position.';
    } else {
      primaryAction = 'Use the core feature of ' + row.name + ' on ' + chain + ' and verify that the interaction appears in your activity.';
    }

    const steps = [
      { title: 'Fresh wallet', text: 'Create or choose a dedicated wallet for ' + row.name + ', and confirm that it is configured for ' + chain + '.', cost: '$0', time: '10 minutes' },
      { title: 'Deposit action', text: 'Fund the wallet with about $' + capital + ' of the network asset and keep a separate amount available for transaction fees. Then: ' + primaryAction, cost: '$' + capital + ' plus gas', time: '35 minutes' },
      { title: 'Weekly qualifying action', text: 'Return to ' + row.name + ' on ' + chain + ' and complete one additional low-value action supported by the app.', cost: 'network fees', time: '15 minutes' },
      { title: 'Hold period', text: 'Keep the position active for about ' + holdDays + ' days, checking the protocol status and your wallet activity periodically.', cost: 'varies by position', time: holdDays + ' days' },
      { title: 'Claim safely', text: 'Before exiting, review current fees and balances, withdraw or unwind the position, and save the transaction records.', cost: 'network fees', time: '15 minutes' },
      { title: 'Keep a log', text: 'Keep a log of wallet addresses, transaction hashes, dates, and outcomes for ' + row.name + '.', cost: '$0', time: '10 minutes' }
    ];

    body.innerHTML = [
      '<h2>' + esc(row.name) + '</h2>',
      '<p class="slug">' + esc(row.slug) + '</p>',
      '<dl class="fields">',
      '  <div><dt>Rank</dt><dd>' + esc(row.rank) + '</dd></div>',
      '  <div><dt>Category</dt><dd>' + esc(row.category || '—') + '</dd></div>',
      '  <div><dt>Chains</dt><dd>' + esc((row.chains || []).join(', ') || '—') + '</dd></div>',
      '  <div><dt>TVL</dt><dd>' + fmtMoney(row.tvl_usd) + '</dd></div>',
      '  <div><dt>7d change</dt><dd class="' + changeClass(row.change_7d) + '">' + fmtPct(row.change_7d) + '</dd></div>',
      '  <div><dt>Market cap</dt><dd>' + fmtMoney(row.mcap_usd) + '</dd></div>',
      '  <div><dt>Listed at</dt><dd>' + esc(row.listed_at || '—') + '</dd></div>',
      '  <div><dt>Age (days)</dt><dd>' + (row.age_days === null || row.age_days === undefined ? '—' : esc(row.age_days)) + '</dd></div>',
      '  <div><dt>Implied value</dt><dd>' + fmtMoney(row.implied_value_usd) + '</dd></div>',
      '  <div><dt>Growth multiplier</dt><dd>' + fmtNum(row.growth_multiplier) + '</dd></div>',
      '  <div><dt>Maturity multiplier</dt><dd>' + fmtNum(row.maturity_multiplier) + '</dd></div>',
      '</dl>',
      '<h3>Farm plan</h3>',
      '<ol class="farm-plan">',
      steps.map(function (s) {
        return '<li><strong>' + esc(s.title) + '</strong><p>' + esc(s.text) + '</p><span class="meta">Cost: ' + esc(s.cost) + ' &middot; Time: ' + esc(s.time) + '</span></li>';
      }).join(''),
      '</ol>',
      '<a href="#" class="back-link">&larr; Back to board</a>'
    ].join('\n');

    const back = body.querySelector('.back-link');
    if (back) back.addEventListener('click', function (e) { e.preventDefault(); closeDetailUser(); });
  }

  function applyHash() {
    const h = location.hash || '';
    if (h.indexOf('#detail/') === 0) {
      const slug = safeDecode(h.slice('#detail/'.length));
      const row = rows.find(function (r) { return r.slug === slug; });
      if (row) {
        detailSlug = slug;
        renderDetail(row);
        modal.hidden = false;
        document.body.classList.add('modal-open');
      } else {
        detailSlug = null;
        modal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    } else if (h.indexOf('#filter/') === 0) {
      const text = safeDecode(h.slice('#filter/'.length));
      filterText = text;
      if (searchInput) searchInput.value = text;
      detailSlug = null;
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      renderBoard();
    } else {
      detailSlug = null;
      if (modal) {
        modal.hidden = true;
        document.body.classList.remove('modal-open');
      }
      if (h === '' || h === '#') {
        filterText = '';
        if (searchInput) searchInput.value = '';
        categoryFilter = 'all';
        if (categorySelect) categorySelect.value = 'all';
      }
      renderBoard();
    }
  }

  // Event listeners
  searchInput.addEventListener('input', function () {
    filterText = searchInput.value;
    const trimmed = filterText.trim();
    try {
      if (trimmed) {
        history.replaceState(null, '', location.pathname + location.search + '#filter/' + encodeURIComponent(trimmed));
      } else {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) { /* ignore */ }
    renderBoard();
  });

  categorySelect.addEventListener('change', function () {
    categoryFilter = categorySelect.value;
    renderBoard();
  });

  tableHead.addEventListener('click', function (e) {
    const th = e.target && e.target.closest ? e.target.closest('th[data-key]') : null;
    if (!th) return;
    const key = th.getAttribute('data-key');
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    updateSortIndicators();
    renderBoard();
  });

  liveToggle.addEventListener('click', function () {
    showLive = !showLive;
    liveSection.classList.toggle('collapsed', !showLive);
    liveToggle.textContent = showLive ? 'Hide live tokens' : 'Show live tokens';
  });

  modal.querySelector('.modal-close').addEventListener('click', closeDetailUser);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeDetailUser();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailSlug) closeDetailUser();
  });

  window.addEventListener('hashchange', applyHash);

  updateSortIndicators();
  applyHash();
  renderLive();
})();
