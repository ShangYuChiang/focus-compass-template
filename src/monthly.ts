import { AXES } from "./seed";
import { workdayDate } from "./domain";
import type { AppState, AxisId, Task } from "./types";

export interface MonthRange { start: string; end: string }

export interface MonthAxisShare {
  axisId: AxisId;
  seconds: number;
  share: number;
  completedCount: number;
}

export interface MonthSummary {
  range: MonthRange;
  completedCount: number;
  focusedSeconds: number;
  sessionCount: number;
  overtimeRatio: number;
  totalOvertimeSeconds: number;
  averageEnergy: number | null;
  axisShares: MonthAxisShare[];
  completedTasks: Task[];
  isEmpty: boolean;
}

export interface MonthComparison {
  completedDelta: number;
  focusedSecondsDelta: number;
  overtimeRatioDelta: number;
  current: MonthSummary;
  previous: MonthSummary;
}

function isoDate(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function containingMonth(date: string): MonthRange {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return { start: isoDate(year, month - 1, 1), end: isoDate(year, month - 1, last) };
}

/** 月底當天回顧本月；其他日期補做上一個完整月份。 */
export function monthRangeFor(reference = workdayDate()): MonthRange {
  const current = containingMonth(reference);
  if (reference === current.end) return current;
  const [year, month] = reference.split("-").map(Number);
  const previousDate = new Date(year, month - 2, 1);
  return containingMonth(isoDate(previousDate.getFullYear(), previousDate.getMonth(), 1));
}

export function previousMonthRange(range: MonthRange): MonthRange {
  const [year, month] = range.start.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return containingMonth(isoDate(date.getFullYear(), date.getMonth(), 1));
}

function inRange(date: string, range: MonthRange) {
  return date >= range.start && date <= range.end;
}

export function summarizeMonth(state: AppState, range = monthRangeFor()): MonthSummary {
  const sessions = state.sessions.filter((session) => inRange(workdayDate(new Date(session.startedAt)), range));
  const completedTasks = state.tasks
    .filter((task) => task.taskKind !== "group" && task.status === "completed" && task.completedAt && inRange(workdayDate(new Date(task.completedAt)), range))
    .sort((a, b) => Number(Boolean(b.evidence)) - Number(Boolean(a.evidence)) || b.actualSeconds - a.actualSeconds);
  const focusedSeconds = sessions.reduce((total, session) => total + session.focusedSeconds, 0);
  const overtime = sessions.filter((session) => session.overtimeSeconds > 0);
  const checkins = state.checkins.filter((checkin) => inRange(checkin.date, range));

  const axisShares = AXES.map((axis) => {
    const seconds = sessions.filter((session) => session.axisId === axis.id).reduce((total, session) => total + session.focusedSeconds, 0);
    return {
      axisId: axis.id,
      seconds,
      share: focusedSeconds ? seconds / focusedSeconds : 0,
      completedCount: completedTasks.filter((task) => task.axisId === axis.id).length,
    };
  });

  return {
    range,
    completedCount: completedTasks.length,
    focusedSeconds,
    sessionCount: sessions.length,
    overtimeRatio: sessions.length ? overtime.length / sessions.length : 0,
    totalOvertimeSeconds: overtime.reduce((total, session) => total + session.overtimeSeconds, 0),
    averageEnergy: checkins.length ? checkins.reduce((total, item) => total + item.energy, 0) / checkins.length : null,
    axisShares,
    completedTasks,
    isEmpty: sessions.length === 0 && completedTasks.length === 0,
  };
}

export function compareMonths(state: AppState, range = monthRangeFor()): MonthComparison {
  const current = summarizeMonth(state, range);
  const previous = summarizeMonth(state, previousMonthRange(range));
  return {
    completedDelta: current.completedCount - previous.completedCount,
    focusedSecondsDelta: current.focusedSeconds - previous.focusedSeconds,
    overtimeRatioDelta: current.overtimeRatio - previous.overtimeRatio,
    current,
    previous,
  };
}

export function defaultMonthlyHighlights(summary: MonthSummary) {
  return summary.completedTasks.slice(0, 3).map((task) => task.id);
}
