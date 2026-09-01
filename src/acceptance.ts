import type { AxisId } from "./types";

export interface AcceptanceDefinition {
  deliverable: string;
  evidence: string;
  quality: string;
}

const DELIVERY_LABELS = ["交付成果", "可驗證結果", "產出"];
const EVIDENCE_LABELS = ["驗收證據", "證據", "成果連結"];
const QUALITY_LABELS = ["品質門檻", "品質標準", "達成標準"];

const EMPTY_ACCEPTANCE: AcceptanceDefinition = { deliverable: "", evidence: "", quality: "" };

function pickLabelValue(line: string, labels: string[]) {
  const normalized = line.trim();
  for (const label of labels) {
    if (!normalized.startsWith(`${label}：`) && !normalized.startsWith(`${label}:`)) continue;
    return normalized.replace(new RegExp(`^${label}[：:]`), "").trim();
  }
  return "";
}

export function parseAcceptanceDefinition(value: string): AcceptanceDefinition {
  if (!value) return EMPTY_ACCEPTANCE;

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return EMPTY_ACCEPTANCE;

  const parsed: AcceptanceDefinition = { ...EMPTY_ACCEPTANCE };
  for (const line of lines) {
    const match = line.match(/^(.*?)[：:]\s*(.*)$/);
    if (!match) continue;
    const [, rawLabel, rest] = match;
    if (pickLabelValue(rawLabel, DELIVERY_LABELS) || DELIVERY_LABELS.some((item) => rawLabel.startsWith(item))) {
      parsed.deliverable = rest;
      continue;
    }
    if (pickLabelValue(rawLabel, EVIDENCE_LABELS) || EVIDENCE_LABELS.some((item) => rawLabel.startsWith(item))) {
      parsed.evidence = rest;
      continue;
    }
    if (pickLabelValue(rawLabel, QUALITY_LABELS) || QUALITY_LABELS.some((item) => rawLabel.startsWith(item))) {
      parsed.quality = rest;
      continue;
    }
  }

  const [firstLine, ...restLines] = lines;
  if (!parsed.deliverable && !parsed.evidence && !parsed.quality) {
    parsed.deliverable = firstLine;
    parsed.evidence = restLines.slice(0, 2).join("；");
  }

  return parsed;
}

export function formatAcceptanceDefinition(values: AcceptanceDefinition): string {
  const deliverable = values.deliverable.trim() || "請填入本步驟完成的核心產物";
  const evidence = values.evidence.trim() || "請填入可留下證據的位置";
  const quality = values.quality.trim() || "請填入合格門檻（可量化）";
  return `交付成果：${deliverable}\n驗收證據：${evidence}\n品質門檻：${quality}`;
}

export function isAcceptanceComplete(values: AcceptanceDefinition) {
  return Boolean(values.deliverable.trim() && values.evidence.trim() && values.quality.trim());
}

export const ACCEPTANCE_FIELD_LABELS = {
  deliverable: "交付成果",
  evidence: "驗收證據",
  quality: "品質門檻",
};

export function buildQuickAcceptanceTemplate(axisId: AxisId, title: string): AcceptanceDefinition {
  const taskLabel = title.trim() || "此任務";
  switch (axisId) {
    case "career":
      return {
        deliverable: `完成可直接放進履歷/作品集的「${taskLabel}」成果`,
        evidence: "GitHub 連結、README、Demo、面試可分享的解釋筆記",
        quality: "成果可被面試官在 5 分鐘內看懂流程與設計思路",
      };
    case "research":
      return {
        deliverable: `完成「${taskLabel}」的研究筆記與可複現結果`,
        evidence: "實驗設定、原始結果、結果輸出表（含日期）",
        quality: "流程可重現，關鍵結論都有證據可追溯",
      };
    case "teaching":
      return {
        deliverable: `完成「${taskLabel}」的可直接教學教案與實作步驟`,
        evidence: "教材、範例程式、學生可執行的作業與答案",
        quality: "學員照著操作可完成一次完整流程，不超過預估時間",
      };
    case "investing":
      return {
        deliverable: `完成「${taskLabel}」的投資研究決策卡`,
        evidence: "資料來源、計算依據、回測/紀錄檔、更新版日期",
        quality: "觀察依據完整，並有進出場與停損/停利規則",
      };
    default:
      return {
        deliverable: `完成「${taskLabel}」的交付成果`,
        evidence: "可驗證的連結或檔案",
        quality: "交付內容完整、可重複驗證且可查閱",
      };
  }
}
