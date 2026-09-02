# 步步 Template V0.1｜個人工作推進與復盤系統

「步步 Template」是一套免費、開源、離線優先的 Windows 桌面工作系統。它把長期目標拆成今天能開始的一小步，結合番茄鐘、每日與週月復盤、收工卡及資料匯出。

這個公開模板以**完全空白的資料庫**開始：不預載作者的任務、專案、專注紀錄或復盤內容。你可以直接建立自己的第一個專案，也可以修改四個預設主軸。

## 下載 V0.1

請從 [V0.1 發布頁](https://github.com/ShangYuChiang/focus-compass-template/releases/tag/v0.1) 下載 Windows x64 安裝包，或下載免安裝 EXE。兩者皆需要 WebView2。

- 對外版本固定為 **V0.1**；npm、Cargo、Tauri 與 Windows 安裝包使用對應的三段版本碼 `0.1.0`。
- 目前只維護 `v0.1` 發布入口；同版修訂以 Release 說明中的 Git commit 與檔案 SHA-256 辨識，不自動遞增版號。
- 此版不含寵物功能，保留空白初始資料與可自行修改的專案類別名稱。
- 應用程式版本與資料格式版本各自獨立；統一版號不會清空既有資料，也不會改變資料儲存位置。

## 主要功能

- 四主軸專案管理、個別甘特圖與進度追蹤；類別名稱可在設定中自行修改
- 任務智慧拆解：將較大成果拆成三個可編輯的小任務
- 25 分鐘番茄鐘、暫停原因、正向超時與柔和提示音
- 任務完成定義、實際耗時、狀態修正與歷史紀錄
- 每日收工卡、感謝日記、每週復盤與每月復盤
- CSV、JSON、Markdown 匯出，方便備份與後續視覺化
- 本機 SQLite 儲存、JSON 備份與還原
- 亮色／暗色外觀與桌面通知

> 「智慧拆解」目前採用本機規則，不會把任務傳送給外部 AI API，也不需要 API 金鑰。

## 技術架構

- React 19 + TypeScript + Vite
- Tauri 2 + Rust
- SQLite（桌面版）／localStorage（瀏覽器開發模式）
- Vitest

## 快速開始

需要 Node.js 20 以上版本。

```powershell
npm ci
npm run dev
```

執行完整前端檢查：

```powershell
npm test
npm run build
```

## 建置 Windows 桌面版

請先安裝 Rust stable-msvc、Microsoft C++ Build Tools 與 WebView2，再執行：

```powershell
npm run tauri dev
npm run tauri build
```

也可以執行 `./build-release.ps1`，依序完成環境檢查、前端建置、測試與 Tauri 打包。

## 建立自己的版本

常用自訂位置：

- `src/seed.ts`：四個主軸的名稱、說明與色彩
- `assets/` 與 `src-tauri/icons/`：品牌圖示與應用程式圖示
- `src-tauri/tauri.conf.json`：程式名稱、視窗標題與應用程式識別碼

若要公開修改後的版本，請先替換應用程式識別碼與品牌資產，並確認倉庫內沒有個人匯出資料、SQLite 檔案、備份檔或 `.env`。這些常見檔案已列入 `.gitignore`。

一般使用者不必修改程式碼：開啟「設定 → 專案類別名稱」即可重新命名四個類別，既有任務、專案與統計會保持原本關聯。

## 資料與隱私

- 正式桌面版把資料保存在使用者自己的電腦，不需登入。
- 瀏覽器開發模式的 localStorage 與桌面 SQLite 不共用。
- 倉庫不包含任何預設使用者任務或使用紀錄。
- 建議定期匯出 JSON 備份；欄位設計請參考 [收工卡資料格式與視覺化](docs/收工卡資料格式與視覺化.md)。

## 參與開發

歡迎提出 Issue 或 Pull Request。開始前請閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

本專案採用 [MIT License](LICENSE)，可自由使用、修改與散布；保留授權聲明即可。
