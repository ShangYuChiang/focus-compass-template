import { describe, expect, it } from "vitest";
import { createInitialState } from "./seed";
import { projectTaskRows, removeTask, taskHasActiveTimer, taskRemovalIds } from "./task";
import type { Task } from "./types";

function plain(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, axisId: "career", projectId: "p-career", title: id, definition: "完成",
    priority: "medium", status: "pending", taskKind: "action", tags: [],
    createdAt: `2026-08-21T00:00:0${id.length}.000Z`, actualSeconds: 0, sessions: 0, ...overrides,
  };
}

function groupedTasks(): Task[] {
  return [
    { id: "parent", axisId: "career", projectId: "p-career", title: "父任務", definition: "完成", priority: "high", status: "completed", taskKind: "group", tags: [], createdAt: "2026-08-20T00:00:00.000Z", completedAt: "2026-08-20T02:00:00.000Z", actualSeconds: 0, sessions: 0 },
    { id: "child-1", axisId: "career", projectId: "p-career", parentTaskId: "parent", childOrder: 1, title: "步驟一", definition: "完成", priority: "high", status: "completed", taskKind: "action", tags: [], createdAt: "2026-08-20T00:00:01.000Z", completedAt: "2026-08-20T01:00:00.000Z", actualSeconds: 1200, sessions: 1 },
    { id: "child-2", axisId: "career", projectId: "p-career", parentTaskId: "parent", childOrder: 2, title: "步驟二", definition: "完成", priority: "high", status: "completed", taskKind: "action", tags: [], createdAt: "2026-08-20T00:00:02.000Z", completedAt: "2026-08-20T02:00:00.000Z", actualSeconds: 1200, sessions: 1 },
  ];
}

describe("projectTaskRows", () => {
  it("父任務後面接自己的小任務，依 childOrder 排序", () => {
    const tasks = [
      groupedTasks()[0],
      { ...groupedTasks()[2], status: "pending" as const, completedAt: undefined },
      { ...groupedTasks()[1], status: "pending" as const, completedAt: undefined },
    ];
    const rows = projectTaskRows(tasks, "p-career");
    expect(rows.map((row) => row.task.id)).toEqual(["parent", "child-1", "child-2"]);
    expect(rows.map((row) => row.isChild)).toEqual([false, true, true]);
  });

  it("每一個任務都列出來，不會只有前幾個", () => {
    const tasks = Array.from({ length: 9 }, (_, index) => plain(`t${index}`, { createdAt: `2026-08-21T00:00:0${index}.000Z` }));
    expect(projectTaskRows(tasks, "p-career")).toHaveLength(9);
  });

  it("預設不含已取消，開啟後才列出", () => {
    const tasks = [plain("live"), plain("dropped", { status: "cancelled" })];
    expect(projectTaskRows(tasks, "p-career").map((row) => row.task.id)).toEqual(["live"]);
    expect(projectTaskRows(tasks, "p-career", true).map((row) => row.task.id)).toEqual(["live", "dropped"]);
  });

  it("父任務被過濾掉時，小任務升到頂層仍然找得到", () => {
    const tasks = [
      plain("parent", { taskKind: "group", status: "cancelled" }),
      plain("child", { parentTaskId: "parent", childOrder: 1 }),
    ];
    const rows = projectTaskRows(tasks, "p-career");
    expect(rows.map((row) => row.task.id)).toEqual(["child"]);
    expect(rows[0].isChild).toBe(false);
  });

  it("只列出屬於這個專案的任務", () => {
    const tasks = [plain("mine"), plain("other", { projectId: "p-research" })];
    expect(projectTaskRows(tasks, "p-career").map((row) => row.task.id)).toEqual(["mine"]);
  });
});

describe("removeTask", () => {
  it("removes one child, keeps historical sessions, and resyncs the completed parent", () => {
    const initial = createInitialState();
    const state = {
      ...initial,
      tasks: groupedTasks(),
      sessions: [{ id: "session-1", taskId: "child-1", axisId: "career" as const, startedAt: "2026-08-20T00:40:00.000Z", endedAt: "2026-08-20T01:00:00.000Z", focusedSeconds: 1200, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [] }],
    };

    const result = removeTask(state, "child-1");

    expect(result.tasks.map((task) => task.id)).toEqual(["parent", "child-2"]);
    expect(result.tasks[0]).toMatchObject({ status: "completed", completedAt: "2026-08-20T02:00:00.000Z" });
    expect(result.sessions).toEqual(state.sessions);
  });

  it("removes a parent and every child but preserves unrelated history", () => {
    const initial = createInitialState();
    const unrelated = plain("unrelated");
    const state = { ...initial, tasks: [...groupedTasks(), unrelated] };

    expect(taskRemovalIds(state, "parent")).toEqual(["parent", "child-1", "child-2"]);
    expect(removeTask(state, "parent").tasks).toEqual([unrelated]);
  });

  it("blocks deletion when the task or one of its children is being timed", () => {
    const initial = createInitialState();
    const state = { ...initial, tasks: groupedTasks(), timer: { ...initial.timer, taskId: "child-2", status: "paused" as const } };

    expect(taskHasActiveTimer(state, "parent")).toBe(true);
    expect(() => removeTask(state, "parent")).toThrow("正在計時的任務不能刪除");
  });
});
