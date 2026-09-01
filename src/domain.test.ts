import { describe, expect, it } from "vitest";
import { SKIP_INCOMPLETE_REASON, actionStreak, freezeTimer, incompleteInterruptions, projectProgress, rankPendingTasks, redistributeTaskFocus, shiftWorkday, workdayDate } from "./domain";
import type { FocusSession, Task, TimerState } from "./types";

const base: Task = {
  id: "base", axisId: "career", projectId: "project", title: "task", definition: "done",
  priority: "medium", status: "pending", tags: [], createdAt: "2026-08-01T00:00:00.000Z", actualSeconds: 0, sessions: 0,
};

function sessionOn(date: string, focusedSeconds = 1500): FocusSession {
  return {
    id: `s-${date}`, taskId: "task", axisId: "career", startedAt: `${date}T10:00:00`,
    focusedSeconds, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [],
  };
}

describe("workdayDate", () => {
  it("把凌晨四點前歸到前一個工作日", () => expect(workdayDate(new Date("2026-08-14T02:30:00"))).toBe("2026-08-13"));
  it("四點後歸到當天", () => expect(workdayDate(new Date("2026-08-14T04:00:00"))).toBe("2026-08-14"));
});

describe("incompleteInterruptions", () => {
  it("一般原因會寫入工作段紀錄", () => {
    expect(incompleteInterruptions(["被外界中斷"], "任務範圍太大"))
      .toEqual(["被外界中斷", "尚未符合：任務範圍太大"]);
  });

  it("選擇此次不紀錄原因時只保留既有中斷", () => {
    expect(incompleteInterruptions(["被外界中斷"], SKIP_INCOMPLETE_REASON))
      .toEqual(["被外界中斷"]);
  });
});

describe("redistributeTaskFocus", () => {
  it("依原工作段比例修正，且總秒數精確一致", () => {
    const sessions = [sessionOn("2026-08-13", 600), { ...sessionOn("2026-08-14", 900), id: "s-second" }];
    const updated = redistributeTaskFocus(sessions, "task", 3000);
    expect(updated.map((session) => session.focusedSeconds)).toEqual([1200, 1800]);
    expect(updated.reduce((total, session) => total + session.focusedSeconds, 0)).toBe(3000);
  });

  it("同步重新計算每段超時秒數", () => {
    const updated = redistributeTaskFocus([sessionOn("2026-08-14", 1500)], "task", 2100);
    expect(updated[0].overtimeSeconds).toBe(600);
  });

  it("不會改動其他任務的工作段", () => {
    const other = { ...sessionOn("2026-08-14", 700), id: "other", taskId: "other-task" };
    expect(redistributeTaskFocus([other], "task", 1800)[0]).toEqual(other);
  });
});

describe("shiftWorkday", () => {
  it("跨月往前一天", () => expect(shiftWorkday("2026-08-01", -1)).toBe("2026-07-31"));
  it("跨年往後一天", () => expect(shiftWorkday("2026-12-31", 1)).toBe("2027-01-01"));
});

describe("actionStreak", () => {
  it("連續三天有專注紀錄就是三天", () => {
    const sessions = [sessionOn("2026-08-12"), sessionOn("2026-08-13"), sessionOn("2026-08-14")];
    expect(actionStreak(sessions, "2026-08-14")).toBe(3);
  });

  it("同一天多筆紀錄只算一天", () => {
    const sessions = [sessionOn("2026-08-14"), { ...sessionOn("2026-08-14"), id: "s-second" }];
    expect(actionStreak(sessions, "2026-08-14")).toBe(1);
  });

  it("今天還沒開始時保留昨天為止的連續天數", () => {
    const sessions = [sessionOn("2026-08-12"), sessionOn("2026-08-13")];
    expect(actionStreak(sessions, "2026-08-14")).toBe(2);
  });

  it("中斷一天就重新計算", () => {
    const sessions = [sessionOn("2026-08-10"), sessionOn("2026-08-11"), sessionOn("2026-08-13")];
    expect(actionStreak(sessions, "2026-08-13")).toBe(1);
  });

  it("沒有任何紀錄時為零", () => expect(actionStreak([], "2026-08-14")).toBe(0));

  it("昨天也沒有紀錄時為零", () => expect(actionStreak([sessionOn("2026-08-10")], "2026-08-14")).toBe(0));

  it("零秒紀錄不算一天行動", () => expect(actionStreak([sessionOn("2026-08-14", 0)], "2026-08-14")).toBe(0));

  it("進行中的專注可以把今天算進去", () => {
    const sessions = [sessionOn("2026-08-13")];
    expect(actionStreak(sessions, "2026-08-14", true)).toBe(2);
  });
});

describe("rankPendingTasks", () => {
  it("逾期優先於一般高優先任務", () => {
    const overdue = { ...base, id: "overdue", priority: "low" as const, dueDate: "2026-08-10" };
    const high = { ...base, id: "high", priority: "high" as const };
    expect(rankPendingTasks([high, overdue], "2026-08-14")[0].id).toBe("overdue");
  });
  it("不推薦已完成任務", () => expect(rankPendingTasks([{ ...base, status: "completed" }], "2026-08-14")).toHaveLength(0));
});

describe("projectProgress", () => {
  it("取消任務不列入分母", () => expect(projectProgress([{ ...base, status: "completed" }, { ...base, id: "cancelled", status: "cancelled" }])).toBe(1));
  it("父任務不重複計算專案進度", () => expect(projectProgress([{ ...base, taskKind: "group", status: "completed" }, { ...base, id: "child", taskKind: "action", status: "pending" }])).toBe(0));
});

describe("freezeTimer", () => {
  const running: TimerState = {
    taskId: "task", status: "running", startedAt: 10_000, accumulatedSeconds: 30,
    pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [],
  };

  it("freezes a running timer without counting time after the snapshot", () => {
    const frozen = freezeTimer(running, 20_000);
    expect(frozen.status).toBe("paused");
    expect(frozen.accumulatedSeconds).toBe(40);
    expect(frozen.startedAt).toBeNull();
  });

  it("leaves an idle timer unchanged", () => {
    const idle = { ...running, status: "idle" as const, startedAt: null };
    expect(freezeTimer(idle, 20_000)).toBe(idle);
  });
});
