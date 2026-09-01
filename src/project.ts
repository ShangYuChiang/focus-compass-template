import type { AppState, Project } from "./types";

export function projectTaskIds(state: AppState, projectId: string) {
  return new Set(state.tasks.filter((task) => task.projectId === projectId).map((task) => task.id));
}

export function projectHasActiveTimer(state: AppState, projectId: string) {
  if (!state.timer.taskId) return false;
  return projectTaskIds(state, projectId).has(state.timer.taskId);
}

/**
 * 刪除專案與其任務；專注 session 與每日復盤保留作為歷史統計，
 * 週／月復盤中的專案與任務參照則同步清除，避免留下無法操作的決策。
 */
export function removeProject(state: AppState, projectId: string): AppState {
  const taskIds = projectTaskIds(state, projectId);
  if (state.timer.taskId && taskIds.has(state.timer.taskId)) {
    throw new Error("正在計時的專案不能刪除，請先結束或暫停本次工作。");
  }

  return {
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    tasks: state.tasks.filter((task) => !taskIds.has(task.id)),
    weeklyReviews: state.weeklyReviews.map((review) => ({
      ...review,
      highlights: review.highlights.filter((taskId) => !taskIds.has(taskId)),
      taskDecisions: review.taskDecisions.filter((decision) => !taskIds.has(decision.taskId)),
    })),
    monthlyReviews: state.monthlyReviews.map((review) => ({
      ...review,
      highlights: review.highlights.filter((taskId) => !taskIds.has(taskId)),
      projectDecisions: review.projectDecisions.filter((decision) => decision.projectId !== projectId),
    })),
  };
}

export function saveProject(state: AppState, project: Project): AppState {
  return {
    ...state,
    projects: state.projects.map((item) => item.id === project.id ? project : item),
  };
}
