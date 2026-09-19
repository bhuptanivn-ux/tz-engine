// Central definition of the segment / timeframe structure.
// `folderName` must match your local "Data/<folderName>/<timeframe folder>/<file>.csv" layout exactly,
// since scripts/bulk-upload.mjs reads folders by this name. `slug` is the URL/blob-path-safe id.

export type Segment = {
  slug: string;
  folderName: string;
  label: string;
};

export type Timeframe = {
  slug: string;
  folderName: string;
  label: string;
};

export const SEGMENTS: Segment[] = [
  { slug: "nse", folderName: "NSE", label: "NSE" },
  { slug: "commodity", folderName: "Commodities", label: "Commodities" },
  { slug: "crypto", folderName: "CRYPTO", label: "Crypto" },
  { slug: "forex", folderName: "FOREX", label: "Forex" },
  { slug: "indexes", folderName: "INDEXES", label: "Indexes" },
  {
    slug: "international-indexes",
    folderName: "INTERNATIONAL INDEXES",
    label: "International Indexes",
  },
  { slug: "sme", folderName: "SME", label: "SME" },
];

export const TIMEFRAMES: Timeframe[] = [
  { slug: "daily", folderName: "DAILY", label: "Daily" },
  { slug: "weekly", folderName: "WEEKLY", label: "Weekly" },
  { slug: "monthly", folderName: "MONTHLY", label: "Monthly" },
  { slug: "yearly", folderName: "YEARLY", label: "Yearly" },
];

export function findSegment(slug: string): Segment | undefined {
  return SEGMENTS.find((s) => s.slug === slug);
}

export function findTimeframe(slug: string): Timeframe | undefined {
  return TIMEFRAMES.find((t) => t.slug === slug);
}

// Blob storage path for a given instrument's raw CSV.
export function blobPath(segmentSlug: string, timeframeSlug: string, instrumentName: string) {
  return `data/${segmentSlug}/${timeframeSlug}/${instrumentName}.csv`;
}

// Prefix used to list all instruments within a segment+timeframe.
export function blobPrefix(segmentSlug: string, timeframeSlug: string) {
  return `data/${segmentSlug}/${timeframeSlug}/`;
}
