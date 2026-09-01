import type { FocusSession, Priority, Task, TimerState } from "./types";
import { taskIsReady } from "./taskBreakdown";

const priorityRank: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const STANDARD_FOCUS_SECONDS = 25 * 60;
export const SKIP_INCOMPLETE_REASON = "此次不紀錄原因";

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function workdayDate(date = new Date()) {
  const copy = new Date(date);
  if (copy.getHours() < 4) copy.setDate(copy.getDate() - 1);
  return formatDate(copy);
}

export function shiftWorkday(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return formatDate(new Date(year, month - 1, day + days));
}

/** 連續行動日數：從今天往回數，每天至少留下一段專注紀錄。今天還沒開始不算中斷。 */
export function actionStreak(sessions: FocusSession[], today = workdayDate(), todayInProgress = false) {
  const activeDays = new Set(
    sessions.filter((session) => session.focusedSeconds > 0).map((session) => workdayDate(new Date(session.startedAt))),
  );
  if (todayInProgress) activeDays.add(today);

  let cursor = activeDays.has(today) ? today : shiftWorkday(today, -1);
  let streak = 0;
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = shiftWorkday(cursor, -1);
  }
  return streak;
}

export function rankPendingTasks(tasks: Task[], today: string) {
  return tasks
    .filter((task) => task.status === "pending" && task.taskKind !== "group" && taskIsReady(task, tasks))
    .sort((a, b) => {
      const overdueA = a.dueDate && a.dueDate <= today ? 1 : 0;
      const overdueB = b.dueDate && b.dueDate <= today ? 1 : 0;
      if (overdueA !== overdueB) return overdueB - overdueA;
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[b.priority] - priorityRank[a.priority];
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export function projectProgress(tasks: Task[]) {
  const relevant = tasks.filter((task) => task.status !== "cancelled" && task.taskKind !== "group");
  if (!relevant.length) return 0;
  return relevant.filter((task) => task.status === "completed").length / relevant.length;
}

/** 結束未完成的工作段時，可選擇只留下時間、不寫入一個臆測的原因。 */
export function incompleteInterruptions(interruptions: string[], reason: string) {
  return reason === SKIP_INCOMPLETE_REASON
    ? [...interruptions]
    : [...interruptions, `尚未符合：${reason}`];
}

/**
 * 手動修正已完成任務的總時間時，依原本各工作段比例重新分配秒數。
 * 總和永遠精確等於 targetSeconds，避免任務數字與週／月統計分離。
 */
export function redistributeTaskFocus(sessions: FocusSession[], taskId: string, targetSeconds: number) {
  const related = sessions.filter((session) => session.taskId === taskId);
  if (!related.length) return sessions;
  const safeTarget = Math.max(0, Math.round(targetSeconds));
  const currentTotal = related.reduce((total, session) => total + session.focusedSeconds, 0);
  let allocated = 0;
  let seen = 0;

  return sessions.map((session) => {
    if (session.taskId !== taskId) return session;
    seen += 1;
    const isLast = seen === related.length;
    const focusedSeconds = isLast
      ? safeTarget - allocated
      : currentTotal > 0
        ? Math.floor(session.focusedSeconds / currentTotal * safeTarget)
        : 0;
    allocated += focusedSeconds;
    return {
      ...session,
      focusedSeconds,
      overtimeSeconds: Math.max(0, focusedSeconds - STANDARD_FOCUS_SECONDS),
    };
  });
}

export function freezeTimer(timer: TimerState, frozenAt = Date.now()): TimerState {
  if (timer.status !== "running" || !timer.startedAt) return timer;
  return {
    ...timer,
    status: "paused",
    startedAt: null,
    accumulatedSeconds: timer.accumulatedSeconds + Math.max(0, (frozenAt - timer.startedAt) / 1000),
    pauseStartedAt: frozenAt,
  };
}
