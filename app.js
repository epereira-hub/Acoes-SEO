/* =========================================================================
   app.js — Renderização e interação do Dashboard de Ações SEO
   ========================================================================= */

const STATE = {
  raw: [],
  filtered: [],
  filters: { produto: '', mes: '', status: '', prioridade: '', impacto: '', categoria: '' },
  table: { search: '', sortKey: 'action', sortDir: 1, page: 1, pageSize: 10 },
  charts: { evolution: null, status: null },
};

const STATUS_COLORS = {
  'Concluído': '#1B8A5A',
  'Em andamento': '#E0A800',
  'Pendente': '#94A3B8',
  'Bloqueado': '#D64545',
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindStaticEvents();
  await loadAndRender();
}

async function loadAndRender() {
  setLoadingState(true);
  try {
    STATE.raw = await loadDashboardData();
    populateFilterOptions(STATE.raw);
    applyFilters();
    setLastUpdated();
    setLoadingState(false, null);
  } catch (err) {
    console.error(err);
    setLoadingState(false, err.message || 'Não foi possível carregar os dados da planilha.');
  }
}

function setLoadingState(isLoading, errorMsg) {
  const banner = document.getElementById('status-banner');
  if (isLoading) {
    banner.hidden = false;
    banner.className = 'status-banner status-banner--loading';
    banner.textContent = 'Carregando dados da planilha…';
  } else if (errorMsg) {
    banner.hidden = false;
    banner.className = 'status-banner status-banner--error';
    banner.textContent = `⚠️ ${errorMsg} Verifique a configuração em js/data.js (SHEET_CONFIG).`;
  } else {
    banner.hidden = true;
  }
}

function setLastUpdated() {
  const el = document.getElementById('last-updated');
  const now = new Date();
  el.textContent = `Atualizado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/* --------------------------- Eventos estáticos --------------------------- */

function bindStaticEvents() {
  document.getElementById('refresh-btn').addEventListener('click', loadAndRender);
  document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);

  ['produto', 'mes', 'status', 'prioridade', 'impacto', 'categoria'].forEach((key) => {
    document.getElementById(`filter-${key}`).addEventListener('change', (e) => {
      STATE.filters[key] = e.target.value;
      applyFilters();
    });
  });

  document.getElementById('table-toggle').addEventListener('click', () => {
    const wrap = document.getElementById('table-wrap');
    const expanded = wrap.hidden === false;
    wrap.hidden = expanded;
    document.getElementById('table-toggle').setAttribute('aria-expanded', String(!expanded));
    document.getElementById('table-toggle-icon').textContent = expanded ? '▸' : '▾';
  });

  document.getElementById('table-search').addEventListener('input', (e) => {
    STATE.table.search = e.target.value;
    STATE.table.page = 1;
    renderTable();
  });

  document.querySelectorAll('#action-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (STATE.table.sortKey === key) {
        STATE.table.sortDir *= -1;
      } else {
        STATE.table.sortKey = key;
        STATE.table.sortDir = 1;
      }
      renderTable();
    });
  });

  document.getElementById('table-prev').addEventListener('click', () => {
    if (STATE.table.page > 1) { STATE.table.page -= 1; renderTable(); }
  });
  document.getElementById('table-next').addEventListener('click', () => {
    STATE.table.page += 1; renderTable();
  });
}

function populateFilterOptions(data) {
  const config = [
    ['produto', 'product'], ['mes', 'month'], ['status', 'status'],
    ['prioridade', 'priority'], ['impacto', 'impact'], ['categoria', 'category'],
  ];
  config.forEach(([filterKey, field]) => {
    const select = document.getElementById(`filter-${filterKey}`);
    const current = select.value;
    const values = [...new Set(data.map((d) => d[field]))].filter(Boolean).sort();
    select.innerHTML = `<option value="">Todos</option>` +
      values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    select.value = current;
  });
}

function clearFilters() {
  STATE.filters = { produto: '', mes: '', status: '', prioridade: '', impacto: '', categoria: '' };
  document.querySelectorAll('.filters select').forEach((s) => { s.value = ''; });
  applyFilters();
}

/* ------------------------------- Filtragem -------------------------------- */

function applyFilters() {
  const f = STATE.filters;
  STATE.filtered = STATE.raw.filter((d) =>
    (!f.produto || d.product === f.produto) &&
    (!f.mes || d.month === f.mes) &&
    (!f.status || d.status === f.status) &&
    (!f.prioridade || d.priority === f.prioridade) &&
    (!f.impacto || d.impact === f.impacto) &&
    (!f.categoria || d.category === f.categoria)
  );
  renderAll();
}

/* -------------------------------- Render ---------------------------------- */

function renderAll() {
  const data = STATE.filtered;
  renderKpis(data);
  renderProducts(data);
  renderDelivered(data);
  renderNext(data);
  renderEvolutionChart(data);
  renderStatusChart(data);
  renderHighlights(data);
  renderTable();
  document.getElementById('empty-state').hidden = data.length !== 0;
}

function renderKpis(data) {
  const k = computeKpis(data);
  const el = document.getElementById('kpi-cards');
  el.innerHTML = [
    kpiCard('Total de ações', k.total, null),
    kpiCard('Concluídas', k.done, `${k.pct}%`, 'success'),
    kpiCard('Em andamento', k.inProgress, null, 'warning'),
    kpiCard('Pendentes', k.pending, null, 'neutral'),
    kpiCard('Impacto alto', k.highImpact, null, 'accent'),
    kpiCard('Prioridade alta', k.highPriority, null, 'accent'),
  ].join('');

  const bar = document.getElementById('overall-progress-bar');
  bar.style.width = `${k.pct}%`;
  document.getElementById('overall-progress-label').textContent = `${k.pct}% concluído`;
}

function kpiCard(label, value, sub, tone) {
  return `
    <div class="kpi-card ${tone ? `kpi-card--${tone}` : ''}">
      <span class="kpi-card__label">${label}</span>
      <span class="kpi-card__value">${value}${sub ? `<span class="kpi-card__sub">${sub}</span>` : ''}</span>
    </div>`;
}

function renderProducts(data) {
  const breakdown = computeProductBreakdown(data);
  const el = document.getElementById('product-grid');
  if (!breakdown.length) { el.innerHTML = ''; return; }
  el.innerHTML = breakdown.map((p) => `
    <div class="product-card">
      <div class="product-card__head">
        <h3>${escapeHtml(p.product)}</h3>
        <span class="product-card__total">${p.total} ${p.total === 1 ? 'ação' : 'ações'}</span>
      </div>
      <div class="segmented-bar" role="img" aria-label="${p.pct}% concluído">
        <div class="segmented-bar__fill" style="width:${p.pct}%"></div>
      </div>
      <div class="product-card__pct">${p.pct}%</div>
      <ul class="product-card__stats">
        <li><span class="dot dot--success"></span>${p.done} concluídas</li>
        <li><span class="dot dot--warning"></span>${p.inProgress} em andamento</li>
        <li><span class="dot dot--neutral"></span>${p.pending} pendentes</li>
        ${p.highImpact ? `<li><span class="dot dot--accent"></span>${p.highImpact} alto impacto</li>` : ''}
      </ul>
    </div>`).join('');
}

function renderDelivered(data) {
  const items = computeTopDelivered(data);
  const el = document.getElementById('delivered-list');
  if (!items.length) {
    el.innerHTML = '<p class="empty-hint">Nenhuma ação concluída para os filtros atuais.</p>';
    return;
  }
  el.innerHTML = items.map((d) => `
    <div class="entry-item">
      <div class="entry-item__head">
        <span class="entry-item__title">${escapeHtml(d.action)}</span>
        ${badge(d.impact, 'impact')}
      </div>
      <div class="entry-item__meta">${escapeHtml(d.product)} · ${escapeHtml(d.month)}</div>
      ${d.description ? `<p class="entry-item__desc">${escapeHtml(truncate(d.description, 140))}</p>` : ''}
    </div>`).join('');
}

function renderNext(data) {
  const items = computeNextActions(data);
  const el = document.getElementById('next-list');
  if (!items.length) {
    el.innerHTML = '<p class="empty-hint">Nenhuma ação pendente para os filtros atuais.</p>';
    return;
  }
  el.innerHTML = items.map((d) => `
    <div class="entry-item">
      <div class="entry-item__head">
        <span class="entry-item__title">${escapeHtml(d.action)}</span>
        ${badge(d.status, 'status')}
      </div>
      <div class="entry-item__meta">${escapeHtml(d.product)} · previsto para ${escapeHtml(d.month)}</div>
      <div class="entry-item__tags">${badge(d.priority, 'priority')}${badge(d.impact, 'impact')}</div>
    </div>`).join('');
}

function badge(value, kind) {
  const cls = `badge badge--${kind}-${normalizeKeyClass(value)}`;
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function normalizeKeyClass(value) {
  return String(value).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function renderHighlights(data) {
  const breakdown = computeProductBreakdown(data);
  const highlights = computeHighlights(data, breakdown);
  const el = document.getElementById('highlights-list');
  if (!highlights.length) {
    el.innerHTML = '<p class="empty-hint">Sem destaques suficientes para os filtros atuais.</p>';
    return;
  }
  el.innerHTML = highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join('');
}

/* -------------------------------- Gráficos --------------------------------- */

function renderEvolutionChart(data) {
  const evolution = computeEvolutionByMonth(data);
  const ctx = document.getElementById('evolution-chart');
  if (STATE.charts.evolution) STATE.charts.evolution.destroy();
  STATE.charts.evolution = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: evolution.map((e) => capitalizeMonth(e.month)),
      datasets: [
        {
          label: 'Total de ações',
          data: evolution.map((e) => e.total),
          backgroundColor: '#C9D6EE',
          borderRadius: 6,
          maxBarThickness: 36,
        },
        {
          label: 'Concluídas',
          data: evolution.map((e) => e.done),
          backgroundColor: '#003087',
          borderRadius: 6,
          maxBarThickness: 36,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Inter', size: 12 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { family: 'Inter', size: 12 } }, grid: { color: '#EDF0F5' } },
      },
    },
  });
}

function renderStatusChart(data) {
  const dist = computeStatusDistribution(data);
  const ctx = document.getElementById('status-chart');
  if (STATE.charts.status) STATE.charts.status.destroy();
  STATE.charts.status = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: dist.map((d) => d.status),
      datasets: [{
        data: dist.map((d) => d.count),
        backgroundColor: dist.map((d) => STATUS_COLORS[d.status] || '#B7C0CF'),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Inter', size: 12 } } } },
    },
  });
}

function capitalizeMonth(m) {
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/* --------------------------------- Tabela ----------------------------------- */

function renderTable() {
  const { search, sortKey, sortDir, page, pageSize } = STATE.table;
  let rows = [...STATE.filtered];

  if (search.trim()) {
    const q = normalizeKey(search);
    rows = rows.filter((d) =>
      [d.action, d.category, d.product, d.owner, d.month].some((v) => normalizeKey(v).includes(q))
    );
  }

  rows.sort((a, b) => {
    const va = String(a[sortKey] ?? '');
    const vb = String(b[sortKey] ?? '');
    return va.localeCompare(vb, 'pt-BR') * sortDir;
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  STATE.table.page = Math.min(page, totalPages);
  const start = (STATE.table.page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const tbody = document.querySelector('#action-table tbody');
  tbody.innerHTML = pageRows.map((d) => `
    <tr>
      <td>${escapeHtml(d.action)}</td>
      <td>${escapeHtml(d.category)}</td>
      <td>${escapeHtml(d.product)}</td>
      <td>${escapeHtml(d.month)}</td>
      <td>${badge(d.status, 'status')}</td>
      <td>${escapeHtml(d.owner)}</td>
      <td>${badge(d.priority, 'priority')}</td>
      <td>${escapeHtml(d.effort)}</td>
      <td>${badge(d.impact, 'impact')}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty-hint">Nenhuma ação encontrada.</td></tr>';

  document.getElementById('table-page-info').textContent = `Página ${STATE.table.page} de ${totalPages} · ${rows.length} ações`;
  document.getElementById('table-prev').disabled = STATE.table.page <= 1;
  document.getElementById('table-next').disabled = STATE.table.page >= totalPages;
}

/* --------------------------------- Utils ------------------------------------ */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function truncate(str, len) {
  return str.length > len ? `${str.slice(0, len).trim()}…` : str;
}
