import { createHash, timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";
import { SEED_LEDGER } from "./seed-ledger.js";

const LEDGER_PATH = "ledger/portfolio.json";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

export function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function loadLedger() {
  if (!storageConfigured()) return { ledger: SEED_LEDGER, source: "seed" };
  const result = await get(LEDGER_PATH, { access: "private", useCache: false });
  if (!result) return { ledger: SEED_LEDGER, source: "seed" };
  const text = await new Response(result.stream).text();
  return { ledger: JSON.parse(text), source: "published" };
}

export async function saveLedger(ledger) {
  if (!storageConfigured()) {
    throw new Error("Storage is not configured. Connect a Vercel Blob store to this project.");
  }
  const stamped = { ...ledger, updatedAt: new Date().toISOString() };
  await put(LEDGER_PATH, JSON.stringify(stamped, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return stamped;
}

export function checkPassword(supplied) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof supplied !== "string") return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Returns { ledger, errors }. The ledger is normalised (upper-case tickers, numbers coerced).
export function validateLedger(input) {
  const errors = [];
  const sectors = Array.isArray(input?.sectors) ? input.sectors : [];
  const holdings = Array.isArray(input?.holdings) ? input.holdings : [];

  const cleanSectors = sectors.map((sector) => ({
    name: String(sector?.name || "").trim(),
    weight: Number(sector?.weight) || 0,
  }));
  if (!cleanSectors.length) errors.push("Add at least one sector.");
  const names = new Set();
  cleanSectors.forEach((sector) => {
    if (!sector.name) errors.push("Every sector needs a name.");
    if (names.has(sector.name)) errors.push(`Sector "${sector.name}" is listed twice.`);
    if (sector.weight < 0 || sector.weight > 100) errors.push(`${sector.name} weight must be between 0 and 100.`);
    names.add(sector.name);
  });
  const total = cleanSectors.reduce((sum, sector) => sum + sector.weight, 0);
  if (Math.abs(total - 100) > 0.05) errors.push(`Sector weights must add to 100%. Current total is ${total.toFixed(2)}%.`);

  const today = new Date().toISOString().slice(0, 10);
  const cleanHoldings = holdings.map((holding, index) => {
    const label = `Holding ${index + 1}`;
    const ticker = String(holding?.ticker || "").trim().toUpperCase();
    const clean = {
      ticker,
      company: String(holding?.company || ticker).trim(),
      sector: String(holding?.sector || "").trim(),
      buyDate: String(holding?.buyDate || ""),
      buyPrice: positiveNumber(holding?.buyPrice),
    };
    if (!TICKER_RE.test(ticker)) errors.push(`${label}: "${holding?.ticker}" is not a valid ticker.`);
    if (!names.has(clean.sector)) errors.push(`${ticker || label}: sector "${clean.sector}" is not in the sector list.`);
    if (!DATE_RE.test(clean.buyDate) || clean.buyDate > today) errors.push(`${ticker || label}: buy date must be a past date (YYYY-MM-DD).`);
    if (clean.buyPrice === null) errors.push(`${ticker || label}: buy price must be a positive number.`);
    if (holding?.share !== undefined && holding?.share !== null && holding?.share !== "") {
      const share = positiveNumber(holding.share);
      if (share === null) errors.push(`${ticker}: sector share must be a positive number.`);
      else clean.share = share;
    }
    if (holding?.sellDate) {
      clean.sellDate = String(holding.sellDate);
      clean.sellPrice = positiveNumber(holding.sellPrice);
      if (!DATE_RE.test(clean.sellDate) || clean.sellDate < clean.buyDate) errors.push(`${ticker}: sell date must be on or after the buy date.`);
      if (clean.sellPrice === null) errors.push(`${ticker}: sell price must be a positive number.`);
    }
    return clean;
  });

  const seen = new Set();
  cleanHoldings.forEach((holding) => {
    const key = `${holding.ticker}|${holding.buyDate}`;
    if (seen.has(key)) errors.push(`${holding.ticker} is entered twice for ${holding.buyDate}.`);
    seen.add(key);
  });

  const benchmarkSymbol = String(input?.benchmark?.symbol || "^990100-USD-STRD").trim();
  const ledger = {
    version: 1,
    benchmark: { symbol: benchmarkSymbol, name: String(input?.benchmark?.name || benchmarkSymbol).trim() },
    sectors: cleanSectors,
    holdings: cleanHoldings,
  };
  return { ledger, errors };
}
