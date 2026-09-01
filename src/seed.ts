import type { AppState, Axis, AxisId } from "./types";

const DEFAULT_AXES: Axis[] = [
  {
    id: "career",
    name: "AI 能力、作品與職涯",
    shortName: "AI 與職涯",
    description: "求職、AI 工具、程式能力與 Side Project",
    color: "#2878d0",
    softColor: "#e7f1fb",
  },
  {
    id: "research",
    name: "研究與論文投稿",
    shortName: "研究投稿",
    description: "文獻、實驗、結果分析與論文投稿",
    color: "#7656b7",
    softColor: "#f0ebf9",
  },
  {
    id: "teaching",
    name: "教學內容與課程資產",
    shortName: "教學資產",
    description: "課綱、教案、實作範例與批改系統",
    color: "#d97631",
    softColor: "#fbefe5",
  },
  {
    id: "investing",
    name: "股票研究與投資系統",
    shortName: "投資系統",
    description: "財報、公司研究、模型回測與決策復盤",
    color: "#d45c87",
    softColor: "#fbeaf0",
  },
];

export const AXES: Axis[] = DEFAULT_AXES.map((axis) => ({ ...axis }));

export const DEFAULT_AXIS_NAMES = Object.fromEntries(
  DEFAULT_AXES.map((axis) => [axis.id, axis.name]),
) as Record<AxisId, string>;

/**
 * 套用儲存在 AppState 的顯示名稱。主軸 ID、色彩與資料關聯保持不變。
 * AXES 是跨畫面共用的目錄，因此設定後所有任務、復盤與統計會使用同一名稱。
 */
export function configureAxisNames(overrides: Partial<Record<AxisId, string>> = {}) {
  AXES.forEach((axis, index) => {
    const defaults = DEFAULT_AXES[index];
    const customName = overrides[axis.id]?.trim();
    axis.name = customName || defaults.name;
    axis.shortName = customName || defaults.shortName;
  });
  return AXES;
}

export function createInitialState(): AppState {
  const now = new Date().toISOString();
  return {
    version: 6,
    axisNames: {},
    // 公開模板不預載任何個人專案或任務；第一次新增任務時即可建立自己的專案。
    projects: [],
    tasks: [],
    sessions: [],
    checkins: [],
    reviews: [],
    weeklyReviews: [],
    monthlyReviews: [],
    backups: [],
    timer: {
      taskId: null,
      status: "idle",
      startedAt: null,
      accumulatedSeconds: 0,
      pausedSeconds: 0,
      pauseStartedAt: null,
      breakEndsAt: null,
      interruptions: [],
    },
    customPauseReasons: [],
    theme: "system",
    soundEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
