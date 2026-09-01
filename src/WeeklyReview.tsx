import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Flame, Lightbulb, Scissors, Target, TimerReset, Trophy, X } from "lucide-react";
import { AXES } from "./seed";
import { analyzeWeek, defaultHighlights, pendingDecisionTasks, summarizeWeek, weekRangeFor } from "./weekly";
import type { AppState, AxisId, Task, TaskDecision, TaskDecisionKind, WeeklyReview } from "./types";

const experimentSuggestions = [
  "把任務再寫小一點，25 分鐘一定做得完",
  "固定在最高產時段開始第一個任務",
  "開始前先寫下第一步要碰的檔案",
  "被中斷時先記一行再離開",
];

function humanMinutes(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function axisOf(axisId: AxisId) {
  return AXES.find((axis) => axis.id === axisId)!;
}

export interface WeeklyReviewResult {
  review: WeeklyReview;
  /** 拆小時要新增的任務 */
  newTasks: Task[];
  /** 要標為已取消的任務 id */
  cancelledTaskIds: string[];
}

export function WeeklyReviewWizard({ state, onSave, onClose }: {
  state: AppState;
  onSave: (result: WeeklyReviewResult) => void;
  onClose: () => void;
}) {
  const range = useMemo(() => weekRangeFor(), []);
  const summary = useMemo(() => summarizeWeek(state, range), [state, range]);
  const analysis = useMemo(() => analyzeWeek(state, range), [state, range]);
  const decisionTasks = useMemo(() => pendingDecisionTasks(state, range), [state, range]);
  const existing = state.weeklyReviews.find((item) => item.weekStart === range.start);

  const [step, setStep] = useState(0);
  const [highlights, setHighlights] = useState<string[]>(existing?.highlights ?? defaultHighlights(summary));
  const [goals, setGoals] = useState<Partial<Record<AxisId, string>>>(existing?.weeklyGoals ?? {});
  const [priorityAxisId, setPriorityAxisId] = useState<AxisId | null>(existing?.priorityAxisId ?? null);
  const [experiment, setExperiment] = useState(existing?.experiment ?? "");
  const [decisions, setDecisions] = useState<Record<string, TaskDecisionKind>>({});
  const [splitDrafts, setSplitDrafts] = useState<Record<string, { title: string; definition: string }>>({});

  function toggleHighlight(taskId: string) {
    setHighlights((previous) => previous.includes(taskId)
      ? previous.filter((id) => id !== taskId)
      : previous.length >= 3 ? previous : [...previous, taskId]);
  }

  function setDecision(taskId: string, decision: TaskDecisionKind) {
    setDecisions((previous) => ({ ...previous, [taskId]: decision }));
    if (decision === "split" && !splitDrafts[taskId]) {
      setSplitDrafts((previous) => ({ ...previous, [taskId]: { title: "", definition: "" } }));
    }
  }

  function updateDraft(taskId: string, field: "title" | "definition", value: string) {
    setSplitDrafts((previous) => ({ ...previous, [taskId]: { ...previous[taskId], [field]: value } }));
  }

  /** 拆小必須填完標題與完成定義，否則會產生一個空任務。 */
  const incompleteSplit = Object.entries(decisions).some(([taskId, decision]) => {
    if (decision !== "split") return false;
    const draft = splitDrafts[taskId];
    return !draft?.title.trim() || !draft?.definition.trim();
  });

  function save() {
    if (!priorityAxisId) return;
    const newTasks: Task[] = [];
    const cancelledTaskIds: string[] = [];
    const taskDecisions: TaskDecision[] = [];

    for (const [taskId, decision] of Object.entries(decisions)) {
      if (decision === "keep") {
        taskDecisions.push({ taskId, decision });
        continue;
      }
      if (decision === "cancel") {
        cancelledTaskIds.push(taskId);
        taskDecisions.push({ taskId, decision });
        continue;
      }
      const source = decisionTasks.find((task) => task.id === taskId);
      const draft = splitDrafts[taskId];
      if (!source || !draft) continue;
      const replacement: Task = {
        id: crypto.randomUUID(),
        axisId: source.axisId,
        projectId: source.projectId,
        title: draft.title.trim(),
        definition: draft.definition.trim(),
        priority: source.priority,
        status: "pending",
        tags: source.tags,
        createdAt: new Date().toISOString(),
        actualSeconds: 0,
        sessions: 0,
      };
      newTasks.push(replacement);
      cancelledTaskIds.push(taskId);
      taskDecisions.push({ taskId, decision, replacementTaskId: replacement.id });
    }

    onSave({
      review: {
        weekStart: range.start,
        weekEnd: range.end,
        highlights,
        weeklyGoals: goals,
        priorityAxisId,
        experiment: experiment.trim() || undefined,
        taskDecisions,
        createdAt: new Date().toISOString(),
      },
      newTasks,
      cancelledTaskIds,
    });
  }

  const steps = ["本週摘要", "問題分析", "下週規劃"];

  return (
    <div className="modal-backdrop">
      <div className="modal wide weekly-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="weekly-header">
          <div className="modal-icon purple"><TimerReset /></div>
          <div>
            <p className="eyebrow">每週復盤 · {range.start} 至 {range.end}</p>
            <h2>{steps[step]}</h2>
          </div>
        </div>

        <div className="weekly-steps">
          {steps.map((label, index) => (
            <span key={label} className={index === step ? "active" : index < step ? "done" : ""}>{label}</span>
          ))}
        </div>

        <div className="weekly-body">
          {step === 0 && <SummaryStep summary={summary} highlights={highlights} onToggle={toggleHighlight} />}
          {step === 1 && <AnalysisStep analysis={analysis} isEmpty={summary.isEmpty} />}
          {step === 2 && (
            <PlanStep
              goals={goals} setGoals={setGoals}
              priorityAxisId={priorityAxisId} setPriorityAxisId={setPriorityAxisId}
              experiment={experiment} setExperiment={setExperiment}
              tasks={decisionTasks} decisions={decisions} onDecide={setDecision}
              drafts={splitDrafts} onDraft={updateDraft}
            />
          )}
        </div>

        <div className="weekly-actions">
          {step > 0
            ? <button className="secondary-button" onClick={() => setStep(step - 1)}><ChevronLeft size={18} />上一步</button>
            : <span />}
          {step < 2
            ? <button className="primary-button" onClick={() => setStep(step + 1)}>下一步<ChevronRight size={18} /></button>
            : <button className="primary-button" disabled={!priorityAxisId || incompleteSplit} onClick={save}>
                <Check size={18} />完成週復盤
              </button>}
        </div>
        {step === 2 && !priorityAxisId && <p className="weekly-hint">選一個下週的第一優先主軸就可以完成。</p>}
        {step === 2 && incompleteSplit && <p className="weekly-hint">拆小的任務要填標題與完成定義。</p>}
      </div>
    </div>
  );
}

function SummaryStep({ summary, highlights, onToggle }: {
  summary: ReturnType<typeof summarizeWeek>;
  highlights: string[];
  onToggle: (taskId: string) => void;
}) {
  if (summary.isEmpty) {
    return <div className="weekly-empty">
      <Flame size={30} />
      <h3>這週沒有留下紀錄</h3>
      <p>可能是休息週，也可能是忙到沒開程式。都沒關係 —— 直接往下，替下週選一個起點就好。</p>
    </div>;
  }

  return <>
    <div className="weekly-stat-row">
      <div><strong>{summary.completedCount}</strong><span>完成任務</span></div>
      <div><strong>{humanMinutes(summary.focusedSeconds)}</strong><span>專注時間</span></div>
      <div><strong>{summary.sessionCount}</strong><span>番茄鐘段數</span></div>
      <div><strong>{Math.round(summary.overtimeRatio * 100)}%</strong><span>超時比例</span></div>
    </div>

    <section className="weekly-section">
      <h3>四個主軸的投入</h3>
      <div className="horizontal-bars">
        {summary.axisShares.map((share) => {
          const axis = axisOf(share.axisId);
          return <div key={share.axisId}>
            <div className="bar-label"><span>{axis.name}</span><strong>{humanMinutes(share.seconds)}　{Math.round(share.share * 100)}%</strong></div>
            <div className="bar-track"><span style={{ width: `${share.share * 100}%`, background: axis.color }} /></div>
          </div>;
        })}
      </div>
    </section>

    <section className="weekly-section">
      <h3>預估與實際</h3>
      <p className="weekly-note">
        每段番茄鐘預估 25 分，實際平均 {humanMinutes(summary.averageSessionSeconds)}。
        本週 {summary.overtimeSessionCount} 段超時，累計多花 {humanMinutes(summary.totalOvertimeSeconds)}。
      </p>
    </section>

    {summary.completedTasks.length > 0 && (
      <section className="weekly-section">
        <h3>本週三個重要成果</h3>
        <p className="weekly-note">已依投入時間自動選好，想換再點。最多三個。</p>
        <div className="highlight-list">
          {summary.completedTasks.map((task) => (
            <button
              key={task.id}
              className={highlights.includes(task.id) ? "selected" : ""}
              onClick={() => onToggle(task.id)}
              style={{ "--axis": axisOf(task.axisId).color } as React.CSSProperties}
            >
              <Trophy size={16} />
              <span><strong>{task.title}</strong><small>{axisOf(task.axisId).shortName} · {humanMinutes(task.actualSeconds)}</small></span>
            </button>
          ))}
        </div>
      </section>
    )}
  </>;
}

function AnalysisStep({ analysis, isEmpty }: { analysis: ReturnType<typeof analyzeWeek>; isEmpty: boolean }) {
  if (isEmpty) {
    return <div className="weekly-empty">
      <Lightbulb size={30} />
      <h3>沒有紀錄就沒有問題要分析</h3>
      <p>下一步替下週挑一個主軸，這裡的分析下週就會長出來。</p>
    </div>;
  }

  const stagnant = analysis.stagnantAxes[0];

  return <>
    <section className="weekly-section">
      <h3>最常超時的任務</h3>
      {analysis.overtimeTasks.length ? (
        <ul className="weekly-list">
          {analysis.overtimeTasks.map((item) => (
            <li key={item.taskId}><span>{item.title}</span><strong>+{humanMinutes(item.overtimeSeconds)}</strong></li>
          ))}
        </ul>
      ) : <p className="weekly-note">本週沒有超時，估時很準。</p>}
    </section>

    <section className="weekly-section">
      <h3>主要暫停原因</h3>
      {analysis.pauseReasons.length ? (
        <ul className="weekly-list">
          {analysis.pauseReasons.map((item) => (
            <li key={item.label}><span>{item.label}</span><strong>{item.count} 次</strong></li>
          ))}
        </ul>
      ) : <p className="weekly-note">本週沒有中途暫停。</p>}
    </section>

    <section className="weekly-section">
      <h3>反覆卡點</h3>
      {analysis.repeatedBlockers.length ? (
        <ul className="weekly-list">
          {analysis.repeatedBlockers.map((item) => (
            <li key={item.taskId}><span>{item.title}</span><strong>{item.unfinishedCount} 次沒完成</strong></li>
          ))}
        </ul>
      ) : <p className="weekly-note">沒有反覆卡住的任務。</p>}
    </section>

    <section className="weekly-section">
      <h3>最久沒推進的主軸</h3>
      <p className="weekly-note">
        {stagnant.daysSince === null
          ? `「${axisOf(stagnant.axisId).name}」還沒有任何紀錄。`
          : `「${axisOf(stagnant.axisId).name}」已經 ${stagnant.daysSince} 天沒有推進。`}
      </p>
    </section>

    <section className="weekly-section">
      <h3>精力與工作時段</h3>
      <p className="weekly-note">
        {analysis.averageEnergy === null ? "本週沒有填寫精力。" : `本週平均精力 ${analysis.averageEnergy.toFixed(1)} / 5。`}
        {analysis.peakBucket && `最高產的時段是${analysis.peakBucket.label}，累積 ${humanMinutes(analysis.peakBucket.seconds)}。`}
      </p>
      <div className="horizontal-bars">
        {analysis.hourBuckets.map((bucket) => {
          const max = Math.max(1, ...analysis.hourBuckets.map((item) => item.seconds));
          return <div key={bucket.label}>
            <div className="bar-label"><span>{bucket.label}</span><strong>{humanMinutes(bucket.seconds)}</strong></div>
            <div className="bar-track"><span style={{ width: `${bucket.seconds / max * 100}%` }} /></div>
          </div>;
        })}
      </div>
    </section>
  </>;
}

function PlanStep({ goals, setGoals, priorityAxisId, setPriorityAxisId, experiment, setExperiment, tasks, decisions, onDecide, drafts, onDraft }: {
  goals: Partial<Record<AxisId, string>>;
  setGoals: React.Dispatch<React.SetStateAction<Partial<Record<AxisId, string>>>>;
  priorityAxisId: AxisId | null;
  setPriorityAxisId: (axisId: AxisId) => void;
  experiment: string;
  setExperiment: (value: string) => void;
  tasks: Task[];
  decisions: Record<string, TaskDecisionKind>;
  onDecide: (taskId: string, decision: TaskDecisionKind) => void;
  drafts: Record<string, { title: string; definition: string }>;
  onDraft: (taskId: string, field: "title" | "definition", value: string) => void;
}) {
  return <>
    <section className="weekly-section">
      <h3>下週的四個里程碑</h3>
      <p className="weekly-note">每個主軸寫一句就好，留白也可以。</p>
      <div className="goal-grid">
        {AXES.map((axis) => (
          <label key={axis.id} style={{ "--axis": axis.color } as React.CSSProperties}>
            <span>{axis.shortName}</span>
            <input
              value={goals[axis.id] ?? ""}
              onChange={(event) => setGoals((previous) => ({ ...previous, [axis.id]: event.target.value }))}
              placeholder="下週要推進到哪裡？"
            />
          </label>
        ))}
      </div>
    </section>

    <section className="weekly-section">
      <h3>下週第一優先主軸<em className="required">必填</em></h3>
      <div className="axis-choice">
        {AXES.map((axis) => (
          <button
            key={axis.id}
            className={priorityAxisId === axis.id ? "selected" : ""}
            style={{ "--axis": axis.color } as React.CSSProperties}
            onClick={() => setPriorityAxisId(axis.id)}
          >{axis.shortName}</button>
        ))}
      </div>
    </section>

    <section className="weekly-section">
      <h3>一個流程改善實驗</h3>
      <p className="weekly-note">只挑一個，下週結束再看有沒有用。</p>
      <div className="reason-list compact">
        {experimentSuggestions.map((suggestion) => (
          <button key={suggestion} className={experiment === suggestion ? "selected" : ""} onClick={() => setExperiment(suggestion)}>
            <Lightbulb size={15} />{suggestion}
          </button>
        ))}
      </div>
      <input className="full-input" value={experiment} onChange={(event) => setExperiment(event.target.value)} placeholder="或自己寫一個" />
    </section>

    {tasks.length > 0 && (
      <section className="weekly-section">
        <h3>沒做完的任務</h3>
        <p className="weekly-note">不處理就是保留。拆小會把原任務收起來，換成一個 25 分鐘做得完的小步驟。</p>
        <div className="decision-list">
          {tasks.map((task) => {
            const decision = decisions[task.id];
            return <div className="decision-item" key={task.id} style={{ "--axis": axisOf(task.axisId).color } as React.CSSProperties}>
              <div className="decision-head">
                <div><strong>{task.title}</strong><small>{axisOf(task.axisId).shortName}{task.dueDate ? ` · 期限 ${task.dueDate}` : ""}</small></div>
                <div className="decision-buttons">
                  <button className={decision === "keep" ? "selected" : ""} onClick={() => onDecide(task.id, "keep")}><Target size={14} />保留</button>
                  <button className={decision === "split" ? "selected" : ""} onClick={() => onDecide(task.id, "split")}><Scissors size={14} />拆小</button>
                  <button className={decision === "cancel" ? "selected" : ""} onClick={() => onDecide(task.id, "cancel")}><X size={14} />取消</button>
                </div>
              </div>
              {decision === "split" && (
                <div className="split-form">
                  <input
                    value={drafts[task.id]?.title ?? ""}
                    onChange={(event) => onDraft(task.id, "title", event.target.value)}
                    placeholder="更小的任務名稱"
                  />
                  <input
                    value={drafts[task.id]?.definition ?? ""}
                    onChange={(event) => onDraft(task.id, "definition", event.target.value)}
                    placeholder="25 分鐘後要看見什麼？"
                  />
                </div>
              )}
            </div>;
          })}
        </div>
      </section>
    )}
  </>;
}
