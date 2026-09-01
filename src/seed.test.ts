import { describe, expect, it } from "vitest";
import { AXES, configureAxisNames, createInitialState, DEFAULT_AXIS_NAMES } from "./seed";

describe("public template initial state", () => {
  it("starts with four editable work axes and no personal content", () => {
    const state = createInitialState();

    expect(AXES).toHaveLength(4);
    expect(state.axisNames).toEqual({});
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

  it("customizes display names without changing stable axis ids", () => {
    try {
      configureAxisNames({ career: "產品開發" });
      expect(AXES.find((axis) => axis.id === "career")).toMatchObject({
        id: "career",
        name: "產品開發",
        shortName: "產品開發",
      });
      expect(AXES.find((axis) => axis.id === "research")?.name).toBe(DEFAULT_AXIS_NAMES.research);
    } finally {
      configureAxisNames();
    }
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
