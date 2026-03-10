import { useEffect, useMemo, useState } from "react";

interface ResetDataDialogProps {
  isOpen: boolean;
  requiredPhrase: string;
  waitSeconds: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function ResetDataDialog({
  isOpen,
  requiredPhrase,
  waitSeconds,
  onConfirm,
  onCancel
}: ResetDataDialogProps): JSX.Element | null {
  const [remainingSeconds, setRemainingSeconds] = useState(waitSeconds);
  const [typedPhrase, setTypedPhrase] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setRemainingSeconds(waitSeconds);
    setTypedPhrase("");
  }, [isOpen, waitSeconds]);

  useEffect(() => {
    if (!isOpen || remainingSeconds <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [isOpen, remainingSeconds]);

  const canConfirm = useMemo(
    () => remainingSeconds <= 0 && typedPhrase === requiredPhrase,
    [remainingSeconds, requiredPhrase, typedPhrase]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter" && canConfirm) {
        event.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canConfirm, isOpen, onCancel, onConfirm]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        aria-describedby="reset-dialog-message"
        aria-labelledby="reset-dialog-title"
        aria-modal="true"
        className="confirm-dialog reset-data-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="reset-dialog-title">Dangerous Reset Protection</h3>
        <p id="reset-dialog-message">This action permanently deletes all journal data, history, backups, and settings.</p>
        {remainingSeconds > 0 ? (
          <div className="reset-data-countdown">Wait {formatCountdown(remainingSeconds)} before continuing.</div>
        ) : (
          <div className="reset-data-countdown">
            Type "{requiredPhrase}" to reset your data.
          </div>
        )}
        <input
          autoComplete="off"
          className="reset-data-input"
          disabled={remainingSeconds > 0}
          placeholder="Type the exact phrase"
          value={typedPhrase}
          onChange={(event) => setTypedPhrase(event.currentTarget.value)}
        />
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger-btn" disabled={!canConfirm} onClick={onConfirm}>
            Wipe Data
          </button>
        </div>
      </div>
    </div>
  );
}
