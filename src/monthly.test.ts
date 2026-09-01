import { describe, expect, it } from "vitest";
import { compareMonths, defaultMonthlyHighlights, monthRangeFor, previousMonthRange, summarizeMonth } from "./monthly";
import type { AppState, FocusSession, Task } from "./types";

function task(id: string, completedAt: string, overrides: Partial<Task> = {}): Task {
  return { id, axisId: "career", projectId: "p", title: id, definition: "done", priority: "medium", status: "completed", tags: [], createdAt: completedAt, completedAt, actualSeconds: 1500, sessions: 1, ...overrides };
}

function session(id: string, startedAt: string, overrides: Partial<FocusSession> = {}): FocusSession {
  return { id, taskId: "t", axisId: "career", startedAt, focusedSeconds: 1500, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [], ...overrides };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 5, projects: [], tasks: [], sessions: [], checkins: [], reviews: [], weeklyReviews: [], monthlyReviews: [], backups: [],
    timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    customPauseReasons: [], theme: "system", soundEnabled: true, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...overrides,
  };
}

const july = { start: "2026-07-01", end: "2026-07-31" };

describe("monthRangeFor", () => {
  it("月底當天回顧本月", () => expect(monthRangeFor("2026-07-31")).toEqual(july));
  it("月中補做上一個完整月份", () => expect(monthRangeFor("2026-08-18")).toEqual(july));
  it("一號仍補做上月", () => expect(monthRangeFor("2026-08-01")).toEqual(july));
  it("跨年正確", () => expect(monthRangeFor("2027-01-15")).toEqual({ start: "2026-12-01", end: "2026-12-31" }));
  it("可取得比較用前一月", () => expect(previousMonthRange(july)).toEqual({ start: "2026-06-01", end: "2026-06-30" }));
});

describe("summarizeMonth", () => {
  it("空月份不產生 NaN", () => {
    const summary = summarizeMonth(state(), july);
    expect(summary.isEmpty).toBe(true);
    expect(summary.overtimeRatio).toBe(0);
    expect(summary.axisShares.every((item) => item.share === 0)).toBe(true);
  });

  it("只計入月份範圍內資料", () => {
    const summary = summarizeMonth(state({
      tasks: [task("july", "2026-07-10T10:00:00"), task("aug", "2026-08-01T10:00:00")],
      sessions: [session("july", "2026-07-12T10:00:00"), session("aug", "2026-08-01T10:00:00")],
    }), july);
    expect(summary.completedCount).toBe(1);
    expect(summary.sessionCount).toBe(1);
  });

  it("計算主軸比例與完成數", () => {
    const summary = summarizeMonth(state({
      tasks: [task("career", "2026-07-10T10:00:00"), task("research", "2026-07-11T10:00:00", { axisId: "research" })],
      sessions: [session("a", "2026-07-10T10:00:00", { focusedSeconds: 1800 }), session("b", "2026-07-11T10:00:00", { axisId: "research", focusedSeconds: 600 })],
    }), july);
    expect(summary.axisShares.find((item) => item.axisId === "career")?.share).toBeCloseTo(0.75);
    expect(summary.axisShares.find((item) => item.axisId === "research")?.completedCount).toBe(1);
  });

  it("計算超時比例與平均精力", () => {
    const summary = summarizeMonth(state({
      sessions: [session("a", "2026-07-10T10:00:00", { overtimeSeconds: 300 }), session("b", "2026-07-11T10:00:00")],
      checkins: [{ date: "2026-07-10", availableMinutes: 60, energy: 2, hardDeadline: false }, { date: "2026-07-11", availableMinutes: 60, energy: 4, hardDeadline: false }],
    }), july);
    expect(summary.overtimeRatio).toBe(0.5);
    expect(summary.totalOvertimeSeconds).toBe(300);
    expect(summary.averageEnergy).toBe(3);
  });

  it("代表成果優先選有證據且最多三個", () => {
    const tasks = [task("a", "2026-07-10T10:00:00"), task("b", "2026-07-11T10:00:00", { evidence: "demo" }), task("c", "2026-07-12T10:00:00"), task("d", "2026-07-13T10:00:00")];
    expect(defaultMonthlyHighlights(summarizeMonth(state({ tasks }), july))).toEqual(["b", "a", "c"]);
  });
});

describe("compareMonths", () => {
  it("回傳完成數、時間與超時比例差", () => {
    const current = state({
      tasks: [task("july-a", "2026-07-10T10:00:00"), task("july-b", "2026-07-11T10:00:00"), task("june", "2026-06-10T10:00:00")],
      sessions: [session("july", "2026-07-10T10:00:00", { focusedSeconds: 1800, overtimeSeconds: 300 }), session("june", "2026-06-10T10:00:00", { focusedSeconds: 600 })],
    });
    const comparison = compareMonths(current, july);
    expect(comparison.completedDelta).toBe(1);
    expect(comparison.focusedSecondsDelta).toBe(1200);
    expect(comparison.overtimeRatioDelta).toBe(1);
  });
});
