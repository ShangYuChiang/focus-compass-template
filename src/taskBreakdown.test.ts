import { describe, expect, it } from "vitest";
import { createTaskPlan, generateTaskDrafts, shouldSplitTask, syncTaskGroups, taskIsReady, type TaskPlanInput } from "./taskBreakdown";
import type { Task } from "./types";

const input: TaskPlanInput = {
  title: "完成個人作品集首頁",
  definition: "GitHub、Demo、README 與成果描述完成",
  axisId: "career",
  projectId: "p-career",
  priority: "high",
  estimatedMinutes: 75,
};

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

describe("smart task breakdown", () => {
  it("25 分鐘內保留為一個可執行任務", () => {
    expect(shouldSplitTask(25)).toBe(false);
    const drafts = generateTaskDrafts({ ...input, estimatedMinutes: 25 }, ids());
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe(input.title);
  });

  it("較大任務依主軸生成三個含完成定義與第一動作的小任務", () => {
    const drafts = generateTaskDrafts(input, ids());
    expect(drafts).toHaveLength(3);
    expect(drafts.every((draft) => draft.definition && draft.firstAction && draft.estimatedMinutes === 25)).toBe(true);
    expect(drafts[0].title).toContain("釐清需求");
  });

  it("確認後建立一個父任務與三個有順序的子任務", () => {
    const drafts = generateTaskDrafts(input, ids());
    const tasks = createTaskPlan(input, drafts, ids(), "2026-08-19T10:00:00.000Z");
    expect(tasks).toHaveLength(4);
    expect(tasks[0].taskKind).toBe("group");
    expect(tasks.slice(1).map((task) => task.childOrder)).toEqual([1, 2, 3]);
    expect(tasks.slice(1).every((task) => task.parentTaskId === tasks[0].id && task.taskKind === "action")).toBe(true);
  });

  it("前一個小任務未完成時不開放後續任務", () => {
    const tasks = createTaskPlan(input, generateTaskDrafts(input, ids()), ids());
    expect(taskIsReady(tasks[1], tasks)).toBe(true);
    expect(taskIsReady(tasks[2], tasks)).toBe(false);
    const completedFirst = tasks.map((task, index) => index === 1 ? { ...task, status: "completed" as const } : task);
    expect(taskIsReady(completedFirst[2], completedFirst)).toBe(true);
  });

  it("所有子任務完成後自動完成父任務", () => {
    const tasks = createTaskPlan(input, generateTaskDrafts(input, ids()), ids());
    const completed = tasks.map((task) => task.taskKind === "action"
      ? { ...task, status: "completed" as const, completedAt: "2026-08-19T12:00:00.000Z" }
      : task);
    const synced = syncTaskGroups(completed);
    expect(synced[0].status).toBe("completed");
    expect(synced[0].completedAt).toBe("2026-08-19T12:00:00.000Z");
  });

  it("已完成小任務改回待執行時會同步重開父任務", () => {
    const tasks = createTaskPlan(input, generateTaskDrafts(input, ids()), ids());
    const completed = syncTaskGroups(tasks.map((task) => task.taskKind === "action"
      ? { ...task, status: "completed" as const, completedAt: "2026-08-19T12:00:00.000Z" }
      : task));
    const reopened = syncTaskGroups(completed.map((task, index) => index === 1
      ? { ...task, status: "pending" as const, completedAt: undefined }
      : task));

    expect(reopened[0]).toMatchObject({ status: "pending", completedAt: undefined });
  });

  it("父任務不會被直接執行", () => {
    const group: Task = {
      id: "group", axisId: "career", projectId: "p", title: "group", definition: "done",
      priority: "medium", status: "pending", taskKind: "group", tags: [], createdAt: "2026-08-19T00:00:00Z", actualSeconds: 0, sessions: 0,
    };
    expect(taskIsReady(group, [group])).toBe(false);
  });
});
