# SMF Portfolio Dashboard

Streamlit dashboard for a Student Managed Fund portfolio. It includes portfolio performance analysis, sector and holding weight controls, benchmark comparison, and an options strategy risk engine using Black-Scholes pricing.

## Features

- Upload a portfolio CSV or use the bundled `portfolio.csv` sample.
- Calculate holding returns, portfolio contribution, benchmark return, and alpha.
- Adjust sector and within-sector weights interactively.
- View return, contribution, volatility, and stock-level charts.
- Build basic multi-leg options strategies and inspect payoff, Greeks, volatility stress, and risk heatmaps.

## Requirements

- Python 3.11 or newer recommended
- Packages listed in `requirements.txt`

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If the Windows `python` command opens the Microsoft Store or fails, use the Python launcher or the virtualenv Python directly after creating the environment.

## Run

```powershell
streamlit run app.py
```

Then open the local URL printed by Streamlit, usually `http://localhost:8501`.

## CSV Format

The app accepts a CSV with either dated price columns or normalized start/end columns. Example:

```csv
Ticker,Company,Exchange,Price_11Mar2026,Price_20Oct2025,Yahoo_Finance_URL
HON,Honeywell International,Nasdaq,239.08,194.73,https://finance.yahoo.com/quote/HON/history/
MSCI World Index,,,4437.08,4322.9,
```

It can also read files with preamble rows before the table header. Sectors, weights, returns, and contributions are derived when they are not supplied.

## Project Files

- `app.py`: Streamlit application.
- `portfolio.csv`: Bundled sample data.
- `requirements.txt`: Python dependencies.

## Deployment

For Streamlit Community Cloud, publish this repository to GitHub and set the app entry point to:

```text
app.py
```

No API keys are required for the current version.

## License

No license has been selected yet. Add a license before making the repository public if other people should be allowed to reuse or modify the code.
