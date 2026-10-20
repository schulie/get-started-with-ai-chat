import { useEffect, useState } from "react";
import { ChatTask, formatDuration } from "./session";
import styles from "../AgentPreviewChatBot.module.css";

export function TaskStatus({ task }: { task: ChatTask }) {
  const [elapsed, setElapsed] = useState(0);
  const running = task.phase === "working" || task.phase === "writing";
  useEffect(() => {
    const tick = () => setElapsed(performance.now() - task.startedAt);
    tick();
    if (!running) return;
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [task.startedAt, running]);
  const label = task.phase === "working" && task.activity ? {
    searching: "Searching web", reading: "Reading public page", preparing: "Preparing files",
  }[task.activity] : {
    working: "Working", writing: "Writing response", completed: "Completed",
    stopped: "Stopped", failed: "Request failed",
  }[task.phase];
  const duration = task.durationMs ?? elapsed;
  return (
    <div className={styles.taskStatus} data-running={running}>
      <span className={styles.taskStatusDot} aria-hidden="true" />
      <span role="status" aria-live="polite">{label}</span>
      <time className={styles.taskElapsed} aria-live="off" dateTime={`PT${Math.floor(duration / 1000)}S`}>
        {formatDuration(duration)} {running ? "elapsed" : "total"}
      </time>
    </div>
  );
}
