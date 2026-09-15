// A small, curated list of major global market indices. Deliberately NOT an
// attempt to enumerate every stock in each index — that data isn't reliably
// available from Yahoo's free/unofficial endpoints and goes stale as indices
// rebalance. Instead, each index doubles as (a) something you can pull price
// history for directly, and (b) a region hint that narrows the stock search
// in the "Stock" tab to that market.

export interface IndexInfo {
  label: string;
  symbol: string; // Yahoo Finance ticker for the index itself
  region: string; // Yahoo search "region" hint (ISO-ish country code Yahoo accepts)
  market: string; // human-readable market/exchange label
}

export const GLOBAL_INDICES: IndexInfo[] = [
  { label: "NIFTY 50", symbol: "^NSEI", region: "IN", market: "India (NSE)" },
  { label: "S&P BSE SENSEX", symbol: "^BSESN", region: "IN", market: "India (BSE)" },
  { label: "S&P 500", symbol: "^GSPC", region: "US", market: "United States" },
  { label: "Dow Jones Industrial Average", symbol: "^DJI", region: "US", market: "United States" },
  { label: "NASDAQ 100", symbol: "^NDX", region: "US", market: "United States" },
  { label: "FTSE 100", symbol: "^FTSE", region: "GB", market: "United Kingdom" },
  { label: "DAX", symbol: "^GDAXI", region: "DE", market: "Germany" },
  { label: "CAC 40", symbol: "^FCHI", region: "FR", market: "France" },
  { label: "Nikkei 225", symbol: "^N225", region: "JP", market: "Japan" },
  { label: "Hang Seng Index", symbol: "^HSI", region: "HK", market: "Hong Kong" },
];
