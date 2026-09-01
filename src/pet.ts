import { parseAcceptanceDefinition } from "./acceptance";
import type { Task } from "./types";

export interface PetReward {
  points: number;
  basePoints: number;
  acceptanceBonus: number;
  firstActionBonus: number;
  evidenceBonus: number;
}

export interface PetStage {
  minPoints: number;
  name: string;
  unlock: string;
  message: string;
}

export const PET_STAGES: PetStage[] = [
  { minPoints: 0, name: "剛見面的毛球", unlock: "布偶貓入住", message: "今天做一小步，我就陪你長一點。" },
  { minPoints: 25, name: "奶油瀏海", unlock: "餵食與新髮型", message: "我開始認得你的工作節奏了。" },
  { minPoints: 100, name: "藍莓學者", unlock: "學者服裝", message: "你的作品正在一件一件留下來。" },
  { minPoints: 200, name: "雙貓研究室", unlock: "第二隻夥伴與進階情緒", message: "長期累積，已經變成看得見的世界。" },
];

/**
 * 每個完成的小任務至少 5 點；把工作定義與成果證據寫清楚，最高可得 10 點。
 * 分數由已儲存任務推導，因此備份／還原後仍會一致，也不需要額外維護重複點數。
 */
export function petRewardForTask(task: Task): PetReward {
  if (task.taskKind === "group" || task.status !== "completed") {
    return { points: 0, basePoints: 0, acceptanceBonus: 0, firstActionBonus: 0, evidenceBonus: 0 };
  }

  const acceptance = parseAcceptanceDefinition(task.definition);
  const acceptanceBonus = acceptance.deliverable.trim() && acceptance.evidence.trim() && acceptance.quality.trim() ? 3 : 0;
  const firstActionBonus = task.firstAction?.trim() ? 1 : 0;
  const evidenceBonus = task.evidence?.trim() ? 1 : 0;
  const basePoints = 5;

  return {
    points: basePoints + acceptanceBonus + firstActionBonus + evidenceBonus,
    basePoints,
    acceptanceBonus,
    firstActionBonus,
    evidenceBonus,
  };
}

export function petStageForPoints(points: number) {
  return [...PET_STAGES].reverse().find((stage) => points >= stage.minPoints) ?? PET_STAGES[0];
}

export function nextPetStage(points: number) {
  return PET_STAGES.find((stage) => stage.minPoints > points);
}

export function petProgress(tasks: Task[]) {
  const completedTasks = tasks
    .filter((task) => task.taskKind !== "group" && task.status === "completed")
    .map((task) => ({ task, reward: petRewardForTask(task) }))
    .sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? ""));
  const points = completedTasks.reduce((sum, item) => sum + item.reward.points, 0);
  const qualityCount = completedTasks.filter((item) => item.reward.points === 10).length;

  return {
    points,
    completedCount: completedTasks.length,
    qualityCount,
    stage: petStageForPoints(points),
    nextStage: nextPetStage(points),
    entries: completedTasks,
  };
}
