# SMF Portfolio Dashboard

Streamlit and static dashboard for a Student Managed Fund portfolio. It includes portfolio performance analysis, sector and holding weight controls, upload-to-upload reporting period comparisons, benchmark comparison when supplied, and an options strategy risk engine using Black-Scholes pricing.

## Features

- Upload a portfolio CSV or use the bundled `portfolio.csv` sample.
- Compare an uploaded reporting period against the previously loaded period.
- Calculate holding returns, portfolio contribution, benchmark return, and alpha.
- Adjust sector and within-sector weights interactively.
- View return, contribution, volatility, and stock-level charts.
- Build basic multi-leg options strategies and inspect payoff, Greeks, volatility stress, and risk heatmaps.

## Requirements

- Python 3.11 or newer recommended
- Packages listed in `requirements-streamlit.txt`

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-streamlit.txt
```

If the Windows `python` command opens the Microsoft Store or fails, use the Python launcher or the virtualenv Python directly after creating the environment.

## Run

```powershell
streamlit run streamlit_app.py
```

Then open the local URL printed by Streamlit, usually `http://localhost:8501`.

## CSV Format

The app accepts a CSV with either dated price columns or normalized start/end columns. Example:

```csv
Sector,Ticker,Company,Exchange,Price_24Apr2026,Price_20Oct2025,Yahoo_Finance_URL
Industrials,HON,Honeywell International,NASDAQ / USD,213.17,194.73,https://finance.yahoo.com/quote/HON/history/
Technology,MU,Micron Technology,NASDAQ / USD,496.72,198.47,https://finance.yahoo.com/quote/MU/history/
```

It can also read files with preamble rows before the table header. Sector labels are read directly when supplied. Weights, returns, and contributions are derived when they are not supplied.

## Project Files

- `streamlit_app.py`: Streamlit application for local or Streamlit Cloud use.
- `app.py`: Minimal Vercel ASGI entrypoint that serves the static dashboard.
- `portfolio.csv`: Bundled sample data.
- `requirements-streamlit.txt`: Python dependencies for the Streamlit app.
- `static/`: Vercel-compatible browser dashboard, including the University of Galway SMF logo asset.
- `package.json`: Static build command for Vercel.

## Deployment

### Streamlit Community Cloud

This app is built with Streamlit. The simplest deployment target is Streamlit
Community Cloud:

1. Push this repository to GitHub.
2. In Streamlit Community Cloud, create a new app from the repository.
3. Set the main file path to:

```text
streamlit_app.py
```

No API keys are required for the current version.

### Vercel

The repository includes a static Vercel build in `static/`. This avoids Vercel's
Python runtime because Streamlit apps are not ASGI/WSGI applications.

Use these Vercel settings:

```text
Framework Preset: Other
Build Command: npm run build
Output Directory: dist
```

`vercel.json` already sets those values. The build copies the static browser
dashboard and `portfolio.csv` into `dist/`. If Vercel still detects the project
as Python, `app.py` serves that same static build through a valid ASGI entrypoint.

## License

No license has been selected yet. Add a license before making the repository public if other people should be allowed to reuse or modify the code.
