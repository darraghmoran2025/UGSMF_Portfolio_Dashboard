// Starting ledger used until a ledger is published from the dashboard.
// Seven sectors at equal target weight; all fourteen positions entered on
// 22 Oct 2025, two per sector.
export const SEED_LEDGER = {
  version: 1,
  updatedAt: null,
  benchmark: { symbol: "^990100-USD-STRD", name: "MSCI World Index" },
  sectors: [
    { name: "Industrials", weight: 14.29 },
    { name: "Consumer", weight: 14.29 },
    { name: "Technology", weight: 14.28 },
    { name: "Healthcare", weight: 14.29 },
    { name: "Real Assets", weight: 14.28 },
    { name: "Materials", weight: 14.29 },
    { name: "Financials", weight: 14.28 },
  ],
  holdings: [
    { ticker: "HON", company: "Honeywell International", sector: "Industrials", buyDate: "2025-10-22", buyPrice: 194.73 },
    { ticker: "BY6.F", company: "BYD Co. Ltd.", sector: "Consumer", buyDate: "2025-10-22", buyPrice: 11.43 },
    { ticker: "MU", company: "Micron Technology", sector: "Technology", buyDate: "2025-10-22", buyPrice: 198.47 },
    { ticker: "BBIO", company: "BridgeBio Pharma", sector: "Healthcare", buyDate: "2025-10-22", buyPrice: 53.24 },
    { ticker: "WPM", company: "Wheaton Precious Metals", sector: "Real Assets", buyDate: "2025-10-22", buyPrice: 97.13 },
    { ticker: "NEM", company: "Newmont Corporation", sector: "Materials", buyDate: "2025-10-22", buyPrice: 87.01 },
    { ticker: "ALV.DE", company: "Allianz SE", sector: "Financials", buyDate: "2025-10-22", buyPrice: 351.7 },
    { ticker: "ATEX", company: "Anterix", sector: "Industrials", buyDate: "2025-10-22", buyPrice: 19.48 },
    { ticker: "PG", company: "Procter & Gamble", sector: "Consumer", buyDate: "2025-10-22", buyPrice: 152.2 },
    { ticker: "INOD", company: "Innodata", sector: "Technology", buyDate: "2025-10-22", buyPrice: 72.07 },
    { ticker: "VRTX", company: "Vertex Pharmaceuticals", sector: "Healthcare", buyDate: "2025-10-22", buyPrice: 426.44 },
    { ticker: "XOM", company: "ExxonMobil", sector: "Real Assets", buyDate: "2025-10-22", buyPrice: 114.71 },
    { ticker: "FCX", company: "Freeport-McMoRan", sector: "Materials", buyDate: "2025-10-22", buyPrice: 40.78 },
    { ticker: "V", company: "Visa", sector: "Financials", buyDate: "2025-10-22", buyPrice: 345.36 },
  ],
};
