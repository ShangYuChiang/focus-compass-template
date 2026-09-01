import { describe, expect, it } from "vitest";
import { nextPetStage, petProgress, petRewardForTask, petStageForPoints } from "./pet";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    axisId: "career",
    projectId: "p1",
    title: "完成作品頁",
    definition: "交付成果：作品頁\n驗收證據：GitHub\n品質門檻：5 分鐘可看懂",
    firstAction: "打開 README",
    taskKind: "action",
    priority: "high",
    status: "completed",
    tags: [],
    evidence: "https://example.com",
    createdAt: "2026-08-20T08:00:00.000Z",
    completedAt: "2026-08-20T09:00:00.000Z",
    actualSeconds: 1200,
    sessions: 1,
    ...overrides,
  };
}

describe("ragdoll cat motivation progress", () => {
  it("a fully documented completed task receives ten points", () => {
    expect(petRewardForTask(task())).toEqual({
      points: 10,
      basePoints: 5,
      acceptanceBonus: 3,
      firstActionBonus: 1,
      evidenceBonus: 1,
    });
  });

  it("a basic completed task still receives five points", () => {
    expect(petRewardForTask(task({ definition: "完成一頁", firstAction: undefined, evidence: undefined })).points).toBe(5);
  });

  it("group and unfinished tasks never receive points", () => {
    expect(petRewardForTask(task({ taskKind: "group" })).points).toBe(0);
    expect(petRewardForTask(task({ status: "pending" })).points).toBe(0);
  });

  it("selects milestone stages and the next unlock", () => {
    expect(petStageForPoints(24).minPoints).toBe(0);
    expect(petStageForPoints(25).minPoints).toBe(25);
    expect(petStageForPoints(200).minPoints).toBe(200);
    expect(nextPetStage(99)?.minPoints).toBe(100);
    expect(nextPetStage(200)).toBeUndefined();
  });

  it("sums only completed action tasks and keeps newest rewards first", () => {
    const result = petProgress([
      task({ id: "old", completedAt: "2026-08-19T09:00:00.000Z" }),
      task({ id: "new", completedAt: "2026-08-20T09:00:00.000Z", evidence: undefined }),
      task({ id: "pending", status: "pending" }),
    ]);
    expect(result.points).toBe(19);
    expect(result.completedCount).toBe(2);
    expect(result.qualityCount).toBe(1);
    expect(result.entries.map((item) => item.task.id)).toEqual(["new", "old"]);
  });
});
