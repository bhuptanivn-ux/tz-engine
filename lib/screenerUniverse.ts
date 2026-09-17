// Ticker universe for the Entry Zone (DTF/WTF) screener.
//
// PLACEHOLDER: the user asked for the NSE 200 constituents, but that list
// isn't something to reproduce from memory — index membership changes and a
// mis-remembered list would silently scan the wrong stocks with no way to
// tell. Seeded instead with the Nifty 50 (a list stable and well-known
// enough to state confidently), clearly marked as a stand-in. Swap this
// array for the real NSE 200 list whenever it's supplied — every consumer
// just imports SCREENER_UNIVERSE.

export interface UniverseEntry {
  symbol: string; // Yahoo Finance symbol, NSE suffix
  name: string;
}

export const SCREENER_UNIVERSE: UniverseEntry[] = [
  { symbol: "ADANIENT.NS", name: "Adani Enterprises" },
  { symbol: "ADANIPORTS.NS", name: "Adani Ports & SEZ" },
  { symbol: "APOLLOHOSP.NS", name: "Apollo Hospitals" },
  { symbol: "ASIANPAINT.NS", name: "Asian Paints" },
  { symbol: "AXISBANK.NS", name: "Axis Bank" },
  { symbol: "BAJAJ-AUTO.NS", name: "Bajaj Auto" },
  { symbol: "BAJFINANCE.NS", name: "Bajaj Finance" },
  { symbol: "BAJAJFINSV.NS", name: "Bajaj Finserv" },
  { symbol: "BEL.NS", name: "Bharat Electronics" },
  { symbol: "BPCL.NS", name: "Bharat Petroleum" },
  { symbol: "BHARTIARTL.NS", name: "Bharti Airtel" },
  { symbol: "BRITANNIA.NS", name: "Britannia Industries" },
  { symbol: "CIPLA.NS", name: "Cipla" },
  { symbol: "COALINDIA.NS", name: "Coal India" },
  { symbol: "DIVISLAB.NS", name: "Divi's Laboratories" },
  { symbol: "DRREDDY.NS", name: "Dr. Reddy's Laboratories" },
  { symbol: "EICHERMOT.NS", name: "Eicher Motors" },
  { symbol: "GRASIM.NS", name: "Grasim Industries" },
  { symbol: "HCLTECH.NS", name: "HCL Technologies" },
  { symbol: "HDFCBANK.NS", name: "HDFC Bank" },
  { symbol: "HDFCLIFE.NS", name: "HDFC Life Insurance" },
  { symbol: "HEROMOTOCO.NS", name: "Hero MotoCorp" },
  { symbol: "HINDALCO.NS", name: "Hindalco Industries" },
  { symbol: "HINDUNILVR.NS", name: "Hindustan Unilever" },
  { symbol: "ICICIBANK.NS", name: "ICICI Bank" },
  { symbol: "ITC.NS", name: "ITC" },
  { symbol: "INDUSINDBK.NS", name: "IndusInd Bank" },
  { symbol: "INFY.NS", name: "Infosys" },
  { symbol: "JSWSTEEL.NS", name: "JSW Steel" },
  { symbol: "KOTAKBANK.NS", name: "Kotak Mahindra Bank" },
  { symbol: "LT.NS", name: "Larsen & Toubro" },
  { symbol: "M&M.NS", name: "Mahindra & Mahindra" },
  { symbol: "MARUTI.NS", name: "Maruti Suzuki India" },
  { symbol: "NTPC.NS", name: "NTPC" },
  { symbol: "NESTLEIND.NS", name: "Nestle India" },
  { symbol: "ONGC.NS", name: "Oil & Natural Gas Corporation" },
  { symbol: "POWERGRID.NS", name: "Power Grid Corporation" },
  { symbol: "RELIANCE.NS", name: "Reliance Industries" },
  { symbol: "SBILIFE.NS", name: "SBI Life Insurance" },
  { symbol: "SHRIRAMFIN.NS", name: "Shriram Finance" },
  { symbol: "SBIN.NS", name: "State Bank of India" },
  { symbol: "SUNPHARMA.NS", name: "Sun Pharmaceutical Industries" },
  { symbol: "TCS.NS", name: "Tata Consultancy Services" },
  { symbol: "TATACONSUM.NS", name: "Tata Consumer Products" },
  { symbol: "TATAMOTORS.NS", name: "Tata Motors" },
  { symbol: "TATASTEEL.NS", name: "Tata Steel" },
  { symbol: "TECHM.NS", name: "Tech Mahindra" },
  { symbol: "TITAN.NS", name: "Titan Company" },
  { symbol: "TRENT.NS", name: "Trent" },
  { symbol: "ULTRACEMCO.NS", name: "UltraTech Cement" },
  { symbol: "WIPRO.NS", name: "Wipro" },
];
