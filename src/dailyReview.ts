import { AXES } from "./seed";
import { workdayDate } from "./domain";
import type { AppState, DailyReview } from "./types";

export interface DailyReviewStats {
  completedCount: number;
  focusedSeconds: number;
  overtimeCount: number;
}

export type DailyReviewExportFormat = "all" | "csv" | "json" | "markdown";
type SingleDailyReviewExportFormat = Exclude<DailyReviewExportFormat, "all">;
const REVIEW_EXPORT_FORMATS: SingleDailyReviewExportFormat[] = ["csv", "json", "markdown"];

export function summarizeDailyReviewDay(state: AppState, date: string): DailyReviewStats {
  const sessions = state.sessions.filter((session) => workdayDate(new Date(session.startedAt)) === date);
  const completedCount = state.tasks.filter((task) => task.taskKind !== "group" && task.status === "completed" && task.completedAt
    && workdayDate(new Date(task.completedAt)) === date).length;
  return {
    completedCount,
    focusedSeconds: sessions.reduce((total, session) => total + session.focusedSeconds, 0),
    overtimeCount: sessions.filter((session) => session.overtimeSeconds > 0).length,
  };
}

export function dailyReviewDisplay(review: DailyReview, state: AppState) {
  const liveStats = summarizeDailyReviewDay(state, review.date);
  return {
    mvpTitle: review.mvpTitle ?? state.tasks.find((task) => task.id === review.mvpTaskId)?.title ?? "未命名成果",
    tomorrowAxis: AXES.find((axis) => axis.id === review.tomorrowAxisId)?.name ?? review.tomorrowAxisId,
    completedCount: review.completedCount ?? liveStats.completedCount,
    focusedSeconds: review.focusedSeconds ?? liveStats.focusedSeconds,
    overtimeCount: review.overtimeCount ?? liveStats.overtimeCount,
  };
}

function humanMinutes(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

export function dailyReviewMarkdown(review: DailyReview, state: AppState) {
  const display = dailyReviewDisplay(review, state);
  return `# 步步｜${review.date} 今日收工卡

## 今日結算

- 完成任務：${display.completedCount} 項
- 專注時間：${humanMinutes(display.focusedSeconds)}
- 超時工作段：${display.overtimeCount} 段

## 今日 MVP

${display.mvpTitle}

## 今天的劇情轉折

${review.plotTwist || "今天進行順利"}

## 明日種子

${display.tomorrowAxis}

## 感謝日記

${review.gratitude?.trim() || "（今天尚未填寫）"}
`;
}

function sortedReviews(reviews: DailyReview[]) {
  return [...reviews].sort((a, b) => a.date.localeCompare(b.date));
}

function csvCell(value: string | number | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * 一列代表一天，保留原始秒數與方便試算表使用的分鐘數。
 * 這是後續 Excel、Power BI、Tableau、Python 畫趨勢圖的建議格式。
 */
export function dailyReviewsCsv(reviews: DailyReview[], state: AppState) {
  const header = [
    "date", "completed_count", "focused_seconds", "focused_minutes", "overtime_count",
    "mvp_task_id", "mvp_title", "plot_twist", "tomorrow_axis_id", "tomorrow_axis",
    "gratitude", "created_at", "updated_at",
  ];
  const rows = sortedReviews(reviews).map((review) => {
    const display = dailyReviewDisplay(review, state);
    return [
      review.date,
      display.completedCount,
      display.focusedSeconds,
      Number((display.focusedSeconds / 60).toFixed(2)),
      display.overtimeCount,
      review.mvpTaskId,
      display.mvpTitle,
      review.plotTwist ?? "今天進行順利",
      review.tomorrowAxisId,
      display.tomorrowAxis,
      review.gratitude ?? "",
      review.createdAt,
      review.updatedAt,
    ].map(csvCell).join(",");
  });
  // BOM 讓 Windows Excel 可直接正確辨識繁體中文 UTF-8。
  return `\uFEFF${header.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

export function dailyReviewsJson(reviews: DailyReview[], state: AppState) {
  const cards = sortedReviews(reviews).map((review) => {
    const display = dailyReviewDisplay(review, state);
    return {
      date: review.date,
      metrics: {
        completedCount: display.completedCount,
        focusedSeconds: display.focusedSeconds,
        focusedMinutes: Number((display.focusedSeconds / 60).toFixed(2)),
        overtimeCount: display.overtimeCount,
      },
      mvp: { taskId: review.mvpTaskId, title: display.mvpTitle },
      reflection: {
        plotTwist: review.plotTwist ?? "今天進行順利",
        gratitude: review.gratitude ?? "",
      },
      nextDay: { axisId: review.tomorrowAxisId, axisName: display.tomorrowAxis },
      createdAt: review.createdAt ?? null,
      updatedAt: review.updatedAt ?? null,
    };
  });
  return JSON.stringify({
    schemaVersion: 1,
    type: "bubu-daily-review-export",
    exportedAt: new Date().toISOString(),
    cardCount: cards.length,
    cards,
  }, null, 2);
}

export function dailyReviewsMarkdown(reviews: DailyReview[], state: AppState) {
  const cards = sortedReviews(reviews);
  const sections = cards.map((review) => {
    const display = dailyReviewDisplay(review, state);
    return `## ${review.date}\n\n- 完成任務：${display.completedCount} 項\n- 專注時間：${humanMinutes(display.focusedSeconds)}\n- 超時工作段：${display.overtimeCount} 段\n- 今日 MVP：${display.mvpTitle}\n- 劇情轉折：${review.plotTwist || "今天進行順利"}\n- 明日種子：${display.tomorrowAxis}\n\n### 感謝日記\n\n${review.gratitude?.trim() || "（這天尚未填寫）"}`;
  });
  return `# 步步｜今日收工卡匯出\n\n共 ${cards.length} 張收工卡，依日期由舊到新排列。\n\n${sections.join("\n\n---\n\n")}\n`;
}

function exportPayload(reviews: DailyReview[], state: AppState, format: SingleDailyReviewExportFormat) {
  if (format === "csv") return { contents: dailyReviewsCsv(reviews, state), extension: "csv", mime: "text/csv;charset=utf-8" };
  if (format === "json") return { contents: dailyReviewsJson(reviews, state), extension: "json", mime: "application/json;charset=utf-8" };
  return { contents: reviews.length === 1 ? dailyReviewMarkdown(reviews[0], state) : dailyReviewsMarkdown(reviews, state), extension: "md", mime: "text/markdown;charset=utf-8" };
}

function exportFileName(reviews: DailyReview[], extension: string) {
  const dates = sortedReviews(reviews).map((review) => review.date);
  if (dates.length === 1) return `步步-今日收工卡-${dates[0]}.${extension}`;
  return `步步-收工卡-${dates[0]}_至_${dates.at(-1)}.${extension}`;
}

export function dailyReviewExportFiles(reviews: DailyReview[], state: AppState, formats: SingleDailyReviewExportFormat[] = REVIEW_EXPORT_FORMATS) {
  return formats.map((format) => {
    const payload = exportPayload(reviews, state, format);
    return { ...payload, fileName: exportFileName(reviews, payload.extension) };
  });
}

function downloadPayloadInBrowser(file: ReturnType<typeof dailyReviewExportFiles>[number]) {
  const blob = new Blob([file.contents], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportDailyReviews(reviews: DailyReview[], state: AppState, format: DailyReviewExportFormat): Promise<boolean> {
  if (!reviews.length) return false;

  if (format === "all") {
    const files = dailyReviewExportFiles(reviews, state);
    if (isTauri()) {
      const [{ invoke }, { open }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/plugin-dialog"),
      ]);
      const selected = await open({ directory: true, multiple: false, title: "選擇三種收工卡格式的儲存資料夾" });
      if (typeof selected !== "string") return false;
      await invoke("write_review_export_bundle", {
        folder: selected,
        files: files.map((file) => ({ fileName: file.fileName, contents: file.contents })),
      });
      return true;
    }
    files.forEach(downloadPayloadInBrowser);
    return true;
  }

  const file = dailyReviewExportFiles(reviews, state, [format])[0];

  if (isTauri()) {
    const [{ invoke }, { save }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/plugin-dialog"),
    ]);
    const selected = await save({
      title: "匯出今日收工卡",
      defaultPath: file.fileName,
      filters: [{ name: format === "csv" ? "CSV 資料表" : format === "json" ? "JSON 結構化資料" : "Markdown 閱讀版", extensions: [file.extension] }],
    });
    if (!selected) return false;
    await invoke("write_review_export", { path: selected, contents: file.contents });
    return true;
  }

  downloadPayloadInBrowser(file);
  return true;
}

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function downloadDailyReviewCard(review: DailyReview, state: AppState): Promise<boolean> {
  return exportDailyReviews([review], state, "markdown");
}
