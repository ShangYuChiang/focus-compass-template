import { describe, expect, it } from "vitest";
import { createInitialState } from "./seed";
import { projectHasActiveTimer, removeProject, saveProject } from "./project";
import type { AppState, Project, Task } from "./types";

function createStateWithProject(): AppState {
  const state = createInitialState();
  const project: Project = {
    id: "project-portfolio",
    axisId: "career",
    name: "個人作品集",
    milestone: "完成可分享版本",
    status: "active",
  };
  const task: Task = {
    id: "task-homepage",
    axisId: "career",
    projectId: project.id,
    title: "完成作品集首頁",
    definition: "首頁可在本機開啟，並包含自我介紹與作品連結。",
    priority: "medium",
    status: "pending",
    tags: ["作品集"],
    createdAt: "2026-01-01T00:00:00.000Z",
    actualSeconds: 0,
    sessions: 0,
  };

  return { ...state, projects: [project], tasks: [task] };
}

describe("project editing and deletion", () => {
  it("updates project fields without changing its tasks", () => {
    const state = createStateWithProject();
    const project = { ...state.projects[0], name: "新版作品集專案", milestone: "完成公開展示頁" };
    const next = saveProject(state, project);
    expect(next.projects[0].name).toBe("新版作品集專案");
    expect(next.tasks).toEqual(state.tasks);
  });

  it("removes the project and its tasks while retaining historical sessions", () => {
    const state = createStateWithProject();
    const projectId = state.projects[0].id;
    const taskId = state.tasks.find((task) => task.projectId === projectId)!.id;
    const withHistory = {
      ...state,
      sessions: [{
        id: "session-1", taskId, axisId: "career" as const, startedAt: "2026-08-20T08:00:00Z",
        endedAt: "2026-08-20T08:25:00Z", focusedSeconds: 1500, pausedSeconds: 0,
        overtimeSeconds: 0, completed: true, interruptions: [],
      }],
    };
    const next = removeProject(withHistory, projectId);
    expect(next.projects.some((project) => project.id === projectId)).toBe(false);
    expect(next.tasks.some((task) => task.projectId === projectId)).toBe(false);
    expect(next.sessions).toHaveLength(1);
  });

  it("blocks deletion while one of the project tasks owns the timer", () => {
    const state = createStateWithProject();
    const projectId = state.projects[0].id;
    const taskId = state.tasks.find((task) => task.projectId === projectId)!.id;
    const active = { ...state, timer: { ...state.timer, taskId, status: "paused" as const } };
    expect(projectHasActiveTimer(active, projectId)).toBe(true);
    expect(() => removeProject(active, projectId)).toThrow("正在計時");
  });
});
