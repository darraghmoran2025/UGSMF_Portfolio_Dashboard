"""
Student Managed Fund (SMF) Portfolio Dashboard.

Tab 1 — Portfolio Performance: read a CSV of stock prices, derive sector
weights, returns, contributions, and benchmark comparisons (MSCI World).

Tab 2 — Options Strategy & Risk Engine: Black-Scholes pricing, multi-leg
strategy builder (with presets), payoff diagram, volatility stress test,
and a 2D risk heatmap (price × time decay).

Accepted CSV format (matches stock_performance_*.csv exports):

    Sector,Ticker,Company,Exchange,Price_<DDMmmYYYY>,Price_<DDMmmYYYY>,Yahoo_Finance_URL
    Industrials,HON,Honeywell International,NASDAQ / USD,213.17,194.73,https://...
    ...
    Benchmark,MSCI World Index,,,4609,4322.9,

Multi-batch portfolios are supported via separator rows that override the
start date for subsequent rows, e.g. ",,,,,Price_2Mar2026," tells the
parser that all rows that follow were acquired on 2 March 2026.
"""

import base64
import csv
import io
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from scipy.stats import norm

try:
    import yfinance as yf
    _HAS_YFINANCE = True
except ImportError:  # pragma: no cover - optional dependency
    yf = None
    _HAS_YFINANCE = False

# ---------------------------------------------------------------------------
# Page setup
# ---------------------------------------------------------------------------
LOGO_PATH = Path(__file__).parent / "static" / "assets" / "ug-smf-logo.png"
FAVICON_PATH = Path(__file__).parent / "static" / "assets" / "ug-smf-logo.png"

BRAND_MAROON = "#8a0a1f"
BRAND_MAROON_DEEP = "#5e0414"
BRAND_GOLD = "#c9a14a"
BRAND_CREAM = "#f7f1e7"
BRAND_INK = "#1a1410"
BRAND_COLORWAY = [
    BRAND_MAROON,
    BRAND_GOLD,
    BRAND_MAROON_DEEP,
    "#0f766e",
    "#1f3a5f",
    "#b03b4e",
    "#6b6157",
]


def _palette(dark: bool) -> dict:
    """Return the colour tokens used by both the CSS theme and Plotly figures."""
    if dark:
        return {
            "APP_BG": "#13100c",
            "PANEL_BG": "#221c15",
            "SIDEBAR_BG": "#1a1510",
            "CARD_BG": "#221c15",
            "TEXT": "#f7f1e7",
            "TEXT_MUTED": "#c9bfae",
            "BORDER": "#3a322a",
            "BORDER_SOFT": "#2a241c",
            "GRID": "#3a322a",
            "ZERO": "#5a5045",
            "PLOTLY_TEMPLATE": "plotly_dark",
            "MAROON": BRAND_MAROON,
            "MAROON_DEEP": BRAND_MAROON_DEEP,
            "GOLD": BRAND_GOLD,
            "POSITIVE": "#3fb273",
        }
    return {
        "APP_BG": "#ffffff",
        "PANEL_BG": "#ffffff",
        "SIDEBAR_BG": "#fbf7f0",
        "CARD_BG": "#ffffff",
        "TEXT": BRAND_INK,
        "TEXT_MUTED": "#6b6157",
        "BORDER": "#e3dccf",
        "BORDER_SOFT": "#efe9dc",
        "GRID": "#e3dccf",
        "ZERO": "#c9bfae",
        "PLOTLY_TEMPLATE": "plotly_white",
        "MAROON": BRAND_MAROON,
        "MAROON_DEEP": BRAND_MAROON_DEEP,
        "GOLD": BRAND_GOLD,
        "POSITIVE": "#1f7a3a",
    }


st.set_page_config(
    page_title="UGSMF Portfolio Dashboard",
    page_icon=str(FAVICON_PATH) if FAVICON_PATH.exists() else ":chart_with_upwards_trend:",
    layout="wide",
)

# Initialise theme state up-front so the CSS block below reflects the toggle.
if "dark_mode" not in st.session_state:
    st.session_state["dark_mode"] = False
st.sidebar.toggle("🌙 Night mode", key="dark_mode")
DARK = bool(st.session_state["dark_mode"])
PALETTE = _palette(DARK)
PLOTLY_TEMPLATE = PALETTE["PLOTLY_TEMPLATE"]

# University of Galway SMF brand styling — palette is theme-aware.
_HEADER_TEXT_COLOR = "#f7f1e7" if DARK else BRAND_INK
_SIDEBAR_HEADER = PALETTE["GOLD"] if DARK else BRAND_MAROON_DEEP
_FOOTER_LINK = PALETTE["GOLD"] if DARK else BRAND_MAROON_DEEP

st.markdown(
    f"""
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

      html, body, [class*="css"] {{
          font-family: 'Inter', system-ui, -apple-system, "Segoe UI", sans-serif;
      }}

      [data-testid="stAppViewContainer"], [data-testid="stMain"] {{
          background: {PALETTE["APP_BG"]};
          color: {PALETTE["TEXT"]};
      }}
      [data-testid="stHeader"] {{
          background: {PALETTE["APP_BG"]};
      }}
      .stMarkdown, .stMarkdown p, .stMarkdown li, .stCaption, label, .stRadio label,
      .stCheckbox label, .stSelectbox label, .stNumberInput label, .stSlider label {{
          color: {PALETTE["TEXT"]};
      }}
      .stMarkdown small, .stCaption {{ color: {PALETTE["TEXT_MUTED"]}; }}

      .ugsmf-banner {{
          align-items: center;
          background: linear-gradient(135deg, {BRAND_MAROON} 0%, {BRAND_MAROON_DEEP} 100%);
          border-bottom: 3px solid {BRAND_GOLD};
          border-radius: 12px;
          color: #fff;
          display: flex;
          gap: 22px;
          margin: 0 0 18px;
          padding: 22px 28px;
      }}
      .ugsmf-banner img {{
          border-radius: 10px;
          display: block;
          flex-shrink: 0;
          height: 104px;
          object-fit: contain;
          width: 104px;
      }}
      .ugsmf-banner .eyebrow {{
          color: {BRAND_GOLD};
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.18em;
          margin: 0 0 4px;
          text-transform: uppercase;
      }}
      .ugsmf-banner h1 {{
          color: #fff;
          font-size: 1.9rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          margin: 0 0 4px;
      }}
      .ugsmf-banner .subline {{
          color: rgba(255, 255, 255, 0.78);
          font-size: 0.86rem;
          letter-spacing: 0.04em;
          margin: 0;
      }}
      .ugsmf-banner .rule {{
          background: rgba(255, 255, 255, 0.25);
          height: 1px;
          margin: 8px 0 6px;
          width: 90px;
      }}

      h1, h2, h3, h4 {{ letter-spacing: -0.01em; color: {_HEADER_TEXT_COLOR}; }}

      div[data-testid="stMetric"] {{
          background: {PALETTE["CARD_BG"]};
          border: 1px solid {PALETTE["BORDER"]};
          border-radius: 10px;
          border-top: 3px solid {BRAND_MAROON};
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
          padding: 14px 16px;
      }}
      div[data-testid="stMetricLabel"] {{
          color: {PALETTE["TEXT_MUTED"]};
          font-size: 0.74rem !important;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
      }}
      div[data-testid="stMetricValue"] {{ color: {PALETTE["TEXT"]}; }}

      .stButton > button, .stDownloadButton > button {{
          background: {BRAND_MAROON};
          border: 1px solid {BRAND_MAROON};
          border-radius: 6px;
          color: #fff;
          font-weight: 700;
          letter-spacing: 0.02em;
      }}
      .stButton > button:hover, .stDownloadButton > button:hover {{
          background: {BRAND_MAROON_DEEP};
          border-color: {BRAND_MAROON_DEEP};
          color: #fff;
      }}

      .stTabs [data-baseweb="tab-list"] {{
          border-bottom: 1px solid {PALETTE["BORDER"]};
          gap: 4px;
      }}
      .stTabs [data-baseweb="tab"] {{
          color: {PALETTE["TEXT_MUTED"]};
          font-weight: 600;
          letter-spacing: 0.02em;
      }}
      .stTabs [aria-selected="true"] {{
          color: {PALETTE["GOLD"] if DARK else BRAND_MAROON_DEEP} !important;
          border-bottom-color: {BRAND_MAROON} !important;
      }}

      section[data-testid="stSidebar"] {{
          background: {PALETTE["SIDEBAR_BG"]};
          border-right: 1px solid {PALETTE["BORDER"]};
      }}
      section[data-testid="stSidebar"] * {{ color: {PALETTE["TEXT"]}; }}
      section[data-testid="stSidebar"] h2,
      section[data-testid="stSidebar"] h3 {{
          color: {_SIDEBAR_HEADER};
      }}

      div[data-testid="stExpander"] {{
          background: {PALETTE["CARD_BG"]};
          border: 1px solid {PALETTE["BORDER_SOFT"]};
          border-radius: 8px;
      }}
      div[data-testid="stExpander"] summary {{ color: {PALETTE["TEXT"]}; }}

      input, textarea, [data-baseweb="input"], [data-baseweb="select"] {{
          color: {PALETTE["TEXT"]} !important;
      }}

      .ugsmf-allocation-presets {{ display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }}

      .ugsmf-footer {{
          border-top: 1px solid {PALETTE["BORDER"]};
          color: {PALETTE["TEXT_MUTED"]};
          font-size: 0.82rem;
          margin-top: 24px;
          padding-top: 18px;
      }}
      .ugsmf-footer strong {{ color: {PALETTE["TEXT"]}; }}
      .ugsmf-footer a {{ color: {_FOOTER_LINK}; text-decoration: none; }}
      .ugsmf-footer a:hover {{ text-decoration: underline; }}
      .ugsmf-footer .disclaimer {{
          border-top: 1px dashed {PALETTE["BORDER"]};
          font-size: 0.76rem;
          margin-top: 12px;
          padding-top: 12px;
      }}
    </style>
    """,
    unsafe_allow_html=True,
)


def _embed_image_b64(path: Path) -> str:
    try:
        return base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return ""


def render_brand_header() -> None:
    logo_b64 = _embed_image_b64(LOGO_PATH)
    logo_html = (
        f'<img src="data:image/png;base64,{logo_b64}" '
        f'alt="University of Galway Student Managed Fund" '
        f'style="height:104px;width:104px;border-radius:10px;object-fit:contain;display:block;flex-shrink:0;" />'
        if logo_b64
        else ""
    )
    st.markdown(
        f"""
        <div class="ugsmf-banner">
          {logo_html}
          <div>
            <p class="eyebrow">Portfolio &amp; Options Analytics</p>
            <h1>Portfolio Dashboard</h1>
            <div class="rule"></div>
            <p class="subline">Student Managed Fund</p>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_brand_footer() -> None:
    st.markdown(
        """
        <div class="ugsmf-footer">
          <div>
            <strong>University of Galway Student Managed Fund</strong>
            ·
            <a href="https://universityofgalwaysmf.com/" target="_blank" rel="noopener">universityofgalwaysmf.com</a>
            · Portfolio &amp; Options Analytics Dashboard
          </div>
          <p class="disclaimer">
            For educational use by members of the University of Galway Student Managed Fund. Figures are
            derived from the loaded CSV and Black–Scholes pricing assumptions and are not investment advice.
          </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

SECTORS = [
    "Industrials",
    "Consumer",
    "Technology",
    "Healthcare",
    "Real Assets",
    "Alternative Assets",
    "Financials",
]
BASELINE_WEIGHT = 100.0 / len(SECTORS)

# Legacy lookup — only used if a CSV omits the Sector column.
TICKER_TO_SECTOR = {
    "HON":     "Industrials",
    "ATEX":    "Industrials",
    "MU":      "Technology",
    "INOD":    "Technology",
    "BBIO":    "Healthcare",
    "VRTX":    "Healthcare",
    "WPM":     "Real Assets",
    "XOM":     "Real Assets",
    "NEM":     "Alternative Assets",
    "FCX":     "Alternative Assets",
    "BYD":     "Consumer",
    "BYDDF":   "Consumer",
    "PG":      "Consumer",
    "1211.HK": "Consumer",
    "ALIZY":   "Financials",
    "ALV.DE":  "Financials",
    "V":       "Financials",
}

BENCHMARK_NAME_DEFAULT = "MSCI World Index"
BENCHMARK_START_DEFAULT = 4322.90
BENCHMARK_END_DEFAULT = 4609.00
PERIOD_START_DEFAULT = "2025-10-20"
PERIOD_END_DEFAULT = "2026-04-24"

# Yahoo Finance ticker for MSCI World USD price return, plus an ETF fallback.
MSCI_WORLD_TICKER = "^990100-USD-STRD"
MSCI_WORLD_PROXY_TICKER = "URTH"

EMBEDDED_CSV = """Sector,Ticker,Company,Exchange,Price_24Apr2026,Price_20Oct2025,Yahoo_Finance_URL
Industrials,HON,Honeywell International,NASDAQ / USD,213.17,194.73,https://finance.yahoo.com/quote/HON/history/
Consumer,BYDDF,BYD Co. Ltd.,OTC / USD,99.46,102.9,https://finance.yahoo.com/quote/BYDDF/history/
Technology,MU,Micron Technology,NASDAQ / USD,496.72,198.47,https://finance.yahoo.com/quote/MU/history/
Healthcare,BBIO,BridgeBio Pharma,NASDAQ / USD,73.28,53.24,https://finance.yahoo.com/quote/BBIO/history/
Real Assets,WPM,Wheaton Precious Metals,NYSE / USD,139.44,97.13,https://finance.yahoo.com/quote/WPM/history/
Alternative Assets,NEM,Newmont Corporation,NYSE / USD,120.7,87.01,https://finance.yahoo.com/quote/NEM/history/
Financials,ALIZY,Allianz SE ADR,OTC ADR / USD,388,351.7,https://finance.yahoo.com/quote/ALIZY/history/
,,,,,Price_2Mar2026,
Industrials,ATEX,Anterix,NASDAQ / USD,45.17,37.2,https://stockanalysis.com/stocks/atex/history/
Consumer,PG,Procter & Gamble,NYSE / USD,148.18,163.51,https://stockanalysis.com/stocks/pg/history/
Technology,INOD,Innodata,NASDAQ / USD,42.34,44.46,https://stockanalysis.com/stocks/inod/history/
Healthcare,VRTX,Vertex Pharmaceuticals,NASDAQ / USD,430.29,486.03,https://stockanalysis.com/stocks/vrtx/history/
Real Assets,XOM,ExxonMobil,NYSE / USD,148.91,154.22,https://stockanalysis.com/stocks/xom/history/
Alternative Assets,FCX,Freeport-McMoRan,NYSE / USD,61.05,68.08,https://stockanalysis.com/stocks/fcx/history/
Financials,V,Visa,NYSE / USD,309.42,320.51,https://stockanalysis.com/stocks/v/history/
Benchmark,MSCI World Index,,,4609,4322.9,
"""


# ---------------------------------------------------------------------------
# CSV cleaning
# ---------------------------------------------------------------------------
_DATE_PATTERNS = [
    (re.compile(r"(\d{1,2})([A-Za-z]{3,9})(\d{4})"), "%d%b%Y"),
    (re.compile(r"(\d{4})[-_](\d{1,2})[-_](\d{1,2})"), "%Y-%m-%d"),
    (re.compile(r"(\d{1,2})[-_](\d{1,2})[-_](\d{4})"), "%d-%m-%Y"),
]


def _parse_date_from_col(col: str) -> datetime | None:
    for pattern, fmt in _DATE_PATTERNS:
        m = pattern.search(col)
        if not m:
            continue
        if fmt == "%d%b%Y":
            token = "".join(m.groups())
        else:
            token = "-".join(m.groups())
        try:
            return datetime.strptime(token, fmt)
        except ValueError:
            continue
    return None


def _split_csv_row(line: str) -> list[str]:
    return next(csv.reader([line]))


def _clean_dataframe(raw_text: str) -> tuple[pd.DataFrame, str, str]:
    lines = raw_text.splitlines()
    if not lines:
        return pd.DataFrame(), PERIOD_START_DEFAULT, PERIOD_END_DEFAULT

    # Locate the column header row.
    header_idx = 0
    for i, line in enumerate(lines):
        lowered = line.lower()
        if "ticker" in lowered and ("price" in lowered or "weight" in lowered or "return" in lowered):
            header_idx = i
            break

    header_fields = [c.strip().replace(" ", "_") for c in _split_csv_row(lines[header_idx])]

    # Map every dated price column to its parsed date.
    date_to_col: dict[datetime, str] = {}
    for col in header_fields:
        if col.lower().startswith("price_"):
            d = _parse_date_from_col(col)
            if d is not None:
                date_to_col[d] = col

    sorted_dates = sorted(date_to_col.items())
    initial_start_date, initial_start_col = sorted_dates[0] if sorted_dates else (None, None)
    end_date, end_col = sorted_dates[-1] if sorted_dates else (None, None)

    ticker_idx = header_fields.index("Ticker") if "Ticker" in header_fields else 1

    # Walk body rows. A separator row carries no Ticker but holds a "Price_<date>"
    # token in one of its cells — that token rebases the start date for every
    # holding row that follows.
    current_start_date = initial_start_date
    current_start_col = initial_start_col
    earliest_start = initial_start_date
    body_rows: list[list[str]] = []
    row_start_dates: list[datetime | None] = []
    row_start_cols: list[str | None] = []

    for raw in lines[header_idx + 1:]:
        if not raw.strip():
            continue
        try:
            fields = _split_csv_row(raw)
        except csv.Error:
            continue
        fields = [(f or "").strip() for f in fields]
        # Right-pad to header width.
        if len(fields) < len(header_fields):
            fields = fields + [""] * (len(header_fields) - len(fields))

        ticker_val = fields[ticker_idx] if ticker_idx < len(fields) else ""

        if not ticker_val or ticker_val.lower() == "nan":
            new_date = None
            for cell_idx, cell in enumerate(fields):
                if cell.lower().startswith("price_"):
                    candidate = _parse_date_from_col(cell)
                    if candidate is not None:
                        new_date = candidate
                        if cell_idx < len(header_fields):
                            current_start_col = header_fields[cell_idx]
                        break
            if new_date is not None:
                current_start_date = new_date
                if earliest_start is None or new_date < earliest_start:
                    earliest_start = new_date
            continue  # skip both separators and blank rows

        body_rows.append(fields)
        row_start_dates.append(current_start_date)
        row_start_cols.append(current_start_col)

    df = pd.DataFrame(body_rows, columns=header_fields)
    df["_RowStartDate"] = row_start_dates
    df["_RowStartCol"] = row_start_cols

    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).str.strip().replace({"nan": np.nan, "": np.nan})

    # Coerce every dated price column to numeric.
    for col in list(date_to_col.values()):
        df[col] = pd.to_numeric(
            df[col].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False),
            errors="coerce",
        )

    # Per-row Price_Start (looked up via the row's own batch start column).
    def _start_price(row: pd.Series) -> float:
        col = row.get("_RowStartCol")
        if not col:
            return np.nan
        val = row.get(col)
        return float(val) if pd.notna(val) else np.nan

    df["Price_Start"] = df.apply(_start_price, axis=1)
    if end_col:
        df["Price_End"] = pd.to_numeric(df[end_col], errors="coerce")
    elif "Price_End" not in df.columns:
        df["Price_End"] = np.nan

    for col in ("Weight", "Return", "Contribution"):
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.replace("%", "", regex=False),
                errors="coerce",
            )

    df = df.dropna(subset=["Ticker"]).reset_index(drop=True)

    for url_col in ("Yahoo_Finance_URL", "Yahoo_URL", "URL"):
        if url_col in df.columns and url_col != "Yahoo_URL":
            df = df.rename(columns={url_col: "Yahoo_URL"})
            break
    if "Yahoo_URL" not in df.columns:
        df["Yahoo_URL"] = pd.NA

    if "Exchange" not in df.columns:
        df["Exchange"] = pd.NA
    if "Company" not in df.columns:
        df["Company"] = df["Ticker"]

    sector_str = df["Sector"].astype(str) if "Sector" in df.columns else pd.Series([""] * len(df))
    ticker_str = df["Ticker"].astype(str)
    bench_mask = (
        sector_str.str.lower().eq("benchmark")
        | ticker_str.str.contains("MSCI", case=False, na=False)
        | ticker_str.str.contains("Index", case=False, na=False)
    )

    if "Sector" not in df.columns:
        df["Sector"] = df["Ticker"].map(TICKER_TO_SECTOR)
    else:
        missing = df["Sector"].isna() & ~bench_mask
        if missing.any():
            df.loc[missing, "Sector"] = df.loc[missing, "Ticker"].map(TICKER_TO_SECTOR)
    df.loc[bench_mask, "Sector"] = "Benchmark"
    df["Sector"] = df["Sector"].fillna("Other")

    return_was_computed = False
    if "Return" not in df.columns or df["Return"].isna().all():
        df["Return"] = (df["Price_End"] - df["Price_Start"]) / df["Price_Start"]
        return_was_computed = True

    weight_was_computed = False
    if "Weight" not in df.columns or df["Weight"].isna().all():
        n_holdings = int((~bench_mask).sum())
        df["Weight"] = 0.0
        if n_holdings > 0:
            df.loc[~bench_mask, "Weight"] = 1.0 / n_holdings
        weight_was_computed = True

    if not weight_was_computed and df["Weight"].max() > 1.5:
        df["Weight"] = df["Weight"] / 100.0
    if not return_was_computed and df["Return"].abs().max() > 5.0:
        df["Return"] = df["Return"] / 100.0
    if "Contribution" in df.columns and df["Contribution"].notna().any() and df["Contribution"].abs().max() > 5.0:
        df["Contribution"] = df["Contribution"] / 100.0

    if "Contribution" not in df.columns or df["Contribution"].isna().all():
        df["Contribution"] = df["Weight"] * df["Return"]

    period_start = (earliest_start or initial_start_date).strftime("%Y-%m-%d") if (earliest_start or initial_start_date) else PERIOD_START_DEFAULT
    period_end = end_date.strftime("%Y-%m-%d") if end_date else PERIOD_END_DEFAULT

    # Surface each row's actual buy date for the deep-dive panel.
    df["Buy_Date"] = [d.strftime("%Y-%m-%d") if isinstance(d, datetime) else "" for d in df["_RowStartDate"]]
    df = df.drop(columns=["_RowStartDate", "_RowStartCol"])

    return df, period_start, period_end


@st.cache_data
def load_from_path(path: str) -> tuple[pd.DataFrame, str, str]:
    raw = Path(path).read_text(encoding="utf-8-sig", errors="ignore") if Path(path).exists() else EMBEDDED_CSV
    return _clean_dataframe(raw)


def load_from_upload(file_bytes: bytes) -> tuple[pd.DataFrame, str, str]:
    raw = file_bytes.decode("utf-8-sig", errors="ignore")
    return _clean_dataframe(raw)


def _split_benchmark(df_all: pd.DataFrame) -> tuple[pd.DataFrame, str, float, float]:
    bench_mask = df_all["Sector"].astype(str).str.lower().eq("benchmark")
    bench = df_all.loc[bench_mask].head(1)
    holdings = df_all.loc[~bench_mask].reset_index(drop=True)

    if bench.empty:
        return holdings, BENCHMARK_NAME_DEFAULT, BENCHMARK_START_DEFAULT, BENCHMARK_END_DEFAULT

    b = bench.iloc[0]
    name = str(b.get("Company") or b.get("Ticker") or BENCHMARK_NAME_DEFAULT)
    if not name or name.lower() == "nan":
        name = str(b.get("Ticker") or BENCHMARK_NAME_DEFAULT)
    start = float(b["Price_Start"]) if pd.notna(b.get("Price_Start")) else BENCHMARK_START_DEFAULT
    end = float(b["Price_End"]) if pd.notna(b.get("Price_End")) else BENCHMARK_END_DEFAULT
    return holdings, name, start, end


@st.cache_data(ttl=600)
def fetch_live_msci_world(period_start_iso: str) -> dict | None:
    """Fetch live MSCI World data, falling back to an ETF proxy if needed.

    Returns a dict with start_close, last_close, percent_return, last_timestamp,
    and source ticker, or ``None`` if yfinance is unavailable / the request
    fails. Cached for 10 minutes so the dashboard does not hammer Yahoo on
    every interaction.
    """
    if not _HAS_YFINANCE:
        return None
    try:
        period_start = datetime.fromisoformat(period_start_iso)
    except ValueError:
        return None
    for ticker, source_name in (
        (MSCI_WORLD_TICKER, "MSCI World Index"),
        (MSCI_WORLD_PROXY_TICKER, "iShares MSCI World ETF proxy"),
    ):
        try:
            hist = yf.Ticker(ticker).history(
                start=period_start.strftime("%Y-%m-%d"),
                interval="1d",
                auto_adjust=False,
            )
        except Exception:  # pragma: no cover - network failure
            continue
        if hist is None or hist.empty or "Close" not in hist.columns:
            continue
        closes = hist["Close"].dropna()
        if closes.empty:
            continue
        start_close = float(closes.iloc[0])
        last_close = float(closes.iloc[-1])
        if start_close <= 0:
            continue
        return {
            "ticker": ticker,
            "source_name": source_name,
            "start_close": start_close,
            "last_close": last_close,
            "percent_return": (last_close / start_close) - 1.0,
            "last_timestamp": closes.index[-1].to_pydatetime().astimezone(timezone.utc),
            "start_date": closes.index[0].strftime("%Y-%m-%d"),
        }
    return None


# ---------------------------------------------------------------------------
# Black-Scholes pricing & options helpers
# ---------------------------------------------------------------------------
def bs_price_and_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> dict:
    """European Black-Scholes price plus Delta, Gamma, Theta (per day), Vega (per 1% IV)."""
    is_call = option_type.lower().startswith("c")
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        if is_call:
            price = max(S - K, 0.0)
            delta = 1.0 if S > K else (0.5 if S == K else 0.0)
        else:
            price = max(K - S, 0.0)
            delta = -1.0 if S < K else (-0.5 if S == K else 0.0)
        return {"price": price, "delta": delta, "gamma": 0.0, "theta": 0.0, "vega": 0.0}

    sqrtT = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT
    pdf_d1 = norm.pdf(d1)
    disc = math.exp(-r * T)

    if is_call:
        price = S * norm.cdf(d1) - K * disc * norm.cdf(d2)
        delta = norm.cdf(d1)
        theta_yr = -(S * pdf_d1 * sigma) / (2 * sqrtT) - r * K * disc * norm.cdf(d2)
    else:
        price = K * disc * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = norm.cdf(d1) - 1.0
        theta_yr = -(S * pdf_d1 * sigma) / (2 * sqrtT) + r * K * disc * norm.cdf(-d2)

    gamma = pdf_d1 / (S * sigma * sqrtT)
    vega = S * pdf_d1 * sqrtT
    return {
        "price": price,
        "delta": delta,
        "gamma": gamma,
        "theta": theta_yr / 365.0,
        "vega": vega / 100.0,
    }


def bs_price_vec(S_arr: np.ndarray, K: float, T: float, r: float, sigma: float, option_type: str) -> np.ndarray:
    """Vectorised BS price (no Greeks) over an array of spot prices."""
    S_arr = np.asarray(S_arr, dtype=float)
    is_call = option_type.lower().startswith("c")
    if T <= 0 or sigma <= 0:
        if is_call:
            return np.maximum(S_arr - K, 0.0)
        return np.maximum(K - S_arr, 0.0)
    sqrtT = math.sqrt(T)
    safe_S = np.where(S_arr > 0, S_arr, 1e-9)
    d1 = (np.log(safe_S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    d2 = d1 - sigma * sqrtT
    if is_call:
        return safe_S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    return K * math.exp(-r * T) * norm.cdf(-d2) - safe_S * norm.cdf(-d1)


def compute_payoff_at_expiry(S_arr: np.ndarray, legs: list[dict]) -> np.ndarray:
    pnl = np.zeros_like(np.asarray(S_arr, dtype=float))
    for leg in legs:
        if leg["type"].lower().startswith("c"):
            intrinsic = np.maximum(S_arr - leg["strike"], 0.0)
        else:
            intrinsic = np.maximum(leg["strike"] - S_arr, 0.0)
        sign = 1.0 if leg["action"] == "Buy" else -1.0
        pnl = pnl + sign * (intrinsic - leg["price"]) * leg["qty"]
    return pnl


def compute_value_curve(S_arr: np.ndarray, legs: list[dict], T: float, r: float, sigma: float) -> np.ndarray:
    """Mark-to-market P&L (current value − entry value) at remaining T years to expiry."""
    pnl = np.zeros_like(np.asarray(S_arr, dtype=float))
    for leg in legs:
        sign = 1.0 if leg["action"] == "Buy" else -1.0
        current = bs_price_vec(S_arr, leg["strike"], T, r, sigma, leg["type"])
        pnl = pnl + sign * (current - leg["price"]) * leg["qty"]
    return pnl


PRESETS = ["Custom", "Bull Call Spread", "Iron Condor", "Straddle"]


def preset_to_legs(preset: str, spot: float, sd_dollar: float) -> list[dict] | None:
    spot2 = round(spot, 2)
    half_lo, half_hi = round(spot - 0.5 * sd_dollar, 2), round(spot + 0.5 * sd_dollar, 2)
    one_lo, one_hi = round(spot - sd_dollar, 2), round(spot + sd_dollar, 2)
    two_lo, two_hi = round(spot - 2 * sd_dollar, 2), round(spot + 2 * sd_dollar, 2)
    if preset == "Bull Call Spread":
        return [
            dict(enabled=True,  action="Buy",  type="Call", strike=half_lo, qty=1),
            dict(enabled=True,  action="Sell", type="Call", strike=half_hi, qty=1),
            dict(enabled=False, action="Buy",  type="Call", strike=spot2,   qty=1),
            dict(enabled=False, action="Buy",  type="Call", strike=spot2,   qty=1),
        ]
    if preset == "Iron Condor":
        return [
            dict(enabled=True,  action="Buy",  type="Put",  strike=two_lo, qty=1),
            dict(enabled=True,  action="Sell", type="Put",  strike=one_lo, qty=1),
            dict(enabled=True,  action="Sell", type="Call", strike=one_hi, qty=1),
            dict(enabled=True,  action="Buy",  type="Call", strike=two_hi, qty=1),
        ]
    if preset == "Straddle":
        return [
            dict(enabled=True,  action="Buy",  type="Call", strike=spot2, qty=1),
            dict(enabled=True,  action="Buy",  type="Put",  strike=spot2, qty=1),
            dict(enabled=False, action="Buy",  type="Call", strike=spot2, qty=1),
            dict(enabled=False, action="Buy",  type="Call", strike=spot2, qty=1),
        ]
    return None


# ---------------------------------------------------------------------------
# Title + upload
# ---------------------------------------------------------------------------
render_brand_header()

with st.container(border=True):
    st.markdown("### Upload Portfolio CSV")
    st.write(
        "Drop your CSV here to display the payoffs. "
        "**Expected format:** `Sector, Ticker, Company, Exchange, Price_<DDMmmYYYY>, Price_<DDMmmYYYY>, Yahoo_Finance_URL` "
        "with an optional `Benchmark,MSCI World Index,...` row. Separator rows such as `,,,,,Price_2Mar2026,` "
        "rebase the buy date for subsequent holdings. Weights, returns, and contributions are derived when omitted."
    )
    uploaded_file = st.file_uploader("Choose a CSV file", type=["csv"], label_visibility="collapsed")
    if uploaded_file is not None:
        df_all, period_start, period_end = load_from_upload(uploaded_file.getvalue())
        st.success(f"Loaded **{uploaded_file.name}** ({len(df_all)} rows)  ·  Period {period_start} → {period_end}")
    else:
        df_all, period_start, period_end = load_from_path("portfolio.csv")
        st.info(f"Using bundled sample data  ·  Period {period_start} → {period_end}")

st.caption(f"Holding period: {period_start} to {period_end}")

df, BENCHMARK_NAME, BENCHMARK_START, BENCHMARK_END = _split_benchmark(df_all)
BENCHMARK_RETURN = (BENCHMARK_END / BENCHMARK_START) - 1.0 if BENCHMARK_START else 0.0
PORTFOLIO_RETURN = float((df["Weight"] * df["Return"]).sum())
ALPHA = PORTFOLIO_RETURN - BENCHMARK_RETURN


# ---------------------------------------------------------------------------
# Sidebar — sector sliders + within-sector stock sliders
# ---------------------------------------------------------------------------
st.sidebar.header("Portfolio Controls")
st.sidebar.caption(f"Period: **{period_start} → {period_end}**")
st.sidebar.caption(f"Benchmark: **{BENCHMARK_NAME}**")
st.sidebar.divider()

st.sidebar.subheader("Sector Weights")
st.sidebar.caption(
    f"Baseline: **{BASELINE_WEIGHT:.2f}% each** (1/{len(SECTORS)}). "
    "Move a slider or type a value — the others auto-rescale to keep the total at 100%."
)


def _slider_key(sector: str) -> str:
    return f"sector_w::{sector}"


def _num_key(sector: str) -> str:
    return f"sector_w_num::{sector}"


def _stock_slider_key(ticker: str) -> str:
    return f"stock_w::{ticker}"


def _stock_num_key(ticker: str) -> str:
    return f"stock_w_num::{ticker}"


if "weights_initialised" not in st.session_state:
    for s in SECTORS:
        st.session_state[_slider_key(s)] = BASELINE_WEIGHT
        st.session_state[_num_key(s)] = BASELINE_WEIGHT
    st.session_state["weights_initialised"] = True

for s in SECTORS:
    sec_stocks = df[df["Sector"] == s]
    n = len(sec_stocks)
    for _, _row in sec_stocks.iterrows():
        sk = _stock_slider_key(_row["Ticker"])
        nk = _stock_num_key(_row["Ticker"])
        if sk not in st.session_state:
            st.session_state[sk] = 100.0 / n if n else 0.0
        if nk not in st.session_state:
            st.session_state[nk] = 100.0 / n if n else 0.0


def _reset_to_equal_weight() -> None:
    for s in SECTORS:
        st.session_state[_slider_key(s)] = BASELINE_WEIGHT
        st.session_state[_num_key(s)] = BASELINE_WEIGHT
    for s in SECTORS:
        sec_stocks = df[df["Sector"] == s]
        n = len(sec_stocks)
        eq = 100.0 / n if n else 0.0
        for _, _row in sec_stocks.iterrows():
            st.session_state[_stock_slider_key(_row["Ticker"])] = eq
            st.session_state[_stock_num_key(_row["Ticker"])] = eq


def _rebalance_others(changed_sector: str, new_val: float) -> None:
    other_sectors = [s for s in SECTORS if s != changed_sector]
    other_sum = sum(float(st.session_state[_slider_key(s)]) for s in other_sectors)
    target_others = 100.0 - new_val
    if target_others <= 0:
        for s in other_sectors:
            st.session_state[_slider_key(s)] = 0.0
            st.session_state[_num_key(s)] = 0.0
    elif other_sum <= 0:
        equal = target_others / len(other_sectors)
        for s in other_sectors:
            st.session_state[_slider_key(s)] = equal
            st.session_state[_num_key(s)] = equal
    else:
        scale = target_others / other_sum
        for s in other_sectors:
            new_v = float(st.session_state[_slider_key(s)]) * scale
            st.session_state[_slider_key(s)] = new_v
            st.session_state[_num_key(s)] = new_v


def _rebalance_stocks_in_sector(sector: str, changed_ticker: str, new_val: float) -> None:
    sec_stocks = df[df["Sector"] == sector]
    other_tickers = [t for t in sec_stocks["Ticker"].tolist() if t != changed_ticker]
    if not other_tickers:
        st.session_state[_stock_slider_key(changed_ticker)] = 100.0
        st.session_state[_stock_num_key(changed_ticker)] = 100.0
        return
    other_sum = sum(float(st.session_state[_stock_slider_key(t)]) for t in other_tickers)
    target = 100.0 - new_val
    if target <= 0:
        for t in other_tickers:
            st.session_state[_stock_slider_key(t)] = 0.0
            st.session_state[_stock_num_key(t)] = 0.0
    elif other_sum <= 0:
        equal = target / len(other_tickers)
        for t in other_tickers:
            st.session_state[_stock_slider_key(t)] = equal
            st.session_state[_stock_num_key(t)] = equal
    else:
        scale = target / other_sum
        for t in other_tickers:
            new_v = float(st.session_state[_stock_slider_key(t)]) * scale
            st.session_state[_stock_slider_key(t)] = new_v
            st.session_state[_stock_num_key(t)] = new_v


def _on_slider_change(sector: str) -> None:
    new_val = max(0.0, min(100.0, float(st.session_state[_slider_key(sector)])))
    st.session_state[_slider_key(sector)] = new_val
    st.session_state[_num_key(sector)] = new_val
    _rebalance_others(sector, new_val)


def _on_num_change(sector: str) -> None:
    new_val = max(0.0, min(100.0, float(st.session_state[_num_key(sector)])))
    st.session_state[_slider_key(sector)] = new_val
    st.session_state[_num_key(sector)] = new_val
    _rebalance_others(sector, new_val)


def _on_stock_slider_change(sector: str, ticker: str) -> None:
    new_val = max(0.0, min(100.0, float(st.session_state[_stock_slider_key(ticker)])))
    st.session_state[_stock_slider_key(ticker)] = new_val
    st.session_state[_stock_num_key(ticker)] = new_val
    _rebalance_stocks_in_sector(sector, ticker, new_val)


def _on_stock_num_change(sector: str, ticker: str) -> None:
    new_val = max(0.0, min(100.0, float(st.session_state[_stock_num_key(ticker)])))
    st.session_state[_stock_slider_key(ticker)] = new_val
    st.session_state[_stock_num_key(ticker)] = new_val
    _rebalance_stocks_in_sector(sector, ticker, new_val)


def _apply_stock_preset(sector: str, weights_pct: list[float]) -> None:
    """Set within-sector stock weights to specific percentages (sum should be ~100)."""
    sec_stocks = df[df["Sector"] == sector].reset_index(drop=True)
    tickers = sec_stocks["Ticker"].tolist()
    if not tickers:
        return
    if len(weights_pct) != len(tickers):
        # Fall back to equal weight if the preset doesn't match the holding count.
        weights_pct = [100.0 / len(tickers)] * len(tickers)
    for tk, w in zip(tickers, weights_pct):
        w_clamped = max(0.0, min(100.0, float(w)))
        st.session_state[_stock_slider_key(tk)] = w_clamped
        st.session_state[_stock_num_key(tk)] = w_clamped


def _apply_sector_preset(weights_pct: dict[str, float]) -> None:
    """Set every sector slider to the supplied percentage map."""
    for s in SECTORS:
        v = max(0.0, min(100.0, float(weights_pct.get(s, 0.0))))
        st.session_state[_slider_key(s)] = v
        st.session_state[_num_key(s)] = v


st.sidebar.button(
    f"Reset to equal weight (1/{len(SECTORS)} each)",
    on_click=_reset_to_equal_weight,
    use_container_width=True,
)

for sector in SECTORS:
    st.sidebar.markdown(f"**{sector}**")
    slider_col, num_col = st.sidebar.columns([3, 2])
    with slider_col:
        st.slider(
            label=sector,
            min_value=0.0, max_value=100.0, step=0.5,
            key=_slider_key(sector),
            on_change=_on_slider_change, args=(sector,),
            format="%.2f%%", label_visibility="collapsed",
        )
    with num_col:
        st.number_input(
            label=f"{sector} %",
            min_value=0.0, max_value=100.0, step=0.5,
            key=_num_key(sector),
            on_change=_on_num_change, args=(sector,),
            format="%.2f", label_visibility="collapsed",
        )

    sector_stocks = df[df["Sector"] == sector].reset_index(drop=True)
    sector_cap_pct = float(st.session_state[_slider_key(sector)])
    n_stocks = len(sector_stocks)
    with st.sidebar.expander(f"Stocks in {sector} ({n_stocks})", expanded=True):
        if sector_stocks.empty:
            st.caption("No stocks in this sector in the loaded CSV.")
        elif n_stocks == 1:
            only = sector_stocks.iloc[0]
            st.markdown(f"**{only['Ticker']}** — {only['Company']}")
            st.caption(
                f"Sole holding in {sector} → receives 100% of the sector cap "
                f"({sector_cap_pct:.2f}% of portfolio)."
            )
            st.markdown(f"Return: **{only['Return'] * 100:+.2f}%**")
            if pd.notna(only.get("Exchange")):
                st.markdown(f"Exchange: {only['Exchange']}")
            if pd.notna(only.get("Yahoo_URL")):
                st.markdown(f"[Yahoo Finance ↗]({only['Yahoo_URL']})")
        else:
            st.caption(
                f"Within-sector shares (sum to 100% of the {sector} cap "
                f"= {sector_cap_pct:.2f}% of portfolio)."
            )

            # Allocation presets — quick ratios in addition to the slider/number-input pair.
            if n_stocks == 2:
                presets = [
                    ("50/50", [50.0, 50.0]),
                    ("60/40", [60.0, 40.0]),
                    ("40/60", [40.0, 60.0]),
                    ("100/0", [100.0, 0.0]),
                    ("0/100", [0.0, 100.0]),
                ]
            else:
                eq = 100.0 / n_stocks
                presets = [(f"Equal ({eq:.1f}% each)", [eq] * n_stocks)]
                # Single-stock-takes-all presets for each holding.
                for i, tk in enumerate(sector_stocks["Ticker"].tolist()):
                    weights = [0.0] * n_stocks
                    weights[i] = 100.0
                    presets.append((f"100% {tk}", weights))

            preset_cols = st.columns(min(len(presets), 5))
            for col_idx, (label, weights) in enumerate(presets):
                preset_cols[col_idx % len(preset_cols)].button(
                    label,
                    key=f"stock_preset::{sector}::{label}",
                    on_click=_apply_stock_preset,
                    args=(sector, weights),
                    use_container_width=True,
                )

            for _, row in sector_stocks.iterrows():
                tk = row["Ticker"]
                share_pct = float(st.session_state[_stock_slider_key(tk)])
                portfolio_pct = sector_cap_pct * share_pct / 100.0
                st.markdown(
                    f"**{tk}** — {row['Company']}  ·  return **{row['Return'] * 100:+.2f}%**  ·  "
                    f"= **{portfolio_pct:.2f}%** of portfolio"
                )
                sl_col, nm_col = st.columns([3, 2])
                with sl_col:
                    st.slider(
                        label=tk,
                        min_value=0.0, max_value=100.0, step=0.5,
                        key=_stock_slider_key(tk),
                        on_change=_on_stock_slider_change, args=(sector, tk),
                        format="%.2f%%", label_visibility="collapsed",
                    )
                with nm_col:
                    st.number_input(
                        label=f"{tk} %",
                        min_value=0.0, max_value=100.0, step=0.5,
                        key=_stock_num_key(tk),
                        on_change=_on_stock_num_change, args=(sector, tk),
                        format="%.2f", label_visibility="collapsed",
                    )
                if pd.notna(row.get("Yahoo_URL")):
                    st.markdown(f"[Yahoo Finance ↗]({row['Yahoo_URL']})")

sector_weights = {s: float(st.session_state[_slider_key(s)]) for s in SECTORS}
slider_total = sum(sector_weights.values())
if slider_total > 0 and abs(slider_total - 100.0) > 1e-6:
    factor = 100.0 / slider_total
    sector_weights = {s: w * factor for s, w in sector_weights.items()}
    slider_total = 100.0

hypothetical_return = 0.0
for sector, w_pct in sector_weights.items():
    sector_stocks = df[df["Sector"] == sector]
    if sector_stocks.empty:
        continue
    sector_share = w_pct / 100.0
    shares = [
        (row["Return"], float(st.session_state.get(_stock_slider_key(row["Ticker"]), 0.0)))
        for _, row in sector_stocks.iterrows()
    ]
    total_share = sum(s for _, s in shares)
    if total_share <= 0:
        continue
    for ret, share_pct in shares:
        portfolio_weight = sector_share * (share_pct / total_share)
        hypothetical_return += portfolio_weight * ret

st.sidebar.metric("Slider Sum", f"{slider_total:.2f}%")
st.sidebar.metric(
    "Hypothetical Return",
    f"{hypothetical_return * 100:.2f}%",
    delta=f"{(hypothetical_return - PORTFOLIO_RETURN) * 100:+.2f}% vs actual",
)


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------
tab1, tab2 = st.tabs(["Portfolio Performance", "Options Strategy & Risk Engine"])


# =============================================================================
# TAB 1 — Portfolio Performance
# =============================================================================
with tab1:
    k1, k2, k3 = st.columns(3)
    k1.metric("Total Portfolio Return", f"{PORTFOLIO_RETURN * 100:.2f}%")
    k2.metric(
        "Benchmark Return (CSV)",
        f"{BENCHMARK_RETURN * 100:.2f}%",
        help=f"{BENCHMARK_NAME}: ${BENCHMARK_START:,.2f} → ${BENCHMARK_END:,.2f}",
    )
    k3.metric("Alpha (Active Return)", f"{ALPHA * 100:+.2f}%", delta=f"{ALPHA * 100:+.2f}%")

    # Live MSCI World data (Yahoo Finance via yfinance) — refreshed every 10 min.
    live_msci = fetch_live_msci_world(period_start)
    with st.container(border=True):
        if live_msci is None:
            if not _HAS_YFINANCE:
                st.caption(
                    "Live MSCI World feed unavailable — install `yfinance` (`pip install yfinance`) "
                    "to enable real-time benchmark tracking."
                )
            else:
                st.caption("Live MSCI World feed unavailable right now (Yahoo Finance returned no data).")
        else:
            live_pct = live_msci["percent_return"] * 100
            ts_local = live_msci["last_timestamp"].strftime("%Y-%m-%d %H:%M UTC")
            lm1, lm2, lm3, lm4 = st.columns(4)
            lm1.metric(
                f"Live {live_msci['source_name']} ({live_msci['ticker']})",
                f"${live_msci['last_close']:,.2f}",
                delta=f"{live_pct:+.2f}% since {live_msci['start_date']}",
            )
            lm2.metric(
                "Live Alpha vs Portfolio",
                f"{(PORTFOLIO_RETURN - live_msci['percent_return']) * 100:+.2f}%",
                help="Portfolio return minus live MSCI World return over the same window.",
            )
            lm3.metric(
                "Live vs CSV Benchmark",
                f"{(live_msci['percent_return'] - BENCHMARK_RETURN) * 100:+.2f}%",
                help="Difference between the live benchmark return and the static MSCI value reported in the CSV.",
            )
            lm4.metric("Last quote", ts_local)

    st.divider()

    left, right = st.columns([1, 1.4])
    with left:
        st.subheader("Sector Weights — Live (from sliders)")
        donut_df = pd.DataFrame({"Sector": list(sector_weights.keys()), "Weight": list(sector_weights.values())})
        donut_df = donut_df[donut_df["Weight"] > 0]
        donut = px.pie(
            donut_df, values="Weight", names="Sector", hole=0.55,
            category_orders={"Sector": SECTORS},
            color_discrete_sequence=BRAND_COLORWAY,
        )
        donut.update_traces(textposition="inside", textinfo="percent+label",
                            marker=dict(line=dict(color=PALETTE["APP_BG"], width=2)))
        donut.update_layout(
            template=PLOTLY_TEMPLATE,
            showlegend=True, margin=dict(t=30, b=10, l=10, r=10),
            font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
            paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        )
        st.plotly_chart(donut, use_container_width=True)

    with right:
        st.subheader(f"Contribution Waterfall — Path to {PORTFOLIO_RETURN * 100:.2f}%")
        wf_df = df.sort_values("Contribution", ascending=False).reset_index(drop=True)
        measures = ["relative"] * len(wf_df) + ["total"]
        x_labels = wf_df["Ticker"].tolist() + ["Total"]
        y_values = (wf_df["Contribution"] * 100).tolist() + [PORTFOLIO_RETURN * 100]
        text_values = [f"{v:+.2f}%" for v in (wf_df["Contribution"] * 100)] + [f"{PORTFOLIO_RETURN * 100:.2f}%"]
        waterfall = go.Figure(
            go.Waterfall(
                name="Contribution", orientation="v", measure=measures,
                x=x_labels, y=y_values, text=text_values, textposition="outside",
                connector={"line": {"color": "#c9bfae"}},
                increasing={"marker": {"color": "#1f7a3a"}},
                decreasing={"marker": {"color": BRAND_MAROON}},
                totals={"marker": {"color": BRAND_MAROON_DEEP}},
            )
        )
        waterfall.update_layout(
            yaxis_title="Contribution to Portfolio Return (%)",
            margin=dict(t=30, b=10, l=10, r=10), showlegend=False,
            template=PLOTLY_TEMPLATE,
            font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
            paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
            xaxis=dict(gridcolor=PALETTE["GRID"]),
            yaxis=dict(gridcolor=PALETTE["GRID"], zerolinecolor=PALETTE["ZERO"]),
        )
        st.plotly_chart(waterfall, use_container_width=True)

    st.divider()

    st.subheader(f"Stock Returns vs {BENCHMARK_NAME}")
    bar_df = df[["Ticker", "Return"]].copy()
    bar_df["Return_pct"] = bar_df["Return"] * 100
    bar_df["Above_Benchmark"] = bar_df["Return"] > BENCHMARK_RETURN
    bar_sorted = bar_df.sort_values("Return_pct", ascending=False)
    bar = px.bar(
        bar_sorted, x="Ticker", y="Return_pct",
        color="Above_Benchmark",
        color_discrete_map={True: "#1f7a3a", False: BRAND_MAROON},
        text=bar_sorted["Return_pct"].map(lambda v: f"{v:.2f}%"),
        labels={"Return_pct": "Return (%)", "Above_Benchmark": "Beat Benchmark"},
    )
    bar.add_hline(
        y=BENCHMARK_RETURN * 100, line_dash="dash", line_color=PALETTE["TEXT_MUTED"],
        annotation_text=f"{BENCHMARK_NAME}: {BENCHMARK_RETURN * 100:.2f}%",
        annotation_position="top right",
    )
    bar.update_traces(textposition="outside")
    bar.update_layout(
        margin=dict(t=30, b=10, l=10, r=10), yaxis_title="Return (%)",
        template=PLOTLY_TEMPLATE,
        font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(gridcolor=PALETTE["GRID"]),
        yaxis=dict(gridcolor=PALETTE["GRID"], zerolinecolor=PALETTE["ZERO"]),
    )
    st.plotly_chart(bar, use_container_width=True)

    st.divider()

    st.subheader("Risk — Cross-Sectional Volatility")
    st.caption(
        "Standard deviation of holding-period returns across the stocks "
        "(used here as a simple dispersion proxy for portfolio risk)."
    )
    returns_array = df["Return"].to_numpy()
    risk_std = float(np.std(returns_array, ddof=1)) if len(returns_array) > 1 else 0.0
    risk_mean = float(np.mean(returns_array)) if len(returns_array) else 0.0
    weighted_var = float(np.sum(df["Weight"].to_numpy() * (returns_array - PORTFOLIO_RETURN) ** 2))
    weighted_std = float(np.sqrt(weighted_var))
    r1, r2, r3 = st.columns(3)
    r1.metric("Std Dev of Returns (σ)", f"{risk_std * 100:.2f}%")
    r2.metric("Mean Stock Return", f"{risk_mean * 100:.2f}%")
    r3.metric(
        "Weighted Std Dev", f"{weighted_std * 100:.2f}%",
        help="Square root of weighted squared deviation from portfolio return.",
    )

    st.divider()

    st.subheader("Stock Deep Dive")
    selected_ticker = st.selectbox("Select a ticker", options=df["Ticker"].tolist())
    sel = df.loc[df["Ticker"] == selected_ticker].iloc[0]

    d1, d2, d3, d4 = st.columns(4)
    d1.metric("Holding Return", f"{sel['Return'] * 100:.2f}%")
    d2.metric("Portfolio Weight", f"{sel['Weight'] * 100:.2f}%")
    d3.metric("Contribution", f"{sel['Contribution'] * 100:.2f}%")
    d4.metric("Price Move", f"${sel['Price_Start']:.2f} → ${sel['Price_End']:.2f}")

    info_left, info_right = st.columns([1, 1])
    with info_left:
        st.markdown(f"**Company:** {sel['Company']}")
        st.markdown(f"**Sector:** {sel['Sector']}")
        exch = sel.get("Exchange")
        st.markdown(f"**Exchange:** {exch if pd.notna(exch) else 'N/A'}")
        buy_date = sel.get("Buy_Date")
        if buy_date:
            st.markdown(f"**Buy date:** {buy_date} → {period_end}")
    with info_right:
        yahoo_url = sel.get("Yahoo_URL")
        if pd.notna(yahoo_url) and str(yahoo_url).startswith("http"):
            st.markdown(f"**Yahoo Finance:** [{selected_ticker}]({yahoo_url})")
            st.link_button("Open Yahoo Finance page", yahoo_url)
        else:
            fallback = f"https://finance.yahoo.com/quote/{selected_ticker}"
            st.markdown(f"**Yahoo Finance:** [{selected_ticker}]({fallback})")
            st.link_button("Open Yahoo Finance page", fallback)

    st.divider()

    with st.expander("Show underlying data"):
        display_df = df.copy()
        display_df["Weight"] = (display_df["Weight"] * 100).round(2).astype(str) + "%"
        display_df["Return"] = (display_df["Return"] * 100).round(2).astype(str) + "%"
        display_df["Contribution"] = (display_df["Contribution"] * 100).round(2).astype(str) + "%"
        st.dataframe(display_df, use_container_width=True)


# =============================================================================
# TAB 2 — Options Strategy & Risk Engine
# =============================================================================
with tab2:
    st.header("Options Strategy & Risk Engine")
    st.caption(
        "Black-Scholes pricing, multi-leg payoff and risk visualisation. "
        "All P&L figures are **per share** (multiply by 100 for standard option contracts)."
    )

    # --- Setup row ---
    setup_cols = st.columns([2, 1, 1, 1, 1])

    portfolio_tickers = df["Ticker"].astype(str).tolist()
    ticker_options = ["Custom"] + portfolio_tickers

    if "opt_ticker_select" not in st.session_state:
        st.session_state["opt_ticker_select"] = portfolio_tickers[0] if portfolio_tickers else "Custom"

    def _on_opt_ticker_change() -> None:
        sel = st.session_state["opt_ticker_select"]
        if sel != "Custom" and sel in df["Ticker"].values:
            row = df.loc[df["Ticker"] == sel].iloc[0]
            st.session_state["opt_spot"] = float(round(row["Price_End"], 2))

    if "opt_spot" not in st.session_state:
        sel0 = st.session_state["opt_ticker_select"]
        if sel0 != "Custom" and sel0 in df["Ticker"].values:
            st.session_state["opt_spot"] = float(round(df.loc[df["Ticker"] == sel0, "Price_End"].iloc[0], 2))
        else:
            st.session_state["opt_spot"] = 100.0

    setup_cols[0].selectbox(
        "Ticker (spot pulled from Tab 1 CSV)",
        options=ticker_options,
        key="opt_ticker_select",
        on_change=_on_opt_ticker_change,
    )
    setup_cols[1].number_input(
        "Spot ($)", min_value=0.01, step=1.0, format="%.2f", key="opt_spot",
    )
    sigma_pct = setup_cols[2].number_input(
        "Implied Volatility (%)", min_value=0.1, max_value=300.0, value=25.0, step=1.0, format="%.2f",
        key="opt_sigma_pct",
        help="Annualised IV. CSV has no IV column, so enter manually (e.g. ~20% for MU, ~15% for HON).",
    )
    r_pct = setup_cols[3].number_input(
        "Risk-free (%)", min_value=0.0, max_value=20.0, value=4.0, step=0.25, format="%.2f",
        key="opt_r_pct",
    )
    days = setup_cols[4].number_input(
        "Days to expiry", min_value=1, max_value=730, value=30, step=1, key="opt_days",
    )

    spot = float(st.session_state["opt_spot"])
    sigma = sigma_pct / 100.0
    r = r_pct / 100.0
    T = days / 365.0
    sd_dollar = spot * sigma * math.sqrt(T)

    # --- Strike suggestions ---
    st.subheader("Strike Price Suggestions")
    st.caption(
        f"Spot ${spot:.2f}  ·  IV {sigma_pct:.1f}%  ·  T = {days}d  →  "
        f"1σ price move ≈ **${sd_dollar:.2f}** (= S × σ × √T)."
    )
    suggest_df = pd.DataFrame({
        "Move": ["−2.0σ", "−1.0σ", "−0.5σ", "ATM", "+0.5σ", "+1.0σ", "+2.0σ"],
        "Strike ($)": [
            spot - 2 * sd_dollar, spot - sd_dollar, spot - 0.5 * sd_dollar, spot,
            spot + 0.5 * sd_dollar, spot + sd_dollar, spot + 2 * sd_dollar,
        ],
    })
    suggest_df["Strike ($)"] = suggest_df["Strike ($)"].round(2)
    st.dataframe(suggest_df, hide_index=True, use_container_width=True)

    # --- Strategy preset + leg builder ---
    st.subheader("Multi-Leg Strategy Builder")
    preset_cols = st.columns([3, 1])
    preset = preset_cols[0].selectbox("Preset", PRESETS, key="opt_preset")
    apply_clicked = preset_cols[1].button("Apply preset", use_container_width=True)

    for i in range(4):
        defaults = {
            "enabled": i == 0,
            "action": "Buy",
            "type": "Call",
            "strike": float(round(spot, 2)),
            "qty": 1,
        }
        for k, v in defaults.items():
            sk = f"leg_{i}_{k}"
            if sk not in st.session_state:
                st.session_state[sk] = v

    if apply_clicked and preset != "Custom":
        legs_template = preset_to_legs(preset, spot, sd_dollar)
        if legs_template:
            for i, leg in enumerate(legs_template):
                for k, v in leg.items():
                    st.session_state[f"leg_{i}_{k}"] = v

    leg_header = st.columns([1.4, 1, 1, 1.4, 1])
    leg_header[0].markdown("**Active**")
    leg_header[1].markdown("**Action**")
    leg_header[2].markdown("**Type**")
    leg_header[3].markdown("**Strike ($)**")
    leg_header[4].markdown("**Qty**")

    for i in range(4):
        cols = st.columns([1.4, 1, 1, 1.4, 1])
        cols[0].checkbox(f"Leg {i + 1}", key=f"leg_{i}_enabled")
        cols[1].selectbox("Action", ["Buy", "Sell"], key=f"leg_{i}_action", label_visibility="collapsed")
        cols[2].selectbox("Type", ["Call", "Put"], key=f"leg_{i}_type", label_visibility="collapsed")
        cols[3].number_input(
            "Strike", min_value=0.01, step=0.5, format="%.2f",
            key=f"leg_{i}_strike", label_visibility="collapsed",
        )
        cols[4].number_input(
            "Qty", min_value=1, max_value=100, step=1,
            key=f"leg_{i}_qty", label_visibility="collapsed",
        )

    active_legs: list[dict] = []
    for i in range(4):
        if st.session_state[f"leg_{i}_enabled"]:
            leg = {
                "n": i + 1,
                "action": st.session_state[f"leg_{i}_action"],
                "type": st.session_state[f"leg_{i}_type"],
                "strike": float(st.session_state[f"leg_{i}_strike"]),
                "qty": int(st.session_state[f"leg_{i}_qty"]),
            }
            bs = bs_price_and_greeks(spot, leg["strike"], T, r, sigma, leg["type"])
            leg.update(bs)
            active_legs.append(leg)

    if not active_legs:
        st.warning("Enable at least one leg to compute payoffs and Greeks.")
    else:
        st.subheader("Pricing & Greeks")

        def _signed(l: dict, key: str) -> float:
            sign = 1.0 if l["action"] == "Buy" else -1.0
            return sign * l[key] * l["qty"]

        rows = [
            {
                "Leg": l["n"],
                "Side": f"{l['action']} {l['qty']}× {l['type']}",
                "Strike ($)": round(l["strike"], 2),
                "Premium ($)": round(l["price"], 4),
                "Δ Delta": round(l["delta"], 4),
                "Γ Gamma": round(l["gamma"], 4),
                "Θ Theta /day": round(l["theta"], 4),
                "ν Vega /1%IV": round(l["vega"], 4),
            }
            for l in active_legs
        ]
        totals = {
            "Leg": "Total",
            "Side": "",
            "Strike ($)": "",
            "Premium ($)": round(sum(_signed(l, "price") for l in active_legs), 4),
            "Δ Delta": round(sum(_signed(l, "delta") for l in active_legs), 4),
            "Γ Gamma": round(sum(_signed(l, "gamma") for l in active_legs), 4),
            "Θ Theta /day": round(sum(_signed(l, "theta") for l in active_legs), 4),
            "ν Vega /1%IV": round(sum(_signed(l, "vega") for l in active_legs), 4),
        }
        st.dataframe(pd.DataFrame(rows + [totals]), hide_index=True, use_container_width=True)

        net_premium = sum(_signed(l, "price") for l in active_legs)
        if net_premium > 0:
            st.info(f"**Net Debit:** ${net_premium:.2f} per share — pay this to open the position.")
        elif net_premium < 0:
            st.info(f"**Net Credit:** ${-net_premium:.2f} per share — receive this to open the position.")
        else:
            st.info("**Net Premium:** $0.00 per share.")

        # --- Payoff diagram ---
        st.subheader("Payoff Diagram")
        S_arr = np.linspace(max(spot * 0.5, 0.01), spot * 1.5, 401)
        payoff_expiry = compute_payoff_at_expiry(S_arr, active_legs)
        value_today = compute_value_curve(S_arr, active_legs, T, r, sigma)

        sign_flips = np.where(np.diff(np.sign(payoff_expiry)))[0]
        breakevens: list[float] = []
        for idx in sign_flips:
            x0, x1 = S_arr[idx], S_arr[idx + 1]
            y0, y1 = payoff_expiry[idx], payoff_expiry[idx + 1]
            if y1 != y0:
                breakevens.append(float(x0 - y0 * (x1 - x0) / (y1 - y0)))

        fig_payoff = go.Figure()
        fig_payoff.add_trace(go.Scatter(
            x=S_arr, y=payoff_expiry, mode="lines",
            name="At expiration", line=dict(color=BRAND_MAROON, width=2),
            hovertemplate="S = $%{x:.2f}<br>P&L = $%{y:.2f}<extra>Expiration</extra>",
        ))
        fig_payoff.add_trace(go.Scatter(
            x=S_arr, y=value_today, mode="lines",
            name="Today (mark-to-market)", line=dict(color=BRAND_GOLD, dash="dash"),
            hovertemplate="S = $%{x:.2f}<br>P&L = $%{y:.2f}<extra>Today</extra>",
        ))
        fig_payoff.add_vline(x=spot, line=dict(color=PALETTE["TEXT_MUTED"], dash="dot"),
                             annotation_text=f"Spot ${spot:.2f}", annotation_position="top")
        fig_payoff.add_hline(y=0, line=dict(color="#c9bfae"))
        for be in breakevens:
            fig_payoff.add_vline(x=be, line=dict(color="#1f7a3a", dash="dot"),
                                 annotation_text=f"BE ${be:.2f}", annotation_position="bottom")
        fig_payoff.update_layout(
            xaxis_title="Underlying price",
            yaxis_title="P&L per share ($)",
            hovermode="x unified",
            margin=dict(t=30, b=10, l=10, r=10),
            template=PLOTLY_TEMPLATE,
            font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
            paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
            xaxis=dict(gridcolor=PALETTE["GRID"]),
            yaxis=dict(gridcolor=PALETTE["GRID"], zerolinecolor=PALETTE["ZERO"]),
        )
        st.plotly_chart(fig_payoff, use_container_width=True)

        m1, m2, m3 = st.columns(3)
        m1.metric("Max profit (in shown range, expiry)", f"${float(np.max(payoff_expiry)):.2f}")
        m2.metric("Max loss (in shown range, expiry)", f"${float(np.min(payoff_expiry)):.2f}")
        m3.metric("Break-even(s)", ", ".join(f"${b:.2f}" for b in breakevens) if breakevens else "—")

        # --- Volatility stress test ---
        st.subheader("Volatility Stress Test")
        st.caption(
            "Compares today's mark-to-market curve at the base IV against ±10pp shifts. "
            "Move the slider to overlay any custom IV shift."
        )
        vol_shift = st.slider(
            "IV shift (percentage points)",
            min_value=-50, max_value=50, value=0, step=1,
            key="opt_vol_shift",
        )
        sigma_user = max(0.001, sigma + vol_shift / 100.0)
        sigma_low = max(0.001, sigma - 0.10)
        sigma_high = sigma + 0.10

        fig_vol = go.Figure()
        fig_vol.add_trace(go.Scatter(
            x=S_arr, y=payoff_expiry, mode="lines",
            name="At expiration", line=dict(color=PALETTE["TEXT_MUTED"], dash="dot"),
        ))
        fig_vol.add_trace(go.Scatter(
            x=S_arr, y=value_today, mode="lines",
            name=f"IV {sigma_pct:.1f}% (base)", line=dict(color=BRAND_MAROON, width=2),
        ))
        fig_vol.add_trace(go.Scatter(
            x=S_arr, y=compute_value_curve(S_arr, active_legs, T, r, sigma_high),
            mode="lines", name=f"IV {sigma_high * 100:.1f}% (+10pp)",
            line=dict(color="#1f7a3a"),
        ))
        fig_vol.add_trace(go.Scatter(
            x=S_arr, y=compute_value_curve(S_arr, active_legs, T, r, sigma_low),
            mode="lines", name=f"IV {sigma_low * 100:.1f}% (−10pp)",
            line=dict(color=BRAND_GOLD),
        ))
        if abs(vol_shift) > 0.5 and abs(vol_shift - 10) > 0.5 and abs(vol_shift + 10) > 0.5:
            fig_vol.add_trace(go.Scatter(
                x=S_arr, y=compute_value_curve(S_arr, active_legs, T, r, sigma_user),
                mode="lines", name=f"IV {sigma_user * 100:.1f}% (your shift)",
                line=dict(color=BRAND_MAROON_DEEP, width=3),
            ))
        fig_vol.add_vline(x=spot, line=dict(color=PALETTE["TEXT_MUTED"], dash="dot"))
        fig_vol.add_hline(y=0, line=dict(color="#c9bfae"))
        fig_vol.update_layout(
            xaxis_title="Underlying price",
            yaxis_title="P&L per share ($)",
            hovermode="x unified",
            margin=dict(t=30, b=10, l=10, r=10),
            template=PLOTLY_TEMPLATE,
            font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
            paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
            xaxis=dict(gridcolor=PALETTE["GRID"]),
            yaxis=dict(gridcolor=PALETTE["GRID"], zerolinecolor=PALETTE["ZERO"]),
        )
        st.plotly_chart(fig_vol, use_container_width=True)

        # --- Risk profile heatmap ---
        st.subheader("Risk Profile Heatmap")
        st.caption(
            "Mark-to-market P&L sensitivity across price change (−20% to +20%) and time decay. "
            "Top row = days remaining at entry; bottom row = expiration."
        )
        n_price, n_time = 21, 21
        price_changes = np.linspace(-0.20, 0.20, n_price)
        days_grid = np.linspace(0, days, n_time)
        S_grid = spot * (1 + price_changes)
        pnl_grid = np.zeros((n_time, n_price))
        for ti, d in enumerate(days_grid):
            T_rem = max(d / 365.0, 1e-8)
            pnl_grid[ti, :] = compute_value_curve(S_grid, active_legs, T_rem, r, sigma)

        # Reverse rows so higher days remaining is at top
        pnl_display = pnl_grid[::-1, :]
        days_labels = [f"{int(round(d))}d" for d in days_grid[::-1]]
        price_labels = [f"{p * 100:+.0f}%" for p in price_changes]

        max_abs = float(np.max(np.abs(pnl_display))) or 1.0
        fig_hm = go.Figure(data=go.Heatmap(
            z=pnl_display,
            x=price_labels, y=days_labels,
            colorscale="RdYlGn",
            zmin=-max_abs, zmax=max_abs, zmid=0,
            colorbar=dict(title="P&L $"),
            hovertemplate="Price change %{x}<br>Days remaining %{y}<br>P&L $%{z:.2f}<extra></extra>",
        ))
        fig_hm.update_layout(
            template=PLOTLY_TEMPLATE,
            xaxis_title="Price change",
            yaxis_title="Days remaining",
            margin=dict(t=30, b=10, l=10, r=10),
            font=dict(family="Inter, system-ui, sans-serif", color=PALETTE["TEXT"]),
            paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        )
        st.plotly_chart(fig_hm, use_container_width=True)


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------
render_brand_footer()
