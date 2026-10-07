const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

function isoDay(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

// Daily closes from `fromDate` (YYYY-MM-DD) to today, plus the live quote.
export async function fetchHistory(symbol, fromDate) {
  const period1 = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000) - 10 * 86400;
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; SMFPortfolioDashboard/1.0)",
    },
  });
  if (!response.ok) throw new Error(`${symbol}: Yahoo returned ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: no chart result`);

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series = [];
  timestamps.forEach((ts, index) => {
    const close = closes[index];
    if (Number.isFinite(close)) series.push({ date: isoDay(ts), close });
  });

  const meta = result.meta || {};
  const livePrice = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : series.at(-1)?.close;
  // Fold the live quote into the series under its trading day.
  const marketDay = meta.regularMarketTime ? isoDay(meta.regularMarketTime) : new Date().toISOString().slice(0, 10);
  if (Number.isFinite(livePrice)) {
    while (series.length && series.at(-1).date > marketDay) series.pop();
    if (series.at(-1)?.date === marketDay) series[series.length - 1] = { date: marketDay, close: livePrice };
    else series.push({ date: marketDay, close: livePrice });
  }
  const previousClose = series.length > 1 ? series.at(-2).close : NaN;

  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency || "",
    livePrice,
    previousClose,
    marketTime: meta.regularMarketTime || null,
    series,
  };
}

// Last close on or before `date`; falls back to the first close after it.
export function priceOn(history, date) {
  const series = history?.series || [];
  let found = null;
  for (const point of series) {
    if (point.date <= date) found = point.close;
    else break;
  }
  return found ?? series[0]?.close ?? NaN;
}
