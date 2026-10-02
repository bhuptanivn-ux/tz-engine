"use client";

import { useState } from "react";
import { SCREENER_SEGMENTS } from "@/lib/screenerSegments";
import { formatDDMMYYYY, formatTimestampDDMMYYYY } from "@/lib/dateFormat";

interface ReportMatch {
  symbol: string;
  name: string;
  date: string;
  family?: string;
  exitType?: string | null;
  exitDate?: string | null;
  reentryDate?: string | null;
}

// Turns one PRIME TREND cycle's raw exitType/exitDate/reentryDate into the
// plain-language remark shown in the Remarks column -- e.g. "SL triggered
// on 18/02/2019. DTF TZ BUY SL also triggered. WTF TZ BUY 2 is still
// active — re-entered on 03/05/2019." Blank for every other event, which
// has no entry/exit lifecycle to describe.
function primeTrendRemark(m: ReportMatch): string {
  if (!m.exitType) return "";
  if (m.exitType === "still open") return "Still active — no exit yet.";

  const exitDateStr = m.exitDate ? formatDDMMYYYY(m.exitDate) : "";
  const family = m.family ?? "anchor";

  // A raw DTF-side SL (Stage 2's own, or Stage 1's SL wiping Stage 2 too)
  // that is NOT the merged "DTF SL - <WTF label>" form below always means
  // the WTF anchor stayed alive afterward -- computePrimeTrend only merges
  // the WTF-side failure into the LAST cycle of an instance (see
  // lib/primeTrend.ts's wtfSlLabel/DTF_SL_EXIT_TYPES), so an unmerged DTF
  // SL is followed by another cycle for the same still-open WTF anchor.
  const DTF_SL_TYPES: Record<string, string> = {
    "DTF TZ BUY ENTRY SL": "",
    "DTF TZ BUY SL (wipes ENTRY)": " DTF TZ BUY SL also triggered.",
  };
  if (m.exitType in DTF_SL_TYPES) {
    const also = DTF_SL_TYPES[m.exitType];
    const reentry = m.reentryDate
      ? ` WTF ${family} is still active — re-entered on ${formatDDMMYYYY(m.reentryDate)}.`
      : ` WTF ${family} is still active — no re-entry yet.`;
    return `SL triggered on ${exitDateStr}.${also}${reentry}`;
  }

  if (m.exitType.startsWith("DTF SL - ")) {
    const wtfLabel = m.exitType.slice("DTF SL - ".length);
    return `SL triggered on ${exitDateStr}. WTF ${family} then also failed (${wtfLabel}) — no further DTF re-entry.`;
  }

  // Whatever's left is a raw WTF-side event name (e.g. "TZ BUY 2 SL(A)") --
  // the WTF anchor itself failed while this DTF entry was still open, with
  // no DTF-side SL of its own firing first.
  const wtfLabel = m.exitType.split("(")[0].trim();
  return `WTF ${family} failed directly (${wtfLabel}) on ${exitDateStr} while this entry was still open.`;
}

const EVENTS = ["TZ BUY 2", "BAR", "BAR 2", "PRIME TREND"];

// PRIME TREND is a fixed dual-timeframe theory (WTF = weekly, DTF = daily,
// always -- see PRIME_TREND_RULEBOOK.md), not a single event on a
// user-chosen timeframe, so the Time frame selector doesn't apply to it.
const TIMEFRAMES: { value: string; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const FIRST_YEAR = 2010;
function availableYears(): number[] {
  const currentYear = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= FIRST_YEAR; y--) years.push(y);
  return years;
}

// Same batching shape as app/entry-zone/page.tsx's segment scan -- NSE
// Equity (~2,600 instruments) is too large for one serverless invocation
// to finish inside a reasonable timeout, so the client requests it in
// small, sequential, independently cacheable batches instead.
const BATCH_SIZE = 75;
const BATCH_TIMEOUT_MS = 45_000;
const BATCH_MAX_ATTEMPTS = 2;
const BATCH_GAP_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReportBatchResponse {
  total?: number;
  scanned?: number;
  matches?: ReportMatch[];
  errors?: string[];
  cached?: boolean;
  error?: string;
}

export default function Report() {
  const years = availableYears();

  const [segment, setSegment] = useState("");
  const [year, setYear] = useState("");
  const [event, setEvent] = useState(EVENTS[0]);
  const [timeframe, setTimeframe] = useState("daily");

  const [matches, setMatches] = useState<ReportMatch[]>([]);
  const [resultEvent, setResultEvent] = useState("");
  const [scanned, setScanned] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScanned, setLastScanned] = useState("");
  const [cachedResult, setCachedResult] = useState(false);
  const [scanProgress, setScanProgress] = useState("");

  async function fetchBatch(offset: number, limit: number): Promise<ReportBatchResponse> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({
          segment,
          year,
          event,
          // PRIME TREND ignores the Time frame dropdown server-side (it's
          // always weekly WTF / daily DTF) -- send a fixed value regardless
          // of whatever the (disabled) dropdown currently shows.
          timeframe: event === "PRIME TREND" ? "daily" : timeframe,
          offset: String(offset),
          limit: String(limit),
        });
        const res = await fetch(`/api/report?${params.toString()}`, { signal: controller.signal });
        const data: ReportBatchResponse = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        return data;
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        lastErr = isAbort
          ? new Error(`Timed out scanning instruments ${offset + 1}-${offset + limit}`)
          : err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Scan failed");
  }

  async function runScan() {
    if (!segment || !year) return;
    setLoading(true);
    setError("");
    setScanProgress("");
    try {
      const first = await fetchBatch(0, BATCH_SIZE);
      const matchesAll = [...(first.matches || [])];
      const errorsAll = [...(first.errors || [])];
      let scannedTotal = first.scanned || 0;
      let allCached = !!first.cached;
      const total = first.total ?? scannedTotal;

      setScanProgress(`${scannedTotal} / ${total}`);

      for (let off = BATCH_SIZE; off < total; off += BATCH_SIZE) {
        await sleep(BATCH_GAP_MS);
        try {
          const batch = await fetchBatch(off, BATCH_SIZE);
          matchesAll.push(...(batch.matches || []));
          errorsAll.push(...(batch.errors || []));
          scannedTotal += batch.scanned || 0;
          allCached = allCached && !!batch.cached;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "batch failed";
          errorsAll.push(`Instruments ${off + 1}-${off + BATCH_SIZE}: ${msg}`);
          allCached = false;
        }
        setScanProgress(`${scannedTotal} / ${total}`);
      }

      matchesAll.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
      setMatches(matchesAll);
      setResultEvent(event);
      setScanned(scannedTotal);
      setErrors(errorsAll);
      setCachedResult(allCached);
      setLastScanned(formatTimestampDDMMYYYY(new Date()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
      setScanProgress("");
    }
  }

  return (
    <main className="container">
      <h1>Report</h1>
      <p className="subtitle">
        Find every scrip in a segment where the selected event occurred at least once during the
        selected calendar year, on the selected time frame.
      </p>

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="report-segment">Segment</label>
            <select
              id="report-segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            >
              <option value="">Select a segment…</option>
              {SCREENER_SEGMENTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 140px" }}>
            <label htmlFor="report-year">Year</label>
            <select id="report-year" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Select a year…</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="report-event">Event</label>
            <select id="report-event" value={event} onChange={(e) => setEvent(e.target.value)}>
              {EVENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="report-timeframe">Time frame</label>
            <select
              id="report-timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              disabled={event === "PRIME TREND"}
            >
              {TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {event === "PRIME TREND" && (
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
                {event} always uses its own Weekly (WTF) / Daily (DTF) pair.
              </p>
            )}
          </div>
        </div>

        <button onClick={runScan} disabled={loading || !segment || !year}>
          {loading ? (scanProgress ? `Scanning… ${scanProgress}` : "Scanning…") : "Run report"}
        </button>
        {error && <div className="error">{error}</div>}
        {lastScanned && (
          <p className="muted event-disclaimer">
            {cachedResult ? "Loaded instantly from today's cached scan" : "Freshly scanned"}
            {" "}
            ({scanned} instrument(s) in{" "}
            {SCREENER_SEGMENTS.find((s) => s.key === segment)?.label || segment}) at {lastScanned}.
            {errors.length > 0 && ` ${errors.length} stock(s) failed to fetch and were skipped.`}
          </p>
        )}
        {errors.length > 0 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Show failed stock(s) ({errors.length})
            </summary>
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
              {errors.slice(0, 25).map((e, i) => (
                <li key={i} className="muted" style={{ fontSize: "0.85rem" }}>
                  {e}
                </li>
              ))}
            </ul>
            {errors.length > 25 && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                …and {errors.length - 25} more.
              </p>
            )}
          </details>
        )}
      </div>

      {lastScanned && matches.length > 0 && (() => {
        const showRemarks = resultEvent === "PRIME TREND";
        const filteredCount = new Set(matches.map((m) => m.symbol)).size;
        return (
          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>
              {filteredCount} out of {scanned}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="col-left">Scrip</th>
                    <th className="col-left">Symbol</th>
                    <th>Date of occurrence</th>
                    {showRemarks && <th className="col-left">Remarks</th>}
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={`${m.symbol}-${m.date}-${i}`}>
                      <td className="col-left">{m.name}</td>
                      <td className="col-left">{m.symbol}</td>
                      <td>{formatDDMMYYYY(m.date)}</td>
                      {showRemarks && <td className="col-left">{primeTrendRemark(m)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {!loading && lastScanned && matches.length === 0 && (
        <p className="muted">No occurrences of {resultEvent || event} found for this segment and year.</p>
      )}
    </main>
  );
}
