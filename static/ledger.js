// Website Ledger tab: edit the fund's sectors and buys, preview, and publish to
// the website's Performance-To-Date page via /api/portfolio.
(() => {
  let ledger = null;
  let lookupTimer = null;

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const pct = (value, signed = true) => {
    if (!Number.isFinite(value)) return "--";
    return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
  };
  const tone = (value) => (!Number.isFinite(value) ? "" : value >= 0 ? "positive" : "negative");
  const today = () => new Date().toISOString().slice(0, 10);

  function setStatus(id, text, isError = false) {
    el(id).textContent = text;
    el(id).classList.toggle("negative", isError);
  }

  function showErrors(errors = []) {
    el("ledgerErrors").innerHTML = errors.map((error) => `<li>${esc(error)}</li>`).join("");
  }

  async function loadLedger() {
    setStatus("ledgerStatus", "Loading the published ledger…");
    try {
      const response = await fetch("/api/portfolio", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load the ledger.");
      ledger = structuredClone(payload.ledger);
      const updated = payload.ledger.updatedAt ? new Date(payload.ledger.updatedAt).toLocaleString() : "never";
      const sourceText = payload.source === "published"
        ? `Showing the ledger live on the website (last published ${updated}).`
        : "Nothing published yet — showing the starting ledger from portfolio.csv. The website uses this until you publish.";
      const writeText = payload.writable ? "" : " Publishing is not set up yet on the server (needs a Blob store and ADMIN_PASSWORD).";
      setStatus("ledgerStatus", sourceText + writeText);
      el("ledgerPreviewPanel").classList.add("hidden");
      showErrors();
      renderLedger();
    } catch (error) {
      setStatus("ledgerStatus", error.message, true);
    }
  }

  function renderLedger() {
    renderSectors();
    renderSectorSelect();
    renderHoldings();
  }

  function renderSectors() {
    el("ledgerSectors").innerHTML = ledger.sectors.map((sector, index) => {
      const count = ledger.holdings.filter((holding) => holding.sector === sector.name && !holding.sellDate).length;
      return `
        <div class="ledger-sector" data-index="${index}">
          <input class="ledger-sector-name" type="text" value="${esc(sector.name)}" aria-label="Sector name" />
          <input class="ledger-sector-weight" type="number" min="0" max="100" step="0.01" value="${sector.weight}" aria-label="${esc(sector.name)} weight" />
          <span class="muted-note">% · ${count} held</span>
          <button class="ledger-remove" type="button" title="Remove sector" ${count ? "disabled" : ""}>×</button>
        </div>`;
    }).join("");
    renderSectorTotal();

    el("ledgerSectors").querySelectorAll(".ledger-sector").forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector(".ledger-sector-weight").addEventListener("input", (event) => {
        ledger.sectors[index].weight = Number(event.target.value) || 0;
        renderSectorTotal();
      });
      row.querySelector(".ledger-sector-name").addEventListener("change", (event) => {
        const oldName = ledger.sectors[index].name;
        const newName = event.target.value.trim();
        if (!newName) { event.target.value = oldName; return; }
        ledger.sectors[index].name = newName;
        ledger.holdings.forEach((holding) => { if (holding.sector === oldName) holding.sector = newName; });
        renderLedger();
      });
      row.querySelector(".ledger-remove").addEventListener("click", () => {
        ledger.sectors.splice(index, 1);
        renderLedger();
      });
    });
  }

  function renderSectorTotal() {
    const total = ledger.sectors.reduce((sum, sector) => sum + (Number(sector.weight) || 0), 0);
    const ok = Math.abs(total - 100) <= 0.05;
    setStatus("ledgerSectorTotal", `Total ${total.toFixed(2)}%${ok ? "" : " — sector weights must add to 100% before publishing."}`, !ok);
  }

  function renderSectorSelect() {
    const current = el("ledgerSector").value;
    el("ledgerSector").innerHTML = ledger.sectors.map((sector) => `<option>${esc(sector.name)}</option>`).join("");
    if (ledger.sectors.some((sector) => sector.name === current)) el("ledgerSector").value = current;
  }

  function renderHoldings() {
    const rows = ledger.holdings
      .map((holding, index) => ({ holding, index }))
      .sort((a, b) => a.holding.buyDate.localeCompare(b.holding.buyDate) || a.holding.sector.localeCompare(b.holding.sector));
    el("ledgerHoldings").innerHTML = `
      <thead><tr>
        <th>Ticker</th><th>Company</th><th>Sector</th><th>Buy Date</th><th>Buy Price</th>
        <th title="Optional. Relative share of the sector slice; blank = equal split.">Sector Share</th>
        <th>Sell Date</th><th>Sell Price</th><th></th>
      </tr></thead>
      <tbody>${rows.map(({ holding, index }) => `
        <tr data-index="${index}">
          <td><strong>${esc(holding.ticker)}</strong></td>
          <td>${esc(holding.company)}</td>
          <td>${esc(holding.sector)}</td>
          <td>${esc(holding.buyDate)}</td>
          <td>${Number(holding.buyPrice).toFixed(2)}</td>
          <td><input class="ledger-share" type="number" min="0" step="any" placeholder="equal" value="${holding.share ?? ""}" /></td>
          <td><input class="ledger-sell-date" type="date" value="${holding.sellDate ?? ""}" /></td>
          <td><input class="ledger-sell-price" type="number" min="0" step="any" value="${holding.sellPrice ?? ""}" /></td>
          <td><button class="ledger-remove" type="button" title="Delete this entry">×</button></td>
        </tr>`).join("")}
      </tbody>`;

    el("ledgerHoldings").querySelectorAll("tbody tr").forEach((row) => {
      const holding = ledger.holdings[Number(row.dataset.index)];
      row.querySelector(".ledger-share").addEventListener("change", (event) => {
        const value = Number(event.target.value);
        if (value > 0) holding.share = value;
        else delete holding.share;
      });
      row.querySelector(".ledger-sell-date").addEventListener("change", (event) => {
        if (event.target.value) holding.sellDate = event.target.value;
        else { delete holding.sellDate; delete holding.sellPrice; }
        renderLedger();
      });
      row.querySelector(".ledger-sell-price").addEventListener("change", (event) => {
        holding.sellPrice = Number(event.target.value) || null;
      });
      row.querySelector(".ledger-remove").addEventListener("click", () => {
        ledger.holdings.splice(Number(row.dataset.index), 1);
        renderLedger();
      });
    });
  }

  async function lookUpPrice() {
    const symbol = el("ledgerTicker").value.trim().toUpperCase();
    const date = el("ledgerDate").value || today();
    if (!symbol) return;
    setStatus("ledgerLookup", `Looking up ${symbol}…`);
    try {
      const response = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}&date=${date}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!el("ledgerCompany").value) el("ledgerCompany").value = payload.name;
      if (!el("ledgerPrice").value && Number.isFinite(payload.close)) el("ledgerPrice").value = payload.close.toFixed(2);
      setStatus("ledgerLookup", `${payload.name} · close on ${date}: ${payload.close.toFixed(2)} ${payload.currency} · live ${Number(payload.livePrice).toFixed(2)}`);
    } catch (error) {
      setStatus("ledgerLookup", error.message || `Could not find ${symbol} on Yahoo Finance.`, true);
    }
  }

  function addHolding(event) {
    event.preventDefault();
    const holding = {
      ticker: el("ledgerTicker").value.trim().toUpperCase(),
      company: el("ledgerCompany").value.trim() || el("ledgerTicker").value.trim().toUpperCase(),
      sector: el("ledgerSector").value,
      buyDate: el("ledgerDate").value,
      buyPrice: Number(el("ledgerPrice").value),
    };
    if (!(holding.buyPrice > 0)) {
      setStatus("ledgerLookup", "Enter a buy price or press Look Up Price.", true);
      return;
    }
    if (ledger.holdings.some((row) => row.ticker === holding.ticker && row.buyDate === holding.buyDate)) {
      setStatus("ledgerLookup", `${holding.ticker} is already recorded for ${holding.buyDate}.`, true);
      return;
    }
    ledger.holdings.push(holding);
    const siblings = ledger.holdings.filter((row) => row.sector === holding.sector && !row.sellDate).length;
    el("ledgerAddForm").reset();
    el("ledgerDate").value = today();
    renderLedger();
    setStatus("ledgerLookup", `Added ${holding.ticker}. ${holding.sector} is now split across ${siblings} holding${siblings === 1 ? "" : "s"}. Publish to update the website.`);
  }

  async function preview() {
    setStatus("ledgerStatus", "Calculating preview with live prices…");
    try {
      const response = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ledger),
      });
      const payload = await response.json();
      if (!response.ok) { showErrors(payload.errors || []); throw new Error(payload.error); }
      showErrors(payload.errors || []);
      el("ledgerPrevReturn").textContent = pct(payload.portfolioReturn);
      el("ledgerPrevBenchmark").textContent = pct(payload.benchmark.return);
      el("ledgerPrevAlpha").textContent = pct(payload.alpha);
      el("ledgerPrevSince").textContent = payload.inception;
      el("ledgerPreviewTable").innerHTML = `
        <thead><tr><th>Ticker</th><th>Sector</th><th>Bought</th><th>Price</th><th>Return</th><th>Today</th><th>Weight Now</th><th>Contribution</th></tr></thead>
        <tbody>${payload.holdings.map((row) => `
          <tr>
            <td><strong>${esc(row.ticker)}</strong>${row.status === "sold" ? " (sold)" : ""}</td>
            <td>${esc(row.sector)}</td>
            <td>${esc(row.buyDate)}</td>
            <td>${Number(row.price).toFixed(2)} ${esc(row.currency)}</td>
            <td class="${tone(row.return)}">${pct(row.return)}</td>
            <td class="${tone(row.dayChange)}">${pct(row.dayChange)}</td>
            <td>${pct(row.weight, false)}</td>
            <td class="${tone(row.contribution)}">${pct(row.contribution)}</td>
          </tr>`).join("")}
        </tbody>`;
      el("ledgerPreviewPanel").classList.remove("hidden");
      setStatus("ledgerStatus", "Preview uses your unsaved edits. Publish to push them to the website.");
    } catch (error) {
      setStatus("ledgerStatus", error.message || "Preview failed.", true);
    }
  }

  async function publish(event) {
    event.preventDefault();
    setStatus("ledgerPublishStatus", "Publishing…");
    showErrors();
    try {
      const response = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-password": el("ledgerPassword").value },
        body: JSON.stringify(ledger),
      });
      const payload = await response.json();
      if (!response.ok) { showErrors(payload.errors || []); throw new Error(payload.error); }
      ledger = structuredClone(payload.ledger);
      renderLedger();
      setStatus("ledgerPublishStatus", `Published ${new Date(payload.ledger.updatedAt).toLocaleString()}. The website picks it up within about a minute.`);
    } catch (error) {
      setStatus("ledgerPublishStatus", error.message || "Publish failed.", true);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    el("ledgerDate").value = today();
    el("ledgerDate").max = today();
    el("ledgerAddForm").addEventListener("submit", addHolding);
    el("ledgerLookupButton").addEventListener("click", lookUpPrice);
    el("ledgerTicker").addEventListener("change", () => {
      el("ledgerCompany").value = "";
      el("ledgerPrice").value = "";
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(lookUpPrice, 150);
    });
    el("ledgerDate").addEventListener("change", () => {
      el("ledgerPrice").value = "";
      if (el("ledgerTicker").value) lookUpPrice();
    });
    el("ledgerAddSector").addEventListener("click", () => {
      ledger.sectors.push({ name: `New Sector ${ledger.sectors.length + 1}`, weight: 0 });
      renderLedger();
    });
    el("ledgerReload").addEventListener("click", loadLedger);
    el("ledgerPreview").addEventListener("click", preview);
    el("ledgerPublishForm").addEventListener("submit", publish);
    loadLedger();
  });
})();
