import { freezeTimer } from "./domain";
import { migrateState, persistRestoredState, STATE_VERSION } from "./storage";
import type { AppState, AxisId, TimerState } from "./types";

const AXIS_IDS: AxisId[] = ["career", "research", "teaching", "investing"];
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface RestoreCandidate {
  fileName: string;
  state: AppState;
  byteSize: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAxisId(value: unknown): value is AxisId {
  return typeof value === "string" && AXIS_IDS.includes(value as AxisId);
}

function isTimer(value: unknown): value is TimerState {
  if (!isObject(value)) return false;
  return ["idle", "running", "paused", "break"].includes(String(value.status))
    && (value.taskId === null || typeof value.taskId === "string")
    && (value.startedAt === null || typeof value.startedAt === "number")
    && typeof value.accumulatedSeconds === "number"
    && (value.pauseStartedAt === null || typeof value.pauseStartedAt === "number")
    && (value.breakEndsAt === null || typeof value.breakEndsAt === "number")
    && isStringArray(value.interruptions);
}

function validateCollections(raw: Record<string, unknown>) {
  const requiredArrays = ["projects", "tasks", "sessions", "checkins", "reviews"];
  if (requiredArrays.some((key) => !Array.isArray(raw[key]))) {
    throw new Error("這不是完整的步步備份：缺少必要資料清單。");
  }

  if (!(raw.projects as unknown[]).every((item) => isObject(item)
    && typeof item.id === "string" && isAxisId(item.axisId)
    && typeof item.name === "string" && typeof item.milestone === "string")) {
    throw new Error("備份中的專案資料格式不正確。");
  }

  if (!(raw.tasks as unknown[]).every((item) => isObject(item)
    && typeof item.id === "string" && isAxisId(item.axisId)
    && typeof item.projectId === "string" && typeof item.title === "string"
    && typeof item.definition === "string" && ["high", "medium", "low"].includes(String(item.priority))
    && ["pending", "active", "completed", "cancelled"].includes(String(item.status))
    && isStringArray(item.tags) && typeof item.createdAt === "string"
    && typeof item.actualSeconds === "number" && typeof item.sessions === "number")) {
    throw new Error("備份中的任務資料格式不正確。");
  }

  if (!(raw.sessions as unknown[]).every((item) => isObject(item)
    && typeof item.id === "string" && typeof item.taskId === "string" && isAxisId(item.axisId)
    && typeof item.startedAt === "string" && typeof item.focusedSeconds === "number"
    && typeof item.pausedSeconds === "number" && typeof item.overtimeSeconds === "number"
    && typeof item.completed === "boolean" && isStringArray(item.interruptions))) {
    throw new Error("備份中的專注紀錄格式不正確。");
  }

  if (!isTimer(raw.timer)) throw new Error("備份中的計時狀態格式不正確。");
}

export function parseBackupPayload(payload: string, fileName = "backup.json"): RestoreCandidate {
  const byteSize = new TextEncoder().encode(payload).byteLength;
  if (byteSize > MAX_BACKUP_BYTES) throw new Error("備份檔超過 20 MB，為了安全不予載入。");

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error("選取的檔案不是有效的 JSON。");
  }
  if (!isObject(raw)) throw new Error("備份檔的最外層格式不正確。");
  if (!Number.isInteger(raw.version) || Number(raw.version) < 1) throw new Error("備份檔缺少有效的版本資訊。");
  if (Number(raw.version) > STATE_VERSION) throw new Error("這份備份來自較新的步步版本，請先更新程式再還原。");
  validateCollections(raw);

  const state = migrateState(raw as unknown as AppState);
  if (!Array.isArray(state.weeklyReviews) || !Array.isArray(state.monthlyReviews) || !Array.isArray(state.backups)) {
    throw new Error("備份的復盤或備份紀錄格式不正確。");
  }
  return { fileName, state, byteSize };
}

export function prepareRestoredState(state: AppState, restoredAt = new Date()): AppState {
  const now = restoredAt.getTime();
  let timer = state.timer;
  if (timer.status === "running") {
    const savedAt = Date.parse(state.updatedAt);
    timer = freezeTimer(timer, Number.isFinite(savedAt) ? Math.min(now, savedAt) : now);
  }
  if (timer.status === "paused") timer = { ...timer, pauseStartedAt: now };
  if (timer.status === "break") {
    timer = { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] };
  }

  const activeId = timer.status === "paused" ? timer.taskId : null;
  return {
    ...state,
    tasks: state.tasks.map((task) => task.status === "active" && task.id !== activeId ? { ...task, status: "pending" } : task),
    timer,
    updatedAt: restoredAt.toISOString(),
  };
}

function selectBrowserFile(): Promise<{ fileName: string; payload: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.append(input);
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          return resolve(null);
        }
        if (file.size > MAX_BACKUP_BYTES) {
          input.remove();
          return reject(new Error("備份檔超過 20 MB，為了安全不予載入。"));
        }
        resolve({ fileName: file.name, payload: await file.text() });
        input.remove();
      } catch (error) {
        input.remove();
        reject(error);
      }
    };
    input.click();
  });
}

export async function chooseRestoreCandidate(): Promise<RestoreCandidate | null> {
  if (!("__TAURI_INTERNALS__" in window)) {
    const selected = await selectBrowserFile();
    return selected ? parseBackupPayload(selected.payload, selected.fileName) : null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    directory: false,
    multiple: false,
    title: "選擇步步 JSON 備份",
    filters: [{ name: "步步備份", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<string>("read_backup", { path });
  const fileName = path.split(/[\\/]/).pop() ?? "backup.json";
  return parseBackupPayload(payload, fileName);
}

export async function commitRestoredState(state: AppState) {
  await persistRestoredState(state);
}
