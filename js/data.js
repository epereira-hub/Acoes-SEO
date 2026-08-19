/* =========================================================================
   data.js — Camada de dados do Dashboard de Ações SEO
   =========================================================================
   Responsável por:
     1. Configuração da fonte (Google Sheets)
     2. Leitura dos dados (CSV publicado ou Apps Script Web App)
     3. Normalização (status, prioridade, impacto, produto, categoria)
     4. Cálculo dos indicadores/agregações consumidos pelo app.js

   >>> CONFIGURE AQUI (única fonte de verdade da conexão) <<<
   ========================================================================= */

   const SHEET_CONFIG = {
    // ID da planilha do Google Sheets.
    // Encontrado na URL: https://docs.google.com/spreadsheets/d/ >>> ESTE TRECHO <<< /edit
    SHEET_ID: 'COLE_AQUI_O_ID_DA_PLANILHA',
  
    // A planilha tem UMA ABA POR PRODUTO (em vez de uma coluna "Produto").
    // Liste aqui o nome exato de cada aba — vira o produto de cada linha lida dela.
    // Se uma linha já tiver uma coluna "Produto" preenchida, ela tem prioridade
    // sobre o nome da aba (então isso continua funcionando se você migrar depois
    // para uma única aba com coluna "Produto").
    PRODUCT_SHEETS: ['Conta PF', 'Conta PJ', 'Empréstimo', 'Cartões'],
  
    // Método de leitura: 'csv' (padrão, mais simples) ou 'apps_script' (mais seguro/corporativo).
    SOURCE_MODE: 'apps_script',
  
    // Usado apenas se SOURCE_MODE = 'apps_script'.
    // Cole aqui a URL de implantação (Web App) do Google Apps Script.
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxh1nMHiNBSv6eA77meOwlPcUoAJGEXp7lWAaJVyQC8a0XAWlAbgHNySLeB1cONrIQr/exec',
  };
  
  /* -------------------------------------------------------------------------
     COMO CONFIGURAR A PLANILHA (leia antes de usar)
     -------------------------------------------------------------------------
     Opção 1 — CSV publicado (mais simples, recomendada para começar rápido)
       1. Na planilha: Arquivo > Compartilhar > Publicar na web.
       2. Na tela de publicação, publique CADA ABA listada em PRODUCT_SHEETS
          (não "Documento inteiro") no formato "Valores separados por vírgula (.csv)".
          O app busca uma aba por vez usando o SHEET_ID + o nome de cada aba.
       3. Cole o SHEET_ID (está na URL da planilha) acima.
       ⚠️ Isso torna as abas publicamente acessíveis a quem tiver o link — não é
       recomendada para dados sensíveis do Banco do Brasil. Use apenas se a
       planilha não tiver informação sigilosa, ou combine com um link "não listado"
       em ambiente restrito.
  
     Opção 2 — Google Apps Script Web App (recomendada para ambiente corporativo)
       Mais segura porque não exige tornar a planilha pública: o script roda
       com a permissão de quem o publicou, e você pode restringir o acesso ao
       domínio da organização.
       1. Na planilha, abra Extensões > Apps Script.
       2. Cole o código abaixo e salve (já lê todas as abas de PRODUCT_SHEETS
          e marca cada linha com o produto correspondente):
  
          function doGet() {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            const productSheets = ['Conta PF', 'Conta PJ', 'Empréstimo', 'Cartões'];
            let data = [];
  
            productSheets.forEach(sheetName => {
              const sheet = ss.getSheetByName(sheetName);
              if (!sheet) return;
              const rows = sheet.getDataRange().getValues();
              const headers = rows.shift();
              const sheetData = rows
                .filter(r => r.some(cell => String(cell).trim() !== ''))
                .map(r => {
                  const obj = Object.fromEntries(headers.map((h, i) => [h, r[i]]));
                  if (!obj['Produto']) obj['Produto'] = sheetName; // usa a aba como produto
                  return obj;
                });
              data = data.concat(sheetData);
            });
  
            return ContentService
              .createTextOutput(JSON.stringify(data))
              .setMimeType(ContentService.MimeType.JSON);
          }
  
       3. Implantar > Nova implantação > Tipo: App da Web.
          - "Executar como": Eu (seu usuário).
          - "Quem pode acessar": escolha "Qualquer pessoa da organização
            [Banco do Brasil / Monumenta]" para manter os dados fora do público geral.
       4. Copie a URL gerada (termina em /exec) e cole em APPS_SCRIPT_URL acima.
       5. Troque SOURCE_MODE para 'apps_script'.
  
     Em ambos os casos, basta atualizar a planilha — o dashboard reflete os
     dados novos automaticamente no próximo carregamento/refresh da página.
     Se uma nova aba de produto for criada, adicione o nome dela em
     PRODUCT_SHEETS (e em productSheets no Apps Script, se usar essa opção).
     ------------------------------------------------------------------------- */
  
  function buildCsvUrl(sheetName) {
    const { SHEET_ID } = SHEET_CONFIG;
    // gviz/tq permite exportar CSV filtrando por nome da aba (sheet=).
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
    const params = `tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    return `${base}?${params}`;
  }
  
  /* ------------------------------- Leitura -------------------------------- */
  
  async function fetchSheetRows() {
    if (SHEET_CONFIG.SOURCE_MODE === 'apps_script') {
      const res = await fetch(SHEET_CONFIG.APPS_SCRIPT_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Falha ao ler Apps Script (HTTP ${res.status})`);
      const rows = await res.json();
      return rows.map((r) => ({ __sheetName: r['Produto'] || '', ...r }));
    }
  
    // Modo CSV: busca cada aba de produto separadamente e junta tudo,
    // marcando cada linha com o nome da aba de origem.
    const sheetNames = SHEET_CONFIG.PRODUCT_SHEETS;
    const results = await Promise.all(sheetNames.map(async (sheetName) => {
      const url = buildCsvUrl(sheetName);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Falha ao ler a aba "${sheetName}" (HTTP ${res.status})`);
      const csvText = await res.text();
      const rows = await new Promise((resolve, reject) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => resolve(result.data),
          error: (err) => reject(err),
        });
      });
      return rows.map((r) => ({ __sheetName: sheetName, ...r }));
    }));
  
    return results.flat();
  }
  
  /* ----------------------------- Normalização ------------------------------
     A planilha pode ter variações de grafia ("Concluído", "concluido",
     "CONCLUÍDO"). Tudo é normalizado para um conjunto fixo de rótulos.
     Colunas ausentes não quebram o app — apenas retornam valores padrão.
     ------------------------------------------------------------------------- */
  
  function stripAccents(str) {
    return String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
  
  function normalizeKey(str) {
    return stripAccents(str).toLowerCase();
  }
  
  const STATUS_MAP = {
    'concluido': 'Concluído',
    'concluida': 'Concluído',
    'feito': 'Concluído',
    'done': 'Concluído',
    'em andamento': 'Em andamento',
    'andamento': 'Em andamento',
    'em progresso': 'Em andamento',
    'progresso': 'Em andamento',
    'doing': 'Em andamento',
    'pendente': 'Pendente',
    'a fazer': 'Pendente',
    'nao iniciado': 'Pendente',
    'to do': 'Pendente',
    'todo': 'Pendente',
    'bloqueado': 'Bloqueado',
    'bloqueada': 'Bloqueado',
    'blocked': 'Bloqueado',
  };
  
  const PRIORITY_MAP = {
    'alta': 'Alta', 'high': 'Alta',
    'media': 'Média', 'médio': 'Média', 'medium': 'Média',
    'baixa': 'Baixa', 'low': 'Baixa',
  };
  
  const IMPACT_MAP = {
    'alto': 'Alto', 'alta': 'Alto', 'high': 'Alto',
    'medio': 'Médio', 'média': 'Médio', 'medium': 'Médio',
    'baixo': 'Baixo', 'baixa': 'Baixo', 'low': 'Baixo',
  };
  
  function mapWithFallback(value, map, fallback) {
    const key = normalizeKey(value);
    if (!key) return fallback;
    return map[key] || (cleanText(value) ? capitalize(cleanText(value)) : fallback);
  }
  
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
  
  // Trims text but preserves accents/casing — used for anything shown on screen.
  function cleanText(str) {
    return String(str ?? '').trim();
  }
  
  function pickField(row, candidates) {
    const keys = Object.keys(row || {});
    for (const candidate of candidates) {
      const found = keys.find((k) => normalizeKey(k) === normalizeKey(candidate));
      if (found && row[found] !== undefined && row[found] !== '') return row[found];
    }
    return '';
  }
  
  function normalizeRow(row, index) {
    const status = mapWithFallback(
      pickField(row, ['Status']), STATUS_MAP, 'Pendente'
    );
    const priority = mapWithFallback(
      pickField(row, ['Prioridade']), PRIORITY_MAP, 'Média'
    );
    const impact = mapWithFallback(
      pickField(row, ['Impacto']), IMPACT_MAP, 'Médio'
    );
    const effortRaw = pickField(row, ['Esforço', 'Esforco']);
    const category = cleanText(pickField(row, ['Categoria'])) || 'Sem categoria';
    // Produto: usa a coluna "Produto" se existir; senão cai para o nome da aba de origem
    // (planilhas organizadas com uma aba por produto, ex.: Conta PF, Conta PJ...).
    const product = cleanText(pickField(row, ['Produto', 'Página', 'Pagina']))
      || cleanText(row.__sheetName)
      || 'Não especificado';
    const month = cleanText(pickField(row, ['Mês', 'Mes'])) || 'Sem mês';
  
    return {
      id: pickField(row, ['ID', 'Id']) || String(index + 1),
      category,
      action: cleanText(pickField(row, ['Ação', 'Acao'])) || 'Ação sem nome',
      description: cleanText(pickField(row, ['Descrição', 'Descricao'])),
      month,
      status,
      owner: cleanText(pickField(row, ['Responsável', 'Responsavel'])) || '—',
      priority,
      effort: cleanText(effortRaw) || '—',
      impact,
      justification: cleanText(pickField(row, ['Justificativa'])),
      product,
    };
  }
  
  async function loadDashboardData() {
    const rawRows = await fetchSheetRows();
    return rawRows
      .filter((r) => Object.entries(r).some(([k, v]) => k !== '__sheetName' && String(v).trim() !== ''))
      .map(normalizeRow);
  }
  
  /* ----------------------------- Agregações -------------------------------- */
  
  const MONTH_ORDER = [
    'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  
  function sortMonths(months) {
    return [...months].sort((a, b) => {
      const ia = MONTH_ORDER.indexOf(normalizeKey(a));
      const ib = MONTH_ORDER.indexOf(normalizeKey(b));
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }
  
  function computeKpis(data) {
    const total = data.length;
    const done = data.filter((d) => d.status === 'Concluído').length;
    const inProgress = data.filter((d) => d.status === 'Em andamento').length;
    const pending = data.filter((d) => d.status === 'Pendente').length;
    const blocked = data.filter((d) => d.status === 'Bloqueado').length;
    const highImpact = data.filter((d) => d.impact === 'Alto').length;
    const highPriority = data.filter((d) => d.priority === 'Alta').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
  
    return { total, done, inProgress, pending, blocked, highImpact, highPriority, pct };
  }
  
  function computeProductBreakdown(data) {
    const products = [...new Set(data.map((d) => d.product))].sort();
    return products.map((product) => {
      const items = data.filter((d) => d.product === product);
      const total = items.length;
      const done = items.filter((d) => d.status === 'Concluído').length;
      const inProgress = items.filter((d) => d.status === 'Em andamento').length;
      const pending = items.filter((d) => d.status === 'Pendente' || d.status === 'Bloqueado').length;
      const highImpact = items.filter((d) => d.impact === 'Alto').length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return { product, total, done, inProgress, pending, highImpact, pct };
    }).sort((a, b) => b.total - a.total);
  }
  
  function computeStatusDistribution(data) {
    const order = ['Concluído', 'Em andamento', 'Pendente', 'Bloqueado'];
    const found = [...new Set(data.map((d) => d.status))];
    const statuses = [...order.filter((s) => found.includes(s)), ...found.filter((s) => !order.includes(s))];
    return statuses.map((status) => ({
      status,
      count: data.filter((d) => d.status === status).length,
    }));
  }
  
  function computeEvolutionByMonth(data) {
    const months = sortMonths([...new Set(data.map((d) => d.month))]);
    return months.map((month) => ({
      month,
      total: data.filter((d) => d.month === month).length,
      done: data.filter((d) => d.month === month && d.status === 'Concluído').length,
    }));
  }
  
  function computeHighlights(data, productBreakdown) {
    const highlights = [];
    if (productBreakdown.length) {
      const topDone = [...productBreakdown].sort((a, b) => b.done - a.done)[0];
      const topPct = [...productBreakdown].sort((a, b) => b.pct - a.pct)[0];
      if (topDone?.done > 0) highlights.push(`${topDone.product} lidera em ações concluídas (${topDone.done}).`);
      if (topPct?.total > 0) highlights.push(`${topPct.product} tem o maior percentual de conclusão (${topPct.pct}%).`);
    }
    const highImpact = data.filter((d) => d.impact === 'Alto').length;
    if (highImpact) highlights.push(`${highImpact} ações classificadas como alto impacto.`);
    const highPriority = data.filter((d) => d.priority === 'Alta').length;
    if (highPriority) highlights.push(`${highPriority} ações com prioridade alta.`);
  
    const categories = [...new Set(data.map((d) => d.category))];
    if (categories.length) {
      const topCategory = categories
        .map((c) => ({ c, n: data.filter((d) => d.category === c).length }))
        .sort((a, b) => b.n - a.n)[0];
      if (topCategory?.n) highlights.push(`"${topCategory.c}" é a categoria com maior volume (${topCategory.n} ações).`);
    }
  
    const evolution = computeEvolutionByMonth(data);
    if (evolution.length) {
      const topMonth = [...evolution].sort((a, b) => b.total - a.total)[0];
      if (topMonth?.total) highlights.push(`${capitalize(topMonth.month)} foi o mês com maior volume de ações (${topMonth.total}).`);
      const lastMonth = evolution[evolution.length - 1];
      if (lastMonth?.done) highlights.push(`${lastMonth.done} ações concluídas em ${lastMonth.month}.`);
    }
  
    const kpis = computeKpis(data);
    if (kpis.total) highlights.push(`${kpis.pct}% de conclusão geral da base de ações.`);
  
    return highlights;
  }
  
  function rank(items, weights) {
    return [...items].sort((a, b) => {
      for (const w of weights) {
        const diff = w(b) - w(a);
        if (diff !== 0) return diff;
      }
      return 0;
    });
  }
  
  function computeTopDelivered(data, limit = 6) {
    const done = data.filter((d) => d.status === 'Concluído');
    const scored = rank(done, [
      (d) => (d.impact === 'Alto' ? 2 : d.impact === 'Médio' ? 1 : 0),
      (d) => (d.priority === 'Alta' ? 2 : d.priority === 'Média' ? 1 : 0),
    ]);
    return scored.slice(0, limit);
  }
  
  function computeNextActions(data, limit = 8) {
    const open = data.filter((d) => d.status !== 'Concluído');
    const monthIndex = (m) => {
      const i = MONTH_ORDER.indexOf(normalizeKey(m));
      return i === -1 ? 999 : i;
    };
    const scored = rank(open, [
      (d) => (d.priority === 'Alta' ? 2 : d.priority === 'Média' ? 1 : 0),
      (d) => (d.impact === 'Alto' ? 2 : d.impact === 'Médio' ? 1 : 0),
      (d) => (d.status === 'Em andamento' ? 1 : 0),
      (d) => -monthIndex(d.month),
    ]);
    return scored.slice(0, limit);
  }