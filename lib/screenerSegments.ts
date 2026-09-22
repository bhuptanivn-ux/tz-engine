// Segment metadata ONLY -- key + label, nothing else. Deliberately kept
// tiny and free of the actual instrument lists (lib/screenerUniverse.ts is
// ~2,600 entries, lib/otherMarkets.ts several more) so this file is safe
// to import from a client component (the Prime Trend page's segment
// dropdown) without bundling those heavy arrays into client JS. The API
// route resolves a segment key to its real instrument list server-side --
// see resolveSegmentInstruments in app/api/screener/route.ts.

export interface ScreenerSegmentMeta {
  key: string;
  label: string;
}

// "nse-equity" here must stay in sync with the case app/api/screener/
// route.ts checks for; the rest must stay in sync with OTHER_MARKETS'
// own `key` fields in lib/otherMarkets.ts.
export const SCREENER_SEGMENTS: ScreenerSegmentMeta[] = [
  { key: "nse-equity", label: "NSE Equity" },
  { key: "commodity", label: "Commodities" },
  { key: "crypto", label: "Crypto" },
  { key: "forex", label: "Forex" },
  { key: "indexes", label: "Indian Indices" },
  { key: "international-indexes", label: "International Indices" },
  { key: "sme", label: "SME (NSE Emerge)" },
];
