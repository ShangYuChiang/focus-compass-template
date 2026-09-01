import type { AxisId, Priority, Task } from "./types";
import { formatAcceptanceDefinition } from "./acceptance";

function withAcceptance(deliverable: string, evidence: string, quality: string) {
  return formatAcceptanceDefinition({ deliverable, evidence, quality });
}

export interface TaskPlanInput {
  title: string;
  definition: string;
  axisId: AxisId;
  projectId: string;
  priority: Priority;
  estimatedMinutes: number;
}

export interface TaskDraft {
  id: string;
  title: string;
  definition: string;
  firstAction: string;
  estimatedMinutes: number;
}

const axisDrafts: Record<AxisId, Array<(title: string) => Omit<TaskDraft, "id">>> = {
  career: [
    (title) => ({ title: `釐清需求與成果：${title}`, definition: withAcceptance(`列出目標對象、最終產物與交付項目，完成 ${title} 的第一版內容`, "需求訪談紀錄、產物草稿（連結）", "輸出結果可被他人快速理解目標邊界"), firstAction: "建立一頁任務簡報，先寫下目標對象與最終產物", estimatedMinutes: 25 }),
    (title) => ({ title: `完成核心版本：${title}`, definition: withAcceptance(`完成可執行的核心版本（能展示關鍵流程）`, "程式碼 Commit、Demo 影片或操作紀錄", "核心流程可由他人重現一次且不卡住"), firstAction: "建立成果檔案或專案骨架，先完成最核心的一段", estimatedMinutes: 25 }),
    (title) => ({ title: `整理證據並驗收：${title}`, definition: withAcceptance(`補齊驗收文件與結果，讓履歷可直接引用`, "README、結果輸出、演示鏈結、測試紀錄", "每個驗收項目皆有對應證據鏈結"), firstAction: "打開完成標準，逐項標記目前已具備與仍缺少的證據", estimatedMinutes: 25 }),
  ],
  research: [
    (title) => ({ title: `界定研究問題：${title}`, definition: withAcceptance(`完成一個可驗證的研究問題與邊界`, "研究備忘錄、假設與資料需求", "問題能被清楚重現為可追蹤的實驗"), firstAction: "建立研究筆記，先寫下一句可驗證的研究問題", estimatedMinutes: 25 }),
    (title) => ({ title: `完成核心分析：${title}`, definition: withAcceptance(`跑完一輪可重現分析並產出核心結果`, "實驗設定、主要結果圖表、原始輸出檔", "結果可複現，流程與參數有完整紀錄"), firstAction: "找到資料與最新實驗設定，建立本次分析紀錄", estimatedMinutes: 25 }),
    (title) => ({ title: `整理結論與證據：${title}`, definition: withAcceptance(`整理成可提交的結果與論點`, "結果表、限制列表、結論段落", "結論有對應證據並可被他人追問"), firstAction: "把主要指標整理成一張結果表", estimatedMinutes: 25 }),
  ],
  teaching: [
    (title) => ({ title: `定義學習成果：${title}`, definition: withAcceptance(`完成清楚的教學目標與學習成果`, "對象需求分析、課程地圖、學習指標", "三個可觀察成果可被學員達成並驗證"), firstAction: "建立教案文件，先寫下目標學員與使用情境", estimatedMinutes: 25 }),
    (title) => ({ title: `製作核心教材：${title}`, definition: withAcceptance(`做出可直接教學的一個完整教學段落`, "範例程式、操作步驟、錄影草稿", "學習者可依教材完成一次操作"), firstAction: "先製作最重要概念的一頁說明與一個範例", estimatedMinutes: 25 }),
    (title) => ({ title: `驗證並整理教案：${title}`, definition: withAcceptance(`完成可交付、可試教的教案版本`, "練習題答案、流程檢查清單、試教回饋", "每個步驟都可示範且時間可控"), firstAction: "以學習者角度走一次教材與練習", estimatedMinutes: 25 }),
  ],
  investing: [
    (title) => ({ title: `定義研究問題：${title}`, definition: withAcceptance(`形成可決策的研究主題與不投資條件`, "研究問題清單、資料來源、假設筆記", "研究問題能轉成可判斷的進出規則"), firstAction: "建立研究卡，先寫下要回答的三個投資問題", estimatedMinutes: 25 }),
    (title) => ({ title: `完成資料與分析：${title}`, definition: withAcceptance(`整理可追溯的資料並完成核心分析`, "財務/估值/回測資料與計算腳本", "關鍵指標計算可複現，輸出有日期版本"), firstAction: "打開第一個資料來源，記錄日期與核心數字", estimatedMinutes: 25 }),
    (title) => ({ title: `整理風險與結論：${title}`, definition: withAcceptance(`寫出清楚的多空論點與最終結論`, "多空條件表、風險清單、決策結果", "可直接放入研究卡並具備後續監控項目"), firstAction: "先列出三項可能使原假設失效的風險", estimatedMinutes: 25 }),
  ],
};

export function shouldSplitTask(estimatedMinutes: number) {
  return estimatedMinutes > 25;
}

export function generateTaskDrafts(input: TaskPlanInput, idFactory: () => string = () => crypto.randomUUID()): TaskDraft[] {
  if (!shouldSplitTask(input.estimatedMinutes)) {
    return [{
      id: idFactory(),
      title: input.title,
      definition: input.definition,
      firstAction: `打開與「${input.title}」最相關的檔案，先完成最小的一步`,
      estimatedMinutes: Math.max(5, input.estimatedMinutes),
    }];
  }
  return axisDrafts[input.axisId].map((build) => ({ id: idFactory(), ...build(input.title) }));
}

export function createTaskPlan(input: TaskPlanInput, drafts: TaskDraft[], idFactory: () => string = () => crypto.randomUUID(), now = new Date().toISOString()): Task[] {
  const validDrafts = drafts.filter((draft) => draft.title.trim() && draft.definition.trim());
  if (validDrafts.length <= 1) {
    const draft = validDrafts[0];
    if (!draft) return [];
    return [{
      id: idFactory(), axisId: input.axisId, projectId: input.projectId,
      title: draft.title.trim(), definition: draft.definition.trim(), firstAction: draft.firstAction.trim() || undefined,
      priority: input.priority, status: "pending", taskKind: "action", estimatedMinutes: Math.max(5, Math.round(draft.estimatedMinutes)),
      tags: [], createdAt: now, actualSeconds: 0, sessions: 0,
    }];
  }

  const parentId = idFactory();
  const parent: Task = {
    id: parentId, axisId: input.axisId, projectId: input.projectId,
    title: input.title.trim(), definition: input.definition.trim(), priority: input.priority,
    status: "pending", taskKind: "group", estimatedMinutes: Math.max(30, Math.round(input.estimatedMinutes)),
    tags: [], createdAt: now, actualSeconds: 0, sessions: 0,
  };
  const children = validDrafts.map((draft, index): Task => ({
    id: idFactory(), axisId: input.axisId, projectId: input.projectId, parentTaskId: parentId, childOrder: index + 1,
    title: draft.title.trim(), definition: draft.definition.trim(), firstAction: draft.firstAction.trim() || undefined,
    priority: input.priority, status: "pending", taskKind: "action", estimatedMinutes: Math.max(5, Math.min(25, Math.round(draft.estimatedMinutes))),
    tags: [], createdAt: new Date(Date.parse(now) + index + 1).toISOString(), actualSeconds: 0, sessions: 0,
  }));
  return [parent, ...children];
}

export function taskIsReady(task: Task, tasks: Task[]) {
  if (task.taskKind === "group") return false;
  if (!task.parentTaskId) return true;
  const order = task.childOrder ?? Number.MAX_SAFE_INTEGER;
  return !tasks.some((candidate) => candidate.parentTaskId === task.parentTaskId
    && (candidate.childOrder ?? Number.MAX_SAFE_INTEGER) < order
    && candidate.status !== "completed" && candidate.status !== "cancelled");
}

export function syncTaskGroups(tasks: Task[]) {
  return tasks.map((task) => {
    if (task.taskKind !== "group") return task;
    const children = tasks.filter((candidate) => candidate.parentTaskId === task.id && candidate.status !== "cancelled");
    const completed = children.length > 0 && children.every((child) => child.status === "completed");
    if (completed) {
      const completedAt = children.map((child) => child.completedAt).filter(Boolean).sort().at(-1);
      return { ...task, status: "completed" as const, completedAt };
    }
    if (task.status === "completed") return { ...task, status: "pending" as const, completedAt: undefined };
    return task;
  });
}
