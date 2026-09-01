import { describe, expect, it } from "vitest";
import { analyzeWeek, defaultHighlights, pendingDecisionTasks, summarizeWeek, weekRangeFor } from "./weekly";
import type { AppState, AxisId, DailyCheckin, FocusSession, Task } from "./types";

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    axisId: "career", projectId: "p-career", title: overrides.id, definition: "完成定義",
    priority: "medium", status: "pending", tags: [], createdAt: "2026-08-01T00:00:00.000Z",
    actualSeconds: 0, sessions: 0, ...overrides,
  };
}

function session(overrides: Partial<FocusSession> & { id: string; startedAt: string }): FocusSession {
  return {
    taskId: "t1", axisId: "career", focusedSeconds: 1500, pausedSeconds: 0,
    overtimeSeconds: 0, completed: true, interruptions: [], ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 5, projects: [], tasks: [], sessions: [], checkins: [], reviews: [],
    weeklyReviews: [], monthlyReviews: [], backups: [],
    timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    customPauseReasons: [], theme: "system", soundEnabled: true,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides,
  };
}

/** 2026-08-10 是星期一，2026-08-16 是星期日。 */
const week = { start: "2026-08-10", end: "2026-08-16" };

describe("weekRangeFor", () => {
  it("星期日當天的目標是本週", () => expect(weekRangeFor("2026-08-16")).toEqual(week));
  it("星期一的目標是上一週", () => expect(weekRangeFor("2026-08-17")).toEqual(week));
  it("星期六的目標是上一週", () => expect(weekRangeFor("2026-08-22")).toEqual(week));
  it("星期二補做時仍指向同一週", () => expect(weekRangeFor("2026-08-18")).toEqual(week));
  it("跨月的週界線正確", () => expect(weekRangeFor("2026-08-02")).toEqual({ start: "2026-07-27", end: "2026-08-02" }));
  it("跨年的週界線正確", () => expect(weekRangeFor("2027-01-01")).toEqual({ start: "2026-12-21", end: "2026-12-27" }));
});

describe("summarizeWeek", () => {
  it("空的一週不會產生 NaN", () => {
    const summary = summarizeWeek(state(), week);
    expect(summary.isEmpty).toBe(true);
    expect(summary.focusedSeconds).toBe(0);
    expect(summary.overtimeRatio).toBe(0);
    expect(summary.averageSessionSeconds).toBe(0);
    expect(summary.axisShares.every((share) => share.share === 0)).toBe(true);
  });

  it("只計入週內的紀錄", () => {
    const current = state({
      sessions: [
        session({ id: "s-in", startedAt: "2026-08-12T10:00:00" }),
        session({ id: "s-before", startedAt: "2026-08-09T10:00:00" }),
        session({ id: "s-after", startedAt: "2026-08-17T10:00:00" }),
      ],
    });
    const summary = summarizeWeek(current, week);
    expect(summary.sessionCount).toBe(1);
    expect(summary.focusedSeconds).toBe(1500);
  });

  it("計算四主軸投入比例", () => {
    const current = state({
      sessions: [
        session({ id: "s1", startedAt: "2026-08-12T10:00:00", axisId: "career", focusedSeconds: 1800 }),
        session({ id: "s2", startedAt: "2026-08-13T10:00:00", axisId: "research", focusedSeconds: 600 }),
      ],
    });
    const shares = summarizeWeek(current, week).axisShares;
    expect(shares.find((item) => item.axisId === "career")?.share).toBeCloseTo(0.75);
    expect(shares.find((item) => item.axisId === "research")?.share).toBeCloseTo(0.25);
    expect(shares.find((item) => item.axisId === "teaching")?.share).toBe(0);
  });

  it("統計超時場次與總超時時間", () => {
    const current = state({
      sessions: [
        session({ id: "s1", startedAt: "2026-08-12T10:00:00", focusedSeconds: 1800, overtimeSeconds: 300 }),
        session({ id: "s2", startedAt: "2026-08-13T10:00:00", focusedSeconds: 1500 }),
        session({ id: "s3", startedAt: "2026-08-14T10:00:00", focusedSeconds: 2100, overtimeSeconds: 600 }),
      ],
    });
    const summary = summarizeWeek(current, week);
    expect(summary.overtimeSessionCount).toBe(2);
    expect(summary.overtimeRatio).toBeCloseTo(2 / 3);
    expect(summary.totalOvertimeSeconds).toBe(900);
    expect(summary.averageSessionSeconds).toBe(1800);
  });

  it("完成任務依投入時間排序，且只算週內完成的", () => {
    const current = state({
      tasks: [
        task({ id: "big", status: "completed", completedAt: "2026-08-12T10:00:00", actualSeconds: 3000 }),
        task({ id: "small", status: "completed", completedAt: "2026-08-13T10:00:00", actualSeconds: 900 }),
        task({ id: "mid", status: "completed", completedAt: "2026-08-14T10:00:00", actualSeconds: 1500 }),
        task({ id: "lastweek", status: "completed", completedAt: "2026-08-03T10:00:00", actualSeconds: 9000 }),
        task({ id: "pending" }),
      ],
    });
    const summary = summarizeWeek(current, week);
    expect(summary.completedCount).toBe(3);
    expect(summary.completedTasks.map((item) => item.id)).toEqual(["big", "mid", "small"]);
    expect(defaultHighlights(summary)).toEqual(["big", "mid", "small"]);
  });

  it("重要成果最多三個", () => {
    const tasks = ["a", "b", "c", "d"].map((id, index) => task({
      id, status: "completed", completedAt: "2026-08-12T10:00:00", actualSeconds: 4000 - index * 100,
    }));
    expect(defaultHighlights(summarizeWeek(state({ tasks }), week))).toHaveLength(3);
  });
});

describe("analyzeWeek", () => {
  it("最常超時的任務依超時秒數排序，取前三", () => {
    const tasks = ["t1", "t2", "t3", "t4"].map((id) => task({ id, title: id }));
    const current = state({
      tasks,
      sessions: [
        session({ id: "s1", startedAt: "2026-08-10T10:00:00", taskId: "t1", overtimeSeconds: 100 }),
        session({ id: "s2", startedAt: "2026-08-11T10:00:00", taskId: "t2", overtimeSeconds: 500 }),
        session({ id: "s3", startedAt: "2026-08-12T10:00:00", taskId: "t3", overtimeSeconds: 300 }),
        session({ id: "s4", startedAt: "2026-08-13T10:00:00", taskId: "t4", overtimeSeconds: 50 }),
        session({ id: "s5", startedAt: "2026-08-14T10:00:00", taskId: "t1", overtimeSeconds: 400 }),
      ],
    });
    const analysis = analyzeWeek(current, week, "2026-08-16");
    expect(analysis.overtimeTasks.map((item) => item.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(analysis.overtimeTasks[0].overtimeSeconds).toBe(500);
  });

  it("統計暫停原因出現次數", () => {
    const current = state({
      sessions: [
        session({ id: "s1", startedAt: "2026-08-10T10:00:00", interruptions: ["被外界中斷", "任務卡住"] }),
        session({ id: "s2", startedAt: "2026-08-11T10:00:00", interruptions: ["被外界中斷"] }),
      ],
    });
    const reasons = analyzeWeek(current, week, "2026-08-16").pauseReasons;
    expect(reasons[0]).toEqual({ label: "被外界中斷", count: 2 });
    expect(reasons[1]).toEqual({ label: "任務卡住", count: 1 });
  });

  it("反覆卡點需要同一任務兩次以上未完成", () => {
    const current = state({
      tasks: [task({ id: "stuck", title: "卡住的任務" }), task({ id: "once" })],
      sessions: [
        session({ id: "s1", startedAt: "2026-08-10T10:00:00", taskId: "stuck", completed: false }),
        session({ id: "s2", startedAt: "2026-08-11T10:00:00", taskId: "stuck", completed: false }),
        session({ id: "s3", startedAt: "2026-08-12T10:00:00", taskId: "once", completed: false }),
      ],
    });
    const blockers = analyzeWeek(current, week, "2026-08-16").repeatedBlockers;
    expect(blockers).toHaveLength(1);
    expect(blockers[0].taskId).toBe("stuck");
    expect(blockers[0].unfinishedCount).toBe(2);
  });

  it("最久沒推進的主軸排在最前面，從未有紀錄的視為最久", () => {
    const current = state({
      sessions: [
        session({ id: "s1", startedAt: "2026-08-15T10:00:00", axisId: "career" }),
        session({ id: "s2", startedAt: "2026-08-10T10:00:00", axisId: "research" }),
      ],
    });
    const axes = analyzeWeek(current, week, "2026-08-16").stagnantAxes;
    expect(axes[0].daysSince).toBeNull();
    const career = axes.find((item) => item.axisId === "career");
    const research = axes.find((item) => item.axisId === "research");
    expect(career?.daysSince).toBe(1);
    expect(research?.daysSince).toBe(6);
  });

  it("計算本週平均精力，沒有紀錄時為 null", () => {
    const checkins: DailyCheckin[] = [
      { date: "2026-08-10", availableMinutes: 90, energy: 2, hardDeadline: false },
      { date: "2026-08-11", availableMinutes: 90, energy: 4, hardDeadline: false },
      { date: "2026-08-03", availableMinutes: 90, energy: 5, hardDeadline: false },
    ];
    expect(analyzeWeek(state({ checkins }), week, "2026-08-16").averageEnergy).toBe(3);
    expect(analyzeWeek(state(), week, "2026-08-16").averageEnergy).toBeNull();
  });

  it("專注時間按時段分桶並找出最高產時段", () => {
    const current = state({
      sessions: [
        session({ id: "s1", startedAt: "2026-08-10T09:00:00", focusedSeconds: 600 }),
        session({ id: "s2", startedAt: "2026-08-11T14:00:00", focusedSeconds: 1800 }),
        session({ id: "s3", startedAt: "2026-08-12T22:00:00", focusedSeconds: 300 }),
      ],
    });
    const analysis = analyzeWeek(current, week, "2026-08-16");
    expect(analysis.hourBuckets.find((bucket) => bucket.label === "上午 8–12")?.seconds).toBe(600);
    expect(analysis.hourBuckets.find((bucket) => bucket.label === "下午 12–18")?.seconds).toBe(1800);
    expect(analysis.peakBucket?.label).toBe("下午 12–18");
  });

  it("完全沒有紀錄時沒有最高產時段", () => {
    expect(analyzeWeek(state(), week, "2026-08-16").peakBucket).toBeNull();
  });
});

describe("pendingDecisionTasks", () => {
  it("列出本週有投入但沒完成的任務", () => {
    const current = state({
      tasks: [task({ id: "worked" }), task({ id: "untouched" })],
      sessions: [session({ id: "s1", startedAt: "2026-08-12T10:00:00", taskId: "worked", completed: false })],
    });
    expect(pendingDecisionTasks(current, week, "2026-08-16").map((item) => item.id)).toEqual(["worked"]);
  });

  it("列出已逾期的待執行任務", () => {
    const current = state({ tasks: [task({ id: "overdue", dueDate: "2026-08-14" }), task({ id: "future", dueDate: "2026-08-30" })] });
    expect(pendingDecisionTasks(current, week, "2026-08-16").map((item) => item.id)).toEqual(["overdue"]);
  });

  it("不列入已完成與已取消的任務", () => {
    const current = state({
      tasks: [
        task({ id: "done", status: "completed", dueDate: "2026-08-01" }),
        task({ id: "dropped", status: "cancelled", dueDate: "2026-08-01" }),
      ],
    });
    expect(pendingDecisionTasks(current, week, "2026-08-16")).toHaveLength(0);
  });

  it("同一任務只出現一次", () => {
    const current = state({
      tasks: [task({ id: "both", dueDate: "2026-08-11" })],
      sessions: [session({ id: "s1", startedAt: "2026-08-12T10:00:00", taskId: "both", completed: false })],
    });
    expect(pendingDecisionTasks(current, week, "2026-08-16")).toHaveLength(1);
  });
});

describe("AxisId 型別完整性", () => {
  it("四個主軸都有比例資料", () => {
    const ids: AxisId[] = ["career", "research", "teaching", "investing"];
    const shares = summarizeWeek(state(), week).axisShares.map((share) => share.axisId);
    expect(shares).toEqual(ids);
  });
});
