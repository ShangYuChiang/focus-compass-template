import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { AXES } from "./seed";
import { ACCEPTANCE_FIELD_LABELS, buildQuickAcceptanceTemplate, formatAcceptanceDefinition, isAcceptanceComplete } from "./acceptance";
import { createTaskPlan, generateTaskDrafts, type TaskDraft, type TaskPlanInput } from "./taskBreakdown";
import type { AppState, AxisId, Priority, Task } from "./types";

type NewProjectDraft = { axisId: AxisId; name: string; milestone: string; targetDate?: string };

export function TaskBreakdownModal({ state, onSave, onClose }: { state: AppState; onSave: (tasks: Task[], newProject?: NewProjectDraft) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [title, setTitle] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [evidence, setEvidence] = useState("");
  const [quality, setQuality] = useState("");
  const [axisId, setAxisId] = useState<AxisId>("career");
  const [projectId, setProjectId] = useState("");
  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectMilestone, setNewProjectMilestone] = useState("");
  const [newProjectTargetDate, setNewProjectTargetDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(75);
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const projects = state.projects.filter((project) => project.axisId === axisId && project.status === "active");
  const isCreatingProject = projectMode === "new";
  const temporaryProjectId = "__new_project__";

  useEffect(() => {
    if (!projects.some((project) => project.id === projectId) || projectMode === "new") setProjectId(isCreatingProject ? temporaryProjectId : projects[0]?.id ?? "");
    if (!projects.length && projectMode === "existing") setProjectMode("new");
  }, [axisId, projectId, isCreatingProject, projects, projectMode, temporaryProjectId]);

  useEffect(() => {
    if (!title.trim()) return;
    if (deliverable || evidence || quality) return;
    const template = buildQuickAcceptanceTemplate(axisId, title.trim());
    setDeliverable(template.deliverable);
    setEvidence(template.evidence);
    setQuality(template.quality);
  }, [axisId, title, deliverable, evidence, quality]);

  function applyAcceptanceTemplate() {
    const template = buildQuickAcceptanceTemplate(axisId, title.trim());
    setDeliverable(template.deliverable);
    setEvidence(template.evidence);
    setQuality(template.quality);
  }

  const newProjectValid = Boolean(newProjectName.trim() && newProjectMilestone.trim());
  const input: TaskPlanInput = {
    title: title.trim(),
    definition: formatAcceptanceDefinition({ deliverable, evidence, quality }),
    axisId,
    projectId: isCreatingProject ? temporaryProjectId : projectId,
    priority,
    estimatedMinutes,
  };
  const formValid = Boolean(input.title && isAcceptanceComplete({ deliverable, evidence, quality }) && (isCreatingProject ? newProjectValid : projectId));
  const draftsValid = drafts.length > 0 && drafts.every((draft) => draft.title.trim() && draft.definition.trim() && draft.estimatedMinutes >= 5);

  function generate() {
    if (!formValid) return;
    setDrafts(generateTaskDrafts(input));
    setConfirmRegenerate(false);
    setPhase("review");
  }

  function updateDraft(id: string, patch: Partial<TaskDraft>) {
    setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function moveDraft(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= drafts.length) return;
    setDrafts((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addDraft() {
    setDrafts((items) => [...items, {
      id: crypto.randomUUID(), title: "", definition: "", firstAction: "", estimatedMinutes: 25,
    }]);
  }

  function save() {
    if (!draftsValid || !formValid) return;
    const tasks = createTaskPlan(input, drafts);
    if (tasks.length) onSave(tasks, isCreatingProject ? { axisId, name: newProjectName.trim(), milestone: newProjectMilestone.trim(), targetDate: newProjectTargetDate.trim() || undefined } : undefined);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal wide breakdown-modal">
      <button className="modal-close" onClick={onClose}><X size={18} /></button>
      <div className="modal-icon blue"><Sparkles /></div>
      <p className="eyebrow">智慧新增任務</p>
      <h2>{phase === "input" ? "先寫下想完成的成果" : drafts.length > 1 ? "AI 建議先做這幾步" : "這項任務可以直接執行"}</h2>
      <p className="modal-lead">{phase === "input" ? "系統會依預估時間判斷：25 分鐘內保留一項，較大的成果先拆成三個可執行步驟。" : "以下內容全部可以修改、刪除、增加或重新排序；確認後才會寫入任務清單。"}</p>

      {phase === "input" ? <>
        <div className="form-grid">
          <label className="form-span"><span>想完成的任務</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：完成個人作品集首頁" /></label>
          <label><span>{ACCEPTANCE_FIELD_LABELS.deliverable}</span><textarea value={deliverable} onChange={(event) => setDeliverable(event.target.value)} placeholder="完成這步要交付什麼，輸出文件/代碼/Demo 名稱" /></label>
          <label><span>{ACCEPTANCE_FIELD_LABELS.evidence}</span><textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="要留下哪種可驗證證據（GitHub、文件、紀錄）" /></label>
          <label><span>{ACCEPTANCE_FIELD_LABELS.quality}</span><textarea value={quality} onChange={(event) => setQuality(event.target.value)} placeholder="完成門檻：可量化、可展示、可復盤" /></label>
          <button type="button" className="secondary-button full form-span" onClick={applyAcceptanceTemplate}>一鍵套用 3 欄位模板（可再微調）</button>
          <label><span>預估總時間</span><select value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))}><option value={25}>25 分鐘</option><option value={50}>50 分鐘</option><option value={75}>75 分鐘</option><option value={120}>120 分鐘以上</option></select></label>
          <label><span>優先程度</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
          <label><span>所屬主軸</span><select value={axisId} onChange={(event) => setAxisId(event.target.value as AxisId)}>{AXES.map((axis) => <option value={axis.id} key={axis.id}>{axis.name}</option>)}</select></label>
          <label><span>所屬專案</span><select
            value={isCreatingProject ? "new" : projectId}
            onChange={(event) => {
              if (event.target.value === "new") {
                setProjectMode("new");
                return;
              }
              setProjectMode("existing");
              setProjectId(event.target.value);
            }}
          >
            <option value="new">＋ 新增新專案</option>
            {!projects.length && <option value="">此主軸目前沒有推進中的專案</option>}
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select></label>
          {isCreatingProject && <><label><span>新專案名稱</span><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="輸入專案名稱，例如：個人作品集" /></label>
            <label><span>新專案里程碑</span><input value={newProjectMilestone} onChange={(event) => setNewProjectMilestone(event.target.value)} placeholder="這個專案的 1 個主要里程碑" /></label>
            <label><span>預計完成日（選填）</span><input type="date" value={newProjectTargetDate} onChange={(event) => setNewProjectTargetDate(event.target.value)} /></label></>}
        </div>
        <button className="primary-button full" disabled={!formValid} onClick={generate}><Sparkles size={18} />自動判斷並產生小任務</button>
      </> : <>
        {drafts.length > 1 && <section className="breakdown-parent-card">
          <div><span>父任務</span><strong>小任務全部完成後自動完成</strong></div>
          <label><span>父任務名稱</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <div className="acceptance-grid">
            <label><span>{ACCEPTANCE_FIELD_LABELS.deliverable}</span><textarea value={deliverable} onChange={(event) => setDeliverable(event.target.value)} placeholder="完成這步要交付什麼，輸出文件/代碼/Demo 名稱" /></label>
            <label><span>{ACCEPTANCE_FIELD_LABELS.evidence}</span><textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="要留下哪種可驗證證據（GitHub、文件、紀錄）" /></label>
            <label><span>{ACCEPTANCE_FIELD_LABELS.quality}</span><textarea value={quality} onChange={(event) => setQuality(event.target.value)} placeholder="完成門檻：可量化、可展示、可復盤" /></label>
          </div>
          <button type="button" className="secondary-button full form-span" onClick={applyAcceptanceTemplate}>一鍵套用 3 欄位模板（可再微調）</button>
          <label className="parent-estimate"><span>整體預估分鐘</span><input type="number" min={30} step={5} value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} /></label>
        </section>}

        <div className="breakdown-common-row">
          <label><span>主軸</span><select value={axisId} onChange={(event) => setAxisId(event.target.value as AxisId)}>{AXES.map((axis) => <option value={axis.id} key={axis.id}>{axis.shortName}</option>)}</select></label>
          <label><span>所屬專案</span><select
            value={isCreatingProject ? "new" : projectId}
            onChange={(event) => {
              if (event.target.value === "new") {
                setProjectMode("new");
                return;
              }
              setProjectMode("existing");
              setProjectId(event.target.value);
            }}
          >
            <option value="new">＋ 新增新專案</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select></label>
          {isCreatingProject && <><label><span>新專案名稱</span><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="輸入專案名稱，例如：個人作品集" /></label>
            <label><span>新專案里程碑</span><input value={newProjectMilestone} onChange={(event) => setNewProjectMilestone(event.target.value)} placeholder="這個專案的 1 個主要里程碑" /></label>
            <label><span>預計完成日（選填）</span><input type="date" value={newProjectTargetDate} onChange={(event) => setNewProjectTargetDate(event.target.value)} /></label></>}
          <label><span>優先度</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
        </div>

        <div className="breakdown-list">{drafts.map((draft, index) => <article className="breakdown-step" key={draft.id}>
          <div className="breakdown-step-head"><span>{index + 1}</span><strong>{draft.title.trim() || "尚未命名的小任務"}</strong><div><button aria-label={`上移第 ${index + 1} 個小任務`} disabled={index === 0} onClick={() => moveDraft(index, -1)}><ArrowUp size={15} /></button><button aria-label={`下移第 ${index + 1} 個小任務`} disabled={index === drafts.length - 1} onClick={() => moveDraft(index, 1)}><ArrowDown size={15} /></button><button aria-label={`刪除第 ${index + 1} 個小任務`} onClick={() => setDrafts((items) => items.filter((item) => item.id !== draft.id))}><Trash2 size={15} /></button></div></div>
          <div className="breakdown-step-fields">
            <label className="wide-field"><span>任務名稱</span><input value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} /></label>
            <label className="wide-field"><span>完成定義（交付成果）</span><textarea value={draft.definition} onChange={(event) => updateDraft(draft.id, { definition: event.target.value })} /></label>
            <label className="wide-field"><span>第一個動作</span><input value={draft.firstAction} onChange={(event) => updateDraft(draft.id, { firstAction: event.target.value })} /></label>
            <label><span>預估分鐘</span><input type="number" min={5} max={25} step={5} value={draft.estimatedMinutes} onChange={(event) => updateDraft(draft.id, { estimatedMinutes: Number(event.target.value) })} /></label>
          </div>
        </article>)}</div>

        <button className="secondary-button breakdown-add" onClick={addDraft}><Plus size={16} />新增一個小任務</button>
        {confirmRegenerate ? <div className="regenerate-confirm"><p>重新生成會取代上面尚未儲存的手動修改。</p><div><button className="text-button" onClick={() => setConfirmRegenerate(false)}>保留目前修改</button><button className="secondary-button" onClick={generate}>確定重新生成</button></div></div> : <button className="text-button regenerate-button" onClick={() => setConfirmRegenerate(true)}><RefreshCw size={15} />重新生成建議</button>}
        <div className="split-actions breakdown-actions"><button className="secondary-button" onClick={() => setPhase("input")}>回上一步</button><button className="primary-button" disabled={!formValid || !draftsValid} onClick={save}><Check size={18} />確認並加入 {drafts.length > 1 ? `${drafts.length} 個小任務` : "待執行"}</button></div>
      </>}
    </div>
  </div>;
}
