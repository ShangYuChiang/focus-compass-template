import { AXES } from "./seed";
import { shiftWorkday, workdayDate } from "./domain";
import type { AppState, AxisId, FocusSession, Task } from "./types";

export interface WeekRange {
  /** 星期一 */
  start: string;
  /** 星期日 */
  end: string;
}

export interface AxisShare {
  axisId: AxisId;
  seconds: number;
  /** 0–1，總時間為 0 時是 0 */
  share: number;
}

export interface WeekSummary {
  range: WeekRange;
  completedCount: number;
  focusedSeconds: number;
  sessionCount: number;
  axisShares: AxisShare[];
  /** 平均每段番茄鐘的實際秒數，沒有紀錄時為 0 */
  averageSessionSeconds: number;
  overtimeSessionCount: number;
  /** 0–1 */
  overtimeRatio: number;
  totalOvertimeSeconds: number;
  /** 依投入時間排序的本週已完成任務 */
  completedTasks: Task[];
  isEmpty: boolean;
}

export interface CountedItem {
  label: string;
  count: number;
}

export interface OvertimeTask {
  taskId: string;
  title: string;
  overtimeSeconds: number;
}

export interface BlockerTask {
  taskId: string;
  title: string;
  /** 本週未完成的段數 */
  unfinishedCount: number;
}

export interface StagnantAxis {
  axisId: AxisId;
  /** 距今天數；從未有紀錄時為 null */
  daysSince: number | null;
}

export interface HourBucket {
  label: string;
  seconds: number;
}

export interface WeekAnalysis {
  overtimeTasks: OvertimeTask[];
  pauseReasons: CountedItem[];
  repeatedBlockers: BlockerTask[];
  stagnantAxes: StagnantAxis[];
  /** 本週 checkin 的平均精力，沒有紀錄時為 null */
  averageEnergy: number | null;
  hourBuckets: HourBucket[];
  /** 專注秒數最高的時段，全部為 0 時為 null */
  peakBucket: HourBucket | null;
}

const HOUR_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "清晨 4–8", from: 4, to: 8 },
  { label: "上午 8–12", from: 8, to: 12 },
  { label: "下午 12–18", from: 12, to: 18 },
  { label: "晚間 18–24", from: 18, to: 24 },
  { label: "深夜 0–4", from: 0, to: 4 },
];

/** 星期一為起點的那一週。傳入的日期屬於哪一週就回傳那一週。 */
function weekContaining(date: string): WeekRange {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay(); // 0 = 星期日
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const start = shiftWorkday(date, -daysFromMonday);
  return { start, end: shiftWorkday(start, 6) };
}

/**
 * 週復盤的目標週：最近一個「已結束或今天結束」的週。
 * 今天是星期日 → 本週；星期一到星期六 → 上一週（本週還沒結束）。
 * 這樣週日當天做或之後補做，統計範圍都是同一個完整的週。
 */
export function weekRangeFor(today = workdayDate()): WeekRange {
  const current = weekContaining(today);
  if (current.end === today) return current;
  const previousStart = shiftWorkday(current.start, -7);
  return { start: previousStart, end: shiftWorkday(previousStart, 6) };
}

function inRange(date: string, range: WeekRange) {
  return date >= range.start && date <= range.end;
}

function sessionsInRange(sessions: FocusSession[], range: WeekRange) {
  return sessions.filter((session) => inRange(workdayDate(new Date(session.startedAt)), range));
}

export function summarizeWeek(state: AppState, range = weekRangeFor()): WeekSummary {
  const weekSessions = sessionsInRange(state.sessions, range);
  const focusedSeconds = weekSessions.reduce((total, session) => total + session.focusedSeconds, 0);

  const completedTasks = state.tasks
    .filter((task) => task.taskKind !== "group" && task.status === "completed" && task.completedAt && inRange(workdayDate(new Date(task.completedAt)), range))
    .sort((a, b) => b.actualSeconds - a.actualSeconds);

  const axisShares = AXES.map((axis) => {
    const seconds = weekSessions
      .filter((session) => session.axisId === axis.id)
      .reduce((total, session) => total + session.focusedSeconds, 0);
    return { axisId: axis.id, seconds, share: focusedSeconds ? seconds / focusedSeconds : 0 };
  });

  const overtimeSessions = weekSessions.filter((session) => session.overtimeSeconds > 0);

  return {
    range,
    completedCount: completedTasks.length,
    focusedSeconds,
    sessionCount: weekSessions.length,
    axisShares,
    averageSessionSeconds: weekSessions.length ? focusedSeconds / weekSessions.length : 0,
    overtimeSessionCount: overtimeSessions.length,
    overtimeRatio: weekSessions.length ? overtimeSessions.length / weekSessions.length : 0,
    totalOvertimeSeconds: overtimeSessions.reduce((total, session) => total + session.overtimeSeconds, 0),
    completedTasks,
    isEmpty: weekSessions.length === 0 && completedTasks.length === 0,
  };
}

/** 預設的本週三個重要成果：投入時間最長的三個已完成任務。 */
export function defaultHighlights(summary: WeekSummary) {
  return summary.completedTasks.slice(0, 3).map((task) => task.id);
}

export function analyzeWeek(state: AppState, range = weekRangeFor(), today = workdayDate()): WeekAnalysis {
  const weekSessions = sessionsInRange(state.sessions, range);
  const titleOf = (taskId: string) => state.tasks.find((task) => task.id === taskId)?.title ?? "已刪除的任務";

  const overtimeByTask = new Map<string, number>();
  for (const session of weekSessions) {
    if (session.overtimeSeconds > 0) {
      overtimeByTask.set(session.taskId, (overtimeByTask.get(session.taskId) ?? 0) + session.overtimeSeconds);
    }
  }
  const overtimeTasks = [...overtimeByTask.entries()]
    .map(([taskId, overtimeSeconds]) => ({ taskId, title: titleOf(taskId), overtimeSeconds }))
    .sort((a, b) => b.overtimeSeconds - a.overtimeSeconds)
    .slice(0, 3);

  const reasonCounts = new Map<string, number>();
  for (const session of weekSessions) {
    for (const reason of session.interruptions) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const pauseReasons = [...reasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const unfinishedCounts = new Map<string, number>();
  for (const session of weekSessions) {
    if (!session.completed) unfinishedCounts.set(session.taskId, (unfinishedCounts.get(session.taskId) ?? 0) + 1);
  }
  const repeatedBlockers = [...unfinishedCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([taskId, unfinishedCount]) => ({ taskId, title: titleOf(taskId), unfinishedCount }))
    .sort((a, b) => b.unfinishedCount - a.unfinishedCount);

  const stagnantAxes = AXES.map((axis) => {
    const dates = state.sessions
      .filter((session) => session.axisId === axis.id)
      .map((session) => workdayDate(new Date(session.startedAt)))
      .sort();
    const last = dates[dates.length - 1];
    return { axisId: axis.id, daysSince: last ? daysBetween(last, today) : null };
  }).sort((a, b) => (b.daysSince ?? Number.MAX_SAFE_INTEGER) - (a.daysSince ?? Number.MAX_SAFE_INTEGER));

  const weekCheckins = state.checkins.filter((checkin) => inRange(checkin.date, range));
  const averageEnergy = weekCheckins.length
    ? weekCheckins.reduce((total, checkin) => total + checkin.energy, 0) / weekCheckins.length
    : null;

  const hourBuckets = HOUR_BUCKETS.map((bucket) => ({
    label: bucket.label,
    seconds: weekSessions
      .filter((session) => {
        const hour = new Date(session.startedAt).getHours();
        return hour >= bucket.from && hour < bucket.to;
      })
      .reduce((total, session) => total + session.focusedSeconds, 0),
  }));
  const peak = hourBuckets.reduce((best, bucket) => (bucket.seconds > best.seconds ? bucket : best), hourBuckets[0]);

  return {
    overtimeTasks,
    pauseReasons,
    repeatedBlockers,
    stagnantAxes,
    averageEnergy,
    hourBuckets,
    peakBucket: peak.seconds > 0 ? peak : null,
  };
}

function daysBetween(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const diff = new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime();
  return Math.round(diff / 86_400_000);
}

/**
 * 下週規劃要處置的任務：本週有投入但沒完成的待執行任務，加上已逾期的待執行任務。
 * 已完成與已取消的不列入。
 */
export function pendingDecisionTasks(state: AppState, range = weekRangeFor(), today = workdayDate()) {
  const workedOn = new Set(sessionsInRange(state.sessions, range).map((session) => session.taskId));
  return state.tasks.filter((task) => {
    if (task.taskKind === "group") return false;
    if (task.status !== "pending" && task.status !== "active") return false;
    const overdue = Boolean(task.dueDate && task.dueDate <= today);
    return workedOn.has(task.id) || overdue;
  });
}
