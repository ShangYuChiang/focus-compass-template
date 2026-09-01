import type { AppState } from "./types";
import { createInitialState } from "./seed";

const FALLBACK_KEY = "focus-compass-state-v1";
export const STATE_VERSION = 5;
let database: import("@tauri-apps/plugin-sql").default | null = null;

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * 把任何舊版本的狀態補成目前版本。
 * 舊版沒有 weeklyReviews／monthlyReviews／backups 與專案狀態，缺欄位會讓畫面直接壞掉，所以一律補上安全預設值。
 * 既有的 tasks／sessions／reviews／checkins 一筆都不改。
 */
export function migrateState(state: AppState): AppState {
  return {
    ...state,
    version: STATE_VERSION,
    weeklyReviews: state.weeklyReviews ?? [],
    monthlyReviews: state.monthlyReviews ?? [],
    backups: state.backups ?? [],
    projects: (state.projects ?? []).map((project) => ({ ...project, status: project.status ?? "active" })),
    tasks: (state.tasks ?? []).map((task) => ({
      ...task,
      taskKind: task.taskKind ?? "action",
      estimatedMinutes: task.estimatedMinutes ?? (task.taskKind === "group" ? 75 : 25),
    })),
    customPauseReasons: state.customPauseReasons ?? [],
    timer: {
      ...state.timer,
      pausedSeconds: state.timer.pausedSeconds ?? 0,
    },
  };
}

function parseState(payload: string): AppState {
  return migrateState(JSON.parse(payload) as AppState);
}

async function getDatabase() {
  if (!isTauri()) return null;
  if (!database) {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    database = await Database.load("sqlite:focus-compass.db");
  }
  return database;
}

export async function loadState(): Promise<AppState> {
  try {
    const db = await getDatabase();
    if (db) {
      const rows = await db.select<{ payload: string }[]>("SELECT payload FROM app_state WHERE id = 1");
      if (rows.length) return parseState(rows[0].payload);
    }
    const fallback = localStorage.getItem(FALLBACK_KEY);
    if (fallback) return parseState(fallback);
  } catch (error) {
    console.warn("無法載入既有資料，改用初始資料。", error);
  }
  return createInitialState();
}

export function saveEmergencyState(state: AppState) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

export async function saveState(state: AppState): Promise<void> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  const payload = JSON.stringify(next);
  try {
    const db = await getDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        [payload, next.updatedAt],
      );
      return;
    }
  } catch (error) {
    console.warn("SQLite 儲存失敗，改存瀏覽器備援。", error);
  }
  localStorage.setItem(FALLBACK_KEY, payload);
}

/**
 * 還原資料時使用的嚴格寫入：桌面模式若 SQLite 寫入失敗就直接拋錯，
 * 絕不讓畫面看似還原成功、實際卻只寫到瀏覽器備援。
 */
export async function persistRestoredState(state: AppState): Promise<void> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  const payload = JSON.stringify(next);
  const db = await getDatabase();
  if (db) {
    await db.execute(
      "INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1, $2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      [payload, next.updatedAt],
    );
    return;
  }
  localStorage.setItem(FALLBACK_KEY, payload);
}

export function exportState(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `focus-compass-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
