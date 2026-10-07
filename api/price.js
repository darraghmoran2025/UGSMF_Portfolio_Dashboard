import { fetchHistory, priceOn } from "../lib/yahoo.js";

// GET /api/price?symbol=MU&date=2026-03-02 -> closing price on (or before) that date, plus the live price.
export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  if (!symbol) return res.status(400).json({ error: "Supply a symbol." });
  try {
    const history = await fetchHistory(symbol, date);
    const close = priceOn(history, date);
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(200).json({ symbol: history.symbol, name: history.name, currency: history.currency, date, close, livePrice: history.livePrice });
  } catch (error) {
    return res.status(404).json({ error: `No Yahoo Finance data for ${symbol}.` });
  }
}
