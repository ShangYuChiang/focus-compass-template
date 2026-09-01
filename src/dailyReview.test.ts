import { describe, expect, it } from "vitest";
import { createInitialState } from "./seed";
import { dailyReviewDisplay, dailyReviewExportFiles, dailyReviewMarkdown, dailyReviewsCsv, dailyReviewsJson, dailyReviewsMarkdown, summarizeDailyReviewDay } from "./dailyReview";
import type { AppState, DailyReview, Task } from "./types";

function stateWithTask(): AppState {
  const state = createInitialState();
  const task: Task = {
    id: "task-portfolio",
    axisId: "career",
    projectId: "project-portfolio",
    title: "完成作品集首頁",
    definition: "首頁可以在本機開啟。",
    priority: "medium",
    status: "pending",
    tags: [],
    createdAt: "2026-08-19T00:00:00.000Z",
    actualSeconds: 0,
    sessions: 0,
  };
  return { ...state, tasks: [task] };
}

function review(): DailyReview {
  return {
    date: "2026-08-19",
    mvpTaskId: "task-portfolio",
    mvpTitle: "完成作品集首頁",
    tomorrowAxisId: "research",
    plotTwist: "一開始不想做，最後仍完成",
    gratitude: "感謝自己仍然開始了。",
    completedCount: 2,
    focusedSeconds: 2700,
    overtimeCount: 1,
  };
}

describe("daily review card", () => {
  it("使用產卡快照，不會被日後任務改名影響", () => {
    const state = stateWithTask();
    state.tasks[0].title = "後來修改的名稱";
    expect(dailyReviewDisplay(review(), state).mvpTitle).toBe("完成作品集首頁");
  });

  it("Markdown 包含統計、劇情、明日種子與感謝日記", () => {
    const markdown = dailyReviewMarkdown(review(), createInitialState());
    expect(markdown).toContain("專注時間：45 分鐘");
    expect(markdown).toContain("一開始不想做，最後仍完成");
    expect(markdown).toContain("研究與論文投稿");
    expect(markdown).toContain("感謝自己仍然開始了。");
  });

  it("舊收工卡沒有快照時會由現有資料補出統計", () => {
    const state = stateWithTask();
    state.sessions = [{
      id: "s1", taskId: "task-portfolio", axisId: "career", startedAt: "2026-08-19T10:00:00",
      focusedSeconds: 1500, pausedSeconds: 0, overtimeSeconds: 0, completed: true, interruptions: [],
    }];
    state.tasks[0] = { ...state.tasks[0], status: "completed", completedAt: "2026-08-19T10:25:00" };
    const oldReview: DailyReview = { date: "2026-08-19", mvpTaskId: "task-portfolio", tomorrowAxisId: "career" };
    expect(summarizeDailyReviewDay(state, oldReview.date).focusedSeconds).toBe(1500);
    expect(dailyReviewDisplay(oldReview, state).completedCount).toBe(1);
  });

  it("CSV 一日一列並同時保留秒數與分鐘數，方便視覺化", () => {
    const csv = dailyReviewsCsv([review()], createInitialState());
    expect(csv.startsWith("\uFEFFdate,completed_count,focused_seconds,focused_minutes")).toBe(true);
    expect(csv).toContain('"2026-08-19","2","2700","45","1"');
    expect(csv).toContain('"研究與論文投稿"');
  });

  it("JSON 使用有版本的結構化框架，保留統計與反思資料", () => {
    const payload = JSON.parse(dailyReviewsJson([review()], createInitialState()));
    expect(payload.schemaVersion).toBe(1);
    expect(payload.type).toBe("bubu-daily-review-export");
    expect(payload.cards[0].metrics.focusedSeconds).toBe(2700);
    expect(payload.cards[0].reflection.gratitude).toBe("感謝自己仍然開始了。");
  });

  it("批次 Markdown 依日期由舊到新排列", () => {
    const later = { ...review(), date: "2026-08-20", gratitude: "感謝明天。" };
    const markdown = dailyReviewsMarkdown([later, review()], createInitialState());
    expect(markdown.indexOf("## 2026-08-19")).toBeLessThan(markdown.indexOf("## 2026-08-20"));
    expect(markdown).toContain("共 2 張收工卡");
  });

  it("完整匯出會同時建立 CSV、JSON 與 Markdown 三個檔案", () => {
    const files = dailyReviewExportFiles([review()], createInitialState());
    expect(files.map((file) => file.extension)).toEqual(["csv", "json", "md"]);
    expect(files.every((file) => file.fileName.includes("2026-08-19"))).toBe(true);
  });
});
