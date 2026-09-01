import { syncTaskGroups } from "./taskBreakdown";
import type { AppState, Task } from "./types";

export interface ProjectTaskRow {
  task: Task;
  /** 子任務在清單中縮排顯示 */
  isChild: boolean;
}

/**
 * 專案內任務的顯示順序：父任務後面接自己的小任務（依 childOrder），其餘依建立時間。
 * 每一個任務都會出現，包含父任務；父任務被過濾掉時，它的小任務會升到頂層，
 * 避免任何任務變成找不到、也就編輯不到的孤兒。
 */
export function projectTaskRows(tasks: Task[], projectId: string, includeCancelled = false): ProjectTaskRow[] {
  const pool = tasks.filter((task) => task.projectId === projectId && (includeCancelled || task.status !== "cancelled"));
  const byCreatedAt = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt);
  const parents = pool.filter((task) => task.taskKind === "group").sort(byCreatedAt);
  const parentIds = new Set(parents.map((parent) => parent.id));

  const rows: ProjectTaskRow[] = [];
  for (const parent of parents) {
    rows.push({ task: parent, isChild: false });
    const children = pool
      .filter((task) => task.parentTaskId === parent.id)
      .sort((a, b) => (a.childOrder ?? Number.MAX_SAFE_INTEGER) - (b.childOrder ?? Number.MAX_SAFE_INTEGER) || byCreatedAt(a, b));
    for (const child of children) rows.push({ task: child, isChild: true });
  }

  const standalone = pool
    .filter((task) => task.taskKind !== "group" && (!task.parentTaskId || !parentIds.has(task.parentTaskId)))
    .sort(byCreatedAt);
  for (const task of standalone) rows.push({ task, isChild: false });

  return rows;
}

export function taskRemovalIds(state: AppState, taskId: string) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return [];
  if (task.taskKind !== "group") return [taskId];
  return [taskId, ...state.tasks.filter((item) => item.parentTaskId === taskId).map((item) => item.id)];
}

export function taskHasActiveTimer(state: AppState, taskId: string) {
  if (!state.timer.taskId || state.timer.status === "idle" || state.timer.status === "break") return false;
  return taskRemovalIds(state, taskId).includes(state.timer.taskId);
}

/**
 * 任務只會從目前工作清單移除；session、復盤與其他歷史快照保留。
 * 父任務被刪除時一併移除其小任務，避免留下失去父層的孤兒任務。
 */
export function removeTask(state: AppState, taskId: string): AppState {
  const ids = new Set(taskRemovalIds(state, taskId));
  if (!ids.size) return state;
  if (taskHasActiveTimer(state, taskId)) throw new Error("正在計時的任務不能刪除");
  return {
    ...state,
    tasks: syncTaskGroups(state.tasks.filter((task) => !ids.has(task.id))),
  };
}
