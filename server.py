#!/usr/bin/env python3
"""Stock AI 決策中樞 — iOS Liquid Glass PWA 伺服器與佇列背景守護進程。
同時提供：
1. 靜態 PWA 檔案服務 (index.html, manifest.json, sw.js, stocks_index.json, icons/*)
2. REST API 端點：
   - GET  /api/overview  -> 回傳最新 overview.json 與 queue.json 狀態
   - POST /api/enqueue   -> 排入新股票分析任務並立即觸發背景佇列處理
   - POST /api/sync      -> 強制從 Google Drive 同步最新 overview.json 與 queue.json
3. 內建 Drive Queue Watcher 背景執行緒（每 6 秒自動巡檢雲端與本機 queue.json）
"""
from __future__ import annotations
import json, mimetypes, os, sys, threading, time, traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

WEBAPP_DIR = Path(__file__).resolve().parent
ROOT_DIR = WEBAPP_DIR.parent
ITAMAE_DIR = ROOT_DIR / 'itamae'
sys.path.insert(0, str(ITAMAE_DIR))

from pipeline.kit_paths import apply as _apply_kit
_apply_kit()
from pipeline.util import now_iso, read_json
from pipeline import drive_sync, symbols
import drive_watcher

_watcher_wake = threading.Event()
_sync_lock = threading.Lock()
_last_drive_pull = 0.0


def _background_watcher_loop():
    """背景常駐執行緒：監聽雲端與本機 queue.json 並依 FIFO 執行 run_stock.py。"""
    drive_watcher._log("WebApp 整合型背景佇列監聽器啟動")
    while True:
        try:
            drive_watcher.process_pending_tasks()
        except Exception:
            drive_watcher._log("Watcher loop error: " + traceback.format_exc()[-300:])
        _watcher_wake.wait(timeout=6.0)
        _watcher_wake.clear()


def _get_state(force_drive: bool = False) -> dict:
    global _last_drive_pull
    now = time.time()
    local_ov_path = str(drive_watcher.LOCAL_OV_PATH)
    local_q_path = str(drive_watcher.LOCAL_QUEUE_PATH)

    if force_drive or (now - _last_drive_pull > 15.0):
        with _sync_lock:
            if force_drive or (time.time() - _last_drive_pull > 15.0):
                ov_cloud = drive_sync.fetch_drive_json(drive_sync.OVERVIEW_FILE_ID, None)
                if isinstance(ov_cloud, dict) and 'records' in ov_cloud:
                    from pipeline.util import atomic_write
                    atomic_write(local_ov_path, ov_cloud)
                q_cloud = drive_sync.fetch_drive_json(drive_sync.QUEUE_FILE_ID, None)
                if isinstance(q_cloud, dict) and 'queue' in q_cloud:
                    from pipeline.util import atomic_write
                    atomic_write(local_q_path, q_cloud)
                _last_drive_pull = time.time()

    ov = read_json(local_ov_path, {'updated_at': now_iso(), 'records': []})
    q = read_json(local_q_path, {'updated_at': now_iso(), 'queue': []})
    return {
        'ok': True,
        'overview': ov,
        'queue': (q.get('queue') or [])[-30:],
        'server_time': now_iso(),
    }


class StockPWAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEBAPP_DIR), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, payload: dict, status: int = 200):
        raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send_json({'ok': True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/overview':
            qs = parse_qs(parsed.query)
            force = qs.get('sync', ['0'])[0] == '1'
            self._send_json(_get_state(force_drive=force))
            return
        if parsed.path == '/api/search':
            qs = parse_qs(parsed.query)
            q = (qs.get('q', [''])[0] or '').strip().lower()
            idx = read_json(str(WEBAPP_DIR / 'stocks_index.json'), [])
            if not q:
                self._send_json({'ok': True, 'results': idx[:12]})
                return
            matches = [
                item for item in idx
                if q in str(item.get('code', '')).lower()
                or q in str(item.get('name', '')).lower()
                or q in str(item.get('yf', '')).lower()
            ][:15]
            self._send_json({'ok': True, 'results': matches})
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get('Content-Length', '0') or '0')
        body_raw = self.rfile.read(length).decode('utf-8') if length > 0 else '{}'
        try:
            body = json.loads(body_raw) if body_raw else {}
        except Exception:
            body = {}

        if parsed.path == '/api/enqueue':
            stock_raw = str(body.get('stock') or '').strip()
            force_rebuild = bool(body.get('force_rebuild', False))
            if not stock_raw:
                self._send_json({'ok': False, 'error': '請輸入股票代號或名稱'}, status=400)
                return
            task = drive_sync.enqueue_task(stock_raw, force_rebuild=force_rebuild, source='webapp_api')
            drive_watcher._mark_overview_status(stock_raw, task['id'], 'analyzing', '已排入分析佇列，正在啟動 T-K-Q 模型...')
            _watcher_wake.set()
            self._send_json({'ok': True, 'task': task, 'state': _get_state(force_drive=False)})
            return

        if parsed.path == '/api/sync':
            self._send_json(_get_state(force_drive=True))
            return

        self._send_json({'ok': False, 'error': 'Not found'}, status=404)


def main():
    port = int(os.environ.get('PORT', '8080'))
    t = threading.Thread(target=_background_watcher_loop, daemon=True)
    t.start()
    server = HTTPServer(('0.0.0.0', port), StockPWAHandler)
    print(f"Stock AI Liquid Glass PWA Server listening on http://localhost:{port}", flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
