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
  MU: "Technology",
  BBIO: "Healthcare",
  WPM: "Real Assets",
  NEM: "Alternative Assets",
  BYD: "Consumer",
  "1211.HK": "Consumer",
  ALIZY: "Financials",
  "ALV.DE": "Financials",
};

const PRESETS = ["Custom", "Bull Call Spread", "Iron Condor", "Straddle"];

let holdings = [];
let benchmark = {
  name: "MSCI World Index",
  start: 4322.9,
  end: 4437.08,
};
let periodStart = "2025-10-20";
let periodEnd = "2026-03-11";
let sectorWeights = {};
let stockShares = {};
let optionTickerSignature = "";

const plotConfig = { responsive: true, displayModeBar: false };

function $(id) {
  return document.getElementById(id);
}

function fmtPct(value, signed = false) {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

function fmtMoney(value) {
  return `$${Number(value).toFixed(2)}`;
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
    const parsed = new Date(`${compact[1]} ${compact[2]} ${compact[3]}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const iso = col.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
  if (iso) {
    const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return NaN;
  return Number(String(value).replace(/[$,%]/g, "").trim());
}

function loadPortfolio(text) {
  const rows = parseCsv(text);
  const metaStart = rows.find((row) => row[0]?.toLowerCase() === "period start");
  const metaEnd = rows.find((row) => row[0]?.toLowerCase() === "period end");
  const metaBenchmark = rows.find((row) => row[0]?.toLowerCase() === "benchmark");
  if (metaStart?.[1]) periodStart = metaStart[1];
  if (metaEnd?.[1]) periodEnd = metaEnd[1];
  if (metaBenchmark) {
    benchmark = {
      name: metaBenchmark[1] || benchmark.name,
      start: cleanNumber(metaBenchmark[2]) || benchmark.start,
      end: cleanNumber(metaBenchmark[3]) || benchmark.end,
    };
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

  if (!headers.includes("Price_Start") && !headers.includes("Price_End") && priceColumns.length >= 2) {
    priceColumns.sort((a, b) => a.date - b.date);
    periodStart = priceColumns[0].date.toISOString().slice(0, 10);
    periodEnd = priceColumns[priceColumns.length - 1].date.toISOString().slice(0, 10);
    headers = headers.map((header, index) => {
      if (index === priceColumns[0].index) return "Price_Start";
      if (index === priceColumns[priceColumns.length - 1].index) return "Price_End";
      return header;
    });
  }

  const records = dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
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
      };
    });

  const benchRow = parsed.find((row) => row.sector === "Benchmark");
  if (benchRow) {
    benchmark = {
      name: benchRow.company || benchRow.ticker || benchmark.name,
      start: benchRow.priceStart || benchmark.start,
      end: benchRow.priceEnd || benchmark.end,
    };
  }

  holdings = parsed.filter((row) => row.sector !== "Benchmark");
  const missingWeights = holdings.every((row) => !row.weight);
  if (missingWeights && holdings.length) holdings.forEach((row) => { row.weight = 1 / holdings.length; });
  resetStateFromHoldings();
  renderAll();
}

function resetStateFromHoldings() {
  sectorWeights = Object.fromEntries(SECTORS.map((sector) => [sector, 0]));
  holdings.forEach((row) => { sectorWeights[row.sector] = (sectorWeights[row.sector] || 0) + row.weight * 100; });
  stockShares = {};
  SECTORS.forEach((sector) => {
    const rows = holdings.filter((row) => row.sector === sector);
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    rows.forEach((row) => { stockShares[row.ticker] = total ? (row.weight / total) * 100 : 100 / rows.length; });
  });
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
  const benchmarkReturn = benchmark.start ? benchmark.end / benchmark.start - 1 : 0;
  return { rows, portfolioReturn, benchmarkReturn, alpha: portfolioReturn - benchmarkReturn };
}

function renderAll() {
  renderControls();
  renderPortfolio();
  renderOptions();
}

function renderControls() {
  const container = $("sectorControls");
  container.innerHTML = "";
  SECTORS.forEach((sector) => {
    const row = document.createElement("div");
    row.className = "control-row";
    row.innerHTML = `
      <header><strong>${sector}</strong><span>${(sectorWeights[sector] || 0).toFixed(1)}%</span></header>
      <input type="range" min="0" max="100" step="0.1" value="${sectorWeights[sector] || 0}" />
    `;
    row.querySelector("input").addEventListener("input", (event) => {
      rebalanceSectors(sector, Number(event.target.value));
      renderAll();
    });
    container.appendChild(row);
  });
}

function rebalanceSectors(changed, value) {
  const capped = Math.max(0, Math.min(100, value));
  const others = SECTORS.filter((sector) => sector !== changed);
  const otherTotal = others.reduce((sum, sector) => sum + (sectorWeights[sector] || 0), 0);
  sectorWeights[changed] = capped;
  const remaining = 100 - capped;
  if (otherTotal <= 0) {
    others.forEach((sector) => { sectorWeights[sector] = remaining / others.length; });
  } else {
    others.forEach((sector) => { sectorWeights[sector] = (sectorWeights[sector] / otherTotal) * remaining; });
  }
}

function renderPortfolio() {
  const { rows, portfolioReturn, benchmarkReturn, alpha } = portfolioStats();
  $("portfolioReturn").textContent = fmtPct(portfolioReturn);
  $("benchmarkReturn").textContent = fmtPct(benchmarkReturn);
  $("alphaReturn").textContent = fmtPct(alpha, true);
  $("alphaReturn").className = alpha >= 0 ? "positive" : "negative";
  $("periodLabel").textContent = `${periodStart} to ${periodEnd}`;

  Plotly.react("sectorChart", [{
    type: "pie",
    labels: SECTORS,
    values: SECTORS.map((sector) => sectorWeights[sector] || 0),
    hole: 0.55,
    textinfo: "label+percent",
  }], layout("Sector allocation"), plotConfig);

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
    marker: { color: sortedByReturn.map((row) => row.return >= benchmarkReturn ? "#16803a" : "#b42318") },
    text: sortedByReturn.map((row) => fmtPct(row.return)),
    textposition: "outside",
  }], {
    ...layout("Holding returns", "Return (%)"),
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: benchmarkReturn * 100, y1: benchmarkReturn * 100, line: { dash: "dash", color: "#17202a" } }],
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
}

function layout(title, ytitle) {
  return {
    title: { text: "", font: { size: 1 } },
    margin: { l: 50, r: 20, t: 20, b: 50 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    yaxis: { title: ytitle || "" },
    showlegend: true,
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
    <a href="${url}" target="_blank" rel="noreferrer">Open Yahoo Finance</a>
  `;
}

function renderTable(rows) {
  $("holdingsTable").innerHTML = `
    <thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Weight</th><th>Return</th><th>Contribution</th><th>Start</th><th>End</th></tr></thead>
    <tbody>${rows.map((row) => `
      <tr>
        <td>${row.ticker}</td><td>${row.company}</td><td>${row.sector}</td>
        <td>${fmtPct(row.weight)}</td><td>${fmtPct(row.return)}</td><td>${fmtPct(row.contribution, true)}</td>
        <td>${fmtMoney(row.priceStart)}</td><td>${fmtMoney(row.priceEnd)}</td>
      </tr>`).join("")}</tbody>
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
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      $("portfolioTab").classList.toggle("hidden", button.dataset.tab !== "portfolio");
      $("optionsTab").classList.toggle("hidden", button.dataset.tab !== "options");
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    });
  });
  $("resetWeights").addEventListener("click", () => {
    resetStateFromHoldings();
    renderAll();
  });
  $("tickerSelect").addEventListener("change", () => renderStockDetail(portfolioStats().rows));
  $("csvUpload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) loadPortfolio(await file.text());
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
