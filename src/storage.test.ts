import { describe, expect, it } from "vitest";
import { STATE_VERSION, migrateState } from "./storage";
import type { AppState } from "./types";

/** v1 的狀態：沒有週／月復盤、備份、專案狀態，timer 也沒有 pausedSeconds。 */
function legacyState() {
  return {
    version: 1,
    projects: [{ id: "p-career", axisId: "career", name: "求職", milestone: "完成 CV" }],
    tasks: [{
      id: "t1", axisId: "career", projectId: "p-career", title: "整理 CV", definition: "三個 bullet",
      priority: "high", status: "completed", tags: [], createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-02T00:00:00.000Z", actualSeconds: 1500, sessions: 1,
    }],
    sessions: [{
      id: "s1", taskId: "t1", axisId: "career", startedAt: "2026-08-02T10:00:00.000Z",
      focusedSeconds: 1500, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [],
    }],
    checkins: [{ date: "2026-08-02", availableMinutes: 90, energy: 4, hardDeadline: false }],
    reviews: [{ date: "2026-08-02", mvpTaskId: "t1", tomorrowAxisId: "research" }],
    timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    theme: "system",
    soundEnabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  } as unknown as AppState;
}

describe("migrateState", () => {
  it("把版本升到目前版本", () => expect(migrateState(legacyState()).version).toBe(STATE_VERSION));

  it("補上缺少的 weeklyReviews、monthlyReviews 與 backups", () => {
    const migrated = migrateState(legacyState());
    expect(migrated.weeklyReviews).toEqual([]);
    expect(migrated.monthlyReviews).toEqual([]);
    expect(migrated.backups).toEqual([]);
  });

  it("補上缺少的 timer.pausedSeconds 與 customPauseReasons", () => {
    const migrated = migrateState(legacyState());
    expect(migrated.timer.pausedSeconds).toBe(0);
    expect(migrated.customPauseReasons).toEqual([]);
    expect(migrated.axisNames).toEqual({});
  });

  it("保留有效的自訂類別名稱並忽略空白內容", () => {
    const current = { ...legacyState(), axisNames: { career: "  產品開發  ", research: "  " } } as AppState;
    expect(migrateState(current).axisNames).toEqual({ career: "產品開發" });
  });

  it("保留既有任務內容，並補上可執行類型與預估時間", () => {
    const legacy = legacyState();
    const migrated = migrateState(legacy);
    expect(migrated.tasks).toEqual(legacy.tasks.map((task) => ({ ...task, taskKind: "action", estimatedMinutes: 25 })));
    expect(migrated.sessions).toEqual(legacy.sessions);
    expect(migrated.reviews).toEqual(legacy.reviews);
    expect(migrated.checkins).toEqual(legacy.checkins);
    expect(migrated.projects).toEqual(legacy.projects.map((project) => ({ ...project, status: "active" })));
  });

  it("已經是新版的資料不會被清掉", () => {
    const current = {
      ...legacyState(),
      weeklyReviews: [{
        weekStart: "2026-08-10", weekEnd: "2026-08-16", highlights: ["t1"], weeklyGoals: {},
        priorityAxisId: "career" as const, taskDecisions: [], createdAt: "2026-08-16T00:00:00.000Z",
      }],
      monthlyReviews: [],
      backups: [{ id: "b1", createdAt: "2026-08-16T00:00:00.000Z", fileName: "a.json", byteSize: 10, taskCount: 1, sessionCount: 1 }],
      backupFolder: "D:\\backups",
      lastPromptedWeek: "2026-08-10",
    } as AppState;
    const migrated = migrateState(current);
    expect(migrated.weeklyReviews).toHaveLength(1);
    expect(migrated.backups).toHaveLength(1);
    expect(migrated.backupFolder).toBe("D:\\backups");
    expect(migrated.lastPromptedWeek).toBe("2026-08-10");
  });
});
