// PRIME TREND 1.1 screener -- Entry Zone 1.1's live "is this stock in a
// TZ BUY zone right now" scan, using the experimental 3-stage variant
// (lib/primeTrend11.ts) instead of the shipped 2-stage theory
// (lib/primeTrend.ts). Mirrors lib/dtfWtfScreener.ts exactly, reusing its
// pure helpers (toDays, toOhlcRow, resampleWeekly, lowestLowPostEntry)
// verbatim -- nothing about the shipped screener changes.
//
// Reporting shift (per explicit instruction, since a third stage now
// exists): the "tzBuy" list ("DTF trading with TZ BUY") now surfaces
// Stage 2 (DTF TZ BUY ENTRY) active, and the "tzBuyEntry" list ("DTF TZ
// BUY ENTRY") now surfaces Stage 3 (TZ BUY 3) active. Stage 1 alone
// (plain DTF TZ BUY) is no longer surfaced in either list.

import { computePrimeTrendLive11 } from "./primeTrend11";
import type { HistoryRowLike } from "./tzEngineWtf";
import { lowestLowPostEntry, resampleWeekly, toDays, toOhlcRow, type ScanResult, type ScreenerRow } from "./dtfWtfScreener";

export function scanStock11(symbol: string, name: string, rows: HistoryRowLike[]): ScanResult {
  const days = toDays(rows);
  if (days.length < 2) return { tzBuy: null, tzBuyEntry: null };

  const weekly = resampleWeekly(days);
  const wtfRows = weekly.map(toOhlcRow);
  const dtfRows = days.map(toOhlcRow);

  const currentClose = days[days.length - 1].c;
  const liveStatuses = computePrimeTrendLive11(wtfRows, dtfRows);

  let tzBuy: ScreenerRow | null = null;
  let tzBuyEntry: ScreenerRow | null = null;
  for (const live of liveStatuses) {
    if (!tzBuy && live.stage2Active && live.stage2Since !== null && live.stage2ActivationPrice !== null) {
      const highestHigh = live.stage2HighestHigh ?? live.stage2ActivationPrice;
      tzBuy = {
        symbol,
        name,
        activeAsOn: live.stage2Since,
        activationPrice: live.stage2ActivationPrice,
        stopLoss: live.stage2StopLoss,
        lowestLowPostEntry: lowestLowPostEntry(days, live.stage2Since),
        highestHigh,
        percentReturn: ((highestHigh - live.stage2ActivationPrice) / live.stage2ActivationPrice) * 100,
        currentClose,
      };
    }
    if (!tzBuyEntry && live.stage3Active && live.stage3Since !== null && live.stage3ActivationPrice !== null) {
      const highestHigh = live.stage3HighestHigh ?? live.stage3ActivationPrice;
      tzBuyEntry = {
        symbol,
        name,
        activeAsOn: live.stage3Since,
        activationPrice: live.stage3ActivationPrice,
        stopLoss: live.stage3StopLoss,
        lowestLowPostEntry: lowestLowPostEntry(days, live.stage3Since),
        highestHigh,
        percentReturn: ((highestHigh - live.stage3ActivationPrice) / live.stage3ActivationPrice) * 100,
        currentClose,
      };
    }
  }

  return { tzBuy, tzBuyEntry };
}
