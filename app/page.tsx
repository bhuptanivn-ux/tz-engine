"use client";

import { useEffect, useState } from "react";

type Option = { slug: string; label: string };

function formatDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export default function Home() {
  const [segments, setSegments] = useState<Option[]>([]);
  const [timeframes, setTimeframes] = useState<Option[]>([]);
  const [segment, setSegment] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [instrument, setInstrument] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ firstDate: string; lastDate: string; rows: number } | null>(
    null
  );
  const [loadingInstruments, setLoadingInstruments] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/segments")
      .then((r) => r.json())
      .then((data) => {
        setSegments(data.segments);
        setTimeframes(data.timeframes);
      });
  }, []);

  useEffect(() => {
    setInstrument("");
    setPreview(null);
    setError("");
    if (!segment || !timeframe) {
      setInstruments([]);
      return;
    }
    setLoadingInstruments(true);
    fetch(`/api/instruments?segment=${segment}&timeframe=${timeframe}`)
      .then((r) => r.json())
      .then((data) => setInstruments(data.instruments ?? []))
      .catch(() => setError("Could not load the instrument list."))
      .finally(() => setLoadingInstruments(false));
  }, [segment, timeframe]);

  useEffect(() => {
    setPreview(null);
    setError("");
    if (!segment || !timeframe || !instrument) return;
    fetch(`/api/preview?segment=${segment}&timeframe=${timeframe}&instrument=${encodeURIComponent(instrument)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPreview(data);
      })
      .catch(() => setError("Could not read this file's date range."));
  }, [segment, timeframe, instrument]);

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      const url = `/api/download?segment=${segment}&timeframe=${timeframe}&instrument=${encodeURIComponent(
        instrument
      )}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed.");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : `${instrument}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  const filteredInstruments = instruments.filter((i) =>
    i.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="page">
      <h1>Market Data Vault</h1>
      <p className="subtitle">Pick a segment, timeframe and instrument to download its full OHLC history as Excel.</p>

      <div className="card">
        <label htmlFor="segment">Segment</label>
        <select id="segment" value={segment} onChange={(e) => setSegment(e.target.value)}>
          <option value="">Select segment...</option>
          {segments.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>

        <label htmlFor="timeframe">Timeframe</label>
        <select id="timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          <option value="">Select timeframe...</option>
          {timeframes.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
        </select>

        {segment && timeframe && (
          <>
            <label htmlFor="search">Search instrument</label>
            <input
              id="search"
              type="text"
              placeholder="e.g. Reliance"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <label htmlFor="instrument">
              Instrument {loadingInstruments && "(loading...)"}
            </label>
            <select id="instrument" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
              <option value="">
                {instruments.length === 0 && !loadingInstruments
                  ? "No files uploaded for this segment/timeframe yet"
                  : "Select instrument..."}
              </option>
              {filteredInstruments.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </>
        )}

        {preview && (
          <p className="status ok">
            Available data: {formatDate(preview.firstDate)} to {formatDate(preview.lastDate)} ({preview.rows} rows)
          </p>
        )}
        {error && <p className="status error">{error}</p>}

        <button disabled={!instrument || downloading} onClick={handleDownload}>
          {downloading ? "Preparing Excel..." : "Download Excel"}
        </button>
      </div>

      <a className="footer-link" href="/admin">
        Admin: upload data files →
      </a>
    </main>
  );
}
