"use client";

import { useEffect, useState } from "react";

type Option = { slug: string; label: string };
type ExistingFile = { instrument: string; size: number; uploadedAt: string };
type UploadResult = { file: string; status: "ok" | "error"; message?: string; rows?: number };

const SESSION_KEY = "mdv_admin_password";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [segments, setSegments] = useState<Option[]>([]);
  const [timeframes, setTimeframes] = useState<Option[]>([]);
  const [segment, setSegment] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [existing, setExisting] = useState<ExistingFile[]>([]);

  useEffect(() => {
    fetch("/api/segments")
      .then((r) => r.json())
      .then((data) => {
        setSegments(data.segments);
        setTimeframes(data.timeframes);
      });

    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      verifyPassword(saved).finally(() => setCheckingAuth(false));
    } else {
      setCheckingAuth(false);
    }
  }, []);

  async function verifyPassword(pw: string): Promise<boolean> {
    const res = await fetch("/api/admin/list?segment=nse&timeframe=daily", {
      headers: { "x-admin-password": pw },
    });
    if (res.status === 401) {
      setAuthError("Incorrect password.");
      sessionStorage.removeItem(SESSION_KEY);
      setAuthed(false);
      return false;
    }
    sessionStorage.setItem(SESSION_KEY, pw);
    setPassword(pw);
    setAuthed(true);
    setAuthError("");
    return true;
  }

  async function loadExisting(seg: string, tf: string) {
    const pw = sessionStorage.getItem(SESSION_KEY) ?? "";
    const res = await fetch(`/api/admin/list?segment=${seg}&timeframe=${tf}`, {
      headers: { "x-admin-password": pw },
    });
    const data = await res.json();
    setExisting(data.files ?? []);
  }

  useEffect(() => {
    if (authed && segment && timeframe) {
      loadExisting(segment, timeframe);
    } else {
      setExisting([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, segment, timeframe]);

  async function handleUpload() {
    if (!files || files.length === 0 || !segment || !timeframe) return;
    setUploading(true);
    setResults([]);
    const form = new FormData();
    form.set("segment", segment);
    form.set("timeframe", timeframe);
    Array.from(files).forEach((f) => form.append("files", f));

    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "x-admin-password": password },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setResults([{ file: "-", status: "error", message: data.error || "Upload failed." }]);
      } else {
        setResults(data.results ?? []);
        loadExisting(segment, timeframe);
      }
    } catch {
      setResults([{ file: "-", status: "error", message: "Network error during upload." }]);
    } finally {
      setUploading(false);
    }
  }

  if (checkingAuth) {
    return (
      <main className="page">
        <p className="subtitle">Checking...</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="page">
        <h1>Admin</h1>
        <p className="subtitle">Enter the admin password to upload data files.</p>
        <div className="card">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verifyPassword(password)}
          />
          {authError && <p className="status error">{authError}</p>}
          <button onClick={() => verifyPassword(password)}>Enter</button>
        </div>
        <a className="footer-link" href="/">
          ← Back to data download
        </a>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Admin: Upload Data Files</h1>
      <p className="subtitle">
        Upload CSV files (one per instrument, filename becomes the instrument name, e.g.
        "Reliance.csv"). Uploading a file with the same name again replaces the old one.
      </p>

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

        <label htmlFor="files">CSV files (you can select many at once)</label>
        <input
          id="files"
          type="file"
          accept=".csv"
          multiple
          onChange={(e) => setFiles(e.target.files)}
        />

        <button disabled={!segment || !timeframe || !files || uploading} onClick={handleUpload}>
          {uploading ? "Uploading..." : `Upload ${files?.length ?? ""} file(s)`}
        </button>

        {results.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {results.map((r, i) => (
              <div className="result-row" key={i}>
                <span>{r.file}</span>
                <span>
                  {r.status === "ok" ? (
                    <span className="badge ok">OK · {r.rows} rows</span>
                  ) : (
                    <span className="badge error" title={r.message}>
                      Error
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {segment && timeframe && (
        <div className="card">
          <strong>Existing files in {segment.toUpperCase()} / {timeframe}</strong>
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Size</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((f) => (
                <tr key={f.instrument}>
                  <td>{f.instrument}</td>
                  <td>{(f.size / 1024).toFixed(1)} KB</td>
                  <td>{new Date(f.uploadedAt).toLocaleString()}</td>
                </tr>
              ))}
              {existing.length === 0 && (
                <tr>
                  <td colSpan={3}>No files yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <a className="footer-link" href="/">
        ← Back to data download
      </a>
    </main>
  );
}
