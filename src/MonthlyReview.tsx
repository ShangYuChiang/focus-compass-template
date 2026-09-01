import { useMemo, useState } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, CirclePause, FolderKanban, Lightbulb, LineChart, Target, Trophy, X } from "lucide-react";
import { AXES } from "./seed";
import { compareMonths, defaultMonthlyHighlights, monthRangeFor, summarizeMonth } from "./monthly";
import type { AppState, AxisId, MonthlyProjectDecisionKind, MonthlyReview, ProjectStatus } from "./types";

const experimentSuggestions = [
  "每週只安排一個最重要成果",
  "先完成作品證據，再擴充功能",
  "月底前一週不再新增大型任務",
  "固定一個晚上整理本週知識資產",
];

function humanMinutes(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function comparisonDelta(label: string, delta: number, suffix: string) {
  if (delta === 0) return "持平";
  const sign = delta > 0 ? "+" : "−";
  const absolute = Math.abs(delta);
  if (label === "專注時間") return `${sign}${humanMinutes(absolute)}`;
  if (label === "超時比例") return `${sign}${Math.round(absolute * 100)}%`;
  return `${sign}${absolute}${suffix}`;
}

function axisOf(axisId: AxisId) {
  return AXES.find((axis) => axis.id === axisId)!;
}

function decisionForStatus(status: ProjectStatus): MonthlyProjectDecisionKind {
  if (status === "paused") return "pause";
  if (status === "completed") return "archive";
  if (status === "cancelled" || status === "archived") return "cancel";
  return "continue";
}

export interface MonthlyReviewResult {
  review: MonthlyReview;
  projectStatuses: Record<string, ProjectStatus>;
}

export function MonthlyReviewWizard({ state, onSave, onClose }: {
  state: AppState;
  onSave: (result: MonthlyReviewResult) => void;
  onClose: () => void;
}) {
  const range = useMemo(() => monthRangeFor(), []);
  const summary = useMemo(() => summarizeMonth(state, range), [state, range]);
  const comparison = useMemo(() => compareMonths(state, range), [state, range]);
  const existing = state.monthlyReviews.find((item) => item.monthStart === range.start);
  const reviewedProjectIds = new Set(existing?.projectDecisions.map((item) => item.projectId) ?? []);
  const projects = state.projects.filter((project) => (project.status !== "archived" && project.status !== "cancelled") || reviewedProjectIds.has(project.id));

  const [step, setStep] = useState(0);
  const [highlights, setHighlights] = useState(existing?.highlights ?? defaultMonthlyHighlights(summary));
  const [decisions, setDecisions] = useState<Record<string, MonthlyProjectDecisionKind>>(() => Object.fromEntries(projects.map((project) => [
    project.id,
    existing?.projectDecisions.find((item) => item.projectId === project.id)?.decision ?? decisionForStatus(project.status),
  ])));
  const [priorityAxisId, setPriorityAxisId] = useState<AxisId | null>(existing?.priorityAxisId ?? null);
  const [outcomes, setOutcomes] = useState<string[]>(() => Array.from({ length: 3 }, (_, index) => existing?.outcomes[index] ?? ""));
  const [goals, setGoals] = useState<Partial<Record<AxisId, string>>>(existing?.monthlyGoals ?? {});
  const [experiment, setExperiment] = useState(existing?.experiment ?? "");

  function toggleHighlight(taskId: string) {
    setHighlights((previous) => previous.includes(taskId)
      ? previous.filter((id) => id !== taskId)
      : previous.length >= 3 ? previous : [...previous, taskId]);
  }

  function save() {
    if (!priorityAxisId || outcomes.some((item) => !item.trim())) return;
    const projectStatuses: Record<string, ProjectStatus> = {};
    const projectDecisions = projects.map((project) => {
      const decision = decisions[project.id] ?? "continue";
      projectStatuses[project.id] = decision === "continue" ? "active" : decision === "pause" ? "paused" : decision === "archive" ? "archived" : "cancelled";
      return { projectId: project.id, decision };
    });
    onSave({
      review: {
        monthStart: range.start,
        monthEnd: range.end,
        highlights,
        projectDecisions,
        priorityAxisId,
        outcomes: outcomes.map((item) => item.trim()),
        monthlyGoals: goals,
        experiment: experiment.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
      projectStatuses,
    });
  }

  const steps = ["本月成果", "趨勢比較", "專案決策", "下月規劃"];
  const canSave = Boolean(priorityAxisId) && outcomes.every((item) => item.trim());

  return <div className="modal-backdrop"><div className="modal wide weekly-modal monthly-modal">
    <button className="modal-close" onClick={onClose}><X size={18} /></button>
    <div className="weekly-header"><div className="modal-icon rose"><LineChart /></div><div><p className="eyebrow">每月復盤 · {range.start.slice(0, 7)}</p><h2>{steps[step]}</h2></div></div>
    <div className="weekly-steps">{steps.map((label, index) => <span key={label} className={index === step ? "active" : index < step ? "done" : ""}>{label}</span>)}</div>
    <div className="weekly-body">
      {step === 0 && <ResultStep summary={summary} highlights={highlights} onToggle={toggleHighlight} />}
      {step === 1 && <ComparisonStep comparison={comparison} />}
      {step === 2 && <ProjectStep projects={projects} decisions={decisions} onDecide={(id, decision) => setDecisions((previous) => ({ ...previous, [id]: decision }))} />}
      {step === 3 && <NextMonthStep outcomes={outcomes} setOutcomes={setOutcomes} goals={goals} setGoals={setGoals} priorityAxisId={priorityAxisId} setPriorityAxisId={setPriorityAxisId} experiment={experiment} setExperiment={setExperiment} />}
    </div>
    <div className="weekly-actions">{step > 0 ? <button className="secondary-button" onClick={() => setStep(step - 1)}><ChevronLeft size={18} />上一步</button> : <span />}{step < 3 ? <button className="primary-button" onClick={() => setStep(step + 1)}>下一步<ChevronRight size={18} /></button> : <button className="primary-button" disabled={!canSave} onClick={save}><Check size={18} />完成月復盤</button>}</div>
    {step === 3 && !canSave && <p className="weekly-hint">填好下月三個主要成果，並選一個第一優先主軸。</p>}
  </div></div>;
}

function ResultStep({ summary, highlights, onToggle }: { summary: ReturnType<typeof summarizeMonth>; highlights: string[]; onToggle: (id: string) => void }) {
  return <>
    <div className="weekly-stat-row"><div><strong>{summary.completedCount}</strong><span>完成任務</span></div><div><strong>{humanMinutes(summary.focusedSeconds)}</strong><span>專注時間</span></div><div><strong>{summary.sessionCount}</strong><span>番茄鐘段數</span></div><div><strong>{Math.round(summary.overtimeRatio * 100)}%</strong><span>超時比例</span></div></div>
    {summary.isEmpty ? <div className="weekly-empty"><Trophy size={30} /><h3>這個月沒有留下紀錄</h3><p>休息或忙於系統外的事情都算真實生活。下一步仍可以直接替下個月選三個成果。</p></div> : <>
      <section className="weekly-section"><h3>四個主軸成果與投入</h3><div className="horizontal-bars">{summary.axisShares.map((item) => { const axis = axisOf(item.axisId); return <div key={item.axisId}><div className="bar-label"><span>{axis.name} · 完成 {item.completedCount}</span><strong>{humanMinutes(item.seconds)}　{Math.round(item.share * 100)}%</strong></div><div className="bar-track"><span style={{ width: `${item.share * 100}%`, background: axis.color }} /></div></div>; })}</div></section>
      {summary.completedTasks.length > 0 && <section className="weekly-section"><h3>三個代表成果</h3><p className="weekly-note">有成果證據的任務會優先。最多選三個。</p><div className="highlight-list">{summary.completedTasks.map((task) => <button key={task.id} className={highlights.includes(task.id) ? "selected" : ""} onClick={() => onToggle(task.id)} style={{ "--axis": axisOf(task.axisId).color } as React.CSSProperties}><Trophy size={16} /><span><strong>{task.title}</strong><small>{axisOf(task.axisId).shortName}{task.evidence ? " · 有成果證據" : ""}</small></span></button>)}</div></section>}
    </>}
  </>;
}

function ComparisonStep({ comparison }: { comparison: ReturnType<typeof compareMonths> }) {
  const rows = [
    { label: "完成任務", current: String(comparison.current.completedCount), previous: String(comparison.previous.completedCount), delta: comparison.completedDelta, suffix: " 項" },
    { label: "專注時間", current: humanMinutes(comparison.current.focusedSeconds), previous: humanMinutes(comparison.previous.focusedSeconds), delta: comparison.focusedSecondsDelta, suffix: "" },
    { label: "超時比例", current: `${Math.round(comparison.current.overtimeRatio * 100)}%`, previous: `${Math.round(comparison.previous.overtimeRatio * 100)}%`, delta: comparison.overtimeRatioDelta, suffix: "" },
  ];
  return <><section className="weekly-section"><h3>和上個月相比</h3><div className="comparison-grid">{rows.map((row) => { const better = row.label === "超時比例" ? row.delta < 0 : row.delta > 0; return <article key={row.label}><span>{row.label}</span><strong>{row.current}</strong><small>上月 {row.previous}</small><em className={row.delta === 0 ? "flat" : better ? "up" : "down"}>{comparisonDelta(row.label, row.delta, row.suffix)}</em></article>; })}</div></section>
    <section className="weekly-section"><h3>精力觀察</h3><p className="weekly-note">{comparison.current.averageEnergy === null ? "本月沒有精力紀錄。" : `本月平均精力 ${comparison.current.averageEnergy.toFixed(1)} / 5。`}{comparison.previous.averageEnergy !== null && ` 上月是 ${comparison.previous.averageEnergy.toFixed(1)} / 5。`}</p></section></>;
}

function ProjectStep({ projects, decisions, onDecide }: { projects: AppState["projects"]; decisions: Record<string, MonthlyProjectDecisionKind>; onDecide: (id: string, decision: MonthlyProjectDecisionKind) => void }) {
  if (!projects.length) return <div className="weekly-empty"><FolderKanban size={30} /><h3>目前沒有進行中的專案</h3><p>可以直接前往下月規劃。</p></div>;
  return <section className="weekly-section"><h3>每個專案下一步怎麼走？</h3><p className="weekly-note">「完成並封存」會保留全部任務與紀錄，只從日常推薦中收起來。</p><div className="project-decision-grid">{projects.map((project) => <article key={project.id} style={{ "--axis": axisOf(project.axisId).color } as React.CSSProperties}><div><strong>{project.name}</strong><small>{axisOf(project.axisId).shortName} · {project.milestone}</small></div><div className="decision-buttons"><button className={decisions[project.id] === "continue" ? "selected" : ""} onClick={() => onDecide(project.id, "continue")}><Target size={14} />繼續</button><button className={decisions[project.id] === "pause" ? "selected" : ""} onClick={() => onDecide(project.id, "pause")}><CirclePause size={14} />暫停</button><button className={decisions[project.id] === "cancel" ? "selected" : ""} onClick={() => onDecide(project.id, "cancel")}><X size={14} />取消</button><button className={decisions[project.id] === "archive" ? "selected" : ""} onClick={() => onDecide(project.id, "archive")}><Archive size={14} />完成並封存</button></div></article>)}</div></section>;
}

function NextMonthStep({ outcomes, setOutcomes, goals, setGoals, priorityAxisId, setPriorityAxisId, experiment, setExperiment }: {
  outcomes: string[]; setOutcomes: React.Dispatch<React.SetStateAction<string[]>>;
  goals: Partial<Record<AxisId, string>>; setGoals: React.Dispatch<React.SetStateAction<Partial<Record<AxisId, string>>>>;
  priorityAxisId: AxisId | null; setPriorityAxisId: (id: AxisId) => void;
  experiment: string; setExperiment: (value: string) => void;
}) {
  return <>
    <section className="weekly-section"><h3>下月三個主要成果<em className="required">必填</em></h3><div className="outcome-list">{outcomes.map((outcome, index) => <label key={index}><span>{index + 1}</span><input value={outcome} onChange={(event) => setOutcomes((previous) => previous.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={index === 0 ? "例如：完成作品集第一版並邀請 3 人回饋" : "一個月底能看見的成果"} /></label>)}</div></section>
    <section className="weekly-section"><h3>四個主軸月度目標</h3><p className="weekly-note">每個主軸一句，暫時不推進可留白。</p><div className="goal-grid">{AXES.map((axis) => <label key={axis.id} style={{ "--axis": axis.color } as React.CSSProperties}><span>{axis.shortName}</span><input value={goals[axis.id] ?? ""} onChange={(event) => setGoals((previous) => ({ ...previous, [axis.id]: event.target.value }))} placeholder="下月底想看見什麼？" /></label>)}</div></section>
    <section className="weekly-section"><h3>下月第一優先主軸<em className="required">必填</em></h3><div className="axis-choice">{AXES.map((axis) => <button key={axis.id} className={priorityAxisId === axis.id ? "selected" : ""} style={{ "--axis": axis.color } as React.CSSProperties} onClick={() => setPriorityAxisId(axis.id)}>{axis.shortName}</button>)}</div></section>
    <section className="weekly-section"><h3>一個系統改善實驗</h3><div className="reason-list compact">{experimentSuggestions.map((item) => <button key={item} className={experiment === item ? "selected" : ""} onClick={() => setExperiment(item)}><Lightbulb size={15} />{item}</button>)}</div><input className="full-input" value={experiment} onChange={(event) => setExperiment(event.target.value)} placeholder="或自己寫一個" /></section>
  </>;
}
