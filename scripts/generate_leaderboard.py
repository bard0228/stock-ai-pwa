#!/usr/bin/env python3
"""每日盤後 Q 模型（Alpha158 橫斷面）台美股 Top 10 排行榜產生器（0 Token，純本地數值計算）。

用法：
  python scripts/generate_leaderboard.py --market ALL
  python scripts/generate_leaderboard.py --market TW
  python scripts/generate_leaderboard.py --market US
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import math
import sys
import warnings
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "stocks_index.json"
DEFAULT_OUT = ROOT / "leaderboard.json"

# 標準 Alpha158 核心因子與權重（+1 越大越偏多，-1 波動/振幅風險懲罰）
ALPHA158_SPEC = [
    ("ROC20", +0.22),
    ("ROC60", +0.18),
    ("MA20", +0.16),
    ("RSV20", +0.14),
    ("CORR20", +0.10),
    ("VMA20", +0.08),
    ("STD20", -0.07),
    ("KLEN", -0.05),
]

# 常見美股／ETF 中文簡稱補充對照（stocks_index.json 未收錄者）
EXTRA_US_NAMES = {
    "SPY": "標普500 ETF (SPY)",
    "QQQ": "那斯達克100 ETF (QQQ)",
    "SPCX": "SPAC 主題 ETF (SPCX)",
    "ANET": "Arista 網路 (ANET)",
    "APP": "AppLovin (APP)",
    "ALAB": "Astera Labs (ALAB)",
    "CRWV": "CoreWeave (CRWV)",
    "DDOG": "Datadog (DDOG)",
    "DELL": "戴爾 (Dell)",
    "GEV": "GE Vernova (GEV)",
    "CEG": "Constellation 能源",
    "RKLB": "Rocket Lab (RKLB)",
    "NBIS": "Nebius Group (NBIS)",
    "LITE": "Lumentum (LITE)",
    "SNDK": "SanDisk (SNDK)",
    "STX": "希捷 (Seagate)",
    "WDC": "威騰電子 (WDC)",
    "AXON": "Axon (AXON)",
    "BKNG": "Booking (BKNG)",
    "BLK": "貝萊德 (BlackRock)",
    "BX": "黑石 (Blackstone)",
    "COF": "第一資本 (Capital One)",
    "CSX": "CSX 運輸",
    "DASH": "DoorDash (DASH)",
    "DE": "迪爾農機 (Deere)",
    "DXCM": "DexCom (DXCM)",
    "EMR": "艾默生電氣 (EMR)",
    "FAST": "Fastenal (FAST)",
    "FDX": "聯邦快遞 (FedEx)",
    "FTNT": "飛塔資訊 (Fortinet)",
    "GD": "通用動力 (GD)",
    "GE": "奇異航太 (GE)",
    "GILD": "吉利德 (Gilead)",
    "GM": "通用汽車 (GM)",
    "HON": "漢威聯合 (Honeywell)",
    "IDXX": "IDEXX (IDXX)",
    "LMT": "洛克希德馬丁 (LMT)",
    "LOW": "勞氏 (Lowe's)",
    "MAR": "萬豪國際 (Marriott)",
    "MCHP": "微晶片科技 (MCHP)",
    "MELI": "美客多 (MercadoLibre)",
    "MNST": "魔爪飲料 (Monster)",
    "MPWR": "芯源系統 (MPS)",
    "MRNA": "莫德納 (Moderna)",
    "NXPI": "恩智浦 (NXP)",
    "ORLY": "O'Reilly (ORLY)",
    "PAYX": "Paychex (PAYX)",
    "PCAR": "PACCAR (PCAR)",
    "PDD": "拼多多 (PDD)",
    "PM": "菲利普莫里斯 (PM)",
    "PYPL": "PayPal (PYPL)",
    "REGN": "再生元 (REGN)",
    "ROST": "Ross Stores (ROST)",
    "RTX": "雷神技術 (RTX)",
    "SCHW": "嘉信理財 (Schwab)",
    "TER": "泰瑞達 (Teradyne)",
    "TMO": "賽默飛世爾 (TMO)",
    "TMUS": "T-Mobile (TMUS)",
    "TTWO": "Take-Two (TTWO)",
    "UNP": "聯合太平洋 (UNP)",
    "UPS": "優比速 (UPS)",
    "USB": "美國合眾銀行 (USB)",
    "VRTX": "福泰製藥 (Vertex)",
    "WDAY": "Workday (WDAY)",
    "XEL": "Xcel 能源",
}

US_ETFS = {"SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "SOXX", "SMH", "SPCX", "TQQQ", "SQQQ"}


def load_name_map() -> dict[str, str]:
    m: dict[str, str] = {}
    if INDEX_PATH.is_file():
        try:
            arr = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if isinstance(arr, list):
                for item in arr:
                    c = str(item.get("code", "")).strip().upper()
                    n = str(item.get("name", "")).strip()
                    if c and n and c not in m:
                        m[c] = n
        except Exception as e:
            print(f"[WARN] 讀取 stocks_index.json 失敗: {e}", file=sys.stderr)
    for k, v in EXTRA_US_NAMES.items():
        m.setdefault(k, v)
    return m


def load_universe(market: str) -> list[str]:
    fname = SCRIPTS_DIR / ("universe_tw.txt" if market == "TW" else "universe_us.txt")
    if not fname.is_file():
        raise FileNotFoundError(f"找不到選股池清單：{fname}")
    out: list[str] = []
    seen = set()
    for line in fname.read_text(encoding="utf-8").splitlines():
        s = line.split("#")[0].strip().upper()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def get_allowed_max_date(market: str, allow_intraday: bool = False) -> dt.date:
    """依據各市場時區與收盤穩定時刻，排除盤中未完成之 K 線。"""
    if market == "TW":
        now = dt.datetime.now(ZoneInfo("Asia/Taipei"))
        close_ready = dt.time(14, 15)  # 台股 13:30 收盤，預留 45 分鐘報價彙整
    else:
        now = dt.datetime.now(ZoneInfo("America/New_York"))
        close_ready = dt.time(16, 20)  # 美股 16:00 ET 收盤，預留 20 分鐘報價彙整
    if allow_intraday:
        return now.date()
    if now.weekday() < 5 and now.time() < close_ready:
        return now.date() - dt.timedelta(days=1)
    return now.date()


def download_history_batched(symbols: list[str], chunk_size: int = 40) -> dict[str, pd.DataFrame]:
    """分批透過 yfinance 下載日 K（含未還原 Close 與 Adj Close），並具備單檔補抓容錯。"""
    frames: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), chunk_size):
        chunk = symbols[i:i + chunk_size]
        try:
            df = yf.download(
                chunk,
                period="180d",
                interval="1d",
                auto_adjust=False,
                group_by="ticker",
                threads=True,
                progress=False,
            )
            if df is None or df.empty:
                continue
            if len(chunk) == 1:
                sym = chunk[0]
                if not df.empty:
                    frames[sym] = df.copy()
            elif isinstance(df.columns, pd.MultiIndex):
                top_cols = set(df.columns.get_level_values(0))
                for sym in chunk:
                    if sym in top_cols:
                        sub = df[sym].dropna(how="all")
                        if not sub.empty:
                            frames[sym] = sub.copy()
        except Exception as e:
            print(f"[WARN] 批次下載 {chunk[:3]}... 失敗: {e}", file=sys.stderr)
    return frames


def normalize_bar_df(raw_df: pd.DataFrame, max_allowed_date: dt.date) -> pd.DataFrame | None:
    """整理日期與欄位、截斷未收盤盤中 K 線、並用 Adj Close / Close 比例調整歷史價。"""
    if raw_df is None or raw_df.empty:
        return None
    df = raw_df.copy()
    idx = pd.to_datetime(df.index)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    df.index = idx.normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df[df.index.date <= max_allowed_date]

    req = ["Open", "High", "Low", "Close", "Volume"]
    if any(col not in df.columns for col in req):
        return None

    df = df.dropna(subset=["Close", "Volume"]).copy()
    df = df[df["Close"] > 0]
    if len(df) < 65:
        return None

    adj = df["Adj Close"] if "Adj Close" in df.columns else df["Close"]
    adj = adj.where(adj.notna() & (adj > 0), df["Close"])
    ratio = (adj / df["Close"]).replace([np.inf, -np.inf], 1.0).fillna(1.0)

    out = pd.DataFrame(index=df.index)
    out["raw_close"] = df["Close"].astype(float)
    out["close"] = adj.astype(float)
    out["open"] = (df["Open"].astype(float) * ratio).astype(float)
    out["high"] = (df["High"].astype(float) * ratio).astype(float)
    out["low"] = (df["Low"].astype(float) * ratio).astype(float)
    out["volume"] = df["Volume"].astype(float).clip(lower=0.0)
    return out


def compute_single_stock_factors(df: pd.DataFrame) -> dict[str, float] | None:
    """計算單支股票於最後一筆完整交易日的 8 大 Alpha158 原始因子與行情摘要。"""
    if len(df) < 65:
        return None

    c = df["close"]
    raw_c = df["raw_close"]
    o = df["open"]
    h = df["high"]
    l = df["low"]
    v = df["volume"].replace(0, np.nan).ffill().fillna(0.0)

    c_last = float(c.iloc[-1])
    c_prev = float(c.iloc[-2])
    c_20 = float(c.iloc[-21])
    c_60 = float(c.iloc[-61])
    if c_last <= 0 or c_prev <= 0 or c_20 <= 0 or c_60 <= 0:
        return None

    roc20 = c_last / c_20 - 1.0
    roc60 = c_last / c_60 - 1.0
    ma20 = c_last / float(c.tail(20).mean()) - 1.0
    low20 = float(l.tail(20).min())
    high20 = float(h.tail(20).max())
    rsv20 = (c_last - low20) / (high20 - low20 + 1e-9) - 0.5

    rets = c.pct_change().tail(21)
    log_v = np.log(v.tail(21) + 1.0)
    corr_val = rets.corr(log_v)
    corr20 = 0.0 if pd.isna(corr_val) else float(corr_val)

    v_mean20 = float(v.tail(20).mean())
    vma20 = (float(v.iloc[-1]) / (v_mean20 + 1e-9) - 1.0) if v_mean20 > 0 else 0.0

    std20_val = c.pct_change().tail(20).std()
    std20 = 0.0 if pd.isna(std20_val) else float(std20_val)

    o_last = float(o.iloc[-1])
    klen = (float(h.iloc[-1]) - float(l.iloc[-1])) / (o_last + 1e-9) if o_last > 0 else 0.0

    chg_1d_pct = (float(raw_c.iloc[-1]) / float(raw_c.iloc[-2]) - 1.0) * 100.0
    avg_vol_20 = float(df["volume"].tail(20).mean())
    avg_dollar_vol_20 = float((df["raw_close"] * df["volume"]).tail(20).mean())

    vals = {
        "ROC20": roc20,
        "ROC60": roc60,
        "MA20": ma20,
        "RSV20": rsv20,
        "CORR20": corr20,
        "VMA20": vma20,
        "STD20": std20,
        "KLEN": klen,
        "close": float(raw_c.iloc[-1]),
        "chg_1d_pct": chg_1d_pct,
        "roc20_pct": roc20 * 100.0,
        "roc60_pct": roc60 * 100.0,
        "avg_vol_20": avg_vol_20,
        "avg_dollar_vol_20": avg_dollar_vol_20,
    }
    for k, val in vals.items():
        if not math.isfinite(val):
            return None
    return vals


def is_etf_symbol(code: str, market: str, yf_sym: str) -> bool:
    if market == "TW":
        return code.startswith("00")
    return code in US_ETFS or yf_sym in US_ETFS


def resolve_us_name(yf_sym: str, name_map: dict[str, str]) -> str:
    if yf_sym in name_map:
        return name_map[yf_sym]
    try:
        info = yf.Ticker(yf_sym).info
        short = str(info.get("shortName") or info.get("longName") or "").strip()
        if short:
            # 清理常見冗長尾綴
            for suffix in (", Inc.", " Inc.", ", Corp.", " Corp.", " Corporation", " Limited", " Ltd."):
                if short.endswith(suffix):
                    short = short[:-len(suffix)].strip()
            return f"{short} ({yf_sym})" if yf_sym not in short else short
    except Exception:
        pass
    return yf_sym


def build_market_board(
    market: str,
    name_map: dict[str, str],
    allow_intraday: bool = False,
) -> dict | None:
    symbols = load_universe(market)
    max_allowed = get_allowed_max_date(market, allow_intraday=allow_intraday)
    print(f"[{market}] 開始抓取 {len(symbols)} 檔選股池（收盤截止基準 <= {max_allowed}）...", flush=True)

    raw_frames = download_history_batched(symbols, chunk_size=40)
    cleaned: dict[str, pd.DataFrame] = {}
    last_dates: list[dt.date] = []

    for sym in symbols:
        df = normalize_bar_df(raw_frames.get(sym), max_allowed)
        if df is not None:
            cleaned[sym] = df
            last_dates.append(df.index[-1].date())

    if len(last_dates) < 20:
        print(f"[WARN] [{market}] 有效下載家數過少（{len(last_dates)}），跳過更新並保留舊榜單。", file=sys.stderr)
        return None

    # 決定市場共識最新交易日（過半或最高出現之日期中最新且達標者）
    date_counts = pd.Series(last_dates).value_counts()
    majority_dates = [d for d, cnt in date_counts.items() if cnt >= max(20, int(len(last_dates) * 0.4))]
    market_trade_date = max(majority_dates) if majority_dates else date_counts.index[0]

    # 篩選出符合收盤日＋流動性底線的合格標的（包含 ETF）
    candidates = []
    for sym, df in cleaned.items():
        if df.index[-1].date() != market_trade_date:
            continue
        metrics = compute_single_stock_factors(df)
        if metrics is None:
            continue

        # 流動性門檻過濾
        if market == "TW":
            # 台股近 20 日均量 >= 1,000 張 (1,000,000 股)
            if metrics["avg_vol_20"] < 1_000_000:
                continue
        else:
            # 美股近 20 日均成交金額 >= 5,000 萬美元
            if metrics["avg_dollar_vol_20"] < 50_000_000:
                continue

        candidates.append({"yf": sym, "metrics": metrics})

    n_elig = len(candidates)
    print(f"[{market}] 市場收盤日：{market_trade_date}，合格標的：{n_elig}/{len(symbols)} 檔", flush=True)
    if n_elig < 20:
        print(f"[WARN] [{market}] 合格家數不足 20 檔，保留舊榜單避免失真。", file=sys.stderr)
        return None

    # 橫斷面 Z-Score 標準化並依 Alpha158 加權計算綜合分數
    factor_df = pd.DataFrame(
        [{k: c["metrics"][k] for k, _ in ALPHA158_SPEC} for c in candidates]
    )
    alpha_scores = np.zeros(n_elig, dtype=float)
    for fname, weight in ALPHA158_SPEC:
        col = factor_df[fname].astype(float)
        mean = float(col.mean())
        std = float(col.std(ddof=0))
        if std > 1e-12:
            z = np.clip((col.values - mean) / std, -3.0, 3.0)
        else:
            z = np.zeros(n_elig, dtype=float)
        alpha_scores += weight * z

    for i, c in enumerate(candidates):
        c["alpha_score"] = float(alpha_scores[i])

    # 依 alpha_score 降冪、ROC20 降冪排序
    candidates.sort(key=lambda x: (x["alpha_score"], x["metrics"]["ROC20"]), reverse=True)

    top10_rows = []
    for idx, c in enumerate(candidates[:10]):
        rank = idx + 1
        yf_sym = c["yf"]
        bare_code = yf_sym.split(".")[0].upper() if market == "TW" else yf_sym
        if market == "TW":
            name = name_map.get(bare_code, bare_code)
        else:
            name = resolve_us_name(yf_sym, name_map)

        percentile = round(100.0 * (n_elig - rank) / (n_elig - 1), 1) if n_elig > 1 else 100.0
        m = c["metrics"]
        top10_rows.append({
            "rank": rank,
            "code": bare_code,
            "yf": yf_sym,
            "name": name,
            "close": round(m["close"], 2),
            "chg_1d_pct": round(m["chg_1d_pct"], 2),
            "percentile": percentile,
            "alpha_score": round(c["alpha_score"], 4),
            "roc20_pct": round(m["roc20_pct"], 2),
            "roc60_pct": round(m["roc60_pct"], 2),
            "is_etf": is_etf_symbol(bare_code, market, yf_sym),
        })

    now_iso = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    return {
        "trade_date": str(market_trade_date),
        "universe_total": len(symbols),
        "eligible_count": n_elig,
        "updated_at": now_iso,
        "top10": top10_rows,
    }


def main():
    parser = argparse.ArgumentParser(description="生成台美股 Q 模型橫斷面 Top 10 排行榜 JSON")
    parser.add_argument("--market", choices=["TW", "US", "ALL"], default="ALL", help="指定更新市場")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="輸出 JSON 路徑")
    parser.add_argument("--allow-intraday", action="store_true", help="測試模式：允許納入尚未收盤之當日 K 線")
    args = parser.parse_args()

    existing = {"updated_at": "", "markets": {}}
    if args.out.is_file():
        try:
            loaded = json.loads(args.out.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("markets"), dict):
                existing = loaded
        except Exception as e:
            print(f"[WARN] 無法讀取既有 {args.out}: {e}", file=sys.stderr)

    name_map = load_name_map()
    targets = ["TW", "US"] if args.market == "ALL" else [args.market]
    updated_any = False

    for mk in targets:
        board = build_market_board(mk, name_map, allow_intraday=args.allow_intraday)
        if board is not None:
            existing["markets"][mk] = board
            updated_any = True

    if not updated_any and not existing["markets"]:
        print("[ERROR] 無任何市場成功產生榜單。", file=sys.stderr)
        sys.exit(1)

    existing["updated_at"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✅ 已寫入 {args.out}（現有市場：{list(existing['markets'].keys())}）", flush=True)


if __name__ == "__main__":
    main()
