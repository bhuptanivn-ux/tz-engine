"use client";

import { useState } from "react";
import { SCREENER_SEGMENTS } from "@/lib/screenerSegments";
import { formatDDMMYYYY, formatTimestampDDMMYYYY } from "@/lib/dateFormat";

interface DtfBarReportMatch {
  symbol: string;
  name: string;
  date: string;
}

const EVENTS = ["TZ BUY", "BAR1", "BAR2", "REAR", "REAR RE-ENTER"];

const FIRST_YEAR = 2010;
function availableYears(): number[] {
  const currentYear = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= FIRST_YEAR; y--) years.push(y);
  return years;
}

// Same batching shape as app/report/page.tsx's segment scan -- NSE Equity
// (~2,600 instruments) is too large for one serverless invocation to
// finish inside a reasonable timeout, so the client requests it in small,
// sequential, independently cacheable batches instead.
const BATCH_SIZE = 75;
const BATCH_TIMEOUT_MS = 45_000;
const BATCH_MAX_ATTEMPTS = 2;
const BATCH_GAP_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DtfBarReportBatchResponse {
  total?: number;
  scanned?: number;
  matches?: DtfBarReportMatch[];
  errors?: string[];
  cached?: boolean;
  error?: string;
}

export default function DtfBarReport() {
  const years = availableYears();

  const [segment, setSegment] = useState("");
  const [year, setYear] = useState("");
  const [event, setEvent] = useState(EVENTS[0]);

  const [matches, setMatches] = useState<DtfBarReportMatch[]>([]);
  const [scanned, setScanned] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScanned, setLastScanned] = useState("");
  const [cachedResult, setCachedResult] = useState(false);
  const [scanProgress, setScanProgress] = useState("");

  async function fetchBatch(offset: number, limit: number): Promise<DtfBarReportBatchResponse> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({
          segment,
          year,
          event,
          offset: String(offset),
          limit: String(limit),
        });
        const res = await fetch(`/api/dtf-bar-report?${params.toString()}`, { signal: controller.signal });
        const data: DtfBarReportBatchResponse = await res.json();
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
      <h1>DTF BAR REPORT</h1>
      <p className="subtitle">
        Find every scrip in a segment where the selected DTF BAR event occurred at least once
        during the selected calendar year. DTF BAR is defined only for Daily Time Frame data, so
        there is no time frame to pick.
      </p>

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="dtf-bar-report-segment">Segment</label>
            <select
              id="dtf-bar-report-segment"
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
            <label htmlFor="dtf-bar-report-year">Year</label>
            <select id="dtf-bar-report-year" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Select a year…</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="dtf-bar-report-event">Event</label>
            <select id="dtf-bar-report-event" value={event} onChange={(e) => setEvent(e.target.value)}>
              {EVENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
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

      {lastScanned && matches.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-left">Scrip</th>
                  <th className="col-left">Symbol</th>
                  <th>Date of occurrence</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={`${m.symbol}-${m.date}-${i}`}>
                    <td className="col-left">{m.name}</td>
                    <td className="col-left">{m.symbol}</td>
                    <td>{formatDDMMYYYY(m.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && lastScanned && matches.length === 0 && (
        <p className="muted">No occurrences of {event} found for this segment and year.</p>
      )}
    </main>
  );
}
