const SECTORS = [
  "Industrials",
  "Consumer",
  "Technology",
  "Healthcare",
  "Real Assets",
  "Alternative Assets",
  "Financials",
];

const TICKER_TO_SECTOR = {
  HON: "Industrials",
  ATEX: "Industrials",
  MU: "Technology",
  INOD: "Technology",
  BBIO: "Healthcare",
  VRTX: "Healthcare",
  WPM: "Real Assets",
  XOM: "Real Assets",
  NEM: "Alternative Assets",
  FCX: "Alternative Assets",
  BYD: "Consumer",
  BYDDF: "Consumer",
  PG: "Consumer",
  "1211.HK": "Consumer",
  ALIZY: "Financials",
  "ALV.DE": "Financials",
  V: "Financials",
};

const PRESETS = ["Custom", "Bull Call Spread", "Iron Condor", "Straddle"];

let holdings = [];
let benchmark = {
  name: "MSCI World Index",
  start: 4322.9,
  end: 4609,
};
let periodStart = "2025-10-20";
let periodEnd = "2026-04-24";
let sectorWeights = {};
let stockShares = {};
let draftSectorWeights = {};
let draftStockShares = {};
let weightsDirty = false;
let optionTickerSignature = "";
let loadedSnapshot = null;
let uploadComparison = null;
let liveQuotes = new Map();
let liveQuoteState = { loading: false, error: "", fetchedAt: null, requested: 0 };

const plotConfig = { responsive: true, displayModeBar: false };

function $(id) {
  return document.getElementById(id);
}

function isDarkMode() {
  return document.body.dataset.theme === "dark";
}

function currentTheme() {
  return isDarkMode()
    ? { text: "#f7f1e7", grid: "#3a322a", zero: "#5a5045", panel: "#221c15", muted: "#c9bfae" }
    : { text: "#1a1410", grid: "#e3dccf", zero: "#c9bfae", panel: "#ffffff", muted: "#6b6157" };
}

function fmtPct(value, signed = false) {
  if (!Number.isFinite(value)) return "--";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

function fmtMoney(value) {
  if (!Number.isFinite(value)) return "--";
  return `$${Number(value).toFixed(2)}`;
}

function fmtSignedMoney(value) {
  if (!Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
}

function fmtNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtDateTime(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return "--";
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toneClass(value) {
  if (!Number.isFinite(value)) return "";
  return value >= 0 ? "positive" : "negative";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseMonth(monthName) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(monthName.slice(0, 3).toLowerCase());
}

function parseCsv(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells = [];
      let current = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = !quoted;
        } else if (ch === "," && !quoted) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}

function dateFromColumn(col) {
  const compact = col.match(/(\d{1,2})([A-Za-z]{3,9})(\d{4})/);
  if (compact) {
    const month = parseMonth(compact[2]);
    if (month < 0) return null;
    const parsed = new Date(Date.UTC(Number(compact[3]), month, Number(compact[1])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const iso = col.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
  if (iso) {
    const parsed = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const dashed = col.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
  if (dashed) {
    const parsed = new Date(Date.UTC(Number(dashed[3]), Number(dashed[2]) - 1, Number(dashed[1])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function fmtIsoDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return NaN;
  return Number(String(value).replace(/[$,%]/g, "").trim());
}

function loadPortfolio(text, { compare = false } = {}) {
  const previousSnapshot = compare ? loadedSnapshot : null;
  const rows = parseCsv(text);
  const metaStart = rows.find((row) => row[0]?.toLowerCase() === "period start");
  const metaEnd = rows.find((row) => row[0]?.toLowerCase() === "period end");
  const metaBenchmark = rows.find((row) => row[0]?.toLowerCase() === "benchmark");
  if (metaStart?.[1]) periodStart = metaStart[1];
  if (metaEnd?.[1]) periodEnd = metaEnd[1];
  let benchmarkAvailable = false;
  if (metaBenchmark) {
    const start = cleanNumber(metaBenchmark[2]);
    const end = cleanNumber(metaBenchmark[3]);
    benchmark = {
      name: metaBenchmark[1] || benchmark.name,
      start,
      end,
      available: Number.isFinite(start) && Number.isFinite(end) && start > 0,
    };
    benchmarkAvailable = benchmark.available;
  }

  const headerIndex = rows.findIndex((row) => {
    const lowered = row.map((cell) => cell.toLowerCase());
    return lowered.includes("ticker") && lowered.some((cell) => cell.includes("price") || cell === "return");
  });
  if (headerIndex < 0) throw new Error("No CSV table header found.");

  let headers = rows[headerIndex].map((header) => header.replace(/\s+/g, "_"));
  const dataRows = rows.slice(headerIndex + 1);
  const priceColumns = headers
    .map((header, index) => ({ header, index, date: header.toLowerCase().startsWith("price_") ? dateFromColumn(header) : null }))
    .filter((item) => item.date);

  let initialStartDate = null;
  let endDate = null;
  if (!headers.includes("Price_Start") && !headers.includes("Price_End") && priceColumns.length >= 2) {
    priceColumns.sort((a, b) => a.date - b.date);
    initialStartDate = priceColumns[0].date;
    endDate = priceColumns[priceColumns.length - 1].date;
    periodStart = fmtIsoDate(initialStartDate);
    periodEnd = fmtIsoDate(endDate);
    headers = headers.map((header, index) => {
      if (index === priceColumns[0].index) return "Price_Start";
      if (index === priceColumns[priceColumns.length - 1].index) return "Price_End";
      return header;
    });
  }

  let currentBuyDate = initialStartDate;
  const records = [];
  dataRows.forEach((row) => {
    const tickerIndex = headers.indexOf("Ticker");
    const ticker = row[tickerIndex] || "";
    if (!ticker.trim()) {
      row.some((cell) => {
        if (!String(cell || "").toLowerCase().startsWith("price_")) return false;
        const parsedDate = dateFromColumn(cell);
        if (parsedDate) currentBuyDate = parsedDate;
        return Boolean(parsedDate);
      });
      return;
    }
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    record.Buy_Date = fmtIsoDate(currentBuyDate);
    records.push(record);
  });
  const parsed = records
    .filter((row) => row.Ticker)
    .map((row) => {
      const ticker = row.Ticker;
      const isBenchmark = /msci|index/i.test(`${ticker} ${row.Company ?? ""} ${row.Sector ?? ""}`);
      const priceStart = cleanNumber(row.Price_Start);
      const priceEnd = cleanNumber(row.Price_End);
      let weight = cleanNumber(row.Weight);
      let ret = cleanNumber(row.Return);
      if (!Number.isFinite(ret) && priceStart > 0) ret = (priceEnd - priceStart) / priceStart;
      if (Number.isFinite(ret) && Math.abs(ret) > 5) ret /= 100;
      if (Number.isFinite(weight) && weight > 1.5) weight /= 100;
      return {
        sector: isBenchmark ? "Benchmark" : row.Sector || TICKER_TO_SECTOR[ticker] || "Other",
        ticker,
        company: row.Company || ticker,
        exchange: row.Exchange || "",
        priceStart,
        priceEnd,
        weight: Number.isFinite(weight) ? weight : 0,
        return: Number.isFinite(ret) ? ret : 0,
        url: row.Yahoo_Finance_URL || row.Yahoo_URL || "",
        buyDate: row.Buy_Date || periodStart,
      };
    });

  const benchRow = parsed.find((row) => row.sector === "Benchmark");
  if (benchRow) {
    benchmark = {
      name: benchRow.company || benchRow.ticker || benchmark.name,
      start: benchRow.priceStart || benchmark.start,
      end: benchRow.priceEnd || benchmark.end,
      available: benchRow.priceStart > 0 && benchRow.priceEnd > 0,
    };
    benchmarkAvailable = benchmark.available;
  }
  if (!benchmarkAvailable) {
    benchmark = { name: "Benchmark", start: NaN, end: NaN, available: false };
  }

  holdings = parsed.filter((row) => row.sector !== "Benchmark");
  const missingWeights = holdings.every((row) => !row.weight);
  if (missingWeights && holdings.length) holdings.forEach((row) => { row.weight = 1 / holdings.length; });
  resetStateFromHoldings();
  loadedSnapshot = buildSnapshot(activeHoldings(), benchmark, periodStart, periodEnd);
  uploadComparison = previousSnapshot ? compareSnapshots(previousSnapshot, loadedSnapshot) : null;
  liveQuotes = new Map();
  liveQuoteState = { loading: false, error: "", fetchedAt: null, requested: holdings.length };
  renderAll();
  fetchLiveQuotes({ silent: true });
}

function cloneWeights(weights) {
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number(value) || 0]));
}

function sameWeights(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => Math.abs((Number(left[key]) || 0) - (Number(right[key]) || 0)) < 0.001);
}

function buildWeightsFromHoldings() {
  const nextSectorWeights = Object.fromEntries(SECTORS.map((sector) => [sector, 0]));
  holdings.forEach((row) => { nextSectorWeights[row.sector] = (nextSectorWeights[row.sector] || 0) + row.weight * 100; });
  const nextStockShares = {};
  SECTORS.forEach((sector) => {
    const rows = holdings.filter((row) => row.sector === sector);
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    rows.forEach((row) => { nextStockShares[row.ticker] = total ? (row.weight / total) * 100 : 100 / rows.length; });
  });
  return { sector: nextSectorWeights, stock: nextStockShares };
}

function resetStateFromHoldings() {
  const next = buildWeightsFromHoldings();
  sectorWeights = cloneWeights(next.sector);
  stockShares = cloneWeights(next.stock);
  draftSectorWeights = cloneWeights(next.sector);
  draftStockShares = cloneWeights(next.stock);
  weightsDirty = false;
}

function markDraftDirty() {
  weightsDirty = !sameWeights(draftSectorWeights, sectorWeights) || !sameWeights(draftStockShares, stockShares);
}

function resetDraftFromHoldings() {
  const next = buildWeightsFromHoldings();
  draftSectorWeights = cloneWeights(next.sector);
  draftStockShares = cloneWeights(next.stock);
  markDraftDirty();
  renderControls();
}

function applyDraftWeights() {
  const validation = validateDraftWeights();
  if (!validation.valid) {
    renderControls();
    return;
  }
  sectorWeights = cloneWeights(draftSectorWeights);
  stockShares = cloneWeights(draftStockShares);
  weightsDirty = false;
  renderAll();
}

function weightTotal(values) {
  return Object.values(values).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function validateDraftWeights() {
  const messages = [];
  const sectorTotal = weightTotal(draftSectorWeights);
  if (Math.abs(sectorTotal - 100) > 0.05) {
    messages.push(`Sector weightings need to add to 100%. Current total is ${sectorTotal.toFixed(1)}%.`);
  }
  SECTORS.forEach((sector) => {
    const rows = holdings.filter((row) => row.sector === sector);
    if (rows.length <= 1) return;
    const stockTotal = rows.reduce((sum, row) => sum + (Number(draftStockShares[row.ticker]) || 0), 0);
    if (Math.abs(stockTotal - 100) > 0.05) {
      messages.push(`${sector} stock weightings need to add to 100%. Current total is ${stockTotal.toFixed(1)}%.`);
    }
  });
  return { valid: messages.length === 0, messages, sectorTotal };
}

function activeHoldings() {
  return holdings.map((row) => {
    const sectorWeight = (sectorWeights[row.sector] || 0) / 100;
    const share = (stockShares[row.ticker] || 0) / 100;
    const weight = sectorWeight * share;
    return { ...row, weight, contribution: weight * row.return };
  });
}

function portfolioStats() {
  const rows = activeHoldings();
  const portfolioReturn = rows.reduce((sum, row) => sum + row.contribution, 0);
  const benchmarkReturn = benchmark.available && benchmark.start ? benchmark.end / benchmark.start - 1 : NaN;
  const alpha = Number.isFinite(benchmarkReturn) ? portfolioReturn - benchmarkReturn : NaN;
  return { rows, portfolioReturn, benchmarkReturn, alpha };
}

function buildSnapshot(rows, sourceBenchmark, start, end) {
  const portfolioReturn = rows.reduce((sum, row) => sum + row.contribution, 0);
  const benchmarkReturn = sourceBenchmark.available && sourceBenchmark.start
    ? sourceBenchmark.end / sourceBenchmark.start - 1
    : NaN;
  return {
    periodStart: start,
    periodEnd: end,
    portfolioReturn,
    benchmarkReturn,
    alpha: Number.isFinite(benchmarkReturn) ? portfolioReturn - benchmarkReturn : NaN,
    rows: rows.map((row) => ({
      ticker: row.ticker,
      company: row.company,
      sector: row.sector,
      return: row.return,
      weight: row.weight,
      contribution: row.contribution,
      priceEnd: row.priceEnd,
    })),
  };
}

function compareSnapshots(previous, current) {
  const previousByTicker = new Map(previous.rows.map((row) => [row.ticker, row]));
  const rows = current.rows.map((row) => {
    const prior = previousByTicker.get(row.ticker);
    return {
      ...row,
      priorReturn: prior?.return,
      returnDelta: Number.isFinite(prior?.return) ? row.return - prior.return : NaN,
      priorPriceEnd: prior?.priceEnd,
      priceDelta: Number.isFinite(prior?.priceEnd) ? row.priceEnd - prior.priceEnd : NaN,
      status: prior ? "Updated" : "Added",
    };
  });
  current.rows.forEach((row) => previousByTicker.delete(row.ticker));
  previousByTicker.forEach((row) => {
    rows.push({
      ...row,
      priorReturn: row.return,
      returnDelta: NaN,
      priorPriceEnd: row.priceEnd,
      priceDelta: NaN,
      status: "Removed",
    });
  });
  return { previous, current, rows };
}

function renderAll() {
  renderControls();
  renderPortfolio();
  renderLiveMode();
  renderOptions();
}

function renderControls() {
  const validation = validateDraftWeights();
  const status = $("weightApplyStatus");
  if (status) {
    status.textContent = validation.valid
      ? (weightsDirty
        ? "You have staged allocation changes. Dashboard numbers will update after Apply Now."
        : "Current dashboard uses the applied portfolio weights.")
      : validation.messages[0];
    if (validation.valid) {
      status.className = "subhead";
    } else {
      status.className = "subhead";
      void status.offsetWidth;
      status.className = "subhead weight-warning";
    }
  }
  const applyButton = $("applyWeights");
  if (applyButton) applyButton.disabled = !weightsDirty || !validation.valid;
  const container = $("sectorControls");
  container.innerHTML = "";
  SECTORS.forEach((sector) => {
    const sectorRows = holdings.filter((row) => row.sector === sector);
    const row = document.createElement("div");
    row.className = "control-row";
    row.innerHTML = `
      <header><strong>${sector}</strong><span>${(draftSectorWeights[sector] || 0).toFixed(1)}%</span></header>
      <div class="control-pair">
        <input class="sector-range" type="range" min="0" max="100" step="0.1" value="${draftSectorWeights[sector] || 0}" />
        <input class="sector-number" type="number" min="0" max="100" step="0.1" value="${(draftSectorWeights[sector] || 0).toFixed(1)}" />
      </div>
      <details class="stock-controls" open>
        <summary>Stocks in ${sector} (${sectorRows.length})</summary>
        <div class="stock-control-body"></div>
      </details>
    `;
    row.querySelector(".sector-range").addEventListener("input", (event) => {
      rebalanceSectors(sector, Number(event.target.value));
      renderControls();
    });
    row.querySelector(".sector-number").addEventListener("change", (event) => {
      rebalanceSectors(sector, Number(event.target.value));
      renderControls();
    });
    renderStockControls(row.querySelector(".stock-control-body"), sector, sectorRows);
    container.appendChild(row);
  });
}

function renderStockControls(container, sector, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="muted-note">No stocks in this sector.</p>';
    return;
  }
  if (rows.length === 1) {
    const only = rows[0];
    container.innerHTML = `<p class="muted-note"><strong>${escapeHtml(only.ticker)}</strong> receives 100% of this sector.</p>`;
    draftStockShares[only.ticker] = 100;
    return;
  }
  const presetButtons = rows.length === 2
    ? [
      ["50/50", [50, 50]],
      ["60/40", [60, 40]],
      ["40/60", [40, 60]],
      ["100/0", [100, 0]],
      ["0/100", [0, 100]],
    ]
    : [
      [`Equal (${(100 / rows.length).toFixed(1)}% each)`, rows.map(() => 100 / rows.length)],
      ...rows.map((holding, index) => [`100% ${holding.ticker}`, rows.map((_, i) => (i === index ? 100 : 0))]),
    ];
  container.innerHTML = `
    <div class="preset-row">
      ${presetButtons.map(([label]) => `<button type="button" data-preset="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
    </div>
    ${rows.map((holding) => {
      const share = draftStockShares[holding.ticker] ?? (100 / rows.length);
      const portfolioShare = (draftSectorWeights[sector] || 0) * share / 100;
      return `
        <div class="stock-row" data-ticker="${escapeHtml(holding.ticker)}">
          <header><strong>${escapeHtml(holding.ticker)}</strong><span>${portfolioShare.toFixed(1)}% portfolio</span></header>
          <small>${escapeHtml(holding.company)} · ${fmtPct(holding.return, true)}</small>
          <div class="control-pair">
            <input class="stock-range" type="range" min="0" max="100" step="0.1" value="${share}" />
            <input class="stock-number" type="number" min="0" max="100" step="0.1" value="${share.toFixed(1)}" />
          </div>
        </div>
      `;
    }).join("")}
  `;
  container.querySelectorAll(".preset-row button").forEach((button) => {
    button.addEventListener("click", () => {
      const found = presetButtons.find(([label]) => label === button.dataset.preset);
      if (!found) return;
      found[1].forEach((weight, index) => { draftStockShares[rows[index].ticker] = weight; });
      markDraftDirty();
      renderControls();
    });
  });
  container.querySelectorAll(".stock-row").forEach((node) => {
    const ticker = node.dataset.ticker;
    node.querySelector(".stock-range").addEventListener("input", (event) => {
      rebalanceStocks(sector, ticker, Number(event.target.value));
      renderControls();
    });
    node.querySelector(".stock-number").addEventListener("change", (event) => {
      rebalanceStocks(sector, ticker, Number(event.target.value));
      renderControls();
    });
  });
}

function rebalanceSectors(changed, value) {
  const capped = Math.max(0, Math.min(100, value));
  draftSectorWeights[changed] = capped;
  markDraftDirty();
}

function rebalanceStocks(sector, changedTicker, value) {
  const capped = Math.max(0, Math.min(100, value));
  draftStockShares[changedTicker] = capped;
  const rows = holdings.filter((row) => row.sector === sector);
  if (rows.length === 1) {
    draftStockShares[changedTicker] = 100;
  }
  markDraftDirty();
}

function renderPortfolio() {
  const { rows, portfolioReturn, benchmarkReturn, alpha } = portfolioStats();
  const theme = currentTheme();
  $("portfolioReturn").textContent = fmtPct(portfolioReturn);
  $("benchmarkReturn").textContent = fmtPct(benchmarkReturn);
  $("alphaReturn").textContent = fmtPct(alpha, true);
  $("alphaReturn").className = toneClass(alpha);
  $("periodLabel").textContent = `${periodStart} to ${periodEnd}`;

  Plotly.react("sectorChart", [{
    type: "pie",
    labels: SECTORS,
    values: SECTORS.map((sector) => sectorWeights[sector] || 0),
    hole: 0.55,
    hovertemplate: "%{label}<br>%{percent}<extra></extra>",
    textinfo: "percent",
    textposition: "inside",
    automargin: true,
    marker: { colors: BRAND_COLORWAY, line: { color: theme.panel, width: 2 } },
  }], sectorLayout(), plotConfig);

  const sortedByContribution = [...rows].sort((a, b) => b.contribution - a.contribution);
  Plotly.react("waterfallChart", [{
    type: "waterfall",
    x: [...sortedByContribution.map((row) => row.ticker), "Total"],
    y: [...sortedByContribution.map((row) => row.contribution * 100), portfolioReturn * 100],
    measure: [...sortedByContribution.map(() => "relative"), "total"],
    text: [...sortedByContribution.map((row) => fmtPct(row.contribution, true)), fmtPct(portfolioReturn)],
    increasing: { marker: { color: "#16803a" } },
    decreasing: { marker: { color: "#b42318" } },
    totals: { marker: { color: "#0f766e" } },
  }], layout("Contribution to return", "Contribution (%)"), plotConfig);

  const sortedByReturn = [...rows].sort((a, b) => b.return - a.return);
  Plotly.react("returnsChart", [{
    type: "bar",
    x: sortedByReturn.map((row) => row.ticker),
    y: sortedByReturn.map((row) => row.return * 100),
    marker: { color: sortedByReturn.map((row) => row.return >= (Number.isFinite(benchmarkReturn) ? benchmarkReturn : 0) ? "#16803a" : "#b42318") },
    text: sortedByReturn.map((row) => fmtPct(row.return)),
    textposition: "outside",
  }], {
    ...layout("Holding returns", "Return (%)"),
    shapes: Number.isFinite(benchmarkReturn)
      ? [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: benchmarkReturn * 100, y1: benchmarkReturn * 100, line: { dash: "dash", color: theme.muted } }]
      : [],
  }, plotConfig);

  const returns = rows.map((row) => row.return);
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
  const weightedVar = rows.reduce((sum, row) => sum + row.weight * (row.return - portfolioReturn) ** 2, 0);
  $("riskStd").textContent = fmtPct(Math.sqrt(variance));
  $("riskMean").textContent = fmtPct(mean);
  $("riskWeighted").textContent = fmtPct(Math.sqrt(weightedVar));

  renderTickerSelect(rows);
  renderTable(rows);
  renderComparison();
}

const BRAND_COLORWAY = [
  "#8a0a1f", // Galway maroon
  "#c9a14a", // Galway gold
  "#5e0414", // deep maroon
  "#0f766e", // teal
  "#1f3a5f", // navy
  "#b03b4e", // soft maroon
  "#6b6157", // warm grey
];

function layout(title, ytitle) {
  const theme = currentTheme();
  return {
    title: { text: "", font: { size: 1 } },
    margin: { l: 50, r: 20, t: 20, b: 50 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    colorway: BRAND_COLORWAY,
    font: { family: "Inter, system-ui, sans-serif", color: theme.text },
    yaxis: { title: ytitle || "", gridcolor: theme.grid, zerolinecolor: theme.zero },
    xaxis: { gridcolor: theme.grid, zerolinecolor: theme.zero },
    showlegend: true,
  };
}

function sectorLayout() {
  return {
    ...layout("Sector allocation"),
    margin: { l: 12, r: 12, t: 12, b: 92 },
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.12,
      yanchor: "top",
      font: { size: 12 },
    },
    uniformtext: { mode: "hide", minsize: 11 },
  };
}

function renderTickerSelect(rows) {
  const select = $("tickerSelect");
  const current = select.value || rows[0]?.ticker;
  select.innerHTML = rows.map((row) => `<option value="${row.ticker}">${row.ticker}</option>`).join("");
  select.value = rows.some((row) => row.ticker === current) ? current : rows[0]?.ticker;
  renderStockDetail(rows);
}

function renderStockDetail(rows) {
  const row = rows.find((item) => item.ticker === $("tickerSelect").value) || rows[0];
  if (!row) return;
  const url = row.url && row.url.startsWith("http") ? row.url : `https://finance.yahoo.com/quote/${row.ticker}`;
  $("stockDetail").innerHTML = `
    <div><span>Company</span><strong>${row.company}</strong></div>
    <div><span>Sector</span><strong>${row.sector}</strong></div>
    <div><span>Holding Return</span><strong>${fmtPct(row.return)}</strong></div>
    <div><span>Portfolio Weight</span><strong>${fmtPct(row.weight)}</strong></div>
    <div><span>Contribution</span><strong>${fmtPct(row.contribution, true)}</strong></div>
    <div><span>Price Move</span><strong>${fmtMoney(row.priceStart)} to ${fmtMoney(row.priceEnd)}</strong></div>
    <div><span>Buy Date</span><strong>${escapeHtml(row.buyDate || periodStart)}</strong></div>
    <a href="${url}" target="_blank" rel="noreferrer">Open Yahoo Finance</a>
  `;
}

function renderTable(rows) {
  $("holdingsTable").innerHTML = `
    <thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Buy Date</th><th>Weight</th><th>Return</th><th>Contribution</th><th>Start</th><th>End</th></tr></thead>
    <tbody>${rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.ticker)}</td><td>${escapeHtml(row.company)}</td><td>${escapeHtml(row.sector)}</td>
        <td>${escapeHtml(row.buyDate || periodStart)}</td>
        <td>${fmtPct(row.weight)}</td><td>${fmtPct(row.return)}</td><td>${fmtPct(row.contribution, true)}</td>
        <td>${fmtMoney(row.priceStart)}</td><td>${fmtMoney(row.priceEnd)}</td>
      </tr>`).join("")}</tbody>
  `;
}

function renderComparison() {
  const panel = $("comparisonPanel");
  if (!uploadComparison) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const { previous, current, rows } = uploadComparison;
  $("comparisonTitle").textContent = `${previous.periodStart} to ${previous.periodEnd} vs ${current.periodStart} to ${current.periodEnd}`;
  const alphaDelta = Number.isFinite(previous.alpha) && Number.isFinite(current.alpha) ? current.alpha - previous.alpha : NaN;
  const benchmarkDelta = Number.isFinite(previous.benchmarkReturn) && Number.isFinite(current.benchmarkReturn)
    ? current.benchmarkReturn - previous.benchmarkReturn
    : NaN;
  $("comparisonStats").innerHTML = `
    <div><span>Portfolio Return Change</span><strong class="${toneClass(current.portfolioReturn - previous.portfolioReturn)}">${fmtPct(current.portfolioReturn - previous.portfolioReturn, true)}</strong></div>
    <div><span>Benchmark Change</span><strong class="${toneClass(benchmarkDelta)}">${fmtPct(benchmarkDelta, true)}</strong></div>
    <div><span>Alpha Change</span><strong class="${toneClass(alphaDelta)}">${fmtPct(alphaDelta, true)}</strong></div>
  `;
  const sorted = [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return Math.abs(b.returnDelta || 0) - Math.abs(a.returnDelta || 0);
  });
  $("comparisonTable").innerHTML = `
    <thead><tr><th>Ticker</th><th>Status</th><th>Previous Return</th><th>Current Return</th><th>Return Change</th><th>Previous Price</th><th>Current Price</th><th>Price Change</th></tr></thead>
    <tbody>${sorted.map((row) => `
      <tr>
        <td>${escapeHtml(row.ticker)}</td>
        <td>${row.status}</td>
        <td>${fmtPct(row.priorReturn)}</td>
        <td>${row.status === "Removed" ? "--" : fmtPct(row.return)}</td>
        <td class="${toneClass(row.returnDelta)}">${fmtPct(row.returnDelta, true)}</td>
        <td>${fmtMoney(row.priorPriceEnd)}</td>
        <td>${row.status === "Removed" ? "--" : fmtMoney(row.priceEnd)}</td>
        <td class="${toneClass(row.priceDelta)}">${fmtSignedMoney(row.priceDelta)}</td>
      </tr>`).join("")}</tbody>
  `;
}

function yahooQuotePrice(quote) {
  if (!quote) return NaN;
  return Number(
    quote.regularMarketPrice
    ?? quote.postMarketPrice
    ?? quote.preMarketPrice
    ?? quote.bid
    ?? quote.ask,
  );
}

function quoteCurrency(quote, holding) {
  return quote?.currency || (holding.exchange || "").split("/").at(-1)?.trim() || "";
}

function liveSymbols() {
  return [...new Set(holdings.map((row) => row.ticker).filter(Boolean))];
}

async function fetchLiveQuotes({ silent = false } = {}) {
  const symbols = liveSymbols();
  if (!symbols.length || liveQuoteState.loading) return;
  liveQuoteState = { ...liveQuoteState, loading: true, error: "", requested: symbols.length };
  if (!silent) renderLiveMode();
  try {
    const response = await fetch(`/api/live-quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Quote request failed (${response.status})`);
    liveQuotes = new Map((payload.quotes || []).map((quote) => [String(quote.symbol || "").toUpperCase(), quote]));
    liveQuoteState = {
      loading: false,
      error: "",
      fetchedAt: payload.fetchedAt || Math.floor(Date.now() / 1000),
      requested: symbols.length,
    };
  } catch (error) {
    liveQuoteState = {
      ...liveQuoteState,
      loading: false,
      error: error instanceof Error ? error.message : "Live quote request failed.",
    };
  }
  renderLiveMode();
}

function renderLiveMode() {
  const table = $("liveQuotesTable");
  if (!table) return;
  const rows = activeHoldings().map((holding) => {
    const quote = liveQuotes.get(holding.ticker.toUpperCase());
    const livePrice = yahooQuotePrice(quote);
    const liveReturn = holding.priceStart > 0 && Number.isFinite(livePrice) ? livePrice / holding.priceStart - 1 : NaN;
    const moveSinceCsv = holding.priceEnd > 0 && Number.isFinite(livePrice) ? livePrice / holding.priceEnd - 1 : NaN;
    return { ...holding, quote, livePrice, liveReturn, moveSinceCsv, liveContribution: holding.weight * liveReturn };
  });
  const coveredRows = rows.filter((row) => Number.isFinite(row.livePrice));
  const livePortfolioReturn = coveredRows.reduce((sum, row) => sum + row.liveContribution, 0);
  const csvPortfolioReturn = coveredRows.reduce((sum, row) => sum + row.weight * row.return, 0);
  const liveMove = livePortfolioReturn - csvPortfolioReturn;
  const coverageLabel = `${coveredRows.length}/${rows.length}`;

  $("liveCoverage").textContent = coverageLabel;
  $("livePortfolioReturn").textContent = coveredRows.length ? fmtPct(livePortfolioReturn) : "--";
  $("livePortfolioReturn").className = toneClass(livePortfolioReturn);
  $("livePortfolioMove").textContent = coveredRows.length ? fmtPct(liveMove, true) : "--";
  $("livePortfolioMove").className = toneClass(liveMove);
  $("liveUpdated").textContent = liveQuoteState.fetchedAt ? fmtDateTime(liveQuoteState.fetchedAt) : "--";

  const status = $("liveStatus");
  if (liveQuoteState.loading) {
    status.textContent = "Refreshing Yahoo Finance quotes...";
  } else if (liveQuoteState.error) {
    status.textContent = liveQuoteState.error;
  } else if (coveredRows.length) {
    status.textContent = `Showing Yahoo Finance quotes for ${coverageLabel} loaded CSV holdings.`;
  } else {
    status.textContent = "Click Refresh Quotes to pull live prices for the loaded CSV tickers.";
  }

  table.innerHTML = `
    <thead><tr><th>Ticker</th><th>Company</th><th>Exchange</th><th>Last Price</th><th>Day Change</th><th>Live Return</th><th>Since CSV End</th><th>Weight</th><th>Live Contribution</th><th>Quote Time</th></tr></thead>
    <tbody>${rows.map((row) => {
      const quote = row.quote;
      const dayChange = Number(quote?.regularMarketChangePercent) / 100;
      const url = row.url && row.url.startsWith("http") ? row.url : `https://finance.yahoo.com/quote/${row.ticker}`;
      return `
        <tr>
          <td><a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(row.ticker)}</a></td>
          <td>${escapeHtml(row.company)}</td>
          <td>${escapeHtml(quote?.fullExchangeName || row.exchange || "--")}</td>
          <td>${quoteCurrency(quote, row)} ${fmtNumber(row.livePrice)}</td>
          <td class="${toneClass(dayChange)}">${fmtPct(dayChange, true)}</td>
          <td class="${toneClass(row.liveReturn)}">${fmtPct(row.liveReturn, true)}</td>
          <td class="${toneClass(row.moveSinceCsv)}">${fmtPct(row.moveSinceCsv, true)}</td>
          <td>${fmtPct(row.weight)}</td>
          <td class="${toneClass(row.liveContribution)}">${fmtPct(row.liveContribution, true)}</td>
          <td>${fmtDateTime(Number(quote?.regularMarketTime))}</td>
        </tr>`;
    }).join("")}</tbody>
  `;
}

function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsPriceGreeks(S, K, T, r, sigma, type) {
  const isCall = type === "Call";
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const price = isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price, delta: 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const disc = Math.exp(-r * T);
  const price = isCall ? S * normCdf(d1) - K * disc * normCdf(d2) : K * disc * normCdf(-d2) - S * normCdf(-d1);
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const thetaYear = isCall
    ? -(S * normPdf(d1) * sigma) / (2 * sqrtT) - r * K * disc * normCdf(d2)
    : -(S * normPdf(d1) * sigma) / (2 * sqrtT) + r * K * disc * normCdf(-d2);
  return { price, delta, gamma, theta: thetaYear / 365, vega: (S * normPdf(d1) * sqrtT) / 100 };
}

function optionPrice(S, K, T, r, sigma, type) {
  return bsPriceGreeks(S, K, T, r, sigma, type).price;
}

function renderOptions() {
  const { rows } = portfolioStats();
  const tickerSelect = $("optionTicker");
  const signature = rows.map((row) => row.ticker).join("|");
  if (signature !== optionTickerSignature) {
    const previous = tickerSelect.value;
    tickerSelect.innerHTML = rows.map((row) => `<option value="${row.ticker}">${row.ticker}</option>`).join("");
    $("presetSelect").innerHTML = PRESETS.map((preset) => `<option>${preset}</option>`).join("");
    tickerSelect.value = rows.some((row) => row.ticker === previous) ? previous : rows[0]?.ticker || "";
    const selected = rows.find((row) => row.ticker === tickerSelect.value) || rows[0];
    $("spotInput").value = selected?.priceEnd?.toFixed(2) || "100.00";
    optionTickerSignature = signature;
    renderLegs(true);
  }
  renderLegs();
  calculateOptions();
}

function defaultLegs() {
  const spot = Number($("spotInput").value) || 100;
  return [
    { enabled: true, action: "Buy", type: "Call", strike: spot, qty: 1 },
    { enabled: false, action: "Sell", type: "Call", strike: spot * 1.05, qty: 1 },
    { enabled: false, action: "Sell", type: "Put", strike: spot * 0.95, qty: 1 },
    { enabled: false, action: "Buy", type: "Put", strike: spot, qty: 1 },
  ];
}

function presetLegs(preset) {
  const spot = Number($("spotInput").value) || 100;
  const sigma = (Number($("ivInput").value) || 25) / 100;
  const days = Number($("daysInput").value) || 30;
  const move = spot * sigma * Math.sqrt(days / 365);
  if (preset === "Bull Call Spread") {
    return [
      { enabled: true, action: "Buy", type: "Call", strike: spot - 0.5 * move, qty: 1 },
      { enabled: true, action: "Sell", type: "Call", strike: spot + 0.5 * move, qty: 1 },
      { enabled: false, action: "Buy", type: "Call", strike: spot, qty: 1 },
      { enabled: false, action: "Buy", type: "Call", strike: spot, qty: 1 },
    ];
  }
  if (preset === "Iron Condor") {
    return [
      { enabled: true, action: "Buy", type: "Put", strike: spot - 2 * move, qty: 1 },
      { enabled: true, action: "Sell", type: "Put", strike: spot - move, qty: 1 },
      { enabled: true, action: "Sell", type: "Call", strike: spot + move, qty: 1 },
      { enabled: true, action: "Buy", type: "Call", strike: spot + 2 * move, qty: 1 },
    ];
  }
  if (preset === "Straddle") {
    return [
      { enabled: true, action: "Buy", type: "Call", strike: spot, qty: 1 },
      { enabled: true, action: "Buy", type: "Put", strike: spot, qty: 1 },
      { enabled: false, action: "Buy", type: "Call", strike: spot, qty: 1 },
      { enabled: false, action: "Buy", type: "Call", strike: spot, qty: 1 },
    ];
  }
  return defaultLegs();
}

function renderLegs(forcePreset = false) {
  const container = $("legs");
  if (container.children.length && !forcePreset) return;
  const legs = forcePreset ? presetLegs($("presetSelect").value) : defaultLegs();
  container.innerHTML = legs.map((leg, index) => `
    <div class="leg" data-leg="${index}">
      <label class="active"><input type="checkbox" class="leg-enabled" ${leg.enabled ? "checked" : ""} /> Leg ${index + 1}</label>
      <label>Action<select class="leg-action"><option ${leg.action === "Buy" ? "selected" : ""}>Buy</option><option ${leg.action === "Sell" ? "selected" : ""}>Sell</option></select></label>
      <label>Type<select class="leg-type"><option ${leg.type === "Call" ? "selected" : ""}>Call</option><option ${leg.type === "Put" ? "selected" : ""}>Put</option></select></label>
      <label>Strike<input class="leg-strike" type="number" min="0.01" step="0.01" value="${leg.strike.toFixed(2)}" /></label>
      <label>Qty<input class="leg-qty" type="number" min="1" step="1" value="${leg.qty}" /></label>
    </div>
  `).join("");
  container.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", calculateOptions));
}

function readLegs() {
  return [...document.querySelectorAll(".leg")]
    .map((el) => ({
      enabled: el.querySelector(".leg-enabled").checked,
      action: el.querySelector(".leg-action").value,
      type: el.querySelector(".leg-type").value,
      strike: Number(el.querySelector(".leg-strike").value),
      qty: Number(el.querySelector(".leg-qty").value) || 1,
    }))
    .filter((leg) => leg.enabled && leg.strike > 0);
}

function calculateOptions() {
  const spot = Number($("spotInput").value) || 100;
  const sigma = Math.max(0.001, (Number($("ivInput").value) || 25) / 100);
  const r = (Number($("rateInput").value) || 0) / 100;
  const days = Math.max(1, Number($("daysInput").value) || 30);
  const T = days / 365;
  const legs = readLegs().map((leg) => ({ ...leg, price: optionPrice(spot, leg.strike, T, r, sigma, leg.type) }));
  const prices = Array.from({ length: 241 }, (_, i) => Math.max(0.01, spot * 0.5 + (spot * i) / 240));
  const expiry = prices.map((S) => legs.reduce((sum, leg) => {
    const intrinsic = leg.type === "Call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
    const sign = leg.action === "Buy" ? 1 : -1;
    return sum + sign * (intrinsic - leg.price) * leg.qty;
  }, 0));
  const today = prices.map((S) => legs.reduce((sum, leg) => {
    const sign = leg.action === "Buy" ? 1 : -1;
    return sum + sign * (optionPrice(S, leg.strike, T, r, sigma, leg.type) - leg.price) * leg.qty;
  }, 0));
  const premium = legs.reduce((sum, leg) => sum + (leg.action === "Buy" ? 1 : -1) * leg.price * leg.qty, 0);
  $("netPremium").textContent = fmtMoney(premium);
  $("maxProfit").textContent = fmtMoney(Math.max(...expiry));
  $("maxLoss").textContent = fmtMoney(Math.min(...expiry));
  $("breakeven").textContent = findBreakevens(prices, expiry).map(fmtMoney).join(", ") || "--";

  Plotly.react("payoffChart", [
    { type: "scatter", mode: "lines", name: "At expiration", x: prices, y: expiry, line: { color: "#0f766e", width: 3 } },
    { type: "scatter", mode: "lines", name: "Today", x: prices, y: today, line: { color: "#d97706", dash: "dash" } },
  ], {
    ...layout("Payoff", "P&L per share"),
    xaxis: { title: "Underlying price" },
    shapes: [
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#667085" } },
      { type: "line", yref: "paper", y0: 0, y1: 1, x0: spot, x1: spot, line: { color: "#17202a", dash: "dot" } },
    ],
  }, plotConfig);

  const priceChanges = Array.from({ length: 21 }, (_, i) => -0.2 + i * 0.02);
  const daysGrid = Array.from({ length: 21 }, (_, i) => days - (days * i) / 20);
  const z = daysGrid.map((remaining) => priceChanges.map((chg) => {
    const S = spot * (1 + chg);
    const t = Math.max(0.000001, remaining / 365);
    return legs.reduce((sum, leg) => {
      const sign = leg.action === "Buy" ? 1 : -1;
      return sum + sign * (optionPrice(S, leg.strike, t, r, sigma, leg.type) - leg.price) * leg.qty;
    }, 0);
  }));
  const maxAbs = Math.max(1, ...z.flat().map(Math.abs));
  Plotly.react("heatmapChart", [{
    type: "heatmap",
    z,
    x: priceChanges.map((chg) => `${(chg * 100).toFixed(0)}%`),
    y: daysGrid.map((d) => `${Math.round(d)}d`),
    colorscale: "RdYlGn",
    zmin: -maxAbs,
    zmax: maxAbs,
  }], layout("Risk heatmap", "Days remaining"), plotConfig);
}

function findBreakevens(xs, ys) {
  const points = [];
  for (let i = 0; i < ys.length - 1; i += 1) {
    if (ys[i] === 0) points.push(xs[i]);
    if (Math.sign(ys[i]) !== Math.sign(ys[i + 1])) {
      points.push(xs[i] - ys[i] * (xs[i + 1] - xs[i]) / (ys[i + 1] - ys[i]));
    }
  }
  return points;
}

function wireEvents() {
  const savedTheme = localStorage.getItem("smf-theme");
  if (savedTheme === "dark") document.body.dataset.theme = "dark";
  $("themeToggle").textContent = isDarkMode() ? "Day mode" : "Night mode";
  $("themeToggle").addEventListener("click", () => {
    document.body.dataset.theme = isDarkMode() ? "" : "dark";
    localStorage.setItem("smf-theme", isDarkMode() ? "dark" : "light");
    $("themeToggle").textContent = isDarkMode() ? "Day mode" : "Night mode";
    renderAll();
  });
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      $("portfolioTab").classList.toggle("hidden", button.dataset.tab !== "portfolio");
      $("liveTab").classList.toggle("hidden", button.dataset.tab !== "live");
      $("optionsTab").classList.toggle("hidden", button.dataset.tab !== "options");
      if (button.dataset.tab === "live" && !liveQuotes.size && !liveQuoteState.loading) {
        fetchLiveQuotes();
      }
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    });
  });
  $("resetWeights").addEventListener("click", () => {
    resetDraftFromHoldings();
  });
  $("applyWeights").addEventListener("click", applyDraftWeights);
  $("refreshLiveQuotes").addEventListener("click", () => fetchLiveQuotes());
  $("tickerSelect").addEventListener("change", () => renderStockDetail(portfolioStats().rows));
  $("csvUpload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) loadPortfolio(await file.text(), { compare: true });
  });
  $("optionTicker").addEventListener("change", () => {
    const row = portfolioStats().rows.find((item) => item.ticker === $("optionTicker").value);
    if (row) $("spotInput").value = row.priceEnd.toFixed(2);
    renderLegs(true);
    calculateOptions();
  });
  ["spotInput", "ivInput", "rateInput", "daysInput"].forEach((id) => $(id).addEventListener("input", calculateOptions));
  $("presetSelect").addEventListener("change", () => {
    renderLegs(true);
    calculateOptions();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  const response = await fetch("/portfolio.csv");
  loadPortfolio(await response.text());
});
