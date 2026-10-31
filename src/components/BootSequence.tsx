import { useEffect, useRef, useState, type CSSProperties } from "react";
import ReactorCore, { ORB_ACCENT } from "./ReactorCore";
import { startupSounds } from "../lib/startupSounds";

export type BootCheck = {
  id: string;
  label: string;
  state: "pending" | "ok" | "error";
  optional?: boolean;
};

export default function BootSequence({
  visible,
  closing = false,
  compact = false,
  checks,
}: {
  visible: boolean;
  closing?: boolean;
  compact?: boolean;
  checks: BootCheck[];
}) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const nextRevealAt = useRef(0);
  const sounded = useRef(new Set<string>());

  // Presentation is paced separately from the real checks. A row can only
  // resolve once its actual result exists; the animation never invents an OK.
  useEffect(() => {
    if (!visible) {
      setRevealed(new Set());
      sounded.current.clear();
      nextRevealAt.current = 0;
      return;
    }
    if (closing) return;
    if (!nextRevealAt.current) nextRevealAt.current = performance.now() + 700;
    const next = checks.find((check) => !revealed.has(check.id));
    if (!next || next.state === "pending") return;
    const timer = window.setTimeout(() => {
      nextRevealAt.current = performance.now() + 350;
      setRevealed((current) => new Set([...current, next.id]));
    }, Math.max(0, nextRevealAt.current - performance.now()));
    return () => window.clearTimeout(timer);
  }, [visible, closing, checks, revealed]);

  // Each committed OK gets its own tick. No soundtrack or preplayed queue:
  // changing the row pacing automatically changes the sound's pacing too.
  useEffect(() => {
    if (!visible || closing) return;
    for (const check of checks) {
      if (revealed.has(check.id) && check.state === "ok" && !sounded.current.has(check.id)) {
        sounded.current.add(check.id);
        startupSounds.check(check.id);
      }
    }
  }, [visible, closing, checks, revealed]);

  if (!visible) return null;
  const required = checks.filter((check) => !check.optional);
  const progress = required.filter((check) => revealed.has(check.id) && check.state === "ok").length / Math.max(1, required.length);
  const activeId = checks.find((check) => !revealed.has(check.id))?.id;

  // Compact variant for HUD mode: a small glass card near the orb instead of
  // taking over the whole (transparent) screen.
  return (
    <div className={`boot ${compact ? "compact" : ""} ${closing ? "closing" : ""}`}>
      {!compact ? (
        <div
          className="orb-stage boot-orb"
          style={{ "--orb-accent": ORB_ACCENT.online } as CSSProperties}
        >
          <span className="orb-ring" />
          <span className="orb-radar" />
          <ReactorCore state="online" />
        </div>
      ) : null}
      <div className="boot-title">A.V.A.L.O.N</div>
      <div className="boot-sub">SYSTEM INITIALIZATION</div>

      <div className="boot-log">
        {checks.map((check) => (
          <div key={check.id} className={`boot-line ${revealed.has(check.id) && check.state === "ok" ? "done" : revealed.has(check.id) && check.state === "error" ? "error" : check.id === activeId ? "active" : ""}`}>
            <span className="boot-dot" />
            {check.label}
            <span className="boot-state">{revealed.has(check.id) && check.state === "ok" ? "OK" : revealed.has(check.id) && check.state === "error" ? "ERR" : check.id === activeId ? check.optional ? "WAIT" : "··" : ""}</span>
          </div>
        ))}
      </div>

      <div className="boot-bar">
        <div
          className="boot-bar-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
