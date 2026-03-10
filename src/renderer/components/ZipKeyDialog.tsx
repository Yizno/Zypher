import { useEffect, useMemo, useState } from "react";

interface ZipKeyDialogProps {
  isOpen: boolean;
  mode: "export" | "import";
  onConfirm: (zipKey: string) => void;
  onCancel: () => void;
}

const MIN_ZIP_KEY_LENGTH = 4;

export default function ZipKeyDialog({ isOpen, mode, onConfirm, onCancel }: ZipKeyDialogProps): JSX.Element | null {
  const [zipKey, setZipKey] = useState("");
  const [confirmZipKey, setConfirmZipKey] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setZipKey("");
    setConfirmZipKey("");
  }, [isOpen]);

  const canConfirm = useMemo(() => {
    if (mode === "import") {
      return zipKey.length === 0 || zipKey.length >= MIN_ZIP_KEY_LENGTH;
    }
    return zipKey.length >= MIN_ZIP_KEY_LENGTH && zipKey === confirmZipKey;
  }, [confirmZipKey, mode, zipKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter" && canConfirm) {
        event.preventDefault();
        onConfirm(zipKey.trim());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canConfirm, isOpen, onCancel, onConfirm, zipKey]);

  if (!isOpen) {
    return null;
  }

  const title = mode === "export" ? "Set Encrypted ZIP Key" : "Enter Encrypted ZIP Key";
  const description =
    mode === "export"
      ? "This key is required to import this encrypted ZIP later. Keep it safe."
      : "Enter the ZIP key used when this encrypted backup was exported. Leave blank when importing plain JSON.";

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        aria-describedby="zip-key-dialog-message"
        aria-labelledby="zip-key-dialog-title"
        aria-modal="true"
        className="confirm-dialog zip-key-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="zip-key-dialog-title">{title}</h3>
        <p id="zip-key-dialog-message">{description}</p>

        <input
          autoFocus
          autoComplete="off"
          className="reset-data-input"
          inputMode="text"
          placeholder={mode === "import" ? "ZIP key (optional for JSON imports)" : `At least ${MIN_ZIP_KEY_LENGTH} characters`}
          type="password"
          value={zipKey}
          onChange={(event) => setZipKey(event.currentTarget.value)}
        />

        {mode === "export" ? (
          <input
            autoComplete="off"
            className="reset-data-input"
            inputMode="text"
            placeholder="Confirm ZIP key"
            type="password"
            value={confirmZipKey}
            onChange={(event) => setConfirmZipKey(event.currentTarget.value)}
          />
        ) : null}

        <div className="settings-note">This key is separate from your app PIN.</div>

        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!canConfirm} onClick={() => onConfirm(zipKey.trim())}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
