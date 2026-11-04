import { useEffect, useState } from "react";
import { Check, ChevronDown, Code2, Cpu, FileText, Globe, Search, Wrench, X } from "lucide-react";
import type { TaskCard } from "../types";
import {
  TERMINAL,
  normalizeMarkdown,
  prettyToolName,
  shortRunId,
  stepDetail,
  stepHeadline,
  toolCategory,
} from "../lib/tasks";

export function StepIcon({ tool }: { tool: string }) {
  const category = toolCategory(tool);
  if (category === "browser") return <Globe size={13} />;
  if (category === "search") return <Search size={13} />;
  if (category === "code") return <Code2 size={13} />;
  if (category === "file") return <FileText size={13} />;
  return <Cpu size={13} />;
}

function ResearchMeta({ task }: { task: TaskCard }) {
  const [now, setNow] = useState(Date.now()); const [error, setError] = useState("");
  const active = !TERMINAL.has(task.status);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const elapsed = Math.max(0, Math.round(((active ? now : (task.finishedAt || task.updatedAt)) - (task.startedAt || task.updatedAt)) / 60000));
  const remaining = Math.max(0, Math.ceil(((task.deadline || now) - now) / 60000));
  const phases: Record<string, string> = { planning: "Planlama", collecting: "Kaynak toplama", verifying: "Doğrulama", reporting: "Raporlama", done: "Sonuç kaydedildi" };
  return <div className="research-meta" onClick={(event) => event.stopPropagation()}>
    <strong>{task.kind === "deep_research" ? "Derin araştırma" : "Araştırma"} · {phases[task.phase || ""] || task.phase}</strong>
    <span>{task.sourceCount || 0} okunmuş kaynak · {elapsed} dk geçti{active && task.deadline ? ` · en fazla ${remaining} dk kaldı` : ""}</span>
    <span>{task.lastActivity}</span>
    {task.searchNotice && task.searchNotice !== task.lastActivity && <span>{task.searchNotice}</span>}
    <div className="research-actions">
      {active && <button onClick={() => void window.iris.stopTask(task.id).catch((error) => setError(String(error)))}>Araştırmayı durdur</button>}
      {task.outputPath && <button onClick={() => void window.iris.openResearchOutput?.(task.id).catch((error) => setError(String(error)))}>Sonuç klasörünü aç</button>}
    </div>
    {error && <small className="research-error">{error}</small>}
  </div>;
}

// Shared tool-step timeline (used on cards and inside the open reader).
export function StepTimeline({ steps }: { steps: NonNullable<TaskCard["steps"]> }) {
  return (
    <ul className="activity-timeline">
      {steps.map((step) => {
        const detail = stepDetail(step);
        return (
          <li key={step.id} className={`activity-step ${step.status} ${toolCategory(step.tool)}`}>
            <span className="step-icon">
              <StepIcon tool={step.tool} />
            </span>
            <span className="step-main">
              <span className="step-tool">{prettyToolName(step.tool)}</span>
              {detail ? <span className="step-detail">{detail}</span> : null}
            </span>
            <span className="step-meta">
              {step.duration !== undefined ? <em>{step.duration.toFixed(1)}s</em> : null}
              {step.status === "running" ? (
                <span className="step-run" />
              ) : step.status === "error" ? (
                <X size={12} className="step-x" />
              ) : (
                <Check size={12} className="step-ok" />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function WorkCard({
  task,
  accepted = false,
  stepsOpen = false,
  onToggleSteps,
  onFocus,
  onOpen,
  onApprove,
}: {
  task: TaskCard;
  accepted?: boolean;
  stepsOpen?: boolean;
  onToggleSteps?: () => void;
  onFocus: () => void;
  onOpen: () => void;
  onApprove?: (choice: "once" | "session" | "always" | "deny") => void;
}) {
  const [localStepsOpen, setLocalStepsOpen] = useState(false);
  const showSteps = onToggleSteps ? stepsOpen : localStepsOpen;
  const status = task.status.toLowerCase();
  const active = !TERMINAL.has(status);
  const expandable = active || Boolean(task.output || task.error);
  const steps = task.steps ?? [];
  const runningStep = [...steps].reverse().find((step) => step.status === "running");

  return (
    <article
      className={`wcard ${active ? "working" : ""} ${expandable ? "expandable" : ""} ${
        accepted ? "accepted" : ""
      }`}
      /* Drives the status-colored rail on the card's left edge. An attribute
         rather than a class so Hermes status strings can never collide with
         layout class names. */
      data-status={status}
      data-task-id={expandable ? task.id : undefined}
      onPointerEnter={onFocus}
      onFocus={onFocus}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (expandable && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={expandable ? 0 : -1}
    >
      {accepted ? <span className="wcard-accepted">Task submitted</span> : null}
      <div className="wcard-top">
        <span className={`badge ${status}`}>{task.status}</span>
        <code title={task.id}>{shortRunId(task.id)}</code>
      </div>
      <p className="wcard-task">{task.task}</p>
      {task.kind && <ResearchMeta task={task} />}
      {expandable ? (
        <div className="wcard-preview">{task.kind ? normalizeMarkdown(task.output || task.error).slice(0, 600) : normalizeMarkdown(task.error || task.output)}</div>
      ) : null}

      {active && (runningStep || steps.length > 0) ? (
        <div className="activity-now">
          <span className="activity-spark" />
          <span className="activity-now-text">
            {runningStep ? stepHeadline(runningStep) : "Thinking…"}
          </span>
        </div>
      ) : null}

      {active && task.notes ? <p className="activity-notes">{task.notes.slice(-180)}</p> : null}

      {task.interaction ? (
        <div className="interaction-card" onClick={(event) => event.stopPropagation()}>
          <strong>
            {task.interaction.secret ? "Secure input required" : "Waiting for your answer"}
          </strong>
          <p>
            {task.interaction.secret
              ? "Use the secure Avalon prompt to continue."
              : task.interaction.question}
          </p>
        </div>
      ) : null}

      {task.approval ? (
        <div className="approval-card" onClick={(event) => event.stopPropagation()}>
          <strong>Approval required</strong>
          {task.approval.command ? <code>{task.approval.command}</code> : null}
          {task.approval.reason ? <p>{task.approval.reason}</p> : null}
          <div className="approval-actions">
            {task.approval.choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className={choice === "deny" ? "deny" : choice === "always" ? "always" : ""}
                disabled={task.approval?.resolving}
                onClick={() => onApprove?.(choice)}
              >
                {choice === "once"
                  ? "Allow once"
                  : choice === "session"
                    ? "This session"
                    : choice === "always"
                      ? "Always allow"
                      : "Deny"}
              </button>
            ))}
          </div>
          {task.approval.error ? <small>{task.approval.error}</small> : null}
        </div>
      ) : null}

      {steps.length > 0 ? (
        <div className="activity" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`activity-toggle ${showSteps ? "open" : ""}`}
            onClick={() => (onToggleSteps ? onToggleSteps() : setLocalStepsOpen((current) => !current))}
          >
            <Wrench size={11} />
            {steps.length} step{steps.length === 1 ? "" : "s"}
            <ChevronDown size={12} className="chev" />
          </button>
          {showSteps ? <StepTimeline steps={steps} /> : null}
        </div>
      ) : null}

      {active ? (
        <div className="wcard-progress">
          <i />
        </div>
      ) : null}
    </article>
  );
}
