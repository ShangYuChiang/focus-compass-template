import { describe, expect, it } from "vitest";
import { MAX_BACKUPS, backupFileName, buildBackupRecord, formatBytes, needsCleanup, preRestoreBackupFileName } from "./backup";
import type { AppState, BackupRecord } from "./types";

function state(taskCount: number, sessionCount: number): AppState {
  return {
    version: 5, projects: [],
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `t${index}`, axisId: "career", projectId: "p", title: "t", definition: "d",
      priority: "medium", status: "pending", tags: [], createdAt: "2026-08-01T00:00:00.000Z",
      actualSeconds: 0, sessions: 0,
    })) as AppState["tasks"],
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      id: `s${index}`, taskId: "t0", axisId: "career", startedAt: "2026-08-01T10:00:00.000Z",
      focusedSeconds: 1500, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [],
    })) as AppState["sessions"],
    checkins: [], reviews: [], weeklyReviews: [], monthlyReviews: [], backups: [],
    timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    customPauseReasons: [], theme: "system", soundEnabled: true,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function record(id: string): BackupRecord {
  return { id, createdAt: "2026-08-16T00:00:00.000Z", fileName: `${id}.json`, byteSize: 100, taskCount: 1, sessionCount: 1 };
}

describe("backupFileName", () => {
  it("月、日、時、分都補零", () => {
    expect(backupFileName(new Date(2026, 0, 5, 9, 7))).toBe("focus-compass-backup-20260105-0907.json");
  });

  it("檔名可依時間排序", () => {
    const earlier = backupFileName(new Date(2026, 7, 16, 9, 0));
    const later = backupFileName(new Date(2026, 7, 16, 14, 0));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("還原前安全備份使用不同前綴", () => {
    expect(preRestoreBackupFileName(new Date(2026, 7, 18, 9, 7))).toBe("focus-compass-pre-restore-20260818-0907.json");
  });
});

describe("buildBackupRecord", () => {
  it("記錄任務與紀錄筆數", () => {
    const built = buildBackupRecord(state(3, 7), "a.json", 2048, new Date(2026, 7, 16, 10, 0));
    expect(built.taskCount).toBe(3);
    expect(built.sessionCount).toBe(7);
    expect(built.byteSize).toBe(2048);
    expect(built.fileName).toBe("a.json");
  });
});

describe("needsCleanup", () => {
  const records = (count: number) => Array.from({ length: count }, (_, index) => record(`b${index}`));

  it("剛好 12 份不提示", () => expect(needsCleanup(records(MAX_BACKUPS))).toBe(false));
  it("超過 12 份才提示", () => expect(needsCleanup(records(MAX_BACKUPS + 1))).toBe(true));
  it("沒有備份時不提示", () => expect(needsCleanup([])).toBe(false));
});

describe("formatBytes", () => {
  it("小於 1 KB 顯示位元組", () => expect(formatBytes(512)).toBe("512 B"));
  it("KB 保留一位小數", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("MB 保留一位小數", () => expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB"));
});
