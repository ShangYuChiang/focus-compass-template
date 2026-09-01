export type AxisId = "career" | "research" | "teaching" | "investing";
export type TaskStatus = "pending" | "active" | "completed" | "cancelled";
export type TaskKind = "action" | "group";
export type Priority = "high" | "medium" | "low";
export type ProjectStatus = "active" | "paused" | "completed" | "archived" | "cancelled";

export interface Axis {
  id: AxisId;
  name: string;
  shortName: string;
  description: string;
  color: string;
  softColor: string;
}

export interface Project {
  id: string;
  axisId: AxisId;
  name: string;
  milestone: string;
  status: ProjectStatus;
  targetDate?: string;
}

export type MonthlyProjectDecisionKind = "continue" | "pause" | "cancel" | "archive";

export interface MonthlyProjectDecision {
  projectId: string;
  decision: MonthlyProjectDecisionKind;
}

export interface MonthlyReview {
  monthStart: string;
  monthEnd: string;
  highlights: string[];
  projectDecisions: MonthlyProjectDecision[];
  priorityAxisId: AxisId;
  outcomes: string[];
  monthlyGoals: Partial<Record<AxisId, string>>;
  experiment?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  axisId: AxisId;
  projectId: string;
  title: string;
  definition: string;
  firstAction?: string;
  /** group 是不可直接計時的父任務；action 是可執行的小任務。舊資料未填時視為 action。 */
  taskKind?: TaskKind;
  parentTaskId?: string;
  childOrder?: number;
  estimatedMinutes?: number;
  priority: Priority;
  status: TaskStatus;
  dueDate?: string;
  tags: string[];
  evidence?: string;
  createdAt: string;
  completedAt?: string;
  actualSeconds: number;
  sessions: number;
}

export interface FocusSession {
  id: string;
  taskId: string;
  axisId: AxisId;
  startedAt: string;
  endedAt?: string;
  focusedSeconds: number;
  pausedSeconds: number;
  overtimeSeconds: number;
  completed: boolean;
  interruptions: string[];
}

export interface DailyCheckin {
  date: string;
  availableMinutes: number;
  energy: number;
  hardDeadline: boolean;
}

export interface DailyReview {
  date: string;
  mvpTaskId: string;
  /** 產卡當下的任務名稱快照，避免日後改名影響歷史卡片 */
  mvpTitle?: string;
  tomorrowAxisId: AxisId;
  plotTwist?: string;
  gratitude?: string;
  note?: string;
  /** 產卡當下的統計快照 */
  completedCount?: number;
  focusedSeconds?: number;
  overtimeCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type TaskDecisionKind = "keep" | "split" | "cancel";

export interface TaskDecision {
  taskId: string;
  decision: TaskDecisionKind;
  /** 拆小時新建的小任務 */
  replacementTaskId?: string;
}

export interface WeeklyReview {
  /** 該週星期一，例如 "2026-08-10" */
  weekStart: string;
  /** 該週星期日 */
  weekEnd: string;
  /** 本週重要成果，最多三個 task id */
  highlights: string[];
  /** 四主軸各一個下週里程碑 */
  weeklyGoals: Partial<Record<AxisId, string>>;
  priorityAxisId: AxisId;
  experiment?: string;
  taskDecisions: TaskDecision[];
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  fileName: string;
  byteSize: number;
  taskCount: number;
  sessionCount: number;
}

export interface TimerState {
  taskId: string | null;
  status: "idle" | "running" | "paused" | "break";
  startedAt: number | null;
  accumulatedSeconds: number;
  pausedSeconds: number;
  pauseStartedAt: number | null;
  breakEndsAt: number | null;
  interruptions: string[];
}

export interface AppState {
  version: number;
  /** 四個固定主軸 ID 的自訂顯示名稱；空白或缺少時使用預設名稱。 */
  axisNames?: Partial<Record<AxisId, string>>;
  projects: Project[];
  tasks: Task[];
  sessions: FocusSession[];
  checkins: DailyCheckin[];
  reviews: DailyReview[];
  weeklyReviews: WeeklyReview[];
  monthlyReviews: MonthlyReview[];
  backups: BackupRecord[];
  timer: TimerState;
  customPauseReasons: string[];
  theme: "system" | "light" | "dark";
  soundEnabled: boolean;
  /** undefined 表示使用預設的「文件\步步\backups」 */
  backupFolder?: string;
  /** 已提醒過週復盤的那一週（weekStart），避免同一週重複跳出 */
  lastPromptedWeek?: string;
  /** 已提醒過月復盤的月份（月初 YYYY-MM-DD） */
  lastPromptedMonth?: string;
  createdAt: string;
  updatedAt: string;
}
