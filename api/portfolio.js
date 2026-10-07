import { checkPassword, loadLedger, saveLedger, storageConfigured, validateLedger } from "../lib/ledger.js";

// GET returns the ledger (sectors, holdings, benchmark).
// PUT replaces it; requires the x-admin-password header to match ADMIN_PASSWORD.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try {
      const { ledger, source } = await loadLedger();
      return res.status(200).json({ ledger, source, writable: storageConfigured() && Boolean(process.env.ADMIN_PASSWORD) });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Could not load the ledger." });
    }
  }

  if (req.method === "PUT") {
    if (!checkPassword(req.headers["x-admin-password"])) {
      return res.status(401).json({ error: "Incorrect admin password." });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const { ledger, errors } = validateLedger(body);
    if (errors.length) return res.status(400).json({ error: "The ledger has problems.", errors });
    try {
      const saved = await saveLedger(ledger);
      return res.status(200).json({ ledger: saved, source: "published" });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Could not save the ledger." });
    }
  }

  return res.status(405).json({ error: "Method not allowed." });
}
