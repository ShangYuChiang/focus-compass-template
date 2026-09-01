import { describe, expect, it } from "vitest";
import { AXES, createInitialState } from "./seed";

describe("public template initial state", () => {
  it("starts with four editable work axes and no personal content", () => {
    const state = createInitialState();

    expect(AXES).toHaveLength(4);
    expect(state.projects).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.checkins).toEqual([]);
    expect(state.reviews).toEqual([]);
    expect(state.weeklyReviews).toEqual([]);
    expect(state.monthlyReviews).toEqual([]);
    expect(state.backups).toEqual([]);
    expect(state.timer.status).toBe("idle");
    expect(state.timer.taskId).toBeNull();
  });

  it("uses the current installation time instead of a developer timestamp", () => {
    const before = Date.now();
    const state = createInitialState();
    const after = Date.now();
    const createdAt = Date.parse(state.createdAt);

    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
    expect(state.updatedAt).toBe(state.createdAt);
  });
});
