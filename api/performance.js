import { loadLedger, validateLedger } from "../lib/ledger.js";
import { computePerformance } from "../lib/performance.js";

// Public, read-only: the website's Performance-To-Date page and ticker bar read this.
// POST computes a preview for an unpublished ledger without saving it.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const { ledger, errors } = validateLedger(body);
    if (errors.length) return res.status(400).json({ error: "The ledger has problems.", errors });
    try {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ...(await computePerformance(ledger)), ledgerSource: "preview" });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Could not compute performance." });
    }
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { ledger, source } = await loadLedger();
    const performance = await computePerformance(ledger);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ ...performance, ledgerSource: source });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not compute performance." });
  }
}
