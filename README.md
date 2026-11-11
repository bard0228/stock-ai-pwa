# 為你股掌 · iOS Liquid Glass PWA 股票決策中樞

> **為你股掌** 是結合 TradingAgents 多角色深度多空辯論（T 模型）、Kronos 時序深度學習預測（K 模型）與 Qlib Alpha158 量化因子排名（Q 模型）的現代化股票決策 App。

## 🌟 核心特色
- **iOS 淺色液態玻璃質感**：低飽和度高階色彩、通透毛玻璃卡片（14px 圓角）、懸浮流暢動畫。
- **現代字體排版**：英數採用 **Plus Jakarta Sans**，中文採用 **Noto Sans TC**，全數值搭配 `.num-col { font-variant-numeric: tabular-nums; }` 縱向切齊千分位與小數點。
- **PWA 原生安裝**：支援 Android Chrome（Google Pixel 10 Pro 等裝置）與 iOS Safari 一鍵「安裝至主畫面」。
- **跨股總覽與去重統計**：自動去重統計已分析股數，單一標的多日分析僅計最新一次評級。
- **手風琴流暢開合**：點擊卡片即可查看三模型立場、目標價、防守停損價、轉強確認價與 Google Drive PDF 報告。

## 📱 安裝至 Android 主畫面步驟（Google Pixel 10 Pro）
1. 使用手機 **Chrome 瀏覽器** 開啟本網頁：[https://bard0228.github.io/stock-ai-pwa/](https://bard0228.github.io/stock-ai-pwa/)
2. 點擊頂部「**安裝 App**」按鈕，或點擊 Chrome 右上角選單（三個點）選擇「**加到主畫面**」或「**安裝應用程式**」。
3. 即可在手機桌面直接以獨立 App 視窗開啟使用！

## ☁️ 雲端雙向橋接（選填）
若需隨時隨地從外部手機 App 直接派發新標的分析至 Google Drive：
1. 前往 [script.google.com](https://script.google.com) 貼上專案中的 `gas/Code.gs` 代碼。
2. 部署為網頁應用程式（權限設為所有人）。
3. 複製得到的 URL，貼入 App 右上角齒輪 ⚙️ 的「雲端橋接設定」中即可連線。
