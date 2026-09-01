import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  Download,
  FileUp,
  FileText,
  Flame,
  FolderKanban,
  GraduationCap,
  Heart,
  Home,
  LineChart,
  ListChecks,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Square,
  Sun,
  Target,
  TimerReset,
  TrendingUp,
  Trophy,
  Trash2,
  X,
} from "lucide-react";
import { AXES, configureAxisNames, DEFAULT_AXIS_NAMES } from "./seed";
import { exportState, loadState, saveEmergencyState, saveState } from "./storage";
import { SKIP_INCOMPLETE_REASON, actionStreak, freezeTimer, incompleteInterruptions, rankPendingTasks, redistributeTaskFocus, workdayDate } from "./domain";
import { weekRangeFor } from "./weekly";
import { MAX_BACKUPS, chooseBackupFolder, defaultBackupFolder, formatBytes, needsCleanup, runBackup, runPreRestoreBackup } from "./backup";
import { chooseRestoreCandidate, commitRestoredState, prepareRestoredState, type RestoreCandidate } from "./restore";
import { WeeklyReviewWizard, type WeeklyReviewResult } from "./WeeklyReview";
import { MonthlyReviewWizard, type MonthlyReviewResult } from "./MonthlyReview";
import { monthRangeFor } from "./monthly";
import { dailyReviewDisplay, downloadDailyReviewCard, exportDailyReviews, summarizeDailyReviewDay, dailyReviewExportFiles, type DailyReviewExportFormat } from "./dailyReview";
import { TaskBreakdownModal } from "./TaskBreakdownModal";
import { syncTaskGroups, taskIsReady } from "./taskBreakdown";
import { ACCEPTANCE_FIELD_LABELS, buildQuickAcceptanceTemplate, formatAcceptanceDefinition, isAcceptanceComplete, parseAcceptanceDefinition } from "./acceptance";
import { projectHasActiveTimer, removeProject, saveProject } from "./project";
import { removeTask, taskHasActiveTimer } from "./task";
import type { AppState, AxisId, DailyCheckin, DailyReview, FocusSession, Priority, Project, ProjectStatus, Task } from "./types";

type View = "today" | "projects" | "review" | "insights";
type NewProjectDraft = { axisId: AxisId; name: string; milestone: string; targetDate?: string };

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const pauseReasons = ["被外界中斷", "任務卡住", "休息／離開"];
const incompleteReasons = ["還需要更多時間", "任務範圍太大", "遇到技術問題", "缺少資料或資源", "完成定義不清楚", "被其他事情中斷", SKIP_INCOMPLETE_REASON];
const projectStatusLabels: Record<ProjectStatus, string> = {
  active: "推進中",
  paused: "已暫停",
  completed: "已完成",
  archived: "已封存",
  cancelled: "已取消",
};

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function AcceptanceSummary({ definition }: { definition: string }) {
  const parsed = parseAcceptanceDefinition(definition);
  const lead = parsed.deliverable || "完成時的交付成果未設定";
  const details = [parsed.evidence ? `證據：${parsed.evidence}` : "", parsed.quality ? `品質門檻：${parsed.quality}` : ""].filter(Boolean).join("；");
  return <div className="acceptance-summary">
    <strong>{lead}</strong>
    {details ? <small>{details}</small> : null}
  </div>;
}

function humanMinutes(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function minutesInputValue(seconds: number) {
  return String(Number((seconds / 60).toFixed(2)));
}

function dateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function startOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

async function sendNativeNotification(title: string, body: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let allowed = await notification.isPermissionGranted();
    if (!allowed) allowed = (await notification.requestPermission()) === "granted";
    if (allowed) notification.sendNotification({ title, body });
  } catch {
    // Notifications remain optional.
  }
}

let cueAudioContext: AudioContext | null = null;

/** 低音量、短音尾的上行雙音，避免工作提示過度突兀。 */
function playTone(enabled: boolean, frequency = 620) {
  if (!enabled) return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!cueAudioContext || cueAudioContext.state === "closed") cueAudioContext = new AudioContextClass();
    const context = cueAudioContext;
    const schedule = () => [frequency, frequency * 1.2].forEach((note, index) => {
      const startsAt = context.currentTime + index * 0.15;
      const endsAt = startsAt + 0.28;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(note, startsAt);
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.032, startsAt + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.02);
    });
    if (context.state === "suspended") void context.resume().then(schedule);
    else schedule();
  } catch {
    // Audio feedback remains optional.
  }
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("today");
  const [now, setNow] = useState(Date.now());
  const [showCheckin, setShowCheckin] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewCard, setReviewCard] = useState<DailyReview | null>(null);
  const [editingDailyReview, setEditingDailyReview] = useState<DailyReview | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showWeeklyPrompt, setShowWeeklyPrompt] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);
  const [showMonthlyPrompt, setShowMonthlyPrompt] = useState(false);
  const [showMonthly, setShowMonthly] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [achievement, setAchievement] = useState<Task | null>(null);
  const [achievementInterruptions, setAchievementInterruptions] = useState(0);
  const [candidateOffsets, setCandidateOffsets] = useState<Record<AxisId, number>>({ career: 0, research: 0, teaching: 0, investing: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const deadlineNotified = useRef(false);
  const stateRef = useRef<AppState | null>(null);

  useEffect(() => {
    loadState().then((loaded) => {
      let hydrated = loaded;
      if (loaded.timer.status === "running") {
        const lastSavedAt = Date.parse(loaded.updatedAt);
        hydrated = {
          ...loaded,
          timer: {
            ...freezeTimer(loaded.timer, Number.isFinite(lastSavedAt) ? Math.min(Date.now(), lastSavedAt) : Date.now()),
            pauseStartedAt: Date.now(),
          },
        };
      } else if (loaded.timer.status === "paused") {
        hydrated = { ...loaded, timer: { ...loaded.timer, pauseStartedAt: Date.now() } };
      }
      configureAxisNames(hydrated.axisNames);
      setState(hydrated);
      stateRef.current = hydrated;
      const today = workdayDate();
      const hasInterruptedTask = Boolean(hydrated.timer.taskId && hydrated.timer.status === "paused");
      setShowResume(hasInterruptedTask);
      if (hasInterruptedTask) return;

      // 提醒順序：繼續任務 → 週復盤 → 今日啟動，一次只出現一張。
      const week = weekRangeFor(today);
      const weeklyDone = hydrated.weeklyReviews.some((item) => item.weekStart === week.start);
      if (!weeklyDone && hydrated.lastPromptedWeek !== week.start) {
        setShowWeeklyPrompt(true);
        return;
      }
      const month = monthRangeFor(today);
      const monthlyDone = hydrated.monthlyReviews.some((item) => item.monthStart === month.start);
      if (!monthlyDone && hydrated.lastPromptedMonth !== month.start) {
        setShowMonthlyPrompt(true);
        return;
      }
      if (!hydrated.checkins.some((item) => item.date === today)) setShowCheckin(true);
    });
  }, []);

  useEffect(() => {
    stateRef.current = state;
    if (!state) return;
    const timer = window.setTimeout(() => void saveState(state), 180);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const snapshot = stateRef.current;
      if (snapshot?.timer.status === "running") void saveState(snapshot);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!state || state.timer.status !== "running" || !state.timer.startedAt) return;
    const elapsed = state.timer.accumulatedSeconds + (now - state.timer.startedAt) / 1000;
    if (elapsed >= FOCUS_SECONDS && !deadlineNotified.current) {
      deadlineNotified.current = true;
      playTone(state.soundEnabled);
      void sendNativeNotification("25 分鐘到了", "你可以完成任務，也可以繼續超時計時。今天的節奏由你決定。");
    }
  }, [now, state]);

  useEffect(() => {
    if (!state || state.timer.status !== "break" || !state.timer.breakEndsAt) return;
    if (now >= state.timer.breakEndsAt) {
      playTone(state.soundEnabled, 760);
      void sendNativeNotification("休息完成", "下一輪四個候選任務已準備好。");
      setState((previous) => previous ? { ...previous, timer: { ...previous.timer, status: "idle", breakEndsAt: null, taskId: null } } : previous);
    }
  }, [now, state]);

  useEffect(() => {
    const beforeUnload = () => {
      if (!stateRef.current) return;
      const frozen = { ...stateRef.current, timer: freezeTimer(stateRef.current.timer) };
      stateRef.current = frozen;
      saveEmergencyState(frozen);
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        const snapshot = stateRef.current;
        if (snapshot) {
          const frozen = { ...snapshot, timer: freezeTimer(snapshot.timer) };
          stateRef.current = frozen;
          await saveState(frozen);
        }
        await appWindow.destroy();
      });
    });
    return () => unlisten?.();
  }, []);

  const elapsedSeconds = useMemo(() => {
    if (!state) return 0;
    const { timer } = state;
    if (timer.status === "running" && timer.startedAt) return timer.accumulatedSeconds + (now - timer.startedAt) / 1000;
    return timer.accumulatedSeconds;
  }, [state, now]);

  const activeTask = state?.tasks.find((task) => task.id === state.timer.taskId) ?? null;
  const today = workdayDate();
  const todaySessions = state?.sessions.filter((session) => workdayDate(new Date(session.startedAt)) === today) ?? [];
  const todayCompleted = state?.tasks.filter((task) => task.taskKind !== "group" && task.status === "completed" && task.completedAt && workdayDate(new Date(task.completedAt)) === today) ?? [];
  const todayFocus = todaySessions.reduce((total, session) => total + session.focusedSeconds, 0) + (state?.timer.status === "running" || state?.timer.status === "paused" ? elapsedSeconds : 0);

  const recommendations = useMemo(() => {
    if (!state) return {} as Record<AxisId, Task | undefined>;
    return Object.fromEntries(AXES.map((axis) => {
      const activeProjects = new Set(state.projects.filter((project) => project.status === "active").map((project) => project.id));
      const tasks = rankPendingTasks(state.tasks.filter((task) => task.axisId === axis.id && activeProjects.has(task.projectId)), today);
      const offset = tasks.length ? candidateOffsets[axis.id] % tasks.length : 0;
      return [axis.id, tasks[offset]];
    })) as Record<AxisId, Task | undefined>;
  }, [state, candidateOffsets, today]);

  const updateState = useCallback((updater: (previous: AppState) => AppState) => {
    setState((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      configureAxisNames(next.axisNames);
      return next;
    });
  }, []);

  function startTask(task: Task) {
    if (!state || task.taskKind === "group" || !taskIsReady(task, state.tasks)) return;
    deadlineNotified.current = false;
    setView("today");
    updateState((previous) => ({
      ...previous,
      tasks: previous.tasks.map((item) => item.id === task.id ? { ...item, status: "active" } : item.status === "active" ? { ...item, status: "pending" } : item),
      timer: { taskId: task.id, status: "running", startedAt: Date.now(), accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    }));
    playTone(state?.soundEnabled ?? true, 520);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function pauseTimer(reason: string) {
    updateState((previous) => {
      if (!previous.timer.startedAt) return previous;
      const accumulated = previous.timer.accumulatedSeconds + (Date.now() - previous.timer.startedAt) / 1000;
      return {
        ...previous,
        timer: { ...previous.timer, status: "paused", startedAt: null, accumulatedSeconds: accumulated, pauseStartedAt: Date.now(), interruptions: [...previous.timer.interruptions, reason] },
      };
    });
    setShowPause(false);
  }

  function resumeTimer() {
    updateState((previous) => {
      const resumedAt = Date.now();
      const pausedSeconds = previous.timer.pausedSeconds + (previous.timer.pauseStartedAt ? Math.max(0, (resumedAt - previous.timer.pauseStartedAt) / 1000) : 0);
      return { ...previous, timer: { ...previous.timer, status: "running", startedAt: resumedAt, pausedSeconds, pauseStartedAt: null } };
    });
  }

  function resumeInterruptedTimer() {
    setShowResume(false);
    resumeTimer();
  }

  function stopInterruptedTimer() {
    updateState((previous) => {
      const seconds = Math.floor(previous.timer.accumulatedSeconds);
      const taskId = previous.timer.taskId;
      const interruptedTask = previous.tasks.find((task) => task.id === taskId);
      const endedAt = new Date().toISOString();
      return {
        ...previous,
        tasks: previous.tasks.map((task) => task.id === taskId
          ? { ...task, status: "pending", actualSeconds: task.actualSeconds + seconds, sessions: task.sessions + (seconds > 0 ? 1 : 0) }
          : task),
        sessions: interruptedTask && seconds > 0 ? [...previous.sessions, {
          id: crypto.randomUUID(), taskId: interruptedTask.id, axisId: interruptedTask.axisId,
          startedAt: new Date(Date.now() - seconds * 1000).toISOString(), endedAt,
          focusedSeconds: seconds, pausedSeconds: previous.timer.pausedSeconds,
          overtimeSeconds: Math.max(0, seconds - FOCUS_SECONDS), completed: false,
          interruptions: [...previous.timer.interruptions, "關閉程式後未繼續"],
        }] : previous.sessions,
        timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
      };
    });
    setShowResume(false);
    if (!state?.checkins.some((item) => item.date === workdayDate())) setShowCheckin(true);
  }

  function finishTask() {
    if (!state || !activeTask) return;
    const seconds = Math.floor(elapsedSeconds);
    const endedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    updateState((previous) => ({
      ...previous,
      tasks: syncTaskGroups(previous.tasks.map((task) => task.id === activeTask.id ? { ...task, status: "completed", completedAt: endedAt, actualSeconds: task.actualSeconds + seconds, sessions: task.sessions + 1 } : task)),
      sessions: [...previous.sessions, {
        id: sessionId, taskId: activeTask.id, axisId: activeTask.axisId, startedAt: new Date(Date.now() - seconds * 1000).toISOString(), endedAt,
        focusedSeconds: seconds, pausedSeconds: previous.timer.pausedSeconds + (previous.timer.pauseStartedAt ? Math.max(0, (Date.now() - previous.timer.pauseStartedAt) / 1000) : 0), overtimeSeconds: Math.max(0, seconds - FOCUS_SECONDS), completed: true, interruptions: previous.timer.interruptions,
      }],
      timer: { taskId: null, status: "break", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: Date.now() + BREAK_SECONDS * 1000, interruptions: [] },
    }));
    setCompletionTask(activeTask);
    setAchievement(activeTask);
    setAchievementInterruptions(state.timer.interruptions.length);
    setShowComplete(false);
    playTone(state.soundEnabled, 840);
    window.setTimeout(() => setAchievement(null), 5000);
  }

  function stopIncomplete(reason: string, continueTimer: boolean) {
    if (!state || !activeTask) return;
    if (continueTimer) {
      if (state.timer.status === "paused") resumeTimer();
      setShowComplete(false);
      return;
    }
    const seconds = Math.floor(elapsedSeconds);
    const endedAt = new Date().toISOString();
    updateState((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => task.id === activeTask.id ? { ...task, status: "pending", actualSeconds: task.actualSeconds + seconds, sessions: task.sessions + 1 } : task),
      sessions: [...previous.sessions, {
        id: crypto.randomUUID(), taskId: activeTask.id, axisId: activeTask.axisId, startedAt: new Date(Date.now() - seconds * 1000).toISOString(), endedAt,
        focusedSeconds: seconds, pausedSeconds: previous.timer.pausedSeconds + (previous.timer.pauseStartedAt ? Math.max(0, (Date.now() - previous.timer.pauseStartedAt) / 1000) : 0), overtimeSeconds: Math.max(0, seconds - FOCUS_SECONDS), completed: false,
        interruptions: incompleteInterruptions(previous.timer.interruptions, reason),
      }],
      timer: { taskId: null, status: "idle", startedAt: null, accumulatedSeconds: 0, pausedSeconds: 0, pauseStartedAt: null, breakEndsAt: null, interruptions: [] },
    }));
    setShowComplete(false);
  }

  function saveWeeklyReview(result: WeeklyReviewResult) {
    updateState((previous) => ({
      ...previous,
      weeklyReviews: [...previous.weeklyReviews.filter((item) => item.weekStart !== result.review.weekStart), result.review],
      tasks: [
        ...previous.tasks.map((task) => result.cancelledTaskIds.includes(task.id) ? { ...task, status: "cancelled" as const } : task),
        ...result.newTasks,
      ],
      lastPromptedWeek: result.review.weekStart,
    }));
    setShowWeekly(false);
    openMonthlyOrCheckin();
  }

  function dismissWeeklyPrompt() {
    const week = weekRangeFor();
    updateState((previous) => ({ ...previous, lastPromptedWeek: week.start }));
    setShowWeeklyPrompt(false);
    openMonthlyOrCheckin();
  }

  function saveMonthlyReview(result: MonthlyReviewResult) {
    updateState((previous) => ({
      ...previous,
      monthlyReviews: [...previous.monthlyReviews.filter((item) => item.monthStart !== result.review.monthStart), result.review],
      projects: previous.projects.map((project) => result.projectStatuses[project.id]
        ? { ...project, status: result.projectStatuses[project.id] }
        : project),
      lastPromptedMonth: result.review.monthStart,
    }));
    setShowMonthly(false);
    if (!state?.checkins.some((item) => item.date === workdayDate())) setShowCheckin(true);
  }

  function dismissMonthlyPrompt() {
    const month = monthRangeFor();
    updateState((previous) => ({ ...previous, lastPromptedMonth: month.start }));
    setShowMonthlyPrompt(false);
    if (!state?.checkins.some((item) => item.date === workdayDate())) setShowCheckin(true);
  }

  function openMonthlyOrCheckin() {
    if (!state) return;
    const month = monthRangeFor();
    const monthlyDone = state.monthlyReviews.some((item) => item.monthStart === month.start);
    if (!monthlyDone && state.lastPromptedMonth !== month.start) {
      setShowMonthlyPrompt(true);
      return;
    }
    if (!state.checkins.some((item) => item.date === workdayDate())) setShowCheckin(true);
  }

  async function performBackup() {
    const snapshot = stateRef.current;
    if (!snapshot) return;
    try {
      const result = await runBackup(snapshot);
      updateState((previous) => ({ ...previous, backups: [...previous.backups, result.record] }));
      setBackupNotice({ ok: true, text: result.folder ? `已備份到 ${result.folder}` : "已下載備份檔" });
    } catch (error) {
      setBackupNotice({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function chooseRestore() {
    setBackupNotice(null);
    try {
      const candidate = await chooseRestoreCandidate();
      if (candidate) setRestoreCandidate(candidate);
    } catch (error) {
      setBackupNotice({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function confirmRestore() {
    const current = stateRef.current;
    if (!current || !restoreCandidate || restoreBusy) return;
    setRestoreBusy(true);
    try {
      // 規劃書 §18：覆蓋目前資料前，必須先建立可回復的安全備份。
      const safety = await runPreRestoreBackup(current);
      const restored = prepareRestoredState(restoreCandidate.state);
      const next: AppState = {
        ...restored,
        // 備份資料夾是這台電腦的設定，不從別台電腦的備份覆蓋。
        backupFolder: current.backupFolder,
        backups: [...restored.backups, safety.record],
      };
      configureAxisNames(next.axisNames);
      await commitRestoredState(next);
      stateRef.current = next;
      setState(next);
      setShowResume(Boolean(next.timer.taskId && next.timer.status === "paused"));
      setRestoreCandidate(null);
      setBackupNotice({
        ok: true,
        text: `還原完成；原資料已安全備份為 ${safety.record.fileName}${safety.folder ? `（${safety.folder}）` : ""}`,
      });
    } catch (error) {
      setBackupNotice({ ok: false, text: `還原未執行：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setRestoreBusy(false);
    }
  }

  function saveCheckin(checkin: DailyCheckin) {
    updateState((previous) => ({ ...previous, checkins: [...previous.checkins.filter((item) => item.date !== checkin.date), checkin] }));
    setShowCheckin(false);
  }

  function saveDailyReview(date: string, mvpTaskId: string, tomorrowAxisId: AxisId, plotTwist: string, gratitude: string) {
    if (!state) return;
    const previousReview = state.reviews.find((item) => item.date === date);
    const liveStats = summarizeDailyReviewDay(state, date);
    const currentMvpTitle = state.tasks.find((task) => task.id === mvpTaskId)?.title ?? "未命名成果";
    const review: DailyReview = {
      date,
      mvpTaskId,
      mvpTitle: previousReview?.mvpTaskId === mvpTaskId ? (previousReview.mvpTitle ?? currentMvpTitle) : currentMvpTitle,
      tomorrowAxisId,
      plotTwist,
      gratitude: gratitude.trim() || undefined,
      completedCount: previousReview?.completedCount ?? liveStats.completedCount,
      focusedSeconds: previousReview?.focusedSeconds ?? liveStats.focusedSeconds,
      overtimeCount: previousReview?.overtimeCount ?? liveStats.overtimeCount,
      createdAt: previousReview?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateState((previous) => ({
      ...previous,
      reviews: [...previous.reviews.filter((item) => item.date !== date), review],
    }));
    setShowReview(false);
    setEditingDailyReview(null);
    setReviewCard(review);
  }

  function addTasks(tasks: Task[], newProject?: NewProjectDraft) {
    if (newProject) {
      const name = newProject.name.trim();
      const milestone = newProject.milestone.trim();
      const targetDate = newProject.targetDate?.trim() || undefined;
      if (!name || !milestone) {
        return;
      }
      const projectId = crypto.randomUUID();
      updateState((previous) => ({
        ...previous,
        projects: [...previous.projects, {
          id: projectId,
          axisId: newProject.axisId,
          name,
          milestone,
          status: "active",
          targetDate,
        }],
        tasks: [...previous.tasks, ...tasks.map((task) => ({ ...task, projectId }))],
      }));
      setShowQuickAdd(false);
      return;
    }
    updateState((previous) => ({ ...previous, tasks: [...previous.tasks, ...tasks] }));
    setShowQuickAdd(false);
  }

  function saveTaskEdit(task: Task) {
    updateState((previous) => {
      let sessions = previous.sessions;
      let savedTask = task;
      if (task.status === "completed") {
        sessions = redistributeTaskFocus(sessions, task.id, task.actualSeconds)
          .map((session) => session.taskId === task.id ? { ...session, axisId: task.axisId } : session);
        const related = sessions.filter((session) => session.taskId === task.id);
        if (!related.length && task.actualSeconds > 0) {
          const endedAt = task.completedAt ?? new Date().toISOString();
          const endedAtMs = Date.parse(endedAt);
          const manualSession: FocusSession = {
            id: crypto.randomUUID(),
            taskId: task.id,
            axisId: task.axisId,
            startedAt: new Date(endedAtMs - task.actualSeconds * 1000).toISOString(),
            endedAt,
            focusedSeconds: task.actualSeconds,
            pausedSeconds: 0,
            overtimeSeconds: Math.max(0, task.actualSeconds - FOCUS_SECONDS),
            completed: true,
            interruptions: ["手動補登完成時間"],
          };
          sessions = [...sessions, manualSession];
          savedTask = { ...task, sessions: 1 };
        } else if (related.length) {
          const latest = [...related].sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt)).at(-1)!;
          sessions = sessions.map((session) => {
            if (session.id !== latest.id || !task.completedAt) return session;
            const endedAtMs = Date.parse(task.completedAt);
            return {
              ...session,
              endedAt: task.completedAt,
              startedAt: new Date(endedAtMs - session.focusedSeconds * 1000).toISOString(),
            };
          });
          savedTask = { ...task, sessions: related.length };
        }
      }
      return {
        ...previous,
        sessions,
        tasks: syncTaskGroups(previous.tasks.map((item) => item.id === task.id ? savedTask : item)),
      };
    });
    setEditingTask(null);
  }

  function deleteTask(taskId: string) {
    updateState((previous) => removeTask(previous, taskId));
    setEditingTask(null);
  }

  function saveProjectEdit(project: Project) {
    updateState((previous) => saveProject(previous, project));
    setEditingProject(null);
  }

  function deleteProject(projectId: string) {
    updateState((previous) => removeProject(previous, projectId));
    setEditingProject(null);
  }

  function skipBreak() {
    updateState((previous) => ({ ...previous, timer: { ...previous.timer, status: "idle", breakEndsAt: null, taskId: null } }));
  }

  function toggleTheme() {
    updateState((previous) => ({ ...previous, theme: previous.theme === "dark" ? "light" : "dark" }));
  }

  useEffect(() => {
    if (!state) return;
    const root = document.documentElement;
    root.dataset.theme = state.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : state.theme;
  }, [state?.theme]);

  if (!state) return <div className="loading-screen"><div className="loading-mark">步</div><p>正在整理今天的下一步…</p></div>;

  const reviewEditDate = editingDailyReview?.date ?? today;
  const reviewEditTasks = state.tasks.filter((task) => task.taskKind !== "group" && task.status === "completed" && task.completedAt
    && workdayDate(new Date(task.completedAt)) === reviewEditDate);

  const navItems: { id: View; label: string; icon: typeof Home }[] = [
    { id: "today", label: "今日", icon: Home },
    { id: "projects", label: "專案", icon: FolderKanban },
    { id: "review", label: "復盤", icon: FileText },
    { id: "insights", label: "洞察", icon: BarChart3 },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">步</div><div><strong>步步</strong><span>每天推進一小步</span></div></div>
        <nav className="nav-list">
          {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><item.icon size={19} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setShowSearch(true)}><Search size={18} />搜尋</button>
          <button onClick={toggleTheme}>{state.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}外觀</button>
          <button onClick={() => exportState(state)}><FileText size={18} />匯出資料</button>
          <button onClick={() => setShowSettings(true)}><Settings size={18} />設定</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">{new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</p><h1>{view === "today" ? "今天，選一小步就好" : view === "projects" ? "專案全景" : view === "review" ? "復盤中心" : "工作洞察"}</h1></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="通知"><Bell size={19} /></button>
            <button className="primary-button" onClick={() => setShowQuickAdd(true)}><Plus size={18} />快速新增</button>
          </div>
        </header>

        {view === "today" && (
          <TodayView
            state={state}
            activeTask={activeTask}
            elapsedSeconds={elapsedSeconds}
            recommendations={recommendations}
            candidateOffsets={candidateOffsets}
            setCandidateOffsets={setCandidateOffsets}
            onStart={startTask}
            onEdit={setEditingTask}
            onPause={() => setShowPause(true)}
            onResume={resumeTimer}
            onComplete={() => setShowComplete(true)}
            onSkipBreak={skipBreak}
            todayCompleted={todayCompleted}
            todayFocus={todayFocus}
            now={now}
            onCheckin={() => setShowCheckin(true)}
            onReview={() => setShowReview(true)}
          />
        )}
        {view === "projects" && <ProjectsView state={state} onStart={startTask} onEdit={setEditingTask} onEditProject={setEditingProject} />}
        {view === "review" && <ReviewCenter state={state} onReview={() => setShowReview(true)} onOpenCard={setReviewCard} onWeekly={() => setShowWeekly(true)} onMonthly={() => setShowMonthly(true)} />}
        {view === "insights" && <InsightsView state={state} />}
      </main>

      {showCheckin && <CheckinModal initial={state.checkins.find((item) => item.date === today)} onSave={saveCheckin} onClose={() => setShowCheckin(false)} />}
      {showResume && activeTask && <ResumeModal task={activeTask} elapsedSeconds={elapsedSeconds} onResume={resumeInterruptedTimer} onStop={stopInterruptedTimer} />}
      {showQuickAdd && <TaskBreakdownModal state={state} onSave={addTasks} onClose={() => setShowQuickAdd(false)} />}
      {editingTask && <TaskEditModal state={state} task={editingTask} onSave={saveTaskEdit} onDelete={deleteTask} onClose={() => setEditingTask(null)} />}
      {editingProject && <ProjectEditModal state={state} project={editingProject} onSave={saveProjectEdit} onDelete={deleteProject} onClose={() => setEditingProject(null)} />}
      {showPause && <ReasonModal title="為什麼先暫停？" reasons={[...pauseReasons, ...state.customPauseReasons]} actionLabel="暫停計時" onSelect={pauseTimer} onClose={() => setShowPause(false)} />}
      {showComplete && activeTask && <CompleteModal task={activeTask} onComplete={finishTask} onIncomplete={stopIncomplete} onClose={() => setShowComplete(false)} />}
      {(showReview || editingDailyReview) && <DailyReviewModal date={reviewEditDate} state={state} tasks={reviewEditTasks} initial={editingDailyReview ?? state.reviews.find((item) => item.date === today)} onSave={(mvp, axis, plot, gratitude) => saveDailyReview(reviewEditDate, mvp, axis, plot, gratitude)} onClose={() => { setShowReview(false); setEditingDailyReview(null); }} />}
      {reviewCard && <DailyShutdownCardModal state={state} review={reviewCard} onEdit={() => { setReviewCard(null); setEditingDailyReview(reviewCard); }} onDownload={() => downloadDailyReviewCard(reviewCard, state)} onClose={() => setReviewCard(null)} />}
      {showSearch && <SearchModal state={state} query={searchQuery} setQuery={setSearchQuery} onEdit={(task) => { setShowSearch(false); setEditingTask(task); }} onClose={() => setShowSearch(false)} />}
      {showWeeklyPrompt && <WeeklyPromptModal
        onStart={() => { setShowWeeklyPrompt(false); setShowWeekly(true); }}
        onBackup={performBackup}
        onLater={dismissWeeklyPrompt}
        notice={backupNotice}
      />}
      {showWeekly && <WeeklyReviewWizard state={state} onSave={saveWeeklyReview} onClose={() => setShowWeekly(false)} />}
      {showMonthlyPrompt && <MonthlyPromptModal onStart={() => { setShowMonthlyPrompt(false); setShowMonthly(true); }} onLater={dismissMonthlyPrompt} />}
      {showMonthly && <MonthlyReviewWizard state={state} onSave={saveMonthlyReview} onClose={() => setShowMonthly(false)} />}
      {showSettings && <SettingsModal
        state={state}
        notice={backupNotice}
        onAxisNamesChange={(axisNames) => updateState((previous) => ({ ...previous, axisNames }))}
        onBackup={performBackup}
        onRestore={chooseRestore}
        onFolderChange={(folder) => updateState((previous) => ({ ...previous, backupFolder: folder ?? undefined }))}
        onClose={() => { setShowSettings(false); setBackupNotice(null); }}
      />}
      {restoreCandidate && <RestoreConfirmModal
        candidate={restoreCandidate}
        busy={restoreBusy}
        onConfirm={confirmRestore}
        onClose={() => { if (!restoreBusy) setRestoreCandidate(null); }}
      />}
      {achievement && <AchievementToast task={completionTask ?? achievement} interruptionCount={achievementInterruptions} todayCompleted={todayCompleted.length} todayFocus={todayFocus} />}
    </div>
  );
}

function TodayView({ state, activeTask, elapsedSeconds, recommendations, candidateOffsets, setCandidateOffsets, onStart, onEdit, onPause, onResume, onComplete, onSkipBreak, todayCompleted, todayFocus, now, onCheckin, onReview }: {
  state: AppState; activeTask: Task | null; elapsedSeconds: number; recommendations: Record<AxisId, Task | undefined>;
  candidateOffsets: Record<AxisId, number>; setCandidateOffsets: React.Dispatch<React.SetStateAction<Record<AxisId, number>>>;
  onStart: (task: Task) => void; onEdit: (task: Task) => void; onPause: () => void; onResume: () => void; onComplete: () => void; onSkipBreak: () => void;
  todayCompleted: Task[]; todayFocus: number; now: number; onCheckin: () => void; onReview: () => void;
}) {
  const timer = state.timer;
  const currentCheckin = state.checkins.find((item) => item.date === workdayDate());
  const isFocus = timer.status === "running" || timer.status === "paused";
  const isOvertime = elapsedSeconds >= FOCUS_SECONDS;
  const remaining = isOvertime ? elapsedSeconds - FOCUS_SECONDS : FOCUS_SECONDS - elapsedSeconds;
  const breakRemaining = timer.breakEndsAt ? Math.max(0, (timer.breakEndsAt - now) / 1000) : 0;
  const streak = useMemo(
    () => actionStreak(state.sessions, workdayDate(), todayFocus > 0),
    [state.sessions, todayFocus],
  );

  return (
    <div className="today-layout">
      <section className="workspace-panel">
        {isFocus && activeTask ? (
          <div className="focus-stage">
            <div className="focus-meta"><span className="status-dot" style={{ background: AXES.find((axis) => axis.id === activeTask.axisId)?.color }} />{AXES.find((axis) => axis.id === activeTask.axisId)?.name}<span>·</span>{state.projects.find((project) => project.id === activeTask.projectId)?.name}</div>
            <h2>{activeTask.title}</h2>
            <div className="definition"><Check size={17} /><AcceptanceSummary definition={activeTask.definition} /></div>
            <div className={`timer-ring ${isOvertime ? "overtime" : ""}`} style={{ "--progress": `${Math.min(100, elapsedSeconds / FOCUS_SECONDS * 100)}%` } as React.CSSProperties}>
              <div className="timer-inner">
                <span>{isOvertime ? "超時" : timer.status === "paused" ? "已暫停" : "專注中"}</span>
                <strong>{isOvertime ? `+${formatSeconds(remaining)}` : formatSeconds(remaining)}</strong>
                <small>預估 25:00</small>
              </div>
            </div>
            <div className="timer-actions">
              {timer.status === "running" ? <button className="secondary-button" onClick={onPause}><Pause size={19} />暫停</button> : <button className="secondary-button" onClick={onResume}><Play size={19} />繼續</button>}
              <button className="complete-button" onClick={onComplete}><Check size={20} />確認完成</button>
              <button className="secondary-button compact-button" onClick={() => onEdit(activeTask)} aria-label="編輯目前任務"><Pencil size={17} />編輯</button>
            </div>
            {activeTask.firstAction && <div className="first-action"><Sparkles size={16} /><span>第一步</span>{activeTask.firstAction}</div>}
          </div>
        ) : timer.status === "break" ? (
          <div className="break-stage">
            <div className="break-orb"><span>休息一下</span><strong>{formatSeconds(breakRemaining)}</strong></div>
            <h2>剛才那一步，已經留下來了。</h2>
            <p>喝口水、看看遠方。下一輪不會自動開始。</p>
            <button className="secondary-button" onClick={onSkipBreak}><SkipForward size={18} />跳過休息</button>
          </div>
        ) : (
          <>
            <div className="section-heading"><div><p className="eyebrow">四個主軸，各一個下一步</p><h2>現在想推進哪一邊？</h2></div><span className="gentle-note">不用全部做，選一個就好</span></div>
            <div className="candidate-grid">
              {AXES.map((axis) => {
                const task = recommendations[axis.id];
                return <article className="candidate-card" key={axis.id} style={{ "--axis": axis.color, "--axis-soft": axis.softColor } as React.CSSProperties}>
                  <div className="axis-icon">{axis.id === "career" ? <BriefcaseBusiness /> : axis.id === "research" ? <LineChart /> : axis.id === "teaching" ? <GraduationCap /> : <TrendingUp />}</div>
                  <div className="card-kicker">{axis.shortName}</div>
                  {task ? <>
                    <h3>{task.title}</h3>
                    <AcceptanceSummary definition={task.definition} />
                    <div className="card-tags"><span>{task.priority === "high" ? "高優先" : task.priority === "medium" ? "中優先" : "低優先"}</span>{task.dueDate && <span>{task.dueDate}</span>}</div>
                    <div className="card-actions"><button className="start-button" onClick={() => onStart(task)}><Play size={17} />開始 25 分鐘</button><button className="swap-button" aria-label={`編輯 ${task.title}`} onClick={() => onEdit(task)}><Pencil size={16} /></button><button className="swap-button" aria-label="換一個任務" onClick={() => setCandidateOffsets({ ...candidateOffsets, [axis.id]: candidateOffsets[axis.id] + 1 })}><RefreshCw size={17} /></button></div>
                  </> : <div className="empty-candidate"><Sparkles size={22} /><h3>目前沒有待執行任務</h3><p>新增一個小任務，讓這個主軸重新流動。</p></div>}
                </article>;
              })}
            </div>
          </>
        )}
      </section>

      <aside className="daily-rail">
        <div className="checkin-card">
          <div className="mini-heading"><span>今日狀態</span><button onClick={onCheckin}>調整</button></div>
          <div className="checkin-values"><div><strong>{currentCheckin?.availableMinutes ?? 0}</strong><span>可用分鐘</span></div><div><strong>{currentCheckin?.energy ?? "–"}</strong><span>精力 / 5</span></div></div>
          {currentCheckin?.hardDeadline && <div className="deadline-pill"><Clock3 size={14} />今天有硬期限</div>}
        </div>
        <div className="stat-card"><div className="stat-icon warm"><Flame /></div><div><strong>{todayCompleted.length}</strong><span>今日完成</span></div><small>每一步都算數</small></div>
        {todayCompleted.length > 0 && <div className="completed-today-card"><div className="mini-heading"><span>今日完成項目</span><small>{todayCompleted.length} 項</small></div><div className="completed-today-list">{todayCompleted.map((task) => <button key={task.id} onClick={() => onEdit(task)} title="編輯完成項目"><Check size={14} /><span>{task.title}</span><Pencil size={13} /></button>)}</div></div>}
        <div className="stat-card"><div className="stat-icon cool"><Clock3 /></div><div><strong>{humanMinutes(todayFocus)}</strong><span>累積專注</span></div><small>包含進行中的任務</small></div>
        <div className="streak-card"><div><Trophy size={21} /><span>行動節奏</span></div><strong>{streak} 天</strong><p>{streak === 0 ? "今天留下第一段專注，就會開始累積。" : streak === 1 ? "已經留下一天的成果，明天再接一步。" : `已經連續 ${streak} 天留下成果。`}</p></div>
        <button className="shutdown-button" onClick={onReview}><Moon size={18} /><span><strong>今日收工</strong><small>用 3 分鐘好好結束今天</small></span><ChevronRight size={18} /></button>
      </aside>
    </div>
  );
}

function ProjectsView({ state, onStart, onEdit, onEditProject }: { state: AppState; onStart: (task: Task) => void; onEdit: (task: Task) => void; onEditProject: (project: Project) => void }) {
  const [axisFilter, setAxisFilter] = useState<AxisId | "all">("all");
  const [axisGanttOpen, setAxisGanttOpen] = useState<Record<AxisId, boolean>>({ career: false, research: false, teaching: false, investing: false });
  const axisDateFormat = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit" });
  const now = new Date();

  function parseDate(value?: string) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function startOfDay(source: Date) {
    const copy = new Date(source);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(source: Date, delta: number) {
    const result = new Date(source);
    result.setDate(result.getDate() + delta);
    return result;
  }

  function toDateLabel(value?: string) {
    const date = parseDate(value);
    if (!date) return "未設定";
    return axisDateFormat.format(date);
  }

  function isCurrentWeek(dateValue?: string) {
    const date = parseDate(dateValue);
    if (!date) return false;
    const start = startOfDay(new Date(now));
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return date >= start && date <= end;
  }

  const toggleAxisGantt = (axisId: AxisId) => setAxisGanttOpen((current) => ({ ...current, [axisId]: !current[axisId] }));

  const axisSections = AXES
    .filter((axis) => axisFilter === "all" || axis.id === axisFilter)
    .map((axis) => {
      const projects = state.projects.filter((project) => project.axisId === axis.id);
      const rowBase = projects.map((project) => {
        const tasks = state.tasks.filter((task) => task.projectId === project.id && task.status !== "cancelled");
        const actionTasks = tasks.filter((task) => task.taskKind !== "group");
        const completed = actionTasks.filter((task) => task.status === "completed").length;
        const progress = actionTasks.length ? Math.round((completed / actionTasks.length) * 100) : 0;
        const readyAction = actionTasks.find((task) => task.status !== "completed" && taskIsReady(task, tasks));
        const topToday = readyAction || actionTasks.find((task) => task.status !== "completed");
        const weekGoal = actionTasks.find((task) => task.status !== "completed" && isCurrentWeek(task.dueDate));
        const taskDueDates = actionTasks.map((task) => parseDate(task.dueDate)).filter((item): item is Date => item !== null);
        const targetDate = parseDate(project.targetDate);
        const endDate = targetDate ?? (
          taskDueDates.length > 0
            ? taskDueDates.reduce((latest, item) => (item.getTime() > latest.getTime() ? item : latest), taskDueDates[0])
            : addDays(startOfDay(now), 30)
        );
        const startDate = taskDueDates.length > 0
          ? taskDueDates.reduce((earliest, item) => (item.getTime() < earliest.getTime() ? item : earliest), taskDueDates[0])
          : addDays(endDate, -14);

        const normalizedStart = startDate > endDate ? addDays(endDate, -14) : startDate;
        const normalizedEnd = addDays(endDate, 1);
        const todayStart = startOfDay(now);
        const overdue = normalizedEnd.getTime() < todayStart.getTime();

        return {
          project,
          tasks,
          actionTasks,
          completed,
          progress,
          progressText: `${completed}/${actionTasks.length}`,
          readyAction,
          deadlineLabel: toDateLabel(project.targetDate),
          thisWeekGoal: weekGoal?.title || topToday?.title || "未規劃本週目標",
          todayAction: topToday?.title || "未規劃可做任務",
          startDate: startOfDay(normalizedStart),
          endDate: normalizedEnd,
          overdue,
        };
      });

      const allStartDates = rowBase.map((item) => item.startDate.getTime());
      const allEndDates = rowBase.map((item) => item.endDate.getTime());
      const defaultStart = startOfDay(now);
      const defaultEnd = addDays(defaultStart, 30);

      const timelineStart = startOfDay(new Date(Math.min(...(allStartDates.length ? allStartDates : [defaultStart.getTime()]))));
      const timelineEndRaw = new Date(Math.max(...(allEndDates.length ? allEndDates : [defaultEnd.getTime()])));
      const timelineEnd = startOfDay(addDays(timelineEndRaw, 1));
      const rangeStartMs = timelineStart.getTime();
      const rangeEndMs = Math.max(rangeStartMs + (24 * 60 * 60 * 1000), timelineEnd.getTime());
      const totalRangeMs = Math.max(1, rangeEndMs - rangeStartMs);
      const fullSpanMs = Math.max(7, Math.round(totalRangeMs / (24 * 60 * 60 * 1000)));
      const ticks = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(timelineStart.getTime() + (fullSpanMs - 1) * index * 24 * 60 * 60 * 1000 / 5);
        const percent = Math.round(((date.getTime() - rangeStartMs) / totalRangeMs) * 100);
        return {
          date: axisDateFormat.format(date),
          percent: Math.min(100, Math.max(0, percent)),
        };
      });
      const todayOffset = Math.min(100, Math.max(0, ((startOfDay(now).getTime() - rangeStartMs) / totalRangeMs) * 100));

      const projectRows = rowBase.map((item) => {
        const startMs = item.startDate.getTime();
        const endMs = item.endDate.getTime();
        const left = Math.min(100, Math.max(0, ((startMs - rangeStartMs) / totalRangeMs) * 100));
        const width = Math.min(100 - left, Math.max(3, ((endMs - startMs) / totalRangeMs) * 100));
        return { ...item, timelineLeft: left, timelineWidth: width };
      });

      return {
        axis,
        projects,
        projectRows,
        ticks,
        todayOffset,
        rangeStartMs,
        rangeEndMs,
      };
    });

  const filterRow = <div className="filter-row"><button className={axisFilter === "all" ? "active" : ""} onClick={() => setAxisFilter("all")}>全部</button>{AXES.map((axis) => <button className={axisFilter === axis.id ? "active" : ""} key={axis.id} onClick={() => setAxisFilter(axis.id)}>{axis.shortName}</button>)}</div>;

  if (axisFilter === "all") {
    return <div className="page-stack">
      {filterRow}
      <section className="axis-overview-intro"><div><p className="eyebrow">四大主軸</p><h2>先看方向，再進入專案細節</h2></div><span>選一個主軸後才顯示甘特圖，降低全景雜訊。</span></section>
      <div className="axis-overview-grid">{axisSections.map(({ axis, projects, projectRows }) => {
        const actionCount = projectRows.reduce((sum, item) => sum + item.actionTasks.length, 0);
        const completedCount = projectRows.reduce((sum, item) => sum + item.completed, 0);
        const progress = actionCount ? Math.round(completedCount / actionCount * 100) : 0;
        const activeCount = projects.filter((project) => project.status === "active").length;
        const nextAction = projectRows.find((item) => item.readyAction)?.readyAction ?? projectRows.flatMap((item) => item.actionTasks).find((task) => task.status !== "completed");
        return <article className="axis-overview-card" key={axis.id} style={{ "--axis": axis.color, "--axis-soft": axis.softColor } as React.CSSProperties}>
          <div className="axis-overview-top"><span className="axis-icon"><Sparkles /></span><small>{activeCount} 個推進中／共 {projects.length} 個</small></div>
          <h3>{axis.name}</h3>
          <p>{axis.description}</p>
          <div className="axis-overview-progress"><div><span>整體完成度</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%`, background: axis.color }} /></div><small>{completedCount}/{actionCount} 個行動任務完成</small></div>
          <div className="axis-overview-next"><span>下一步</span><strong>{nextAction?.title ?? "尚未建立可執行任務"}</strong></div>
          <button onClick={() => setAxisFilter(axis.id)}>查看專案與甘特圖<ChevronRight size={16} /></button>
        </article>;
      })}</div>
    </div>;
  }

  return <div className="page-stack">
    {filterRow}
    {axisSections.map(({ axis, projects, projectRows, ticks, todayOffset, rangeStartMs, rangeEndMs }) => {
      const projectCards = projectRows.map((item) => {
        const { project, tasks, actionTasks, completed, progress, progressText, readyAction } = item;
        const deadlineLabel = item.deadlineLabel;
        return <article className={`project-card ${project.status !== "active" ? "inactive" : ""}`} key={project.id} style={{ "--axis": axis.color } as React.CSSProperties}>
          <div className="project-top">
            <div><span className="axis-label">主軸：{axis.shortName}</span><span className={`project-status ${project.status}`}>{projectStatusLabels[project.status]}</span></div>
            <button className="project-task-edit" aria-label={`編輯專案 ${project.name}`} onClick={() => onEditProject(project)}><Pencil size={14} /></button>
          </div>
          <h3>{project.name}</h3>
          <p>{project.milestone}</p>
          <div className="progress-track"><span style={{ width: `${progress}%`, background: axis.color }} /></div>
          <div className="progress-meta"><small>完成度 {progressText}</small><em>截止日 {deadlineLabel}</em></div>
          <div className="task-list">
            {actionTasks.slice(0, 4).map((task) => {
              const canStart = task.status !== "completed" && task.taskKind !== "group" && taskIsReady(task, tasks);
              return <div className={`project-task-row ${task.status}`} key={task.id}>
                <button className="project-task-main" onClick={() => onEdit(task)}>
                  <span className={`priority ${task.priority}`}></span><span className="task-title">{task.title}</span><small>{task.dueDate ? `到期 ${task.dueDate}` : "未設到期"}</small>
                </button>
                <div className="project-task-edit">
                  {canStart && <button onClick={() => onStart(task)} aria-label={`開始 ${task.title}`}><Play size={14} /></button>}
                </div>
              </div>;
            })}
          </div>
          {!actionTasks.length && <small style={{ color: "var(--muted)", fontSize: "12px" }}>這個專案目前沒有行動任務。</small>}
        </article>;
      });
      const isGanttOpen = axisGanttOpen[axis.id];
      const compactRows = projectRows.slice(0, 2);
      const ganttRows = isGanttOpen ? projectRows : compactRows;
      const needsExpand = projectRows.length > 2;

      return <section className="axis-section" key={axis.id} style={{ "--axis": axis.color } as React.CSSProperties}>
        <div className="axis-section-heading">
          <h3>{axis.name}</h3>
        <div className="axis-section-controls">
            <span>{projects.length} 個專案</span>
            {needsExpand ? <button className="axis-gantt-toggle" onClick={() => toggleAxisGantt(axis.id)}>{isGanttOpen ? "收起甘特" : "展開甘特"}</button> : null}
          </div>
        </div>
        {!!projectRows.length && <div className="axis-gantt">
          <div className="axis-gantt-head">
            <span>專案</span>
            <span>今日可做</span>
            <span>本週目標</span>
            <span>排程</span>
            <span>進度</span>
          </div>
          <div className="axis-gantt-timeline-row"><div className="axis-gantt-timeline">
            {ticks.map((tick) => <span key={tick.percent} style={{ left: `${tick.percent}%` }}>{tick.date}</span>)}
          </div></div>
          {ganttRows.map((item) => {
            const { project, actionTasks, progress, progressText, todayAction, thisWeekGoal, overdue, startDate, endDate, timelineLeft, timelineWidth } = item;
            const canStartAction = item.readyAction || actionTasks.find((task) => task.status !== "completed");
            const startLabel = toDateLabel(startDate.toISOString());
            const endLabel = toDateLabel(endDate.toISOString());
            const projectDurationDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
            return <article className={`axis-gantt-row ${project.status}`} key={project.id}>
              <div className="axis-gantt-title">
                <div>
                  <strong>{project.name}</strong>
                  <small>{project.milestone || "未設定里程碑"}</small>
                </div>
                <span className={`project-status ${project.status}`}>{projectStatusLabels[project.status]}</span>
              </div>
              <div className="axis-gantt-cell">{canStartAction ? canStartAction.title : todayAction}</div>
              <div className="axis-gantt-cell week-goal">{thisWeekGoal}</div>
              <div className="axis-gantt-cell axis-gantt-plan">
                <div className="axis-gantt-mini-timeline">
                  <span className="axis-gantt-plan-label"><em>起</em>{startLabel}</span>
                  <span className="axis-gantt-track-wrap">
                    <span className={`axis-gantt-track-line ${overdue ? "overdue-track" : ""}`}>
                      <span className="axis-gantt-track-fill" style={{ left: `${timelineLeft}%`, width: `${timelineWidth}%`, background: axis.color }} />
                      <span className="axis-gantt-today-marker" style={{ left: `${todayOffset}%` }} />
                      <span className="axis-gantt-total-text">{projectDurationDays} 天</span>
                    </span>
                  </span>
                  <span className="axis-gantt-plan-label"><em>迄</em>{endLabel}</span>
                </div>
                <small className={overdue ? "axis-gantt-cell deadline overdue" : "axis-gantt-cell deadline"}>截止日 {axisDateFormat.format(endDate)}</small>
              </div>
              <div className="axis-gantt-cell axis-gantt-progress-cell">
                <span>{progressText}</span>
                <div className="axis-gantt-track"><span className="axis-gantt-bar" style={{ width: `${progress}%`, background: axis.color }} /></div>
              </div>
            </article>;
          })}
        </div>}
        {needsExpand && <button className="axis-more-note" onClick={() => toggleAxisGantt(axis.id)}>{isGanttOpen ? "只看前 2 筆" : `還有 ${projectRows.length - 2} 個專案未展開`}</button>}
        <div className="project-grid">{projectCards.length ? projectCards : <div className="project-empty">這個主軸還沒建立專案，先用右上「快速新增」加一個。</div>}</div>
      </section>;
    })}
  </div>;
}

function ReviewCenter({ state, onReview, onOpenCard, onWeekly, onMonthly }: {
  state: AppState;
  onReview: () => void;
  onOpenCard: (review: DailyReview) => void;
  onWeekly: () => void;
  onMonthly: () => void;
}) {
  const [reviewStart, setReviewStart] = useState("");
  const [reviewEnd, setReviewEnd] = useState("");
  const [reviewFormat, setReviewFormat] = useState<DailyReviewExportFormat>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const today = workdayDate();
  const reviews = [...state.reviews].sort((a, b) => b.date.localeCompare(a.date));
  const latestReview = reviews[0];
  const thisWeek = weekRangeFor();
  const thisWeekCount = reviews.filter((item) => item.date >= thisWeek.start && item.date <= thisWeek.end).length;
  const todayReview = reviews.find((item) => item.date === today);
  const selectableReviews = reviews.filter((review) => {
    if (reviewStart && review.date < reviewStart) return false;
    if (reviewEnd && review.date > reviewEnd) return false;
    return true;
  });

  async function handleExport() {
    if (!selectableReviews.length) return;
    setIsExporting(true);
    try {
      await exportDailyReviews(selectableReviews, state, reviewFormat);
      setExportMessage(`已匯出 ${selectableReviews.length} 張收工卡`);
    } catch {
      setExportMessage("匯出失敗，請稍後再試");
    } finally {
      setIsExporting(false);
    }
  }

  return <div className="page-stack">
    <div className="review-layout">
      <section className="review-hero">
        <div className="review-orb"><FileText size={34} /></div>
        <p className="eyebrow">復盤中心</p>
        <h2>把努力變成可持續證據</h2>
        <p>把「今天、這週、這個月」集中在一起，先做每日收工卡，週月復盤才會有素材可用。</p>
        <div className="review-hero-actions">
          <button className="primary-button" onClick={onReview}>{todayReview ? "更新今日收工卡" : "產生今日收工卡"}</button>
          {latestReview && <button className="secondary-button" onClick={() => onOpenCard(latestReview)}>查看最近收工卡</button>}
          <button className="secondary-button" onClick={onWeekly}>開啟週復盤</button>
          <button className="secondary-button" onClick={onMonthly}>開啟月復盤</button>
        </div>
      </section>
      <section className="review-cards">
        <article>
          <CalendarDays size={24} />
          <span>今日收工</span>
          <h3>{todayReview ? "已完成" : "尚未完成"}</h3>
          <p>{todayReview ? `今天已留存收工卡：${todayReview.date}` : "今天還沒收工，先完成收工流程再繼續。"}</p>
        </article>
        <article>
          <ListChecks size={24} />
          <span>本週收工</span>
          <h3>{thisWeekCount} 張</h3>
          <p>這週收工卡累積，越來越能看到節奏與習慣。</p>
        </article>
        <article>
          <Trophy size={24} />
          <span>歷史收工</span>
          <h3>{state.reviews.length} 張</h3>
          <p>一鍵匯出 CSV、JSON、Markdown，放進分析或履歷作品證據。</p>
        </article>
      </section>
    </div>
    <section className="shutdown-history">
      <div className="section-heading"><div><p className="eyebrow">收工卡紀錄</p><h2>可追溯、可匯出</h2></div></div>
      <div className="review-export-toolbar">
        <div className="review-date-filter">
          <label><span>開始日期</span><input type="date" value={reviewStart} onChange={(event) => setReviewStart(event.target.value)} /></label>
          <label><span>結束日期</span><input type="date" value={reviewEnd} onChange={(event) => setReviewEnd(event.target.value)} /></label>
          <div className="review-export-format">
            <span>匯出格式</span>
            <select value={reviewFormat} onChange={(event) => setReviewFormat(event.target.value as DailyReviewExportFormat)}>
              <option value="all">全部</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
            </select>
          </div>
        </div>
        <div className="review-selection-actions"><button className="secondary-button" onClick={() => { setReviewStart(""); setReviewEnd(""); }}>清空篩選</button></div>
        <button className="primary-button" onClick={() => void handleExport()} disabled={isExporting || selectableReviews.length === 0}><Download size={17} />{isExporting ? "匯出中…" : "下載收工卡"}</button>
      </div>
      <p className="review-format-hint">{exportMessage || "可先用日期範圍挑選後下載，輸出格式會保留收工卡可回溯欄位。你也可以先到 Windows 檔案總管打開後做圖表。"} </p>
      <div className="shutdown-history-grid">
        {reviews.map((review) => {
          const display = dailyReviewDisplay(review, state);
          const axis = AXES.find((item) => item.id === review.tomorrowAxisId);
          return <button className="shutdown-history-row" key={review.date} onClick={() => onOpenCard(review)}>
            <span className="review-select">✓</span>
            <div className="shutdown-history-card">
              <span>{review.date}</span>
              <strong>{display.mvpTitle}</strong>
              <small><Heart size={13} />{review.plotTwist || "今天進行順利"}</small>
              <em style={{ color: axis?.color }}>{axis?.shortName}</em>
            </div>
          </button>;
        })}
      </div>
      {!reviews.length && <p className="empty-search">目前沒有收工卡，先回到「今日」完成今天收工吧。</p>}
    </section>
  </div>;
}

function MonthlyPromptModal({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  const month = monthRangeFor();
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-icon rose"><LineChart /></div>
    <p className="eyebrow">{month.start.slice(0, 7)} 月度復盤</p>
    <h2>把這個月的成果收進口袋</h2>
    <p className="modal-lead">看看四個主軸實際走了多遠，再替下個月留下三個清楚的成果。</p>
    <div className="stack-actions">
      <button className="primary-button full" onClick={onStart}><LineChart size={18} />開始月復盤</button>
      <button className="text-button" onClick={onLater}>稍後再說</button>
    </div>
  </div></div>;
}

function WeeklyPromptModal({ onStart, onBackup, onLater, notice }: {
  onStart: () => void; onBackup: () => void; onLater: () => void; notice: { ok: boolean; text: string } | null;
}) {
  const week = weekRangeFor();
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-icon purple"><CalendarDays /></div>
    <p className="eyebrow">{week.start} 至 {week.end}</p>
    <h2>這一週可以收起來了</h2>
    <p className="modal-lead">花幾分鐘看看這週實際發生什麼，順手把資料備份起來。</p>
    {notice && <div className={`backup-notice ${notice.ok ? "ok" : "bad"}`}>{notice.text}</div>}
    <div className="stack-actions">
      <button className="primary-button full" onClick={onStart}><CalendarDays size={18} />開始週復盤</button>
      <button className="secondary-button full" onClick={onBackup}><Download size={18} />立即備份資料</button>
      <button className="text-button" onClick={onLater}>稍後再說</button>
    </div>
  </div></div>;
}

function SettingsModal({ state, notice, onAxisNamesChange, onBackup, onRestore, onFolderChange, onClose }: {
  state: AppState;
  notice: { ok: boolean; text: string } | null;
  onAxisNamesChange: (axisNames: Partial<Record<AxisId, string>>) => void;
  onBackup: () => void;
  onRestore: () => void;
  onFolderChange: (folder: string | null) => void;
  onClose: () => void;
}) {
  const [resolvedDefault, setResolvedDefault] = useState<string | null>(null);
  const [axisDraft, setAxisDraft] = useState<Record<AxisId, string>>(() => ({
    career: state.axisNames?.career ?? DEFAULT_AXIS_NAMES.career,
    research: state.axisNames?.research ?? DEFAULT_AXIS_NAMES.research,
    teaching: state.axisNames?.teaching ?? DEFAULT_AXIS_NAMES.teaching,
    investing: state.axisNames?.investing ?? DEFAULT_AXIS_NAMES.investing,
  }));
  const [axisSaved, setAxisSaved] = useState(false);
  useEffect(() => { void defaultBackupFolder().then(setResolvedDefault); }, []);
  const recent = [...state.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const folderLabel = state.backupFolder ?? resolvedDefault ?? "文件\\步步\\backups";

  async function pickFolder() {
    const chosen = await chooseBackupFolder();
    if (chosen) onFolderChange(chosen);
  }

  function saveAxisNames() {
    const normalized = Object.fromEntries(AXES.map((axis) => [axis.id, axisDraft[axis.id].trim()])) as Record<AxisId, string>;
    const overrides = Object.fromEntries(AXES
      .filter((axis) => normalized[axis.id] !== DEFAULT_AXIS_NAMES[axis.id])
      .map((axis) => [axis.id, normalized[axis.id]])) as Partial<Record<AxisId, string>>;
    onAxisNamesChange(overrides);
    setAxisDraft(normalized);
    setAxisSaved(true);
  }

  function resetAxisNames() {
    const defaults = { ...DEFAULT_AXIS_NAMES };
    setAxisDraft(defaults);
    onAxisNamesChange({});
    setAxisSaved(true);
  }

  const axisNamesValid = AXES.every((axis) => axisDraft[axis.id].trim().length > 0 && axisDraft[axis.id].trim().length <= 40);

  return <Modal onClose={onClose} wide>
    <div className="modal-icon blue"><Settings /></div>
    <p className="eyebrow">設定</p>
    <h2>專案類別名稱</h2>
    <p className="modal-lead">名稱會同步套用到任務、專案、甘特圖、復盤、統計與匯出資料；既有紀錄不會被移動。</p>
    <div className="axis-name-settings">
      {AXES.map((axis, index) => <label key={axis.id} style={{ "--axis": axis.color } as React.CSSProperties}>
        <span><i />類別 {index + 1}</span>
        <input
          maxLength={40}
          value={axisDraft[axis.id]}
          onChange={(event) => { setAxisDraft((previous) => ({ ...previous, [axis.id]: event.target.value })); setAxisSaved(false); }}
          aria-label={`類別 ${index + 1} 名稱`}
        />
      </label>)}
    </div>
    {!axisNamesValid && <p className="field-error">每個類別都需要名稱，最多 40 個字。</p>}
    {axisSaved && <p className="download-status success">類別名稱已儲存。</p>}
    <div className="axis-name-actions"><button className="text-button" onClick={resetAxisNames}>恢復預設名稱</button><button className="primary-button" disabled={!axisNamesValid} onClick={saveAxisNames}><Check size={17} />儲存類別名稱</button></div>
    <div className="settings-divider" />
    <h2>備份</h2>
    <label className="field-label">備份資料夾</label>
    <div className="folder-row">
      <code>{folderLabel}</code>
      <div>
        <button className="secondary-button" onClick={pickFolder}>變更資料夾</button>
        {state.backupFolder && <button className="text-button" onClick={() => onFolderChange(null)}>改回預設</button>}
      </div>
    </div>
    {notice && <div className={`backup-notice ${notice.ok ? "ok" : "bad"}`}>{notice.text}</div>}
    <button className="primary-button full" onClick={onBackup}><Download size={18} />立即備份</button>
    <button className="secondary-button full" onClick={onRestore}><FileUp size={18} />從 JSON 備份還原</button>
    {needsCleanup(state.backups) && (
      <div className="backup-notice warn">已經有 {state.backups.length} 份備份，超過建議保留的 {MAX_BACKUPS} 份。可以到資料夾裡刪掉舊的。</div>
    )}
    {recent.length > 0 && <>
      <label className="field-label">最近的備份</label>
      <ul className="backup-list">
        {recent.map((item) => <li key={item.id}>
          <span>{item.createdAt.slice(0, 10)}</span>
          <small>{item.taskCount} 個任務 · {item.sessionCount} 段紀錄</small>
          <strong>{formatBytes(item.byteSize)}</strong>
        </li>)}
      </ul>
    </>}
  </Modal>;
}

function RestoreConfirmModal({ candidate, busy, onConfirm, onClose }: {
  candidate: RestoreCandidate;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const state = candidate.state;
  const reviewCount = state.reviews.length + state.weeklyReviews.length + state.monthlyReviews.length;
  return <Modal onClose={onClose} wide>
    <div className="modal-icon amber"><ShieldCheck /></div>
    <p className="eyebrow">還原前確認</p>
    <h2>用這份備份取代目前資料？</h2>
    <p className="modal-lead">系統會先把現在的完整資料另存成安全備份；只有安全備份成功後，才會執行還原。</p>
    <div className="restore-file-card">
      <FileText size={24} />
      <div><strong>{candidate.fileName}</strong><small>資料版本 {state.version} · {formatBytes(candidate.byteSize)}</small></div>
    </div>
    <div className="review-stats restore-stats">
      <div><strong>{state.projects.length}</strong><span>專案</span></div>
      <div><strong>{state.tasks.length}</strong><span>任務</span></div>
      <div><strong>{state.sessions.length}</strong><span>專注紀錄</span></div>
      <div><strong>{reviewCount}</strong><span>復盤</span></div>
    </div>
    <div className="backup-notice warn">還原後，目前畫面中的資料會被這份備份取代。此動作不會刪除剛建立的安全備份檔。</div>
    <div className="split-actions">
      <button className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
      <button className="complete-button" disabled={busy} onClick={onConfirm}><ShieldCheck size={18} />{busy ? "正在安全備份…" : "先安全備份並還原"}</button>
    </div>
  </Modal>;
}

function InsightsView({ state }: { state: AppState }) {
  const total = state.sessions.reduce((sum, session) => sum + session.focusedSeconds, 0);
  const completed = state.tasks.filter((task) => task.taskKind !== "group" && task.status === "completed").length;
  const overtime = state.sessions.filter((session) => session.overtimeSeconds > 0);
  const byAxis = AXES.map((axis) => ({ axis, seconds: state.sessions.filter((session) => session.axisId === axis.id).reduce((sum, session) => sum + session.focusedSeconds, 0) }));
  const max = Math.max(1, ...byAxis.map((item) => item.seconds));
  return <div className="insight-page"><div className="metric-grid"><article><Clock3 /><span>累積專注</span><strong>{humanMinutes(total)}</strong></article><article><ListChecks /><span>完成任務</span><strong>{completed}</strong></article><article><TimerReset /><span>超時任務</span><strong>{overtime.length}</strong></article><article><Target /><span>估時準確</span><strong>{state.sessions.length ? Math.round(state.sessions.filter((session) => session.overtimeSeconds === 0).length / state.sessions.length * 100) : 0}%</strong></article></div>
    <section className="chart-card"><div className="section-heading"><div><p className="eyebrow">時間分布</p><h2>四個主軸的投入</h2></div><span className="gentle-note">累積所有專注紀錄</span></div><div className="horizontal-bars">{byAxis.map(({ axis, seconds }) => <div key={axis.id}><div className="bar-label"><span>{axis.name}</span><strong>{humanMinutes(seconds)}</strong></div><div className="bar-track"><span style={{ width: `${seconds / max * 100}%`, background: axis.color }} /></div></div>)}</div></section>
    <section className="empty-insight"><BarChart3 /><h3>更多洞察會隨使用累積</h3><p>完成幾天任務後，這裡會出現精力、時段、超時與中斷趨勢。</p></section></div>;
}

function Modal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal ${wide ? "wide" : ""}`}><button className="modal-close" onClick={onClose}><X size={18} /></button>{children}</div></div>;
}

function ResumeModal({ task, elapsedSeconds, onResume, onStop }: { task: Task; elapsedSeconds: number; onResume: () => void; onStop: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-icon blue"><TimerReset /></div><p className="eyebrow">上次工作已安全記錄</p><h2>要繼續剛才的任務嗎？</h2><div className="definition-box"><strong>{task.title}</strong><small>已累積 {humanMinutes(elapsedSeconds)}，關閉期間沒有列入計時。</small></div><div className="stack-actions"><button className="primary-button full" onClick={onResume}><Play size={18} />繼續執行</button><button className="text-button" onClick={onStop}>先放回待執行</button></div></div></div>;
}

function CheckinModal({ initial, onSave, onClose }: { initial?: DailyCheckin; onSave: (value: DailyCheckin) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(initial?.availableMinutes ?? 90);
  const [energy, setEnergy] = useState(initial?.energy ?? 3);
  const [deadline, setDeadline] = useState(initial?.hardDeadline ?? false);
  return <Modal onClose={onClose}><div className="modal-icon blue"><Sun /></div><p className="eyebrow">今日啟動</p><h2>今天的條件是什麼？</h2><p className="modal-lead">不是訂理想行程，只是讓推薦更貼近現在的你。</p>
    <label className="field-label">今天可用總時間</label><div className="choice-row">{[30, 60, 90, 120].map((value) => <button className={minutes === value ? "selected" : ""} key={value} onClick={() => setMinutes(value)}>{value} 分</button>)}</div>
    <label className="field-label">目前精力</label><div className="energy-row">{[1, 2, 3, 4, 5].map((value) => <button className={energy === value ? "selected" : ""} key={value} onClick={() => setEnergy(value)}>{value}</button>)}</div>
    <label className="toggle-row"><input type="checkbox" checked={deadline} onChange={(event) => setDeadline(event.target.checked)} /><span><strong>今天有硬期限</strong><small>即將到期的任務會優先顯示</small></span></label>
    <button className="primary-button full" onClick={() => onSave({ date: workdayDate(), availableMinutes: minutes, energy, hardDeadline: deadline })}>產生今天的下一步</button>
  </Modal>;
}

function ProjectEditModal({ state, project, onSave, onDelete, onClose }: {
  state: AppState;
  project: Project;
  onSave: (project: Project) => void;
  onDelete: (projectId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [milestone, setMilestone] = useState(project.milestone);
  const [targetDate, setTargetDate] = useState(project.targetDate ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const axis = AXES.find((item) => item.id === project.axisId)!;
  const relatedTasks = state.tasks.filter((task) => task.projectId === project.id);
  const activeTimer = projectHasActiveTimer(state, project.id);

  return <Modal onClose={onClose} wide>
    <div className="modal-icon purple"><FolderKanban /></div>
    <p className="eyebrow">編輯專案 · {axis.shortName}</p>
    <h2>調整專案範圍與期限</h2>
    <p className="modal-lead">專案名稱、里程碑與截止日會同步反映在主軸甘特圖。</p>
    <div className="form-grid project-edit-form">
      <label className="form-span"><span>專案名稱</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="清楚描述這個專案" /></label>
      <label className="form-span"><span>里程碑／完成成果</span><textarea value={milestone} onChange={(event) => setMilestone(event.target.value)} placeholder="完成時要留下什麼可驗收成果？" /></label>
      <label><span>專案截止日</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
      <label><span>專案狀態</span><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="active">推進中</option><option value="paused">已暫停</option><option value="completed">已完成</option><option value="archived">已封存</option><option value="cancelled">已取消</option></select></label>
    </div>
    <button className="primary-button full" disabled={!name.trim() || !milestone.trim()} onClick={() => onSave({ ...project, name: name.trim(), milestone: milestone.trim(), targetDate: targetDate || undefined, status })}><Check size={18} />儲存專案修改</button>

    <section className="project-danger-zone">
      <div><Trash2 size={18} /><div><strong>刪除專案</strong><p>從日常系統移除專案與其中 {relatedTasks.length} 個任務；既有專注 session 與復盤統計仍會保留。</p></div></div>
      {!confirmDelete ? <button className="danger-outline-button" disabled={activeTimer} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />刪除專案</button> : <div className="project-delete-confirm"><div><AlertTriangle size={18} /><span>確定刪除「{project.name}」？這會一併移除相關任務。</span></div><div><button className="secondary-button" onClick={() => setConfirmDelete(false)}>先不要</button><button className="danger-button" onClick={() => onDelete(project.id)}>確認刪除</button></div></div>}
      {activeTimer && <small>這個專案目前有計時中的任務，請先結束本次工作再刪除。</small>}
    </section>
  </Modal>;
}

function TaskEditModal({ state, task, onSave, onDelete, onClose }: { state: AppState; task: Task; onSave: (task: Task) => void; onDelete: (taskId: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const initialAcceptance = parseAcceptanceDefinition(task.definition);
  const [acceptanceDeliverable, setAcceptanceDeliverable] = useState(initialAcceptance.deliverable);
  const [acceptanceEvidence, setAcceptanceEvidence] = useState(initialAcceptance.evidence);
  const [acceptanceQuality, setAcceptanceQuality] = useState(initialAcceptance.quality);
  const [firstAction, setFirstAction] = useState(task.firstAction ?? "");
  const [axisId, setAxisId] = useState<AxisId>(task.axisId);
  const [projectId, setProjectId] = useState(task.projectId);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [estimatedMinutes, setEstimatedMinutes] = useState(task.estimatedMinutes ?? (task.taskKind === "group" ? 75 : 25));
  const [childOrder, setChildOrder] = useState(task.childOrder ?? 1);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [evidence, setEvidence] = useState(task.evidence ?? "");
  const [actualMinutes, setActualMinutes] = useState(minutesInputValue(task.actualSeconds));
  const [completedDateTime, setCompletedDateTime] = useState(dateTimeLocalValue(task.completedAt));
  const [actualTimeChanged, setActualTimeChanged] = useState(false);
  const [completionTimeChanged, setCompletionTimeChanged] = useState(false);
  const [willReopen, setWillReopen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projects = state.projects.filter((project) => project.axisId === axisId && (project.status === "active" || project.id === task.projectId));
  const activeTimer = taskHasActiveTimer(state, task.id);
  const childCount = task.taskKind === "group" ? state.tasks.filter((item) => item.parentTaskId === task.id).length : 0;

  useEffect(() => {
    if (!projects.some((project) => project.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [axisId, projectId, projects]);

  const statusLabel = task.taskKind === "group" ? "父任務" : willReopen ? "將改回待執行" : task.status === "completed" ? "已完成" : task.status === "active" ? "進行中" : task.status === "cancelled" ? "已取消" : "待執行";
  const acceptanceComplete = isAcceptanceComplete({ deliverable: acceptanceDeliverable, evidence: acceptanceEvidence, quality: acceptanceQuality });
  const completionFieldsValid = willReopen || task.taskKind === "group" || task.status !== "completed"
    || (Number.isFinite(Number(actualMinutes)) && Number(actualMinutes) >= 0 && Boolean(completedDateTime));

  function fillAcceptanceTemplate() {
    const template = buildQuickAcceptanceTemplate(axisId, title);
    setAcceptanceDeliverable(template.deliverable);
    setAcceptanceEvidence(template.evidence);
    setAcceptanceQuality(template.quality);
  }

  return <Modal onClose={onClose} wide>
    <div className="modal-icon blue"><Pencil /></div>
    <p className="eyebrow">編輯任務 · {statusLabel}</p>
    <h2>調整這一步的內容</h2>
    <p className="modal-lead">可以修正任務內容與完成時間；已完成任務也能改回待執行，既有專注紀錄不會消失。</p>
    {task.taskKind !== "group" && task.status === "completed" && <section className={`task-status-editor ${willReopen ? "reopen" : ""}`}>
      <div><RefreshCw size={18} /><div><strong>{willReopen ? "儲存後改回待執行" : "這項任務目前已完成"}</strong><p>{willReopen ? "完成日期會清除，任務重新出現在推薦清單；先前專注時間與 session 保留。" : "如果只是誤按完成，或成果需要重新加工，可以把它放回待執行。"}</p></div></div>
      <button type="button" className="secondary-button" onClick={() => setWillReopen((value) => !value)}>{willReopen ? "維持已完成" : "改回待執行"}</button>
    </section>}
    {task.taskKind === "group" && <p className="task-group-status-note">父任務的完成狀態由小任務自動計算；若要重新開啟，請把其中一個已完成小任務改回待執行。</p>}
      <div className="form-grid edit-task-form">
      <label className="form-span"><span>任務名稱</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="動詞＋明確產物" /></label>
      <div className="acceptance-grid form-span">
        <label><span>{ACCEPTANCE_FIELD_LABELS.deliverable}</span><textarea value={acceptanceDeliverable} onChange={(event) => setAcceptanceDeliverable(event.target.value)} placeholder="完成這步要交付什麼，輸出文件/代碼/Demo 名稱" /></label>
        <label><span>{ACCEPTANCE_FIELD_LABELS.evidence}</span><textarea value={acceptanceEvidence} onChange={(event) => setAcceptanceEvidence(event.target.value)} placeholder="要留下哪種可驗證證據（GitHub、文件、報表、紀錄）" /></label>
        <label><span>{ACCEPTANCE_FIELD_LABELS.quality}</span><textarea value={acceptanceQuality} onChange={(event) => setAcceptanceQuality(event.target.value)} placeholder="合格門檻：可量化、可示範、可交付" /></label>
      </div>
      <div className="form-span">
        <button type="button" className="secondary-button full" onClick={fillAcceptanceTemplate}>一鍵套用 3 欄位驗收模板（保留可再修）</button>
      </div>
      <label className="form-span"><span>第一個動作</span><input value={firstAction} onChange={(event) => setFirstAction(event.target.value)} placeholder="可選填，例如：打開 CV 文件" /></label>
      <label><span>所屬主軸</span><select value={axisId} onChange={(event) => setAxisId(event.target.value as AxisId)}>{AXES.map((axis) => <option value={axis.id} key={axis.id}>{axis.name}</option>)}</select></label>
      <label><span>所屬專案</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{!projects.length && <option value="">此主軸沒有可用專案</option>}{projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.status !== "active" ? `（${projectStatusLabels[project.status]}）` : ""}</option>)}</select></label>
      <label><span>優先程度</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
      <label><span>{task.taskKind === "group" ? "整體預估分鐘" : "預估花費（分鐘）"}</span><input type="number" min="5" step="5" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} /></label>
      {task.parentTaskId && <label><span>小任務順序</span><input type="number" min="1" step="1" value={childOrder} onChange={(event) => setChildOrder(Number(event.target.value))} /></label>}
      <label><span>期限</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      {task.taskKind !== "group" && task.status === "completed" && !willReopen && <>
        <label><span>實際花費（分鐘）</span><input type="number" min="0" step="1" value={actualMinutes} onChange={(event) => { setActualMinutes(event.target.value); setActualTimeChanged(true); }} /></label>
        <label><span>完成日期時間</span><input type="datetime-local" value={completedDateTime} onChange={(event) => { setCompletedDateTime(event.target.value); setCompletionTimeChanged(true); }} /></label>
        <p className="completion-sync-note form-span"><Clock3 size={15} />修改後會同步更新每日、每週、每月與主軸投入統計。</p>
      </>}
      <label className="form-span"><span>成果證據</span><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="可選填：GitHub、文件、Demo 或成果位置" /></label>
    </div>
    <button className="primary-button full" disabled={!title.trim() || !acceptanceComplete || !projectId || !completionFieldsValid} onClick={() => onSave({
      ...task,
      title: title.trim(),
      definition: formatAcceptanceDefinition({ deliverable: acceptanceDeliverable, evidence: acceptanceEvidence, quality: acceptanceQuality }),
      firstAction: firstAction.trim() || undefined,
      axisId,
      projectId,
      priority,
      estimatedMinutes: Math.max(5, Math.round(estimatedMinutes)),
      childOrder: task.parentTaskId ? Math.max(1, Math.round(childOrder)) : task.childOrder,
      dueDate: dueDate || undefined,
      evidence: evidence.trim() || undefined,
      status: willReopen ? "pending" : task.status,
      actualSeconds: task.taskKind !== "group" && task.status === "completed" && !willReopen && actualTimeChanged ? Math.max(0, Math.round(Number(actualMinutes) * 60)) : task.actualSeconds,
      completedAt: willReopen ? undefined : task.taskKind !== "group" && task.status === "completed" && completionTimeChanged ? new Date(completedDateTime).toISOString() : task.completedAt,
    })}><Check size={18} />儲存修改</button>
    <section className="project-danger-zone task-danger-zone">
      <div><Trash2 size={18} /><div><strong>刪除任務</strong><p>{task.taskKind === "group" ? `從日常系統移除父任務與其中 ${childCount} 個小任務。` : "從日常系統移除這項任務。"}既有專注 session 與收工卡統計仍會保留。</p></div></div>
      {!confirmDelete ? <button type="button" className="danger-outline-button" disabled={activeTimer} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />刪除任務</button> : <div className="project-delete-confirm"><div><AlertTriangle size={18} /><span>確定刪除「{task.title}」？{task.taskKind === "group" && childCount > 0 ? `其中 ${childCount} 個小任務也會一起移除。` : ""}</span></div><div><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>先不要</button><button type="button" className="danger-button" onClick={() => onDelete(task.id)}>確認刪除</button></div></div>}
      {activeTimer && <small>這項任務目前正在計時，請先結束本次工作再刪除。</small>}
    </section>
  </Modal>;
}

function ReasonModal({ title, reasons, actionLabel, onSelect, onClose }: { title: string; reasons: string[]; actionLabel: string; onSelect: (reason: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  return <Modal onClose={onClose}><div className="modal-icon amber"><CirclePause /></div><h2>{title}</h2><div className="reason-list">{reasons.map((reason) => <button key={reason} onClick={() => onSelect(reason)}>{reason}<ChevronRight size={17} /></button>)}</div><div className="inline-input"><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="其他原因" /><button disabled={!custom.trim()} onClick={() => onSelect(custom.trim())}>{actionLabel}</button></div></Modal>;
}

function CompleteModal({ task, onComplete, onIncomplete, onClose }: { task: Task; onComplete: () => void; onIncomplete: (reason: string, keepGoing: boolean) => void; onClose: () => void }) {
  const [notDone, setNotDone] = useState(false); const [reason, setReason] = useState(incompleteReasons[0]);
  const acceptance = parseAcceptanceDefinition(task.definition);
  return <Modal onClose={onClose}><div className="modal-icon green"><Check /></div><p className="eyebrow">完成定義</p><h2>這一步真的完成了嗎？</h2>
    <div className="definition-box acceptance-definition">
      <strong>完成驗收框架</strong>
      <p><span>交付成果：</span>{acceptance.deliverable || "未設定"}</p>
      <p><span>驗收證據：</span>{acceptance.evidence || "未設定"}</p>
      <p><span>品質門檻：</span>{acceptance.quality || "未設定"}</p>
    </div>{!notDone ? <div className="stack-actions"><button className="complete-button full" onClick={onComplete}><Check size={19} />符合，完成任務</button><button className="text-button" onClick={() => setNotDone(true)}>尚未符合</button></div> : <><label className="field-label">尚未符合的原因</label><select className="full-select" value={reason} onChange={(event) => setReason(event.target.value)}>{incompleteReasons.map((item) => <option key={item}>{item}</option>)}</select><div className="split-actions"><button className="secondary-button" onClick={() => onIncomplete(reason, false)}><Square size={17} />結束本次</button><button className="primary-button" onClick={() => onIncomplete(reason, true)}><Play size={17} />繼續計時</button></div></>}</Modal>;
}

function DailyReviewModal({ date, state, tasks, initial, onSave, onClose }: { date: string; state: AppState; tasks: Task[]; initial?: DailyReview; onSave: (mvp: string, axis: AxisId, plot: string, gratitude: string) => void; onClose: () => void }) {
  const [mvp, setMvp] = useState(initial?.mvpTaskId ?? tasks[0]?.id ?? "");
  const [axis, setAxis] = useState<AxisId>(initial?.tomorrowAxisId ?? "career");
  const [plot, setPlot] = useState(initial?.plotTwist ?? "今天進行順利");
  const [gratitude, setGratitude] = useState(initial?.gratitude ?? "");
  const liveStats = summarizeDailyReviewDay(state, date);
  const stats = initial ? dailyReviewDisplay(initial, state) : liveStats;
  const initialMvpMissing = Boolean(initial && !tasks.some((task) => task.id === initial.mvpTaskId));
  return <Modal onClose={onClose} wide><div className="modal-icon purple"><Trophy /></div><p className="eyebrow">{initial ? `編輯 ${date} 收工卡` : "今日收工結算"}</p><h2>{initial ? "更新這一天留下的紀錄。" : "把今天留下來，再安心收工。"}</h2><div className="review-stats"><div><strong>{initial ? stats.completedCount : tasks.length}</strong><span>完成任務</span></div><div><strong>{humanMinutes(stats.focusedSeconds)}</strong><span>專注時間</span></div><div><strong>{stats.overtimeCount}</strong><span>超時任務</span></div></div>
    <label className="field-label">🏆 今日 MVP（必填）</label><select className="full-select" value={mvp} onChange={(event) => setMvp(event.target.value)}><option value="">選擇今天最值得肯定的成果</option>{initialMvpMissing && <option value={initial!.mvpTaskId}>{initial!.mvpTitle ?? "原本選擇的成果"}</option>}{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
    <label className="field-label">今天最大的劇情轉折</label><select className="full-select" value={plot} onChange={(event) => setPlot(event.target.value)}>{["今天進行順利", "一開始不想做，最後仍完成", "任務比預期困難", "被外界中斷", "發現更好的做法", "任務定義不清楚"].map((item) => <option key={item}>{item}</option>)}</select>
    <label className="field-label">🌱 明日種子（必填）</label><div className="axis-choice">{AXES.map((item) => <button className={axis === item.id ? "selected" : ""} style={{ "--axis": item.color } as React.CSSProperties} key={item.id} onClick={() => setAxis(item.id)}>{item.shortName}</button>)}</div>
    <label className="field-label">💛 感謝日記</label><textarea className="gratitude-input" value={gratitude} onChange={(event) => setGratitude(event.target.value)} placeholder="今天有哪一件小事、哪一個人，或哪一個努力值得感謝？" />
    <button className="primary-button full" disabled={!mvp} onClick={() => onSave(mvp, axis, plot, gratitude)}>{initial ? "儲存並更新收工卡" : "生成並保存今日收工卡"}</button>
  </Modal>;
}

function DailyShutdownCardModal({ state, review, onEdit, onDownload, onClose }: { state: AppState; review: DailyReview; onEdit: () => void; onDownload: () => Promise<boolean>; onClose: () => void }) {
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const display = dailyReviewDisplay(review, state);
  const dateLabel = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${review.date}T12:00:00`));
  const axis = AXES.find((item) => item.id === review.tomorrowAxisId)!;
  async function saveMarkdown() {
    setDownloadStatus("saving");
    try {
      const saved = await onDownload();
      setDownloadStatus(saved ? "saved" : "idle");
    } catch {
      setDownloadStatus("error");
    }
  }
  return <Modal onClose={onClose} wide>
    <div className="shutdown-card-heading"><div className="modal-icon green"><Moon /></div><div><p className="eyebrow">今日收工卡</p><h2>{dateLabel}</h2></div></div>
    <p className="shutdown-card-lead">今天已經好好收進系統，可以放心休息了。</p>
    <div className="review-stats shutdown-card-stats"><div><strong>{display.completedCount}</strong><span>完成任務</span></div><div><strong>{humanMinutes(display.focusedSeconds)}</strong><span>專注時間</span></div><div><strong>{display.overtimeCount}</strong><span>超時工作段</span></div></div>
    <section className="shutdown-highlight"><Trophy size={20} /><div><span>今日 MVP</span><strong>{display.mvpTitle}</strong></div></section>
    <div className="shutdown-story-grid"><section><span>今天的劇情轉折</span><strong>{review.plotTwist || "今天進行順利"}</strong></section><section style={{ "--axis": axis.color } as React.CSSProperties}><span>明日種子</span><strong>{display.tomorrowAxis}</strong></section></div>
    <section className="gratitude-card"><Heart size={21} /><div><span>感謝日記</span><p>{review.gratitude?.trim() || "今天尚未填寫；之後仍可以更新這張收工卡。"}</p></div></section>
    {downloadStatus === "saved" && <p className="download-status success">收工卡已存成 Markdown，可以在檔案總管中查看。</p>}
    {downloadStatus === "error" && <p className="download-status error">下載失敗，請重新選擇儲存位置再試一次。</p>}
    <div className="split-actions shutdown-card-actions"><div><button className="secondary-button" onClick={onEdit}><Pencil size={17} />編輯收工卡</button><button className="secondary-button" disabled={downloadStatus === "saving"} onClick={() => void saveMarkdown()}><Download size={17} />{downloadStatus === "saving" ? "儲存中…" : "下載 Markdown"}</button></div><button className="primary-button" onClick={onClose}><Check size={17} />完成收工</button></div>
  </Modal>;
}

function SearchModal({ state, query, setQuery, onEdit, onClose }: { state: AppState; query: string; setQuery: (value: string) => void; onEdit: (task: Task) => void; onClose: () => void }) {
  const results = state.tasks.filter((task) => `${task.title} ${task.definition} ${task.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  return <Modal onClose={onClose} wide><div className="search-box"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋任務、完成定義或標籤…" /></div><div className="search-results">{query && results.map((task) => { const axis = AXES.find((item) => item.id === task.axisId)!; return <div key={task.id}><span style={{ background: axis.color }} /><div><strong>{task.title}</strong><small>{axis.shortName} · {task.status === "completed" ? "已完成" : task.status === "active" ? "進行中" : "待執行"}</small></div><button aria-label={`編輯 ${task.title}`} onClick={() => onEdit(task)}><Pencil size={15} /></button></div>; })}{query && !results.length && <div className="empty-search">找不到相符紀錄</div>}</div></Modal>;
}

function AchievementToast({ task, interruptionCount, todayCompleted, todayFocus }: { task: Task; interruptionCount: number; todayCompleted: number; todayFocus: number }) {
  const axis = AXES.find((item) => item.id === task.axisId)!;
  return <div className="achievement-toast"><div className="confetti">✦</div><div className="trophy-ring"><Trophy /></div><p>今日 MVP 候選</p><h3>{task.title}</h3><div className="toast-stats"><span><Check size={15} />今日 {todayCompleted} 項</span><span><Clock3 size={15} />{humanMinutes(todayFocus)}</span><span style={{ color: axis.color }}>{axis.shortName}</span></div><small>{interruptionCount ? "卡住仍然完成，這一步很有份量。" : "成果已經留下紀錄，可以放心繼續下一步。"}</small></div>;
}

export default App;
