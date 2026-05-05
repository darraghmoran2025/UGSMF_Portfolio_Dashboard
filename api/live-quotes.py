from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart"


def _normalise_symbols(raw_symbols: str) -> list[str]:
    symbols: list[str] = []
    seen: set[str] = set()
    for raw in raw_symbols.split(","):
        symbol = raw.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols[:80]


def _fetch_yahoo_chart_quote(symbol: str) -> tuple[dict | None, str | None]:
    request = Request(
        f"{YAHOO_CHART_URL}/{quote(symbol, safe='.-^')}?range=5d&interval=1d",
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; SMFPortfolioDashboard/1.0)",
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            yahoo_payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return None, f"{symbol}: {exc}"

    result = yahoo_payload.get("chart", {}).get("result", [])
    if not result:
        return None, f"{symbol}: no chart result"

    meta = result[0].get("meta", {})
    live_price = meta.get("regularMarketPrice")
    previous_close = meta.get("chartPreviousClose") or meta.get("previousClose")
    if live_price is None:
        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        closes = [value for value in closes if value is not None]
        if closes:
            live_price = closes[-1]
            if previous_close is None and len(closes) > 1:
                previous_close = closes[-2]
    if live_price is None:
        return None, f"{symbol}: no live price"

    live_price = float(live_price)
    previous_close = float(previous_close) if previous_close else None
    change_pct = (live_price / previous_close - 1.0) * 100 if previous_close and previous_close > 0 else None
    return {
        "symbol": meta.get("symbol") or symbol,
        "shortName": meta.get("shortName") or meta.get("longName") or symbol,
        "longName": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency") or "",
        "fullExchangeName": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "regularMarketPrice": live_price,
        "regularMarketPreviousClose": previous_close,
        "regularMarketChangePercent": change_pct,
        "regularMarketTime": meta.get("regularMarketTime"),
        "marketState": meta.get("marketState") or "",
    }, None


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        symbols = _normalise_symbols(query.get("symbols", [""])[0])
        if not symbols:
            self._send_json(400, {"error": "No symbols supplied."})
            return

        quotes: list[dict] = []
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=min(8, len(symbols))) as executor:
            future_map = {executor.submit(_fetch_yahoo_chart_quote, symbol): symbol for symbol in symbols}
            for future in as_completed(future_map):
                quote_payload, error = future.result()
                if quote_payload is not None:
                    quotes.append(quote_payload)
                if error:
                    errors.append(error)

        quotes.sort(key=lambda quote_payload: symbols.index(str(quote_payload.get("symbol", "")).upper()) if str(quote_payload.get("symbol", "")).upper() in symbols else len(symbols))

        self._send_json(
            200,
            {
                "source": "Yahoo Finance",
                "fetchedAt": int(time.time()),
                "requestedSymbols": symbols,
                "quotes": quotes,
                "errors": errors,
            },
        )

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "private, max-age=30")
        self.end_headers()
        self.wfile.write(body)
