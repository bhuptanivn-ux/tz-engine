import { put, list, del } from "@vercel/blob";

function getToken(): string | undefined {
  // In Vercel deployments with a Blob store connected, this env var is set automatically.
  return process.env.BLOB_READ_WRITE_TOKEN;
}

export async function uploadCsv(pathname: string, content: string | Buffer) {
  const token = getToken();
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Connect a Vercel Blob store to this project first."
    );
  }
  return put(pathname, content, {
    access: "public",
    contentType: "text/csv",
    addRandomSuffix: false,
    token,
  });
}

export async function listUnderPrefix(prefix: string) {
  const token = getToken();
  if (!token) return [];
  const results: { pathname: string; url: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    for (const b of page.blobs) {
      results.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return results;
}

export async function findBlobByExactPath(pathname: string) {
  const matches = await listUnderPrefix(pathname);
  return matches.find((b) => b.pathname === pathname);
}

export async function fetchBlobText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch file from storage (status ${res.status})`);
  }
  return res.text();
}

export async function deleteBlob(pathname: string) {
  const token = getToken();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  const existing = await findBlobByExactPath(pathname);
  if (existing) {
    await del(existing.url, { token });
  }
}
