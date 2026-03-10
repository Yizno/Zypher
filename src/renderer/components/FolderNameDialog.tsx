import { useEffect, useMemo, useState } from "react";

interface FolderNameDialogProps {
  isOpen: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function FolderNameDialog({ isOpen, onConfirm, onCancel }: FolderNameDialogProps): JSX.Element | null {
  const [folderName, setFolderName] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setFolderName("");
  }, [isOpen]);

  const trimmedName = useMemo(() => folderName.trim(), [folderName]);
  const canConfirm = trimmedName.length > 0;

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
        onConfirm(trimmedName);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canConfirm, isOpen, onCancel, onConfirm, trimmedName]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        aria-describedby="folder-name-dialog-message"
        aria-labelledby="folder-name-dialog-title"
        aria-modal="true"
        className="confirm-dialog folder-name-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="folder-name-dialog-title">Create Folder</h3>
        <p id="folder-name-dialog-message">Enter a folder name.</p>
        <input
          autoFocus
          autoComplete="off"
          className="reset-data-input"
          placeholder="Folder name"
          type="text"
          value={folderName}
          onChange={(event) => setFolderName(event.currentTarget.value)}
        />
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!canConfirm} onClick={() => onConfirm(trimmedName)}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
