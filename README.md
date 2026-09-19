# Market Data Vault

A small web app for downloading OHLC (Open/High/Low/Close/Volume) data as Excel,
organized by Segment (NSE / Commodity / Crypto / Forex / Indexes / International
Indexes / SME) and Timeframe (Daily / Weekly / Monthly / Yearly).

Your CSV data files live in **Vercel Blob storage** (not on any single laptop),
so the deployed app can read them from anywhere. You get data into Blob storage
two ways:

- **Bulk, one-time:** run `scripts/bulk-upload.mjs` on your laptop to push your
  existing `Data/<Segment>/<Timeframe>/<Instrument>.csv` folder tree in one go.
- **Ongoing / one-off:** use the `/admin` page in the deployed app to upload new
  or updated files any time, from any computer, without redeploying.

## 1. Local setup

```bash
npm install
```

## 2. Create a Vercel project + Blob store

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repo.
   Framework preset should auto-detect as **Next.js** — accept the defaults and deploy.
3. Once the project exists, go to your project's **Storage** tab → **Create Database**
   → **Blob** → create a store and connect it to this project.
   Vercel automatically adds the `BLOB_READ_WRITE_TOKEN` environment variable to
   your project for you — you don't need to type it in yourself.
4. Go to **Settings → Environment Variables** and add:
   - `ADMIN_PASSWORD` — any password you choose, used to protect the `/admin` upload page.
5. Redeploy (Vercel does this automatically after you add env vars, or trigger
   a redeploy manually from the Deployments tab).

## 3. Get your existing local data into the app

On your laptop, in this project folder:

```bash
# Copy the Blob token from Vercel dashboard -> Storage -> your store -> ".env.local" tab
cp .env.local.example .env.local
# paste BLOB_READ_WRITE_TOKEN=... into .env.local

npm run bulk-upload -- "C:\path\to\your\Data\folder"
```

This walks your local `Data/<Segment>/<Timeframe>/*.csv` files and uploads each
one to Blob storage, preserving the same structure. It's safe to re-run — files
with the same name overwrite the old version.

Expected local folder layout (must match, folder names are case-insensitive):

```
Data/
  NSE/
    DAILY/    Reliance.csv, TCS.csv, ...
    WEEKLY/   ...
    MONTHLY/  ...
    YEARLY/   ...
  COMMODITY/  DAILY/ WEEKLY/ MONTHLY/ YEARLY/
  CRYPTO/     ...
  FOREX/      ...
  INDEXES/    ...
  INTERNATIONAL INDEXES/ ...
  SME/        ...
```

Each CSV needs a header row with recognizable Date/Open/High/Low/Close columns
(Volume is optional). Common variants (`Date`/`Time`, `Adj Close`, etc.) are
handled automatically.

## 4. Using the app

- **`/`** — pick Segment → Timeframe → Instrument, see the available date range,
  click **Download Excel**. The file always covers the file's full range (its
  earliest to latest date) — there's no manual date picker, matching the source data.
- **`/admin`** — enter your `ADMIN_PASSWORD`, pick Segment + Timeframe, select
  one or many CSV files, upload. Existing files for that segment/timeframe are
  listed below with size and last-uploaded time.

## 5. If something breaks after a change (rollback)

Two independent safety nets:

- **Vercel deployment history:** every push creates a new deployment. Go to your
  project's **Deployments** tab, find the last known-good one, and click
  **"Promote to Production"** — instant rollback, no code changes needed.
- **Git history:** all code changes are committed. If a bad commit needs undoing
  in the repo itself, `git revert <commit>` and push — this keeps history intact
  (safer than force-pushing or resetting).

Your uploaded data files in Blob storage are untouched by either kind of
rollback — they only affect the app code.

## Project structure

```
app/
  page.tsx                 Public download page
  admin/page.tsx           Admin upload page
  api/segments/            List of segments + timeframes
  api/instruments/         List instruments for a segment+timeframe
  api/preview/             First/last date + row count for one instrument
  api/download/            Generates and returns the Excel file
  api/admin/upload/        Handles CSV uploads (password protected)
  api/admin/list/          Lists uploaded files (password protected)
lib/
  constants.ts             Segment/timeframe definitions and blob path helpers
  blob.ts                  Vercel Blob read/write helpers
  csv.ts                   Flexible CSV parsing + styled Excel generation
  adminAuth.ts             Simple password check for admin routes
scripts/
  bulk-upload.mjs          Run locally to bulk-import your existing Data folder
```
