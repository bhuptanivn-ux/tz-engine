#!/usr/bin/env node
// One-off diagnostic: checks a hand-picked list of candidate Yahoo symbols
// (usually alternate spellings for tickers that failed under their
// straightforward ".NS" form -- e.g. a hyphen instead of an underscore)
// and reports which ones actually exist. Doesn't touch Blob storage or
// any uploaded data -- purely a lookup, run manually as needed.
//
// Usage:
//   node scripts/check-symbols.mjs "SYM1,SYM2,SYM3"

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function existsOnYahoo(symbol, maxAttempts = 3) {
  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "3mo");
  url.searchParams.set("interval", "1d");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
    } catch {
      if (attempt === maxAttempts) return { ok: false, reason: "network error" };
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 404) return { ok: false, reason: "404 not found" };
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) return { ok: false, reason: `status ${res.status}` };
      await sleep(3000 * attempt);
      continue;
    }
    if (!res.ok) return { ok: false, reason: `status ${res.status}` };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const chartError = data?.chart?.error;
    if (chartError) return { ok: false, reason: chartError.description || "chart error" };
    if (!result) return { ok: false, reason: "no result" };

    const closes = result.indicators?.quote?.[0]?.close || [];
    const hasRealBar = closes.some((c) => typeof c === "number" && !Number.isNaN(c));
    const name = result.meta?.longName || result.meta?.shortName || null;
    return hasRealBar
      ? { ok: true, name }
      : { ok: false, reason: "no non-null bars in last 3mo" };
  }
  return { ok: false, reason: "unknown" };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/check-symbols.mjs "SYM1,SYM2,SYM3"');
    process.exit(1);
  }
  const symbols = arg.split(",").map((s) => s.trim()).filter(Boolean);

  for (const symbol of symbols) {
    const result = await existsOnYahoo(symbol);
    if (result.ok) {
      console.log(`FOUND    ${symbol}  ->  ${result.name || "(no name in response)"}`);
    } else {
      console.log(`NOT FOUND ${symbol}  ->  ${result.reason}`);
    }
    await sleep(300);
  }
}

main().catch((err) => {
  console.error("Check failed:", err.message || err);
  process.exit(1);
});
