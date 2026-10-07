import { useState, useEffect, useRef } from "react";
import "./LogPanel.css";

function TerminalIcon() {
  return (
    <svg
      className="log-terminal-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function LogEntryRow({ entry }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  };

  return (
    <div
      className={`log-item-row${copied ? " copied" : ""}`}
      onClick={handleCopy}
      title="Click to copy this line"
    >
      <span className="log-timestamp">{entry.time}</span>
      <span className="log-prompt-char">›</span>
      <span className={`log-message ${entry.level || "info"}`}>
        {entry.message}
      </span>
      <span className="log-copy-indicator">{copied ? "✓ Copied" : "⎘"}</span>
    </div>
  );
}

export default function LogPanel({ logs }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="log-panel-wrapper">
      <div className="log-panel-header">
        <div className="log-panel-left">
          <div className="terminal-dots">
            <span className="dot-circle dot-red" />
            <span className="dot-circle dot-yellow" />
            <span className="dot-circle dot-green" />
          </div>
          <div className="log-panel-title">
            <TerminalIcon />
            <span>Execution Terminal</span>
          </div>
          <span className="log-count-tag">{logs.length} events</span>
        </div>
      </div>

      <div className="log-scroll-area">
        {logs.length === 0 ? (
          <div className="log-empty-state">
            <span className="log-empty-icon">📟</span>
            <span>
              Live automation stream will appear here when task starts…
            </span>
          </div>
        ) : (
          logs.map((entry, i) => <LogEntryRow key={i} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
