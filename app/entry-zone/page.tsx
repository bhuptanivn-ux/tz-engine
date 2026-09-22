"use client";

import { useState } from "react";
import type { ScreenerRow } from "@/lib/dtfWtfScreener";

type ListChoice = "tzBuy" | "tzBuyEntry";

function fmt(n: number): string {
  return n.toFixed(2);
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function EntryZone() {
  const [choice, setChoice] = useState<ListChoice>("tzBuyEntry");
  const [tzBuy, setTzBuy] = useState<ScreenerRow[]>([]);
  const [tzBuyEntry, setTzBuyEntry] = useState<ScreenerRow[]>([]);
  const [scanned, setScanned] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScanned, setLastScanned] = useState("");

  async function runScan() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/screener");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setTzBuy(data.tzBuy || []);
      setTzBuyEntry(data.tzBuyEntry || []);
      setScanned(data.scanned || 0);
      setErrors(data.errors || []);
      setLastScanned(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  // Newest activation first -- oldest at the bottom.
  const rows = [...(choice === "tzBuy" ? tzBuy : tzBuyEntry)].sort((a, b) =>
    b.activeAsOn.localeCompare(a.activeAsOn)
  );

  return (
    <main className="container">
      <h1>Entry Zone</h1>
      <p className="subtitle">
        DTF/WTF dual-timeframe screener — Part A: stocks whose weekly timeframe (WTF) is
        currently active with TZ BUY 2, and whose daily timeframe (DTF) has broken out above it.
        Part B (WTF at plain BAR level) isn&apos;t built yet.
      </p>

      <div className="card">
        <div className="tabs">
          <button
            className={choice === "tzBuy" ? "tab active" : "tab"}
            onClick={() => setChoice("tzBuy")}
          >
            DTF trading with TZ BUY
          </button>
          <button
            className={choice === "tzBuyEntry" ? "tab active" : "tab"}
            onClick={() => setChoice("tzBuyEntry")}
          >
            DTF TZ BUY ENTRY
          </button>
        </div>
        <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
          {choice === "tzBuy"
            ? "Above WTF TZ BUY 2 reference high"
            : "DTF's own TZ BUY 2, above DTF TZ BUY"}
        </p>
        <button onClick={runScan} disabled={loading}>
          {loading ? "Scanning…" : "Scan universe"}
        </button>
        {error && <div className="error">{error}</div>}
        {lastScanned && (
          <p className="muted event-disclaimer">
            Scanned {scanned} stocks (Nifty 50 placeholder universe — swap in the real NSE 200
            list once it&apos;s supplied) at {lastScanned}. Simplified first version: DTF is
            anchored off WTF&apos;s current TZ BUY 2 reference and then runs independently — the
            full pause/dormant/race WTF state machine isn&apos;t ported yet. Activation price is a
            one-time snapshot of DTF&apos;s own TZ BUY reference, taken when this list&apos;s
            milestone formed (can differ between the two lists). Highest high is WTF&apos;s own
            weekly high, live — but freezes the moment WTF hits RED2 or BAR SL2, resuming only
            once price trades back above that frozen level. % Return is the change from
            Activation price to Highest high.
            {errors.length > 0 && ` ${errors.length} stock(s) failed to fetch and were skipped.`}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scrip</th>
                  <th>Active as on</th>
                  <th>{choice === "tzBuy" ? "TZ BUY entry above" : "Activation price"}</th>
                  <th>Highest high</th>
                  <th>% Return</th>
                  <th>Current close</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td>
                      {r.symbol} <span className="name">{r.name}</span>
                    </td>
                    <td>{r.activeAsOn}</td>
                    <td>{fmt(r.activationPrice)}</td>
                    <td>{fmt(r.highestHigh)}</td>
                    <td className={r.percentReturn >= 0 ? "return-pos" : "return-neg"}>
                      {fmtPercent(r.percentReturn)}
                    </td>
                    <td>{fmt(r.currentClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && lastScanned && rows.length === 0 && (
        <p className="muted">No stocks currently active for this list.</p>
      )}
    </main>
  );
}
