/**
 * Stock AI 決策中樞 — Google Apps Script 雲端橋接器 (Code.gs)
 * -------------------------------------------------------------
 * 綁定您的 Google Drive「千層蛋糕/tasks/」資料夾內檔案：
 * - queue.json    (File ID: 15iZqp24b1BtGcyyxrOEjXyvHEId1sc0d)
 * - overview.json (File ID: 1Lf1iGi_tuxyRpUHNDZsb_FbKLQ1982yf)
 *
 * 部署步驟（僅需 1 分鐘）：
 * 1. 前往 https://script.google.com 建立新專案，貼上本檔案內容。
 * 2. 點擊右上角「部署」->「新增部署作業」-> 類型選擇「網頁應用程式 (Web App)」。
 * 3. 「執行身分」選擇「我 (Me)」，「誰可以存取」選擇「所有人 (Anyone)」。
 * 4. 複製產生的「網頁應用程式網址 (https://script.google.com/macros/s/.../exec)」，
 *    貼入 Stock AI 網頁 App 右上角的「雲端橋接設定」即可從手機隨時隨地派發任務與讀取跨股總覽！
 */

const QUEUE_FILE_ID = '15iZqp24b1BtGcyyxrOEjXyvHEId1sc0d';
const OVERVIEW_FILE_ID = '1Lf1iGi_tuxyRpUHNDZsb_FbKLQ1982yf';

function _readJsonFile(fileId, fallback) {
  try {
    const file = DriveApp.getFileById(fileId);
    const content = file.getBlob().getDataAsString('UTF-8');
    return JSON.parse(content);
  } catch (e) {
    return fallback;
  }
}

function _writeJsonFile(fileId, data) {
  const file = DriveApp.getFileById(fileId);
  file.setContent(JSON.stringify(data, null, 2));
}

function _jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'overview';
  if (action === 'overview') {
    const ov = _readJsonFile(OVERVIEW_FILE_ID, { updated_at: new Date().toISOString(), records: [] });
    const q = _readJsonFile(QUEUE_FILE_ID, { updated_at: new Date().toISOString(), queue: [] });
    return _jsonResponse({
      ok: true,
      overview: ov,
      queue: (q.queue || []).slice(-30)
    });
  }
  if (action === 'enqueue' && e.parameter.stock) {
    return _enqueueTask(e.parameter.stock, e.parameter.force_rebuild === 'true');
  }
  return _jsonResponse({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const stock = String(body.stock || '').trim();
    const forceRebuild = Boolean(body.force_rebuild);
    if (!stock) {
      return _jsonResponse({ ok: false, error: 'Missing stock parameter' });
    }
    return _enqueueTask(stock, forceRebuild);
  } catch (err) {
    return _jsonResponse({ ok: false, error: String(err) });
  }
}

function _enqueueTask(stockRaw, forceRebuild) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const qData = _readJsonFile(QUEUE_FILE_ID, { updated_at: new Date().toISOString(), queue: [] });
    const nowIso = new Date().toISOString();
    const taskId = Math.random().toString(16).substring(2, 10);
    const task = {
      id: taskId,
      stock: stockRaw,
      code: stockRaw.toUpperCase(),
      name: stockRaw,
      force_rebuild: Boolean(forceRebuild),
      source: 'gas_pwa',
      status: 'queued',
      created_at: nowIso
    };
    const list = Array.isArray(qData.queue) ? qData.queue : [];
    list.push(task);
    qData.queue = list.slice(-100);
    qData.updated_at = nowIso;
    _writeJsonFile(QUEUE_FILE_ID, qData);
    return _jsonResponse({ ok: true, task: task });
  } finally {
    lock.releaseLock();
  }
}
