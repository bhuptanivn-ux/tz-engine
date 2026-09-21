// Yahoo Finance symbol for each non-NSE-mainboard ticker, used only by
// scripts/refresh-daily.mjs to fetch fresh daily bars going forward. NSE
// and SME tickers don't need an entry here -- they just take "<TICKER>.NS"
// directly (see refresh-daily.mjs).
//
// Confidence varies a lot by segment and is noted per group below. This
// was built from training knowledge only -- nothing here was verified
// against a live Yahoo response (this environment can't reach Yahoo's
// endpoints), so treat the LOW-confidence entries as a first guess to
// spot-check after the first scheduled run, not a certainty. The refresh
// script never overwrites or deletes existing historical rows regardless
// -- a wrong mapping only means new (or missing) rows going forward for
// that one ticker, never corrupted history, and it's an easy fix here if
// a mapping turns out to be wrong or a ticker never returns data.

export const OTHER_MARKETS_YAHOO_MAP = {
  // HIGH confidence -- these are the standard, actively-quoted Yahoo
  // continuous-futures tickers, and the original data (data/Commodities/
  // SOURCES.csv) documents that it was ALREADY sourced from these same
  // public COMEX/NYMEX/ICE continuous series (not real MCX lot pricing),
  // so continuing with them keeps the series consistent with its own
  // history rather than introducing a new source.
  commodity: {
    ALUMINI: "ALI=F",
    ALUMINIUM: "ALI=F",
    COPPER: "HG=F",
    COTTON: "CT=F",
    CRUDEOIL: "CL=F",
    CRUDEOILM: "CL=F",
    GOLD: "GC=F",
    GOLDGUINEA: "GC=F",
    GOLDM: "GC=F",
    GOLDPETAL: "GC=F",
    GOLDTEN: "GC=F",
    NATGASMINI: "NG=F",
    NATURALGAS: "NG=F",
    SILVER: "SI=F",
    SILVERM: "SI=F",
    SILVERMIC: "SI=F",
  },

  // HIGH confidence for the 4 major pairs; CNYINR is LOW confidence --
  // Yahoo doesn't reliably carry a direct CNY/INR quote, so that one may
  // simply return no data (tolerated, not fatal).
  forex: {
    USDINR: "INR=X",
    EURINR: "EURINR=X",
    GBPINR: "GBPINR=X",
    JPYINR: "JPYINR=X",
    CNYINR: "CNYINR=X",
  },

  // HIGH confidence for the mainstream coins; LOW confidence for
  // TETHER_GOLD (best-guess ticker, and unverified whether Yahoo's quote
  // currency matches what's already in this series -- worth a manual spot
  // check of the first few auto-fetched rows against the existing data).
  crypto: {
    BITCOIN: "BTC-USD",
    ETHEREUM: "ETH-USD",
    BNB: "BNB-USD",
    SOLANA: "SOL-USD",
    TETHER_GOLD: "XAUT-USD",
  },

  // HIGH confidence for the three headline indices.
  "international-indexes": {
    DJI: "^DJI",
    IXIC: "^IXIC",
    SPX: "^GSPC",
  },

  // HIGH confidence: NIFTY, BANKNIFTY, SENSEX, INDIAVIX. MEDIUM/LOW for
  // the sector and broad-market indices -- Yahoo's tickers for these
  // shift naming conventions occasionally and weren't verifiable live;
  // spot-check these after the first run.
  indexes: {
    NIFTY: "^NSEI",
    BANKNIFTY: "^NSEBANK",
    SENSEX: "^BSESN",
    INDIAVIX: "^INDIAVIX",
    NIFTY_100: "^CNX100",
    NIFTY_200: "^CNX200",
    NIFTY_500: "^CRSLDX",
    NIFTY_AUTO: "^CNXAUTO",
    NIFTY_COMMODITIES: "^CNXCMDT",
    NIFTY_FINANCIAL_SERVICES: "^CNXFIN",
    NIFTY_FMCG: "^CNXFMCG",
    NIFTY_IT: "^CNXIT",
    NIFTY_OIL_AND_GAS: "^CNXENERGY",
    NIFTY_PHARMA: "^CNXPHARMA",
    NIFTY_SMALLCAP_100: "^CNXSC",
  },
};

export function yahooSymbolForOtherMarket(segment, ticker) {
  return OTHER_MARKETS_YAHOO_MAP[segment]?.[ticker] ?? null;
}
