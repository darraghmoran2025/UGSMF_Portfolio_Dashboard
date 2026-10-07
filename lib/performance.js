import { fetchHistory, priceOn } from "./yahoo.js";

// Each sector is a fixed sleeve of the fund (e.g. Financials = 7%). A sleeve
// starts as cash worth 1.0. Whenever a stock in that sector is bought or sold,
// the sleeve's current value is re-split across the stocks it then holds
// (equally, or by each holding's optional `share`). The sector's weight in the
// fund never changes; only how it is divided between its stocks does.
//
// Portfolio return = sum over sectors of weight x sleeve return.

function holdingId(holding) {
  return `${holding.ticker}|${holding.buyDate}`;
}

function sharesFor(held) {
  const explicit = held.every((holding) => Number.isFinite(holding.share));
  const raw = held.map((holding) => (explicit ? holding.share : 1));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

function buildSleeve(sectorHoldings, histories) {
  const events = new Map();
  const addEvent = (date, type, holding) => {
    if (!events.has(date)) events.set(date, []);
    events.get(date).push({ type, holding });
  };
  sectorHoldings.forEach((holding) => {
    addEvent(holding.buyDate, "buy", holding);
    if (holding.sellDate) addEvent(holding.sellDate, "sell", holding);
  });

  const periods = [];
  const held = new Map();
  let units = new Map();
  let cash = 1;

  [...events.keys()].sort().forEach((date) => {
    const dayEvents = events.get(date);
    const soldToday = new Map(dayEvents.filter((e) => e.type === "sell").map((e) => [holdingId(e.holding), e.holding.sellPrice]));
    const priceAt = (holding) => {
      const id = holdingId(holding);
      if (soldToday.has(id)) return soldToday.get(id);
      return priceOn(histories.get(holding.ticker), date);
    };

    // Mark the sleeve to market on the event date, closing the previous period.
    let value = cash;
    held.forEach((holding, id) => { value += units.get(id) * priceAt(holding); });
    if (periods.length) periods.at(-1).exitPrices = new Map([...held].map(([id, holding]) => [id, priceAt(holding)]));

    dayEvents.forEach(({ type, holding }) => {
      const id = holdingId(holding);
      if (type === "sell") held.delete(id);
      else if (!holding.sellDate || holding.sellDate > date) held.set(id, holding);
    });

    const heldList = [...held.values()];
    units = new Map();
    const entryPrices = new Map();
    if (heldList.length) {
      const shares = sharesFor(heldList);
      heldList.forEach((holding, index) => {
        const id = holdingId(holding);
        const price = holding.buyDate === date ? holding.buyPrice : priceOn(histories.get(holding.ticker), date);
        units.set(id, (value * shares[index]) / price);
        entryPrices.set(id, price);
      });
      cash = 0;
    } else {
      cash = value;
    }
    periods.push({ start: date, cash, units: new Map(units), holdings: new Map(held), entryPrices });
  });

  const valueAt = (date) => {
    let period = null;
    for (const candidate of periods) {
      if (candidate.start <= date) period = candidate;
      else break;
    }
    if (!period) return 1;
    let value = period.cash;
    period.holdings.forEach((holding, id) => {
      value += period.units.get(id) * priceOn(histories.get(holding.ticker), date);
    });
    return value;
  };

  return { periods, valueAt };
}

export async function computePerformance(ledger) {
  const holdings = ledger.holdings || [];
  const tickers = [...new Set(holdings.map((holding) => holding.ticker))];
  const inception = holdings.reduce((min, holding) => (holding.buyDate < min ? holding.buyDate : min), holdings[0]?.buyDate || new Date().toISOString().slice(0, 10));
  const benchmarkSymbol = ledger.benchmark?.symbol || "^990100-USD-STRD";

  const errors = [];
  const histories = new Map();
  const results = await Promise.allSettled([...tickers, benchmarkSymbol].map((symbol) => fetchHistory(symbol, inception)));
  [...tickers, benchmarkSymbol].forEach((symbol, index) => {
    const result = results[index];
    if (result.status === "fulfilled" && result.value.series.length) histories.set(symbol, result.value);
    else errors.push(result.reason?.message || `${symbol}: no price data`);
  });

  // Holdings without price data are priced flat at their buy price so the rest still computes.
  holdings.forEach((holding) => {
    if (!histories.has(holding.ticker)) {
      histories.set(holding.ticker, { livePrice: holding.buyPrice, previousClose: NaN, series: [{ date: holding.buyDate, close: holding.buyPrice }], stale: true });
    }
  });

  const asOfDay = histories.get(benchmarkSymbol)?.series.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const sectorRows = [];
  const holdingRows = [];
  const sleeves = [];

  (ledger.sectors || []).forEach((sector) => {
    const weight = sector.weight / 100;
    const sectorHoldings = holdings.filter((holding) => holding.sector === sector.name);
    const sleeve = buildSleeve(sectorHoldings, histories);
    sleeves.push({ weight, sleeve });

    // Contribution of each holding = weight x units x price move, summed across periods.
    const contributions = new Map();
    sleeve.periods.forEach((period, index) => {
      const isLast = index === sleeve.periods.length - 1;
      period.holdings.forEach((holding, id) => {
        const exitPrice = isLast ? histories.get(holding.ticker).livePrice : period.exitPrices.get(id);
        const move = period.units.get(id) * (exitPrice - period.entryPrices.get(id));
        contributions.set(id, (contributions.get(id) || 0) + weight * move);
      });
    });

    const lastPeriod = sleeve.periods.at(-1);
    const sleeveValue = sleeve.valueAt("9999-12-31");
    sectorHoldings.forEach((holding) => {
      const id = `${holding.ticker}|${holding.buyDate}`;
      const history = histories.get(holding.ticker);
      const sold = Boolean(holding.sellDate);
      const price = sold ? holding.sellPrice : history.livePrice;
      const isHeld = lastPeriod?.holdings.has(id);
      const currentWeight = isHeld && sleeveValue > 0
        ? (weight * lastPeriod.units.get(id) * history.livePrice) / sleeveValue
        : 0;
      holdingRows.push({
        ticker: holding.ticker,
        company: holding.company,
        sector: holding.sector,
        buyDate: holding.buyDate,
        buyPrice: holding.buyPrice,
        sellDate: holding.sellDate || null,
        price,
        currency: history.currency || "",
        status: sold ? "sold" : "held",
        return: price / holding.buyPrice - 1,
        dayChange: !sold && Number.isFinite(history.previousClose) ? history.livePrice / history.previousClose - 1 : null,
        weight: currentWeight,
        contribution: contributions.get(id) || 0,
        stale: Boolean(history.stale),
      });
    });

    sectorRows.push({
      name: sector.name,
      weight,
      return: sleeveValue - 1,
      contribution: weight * (sleeveValue - 1),
      holdings: sectorHoldings.filter((holding) => !holding.sellDate).length,
    });
  });

  const portfolioReturn = sectorRows.reduce((sum, row) => sum + row.contribution, 0);
  const benchmarkHistory = histories.get(benchmarkSymbol);
  const benchmarkStart = priceOn(benchmarkHistory, inception);
  const benchmarkReturn = benchmarkHistory ? benchmarkHistory.livePrice / benchmarkStart - 1 : NaN;

  const series = (benchmarkHistory?.series || [])
    .filter((point) => point.date >= inception)
    .map((point) => ({
      date: point.date,
      portfolio: sleeves.reduce((sum, { weight, sleeve }) => sum + weight * (sleeve.valueAt(point.date) - 1), 0),
      benchmark: point.close / benchmarkStart - 1,
    }));

  return {
    asOf: new Date().toISOString(),
    asOfDay,
    inception,
    portfolioReturn,
    benchmark: {
      symbol: benchmarkSymbol,
      name: ledger.benchmark?.name || benchmarkSymbol,
      return: benchmarkReturn,
    },
    alpha: Number.isFinite(benchmarkReturn) ? portfolioReturn - benchmarkReturn : null,
    sectors: sectorRows,
    holdings: holdingRows.sort((a, b) => a.buyDate.localeCompare(b.buyDate) || a.sector.localeCompare(b.sector)),
    series,
    errors,
    ledgerUpdatedAt: ledger.updatedAt || null,
  };
}
