import type { AppState, BackupRecord } from "./types";

/** 規劃書要求保留最近 12 份每週備份，超過時提示清理。 */
export const MAX_BACKUPS = 12;

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** 純 ASCII 且可依檔名排序，避免不同系統的中文檔名編碼問題。 */
export function backupFileName(date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `focus-compass-backup-${stamp}.json`;
}

export function preRestoreBackupFileName(date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `focus-compass-pre-restore-${stamp}.json`;
}

export function buildBackupRecord(state: AppState, fileName: string, byteSize: number, createdAt = new Date()): BackupRecord {
  return {
    id: `${fileName}-${createdAt.getTime()}`,
    createdAt: createdAt.toISOString(),
    fileName,
    byteSize,
    taskCount: state.tasks.length,
    sessionCount: state.sessions.length,
  };
}

/** 超過保留份數就該提示清理，不自動刪檔 —— 刪除使用者的備份是不可逆的。 */
export function needsCleanup(records: BackupRecord[]) {
  return records.length > MAX_BACKUPS;
}

export function formatBytes(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

export interface BackupResult {
  record: BackupRecord;
  /** 實際寫入的資料夾；瀏覽器模式為 null（走瀏覽器下載） */
  folder: string | null;
}

export async function defaultBackupFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("default_backup_folder");
}

/** 開啟原生資料夾選取；取消時回傳 null。 */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "選擇備份資料夾" });
  return typeof selected === "string" ? selected : null;
}

function downloadInBrowser(fileName: string, payload: string) {
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return blob.size;
}

/**
 * 立即備份。桌面模式寫入檔案，瀏覽器開發模式退回下載。
 * 寫檔失敗會往外拋，由呼叫端顯示錯誤與嘗試過的路徑。
 */
async function writeBackup(state: AppState, fileName: string): Promise<BackupResult> {
  const payload = JSON.stringify(state, null, 2);

  if (!isTauri()) {
    const byteSize = downloadInBrowser(fileName, payload);
    return { record: buildBackupRecord(state, fileName, byteSize), folder: null };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const byteSize = await invoke<number>("write_backup", {
    folder: state.backupFolder ?? null,
    fileName,
    contents: payload,
  });
  const folder = state.backupFolder ?? (await defaultBackupFolder());
  return { record: buildBackupRecord(state, fileName, byteSize), folder };
}

export async function runBackup(state: AppState): Promise<BackupResult> {
  return writeBackup(state, backupFileName());
}

/** 還原是覆蓋操作；執行前強制建立一份可回復的安全備份。 */
export async function runPreRestoreBackup(state: AppState): Promise<BackupResult> {
  return writeBackup(state, preRestoreBackupFileName());
}
