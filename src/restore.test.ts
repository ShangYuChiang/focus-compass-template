import { describe, expect, it } from "vitest";
import { createInitialState } from "./seed";
import { parseBackupPayload, prepareRestoredState } from "./restore";
import { STATE_VERSION } from "./storage";
import type { Task } from "./types";

function sampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-sample",
    axisId: "career",
    projectId: "project-sample",
    title: "完成範例頁面",
    definition: "頁面可以在本機開啟。",
    priority: "medium",
    status: "pending",
    tags: [],
    createdAt: "2026-08-18T00:00:00.000Z",
    actualSeconds: 0,
    sessions: 0,
    ...overrides,
  };
}

describe("parseBackupPayload", () => {
  it("接受目前版本並產生摘要", () => {
    const state = createInitialState();
    const result = parseBackupPayload(JSON.stringify(state), "good.json");
    expect(result.fileName).toBe("good.json");
    expect(result.state.tasks).toHaveLength(0);
    expect(result.byteSize).toBeGreaterThan(0);
  });

  it("舊版備份會經過 migration", () => {
    const state = createInitialState() as unknown as Record<string, unknown>;
    state.version = 1;
    delete state.weeklyReviews;
    delete state.monthlyReviews;
    delete state.backups;
    const result = parseBackupPayload(JSON.stringify(state));
    expect(result.state.version).toBe(STATE_VERSION);
    expect(result.state.weeklyReviews).toEqual([]);
    expect(result.state.monthlyReviews).toEqual([]);
    expect(result.state.backups).toEqual([]);
  });

  it("拒絕無效 JSON", () => expect(() => parseBackupPayload("not json")).toThrow("不是有效的 JSON"));

  it("拒絕未來版本", () => {
    const state = { ...createInitialState(), version: 99 };
    expect(() => parseBackupPayload(JSON.stringify(state))).toThrow("較新的步步版本");
  });

  it("拒絕缺少任務清單的檔案", () => {
    const state = createInitialState() as unknown as Record<string, unknown>;
    delete state.tasks;
    expect(() => parseBackupPayload(JSON.stringify(state))).toThrow("缺少必要資料清單");
  });

  it("拒絕欄位損壞的任務", () => {
    const state = createInitialState();
    const broken = { ...state, tasks: [{ ...sampleTask(), axisId: "invalid" }] };
    expect(() => parseBackupPayload(JSON.stringify(broken))).toThrow("任務資料格式不正確");
  });
});

describe("prepareRestoredState", () => {
  it("不計入備份後到還原前的離線時間", () => {
    const state = createInitialState();
    state.updatedAt = "2026-08-18T10:00:10.000Z";
    state.timer = { taskId: "t-career-1", status: "running", startedAt: Date.parse("2026-08-18T10:00:00.000Z"), accumulatedSeconds: 5, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] };
    const restored = prepareRestoredState(state, new Date("2026-08-20T10:00:00.000Z"));
    expect(restored.timer.status).toBe("paused");
    expect(restored.timer.accumulatedSeconds).toBe(15);
  });

  it("過期的休息狀態會回到 idle", () => {
    const state = createInitialState();
    state.timer = { ...state.timer, status: "break", breakEndsAt: 1 };
    expect(prepareRestoredState(state).timer.status).toBe("idle");
  });

  it("沒有對應計時器的 active 任務會回到待執行", () => {
    const state = createInitialState();
    state.tasks = [sampleTask({ status: "active" })];
    expect(prepareRestoredState(state).tasks[0].status).toBe("pending");
  });
});
