import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageHistoryItem } from "../../../shared/types";

type HistoryFilter = "all" | "named" | "unnamed";

interface VersionHistoryPanelProps {
  items: PageHistoryItem[];
  historyEnabled: boolean;
  previewingId: string | null;
  onPreview: (historyId: string) => void;
  onRestore: (historyId: string) => void;
  onDelete: (historyId: string) => void;
  onDeleteMultiple: (historyIds: string[]) => void;
  onRename: (historyId: string, name: string | null) => void;
  onDuplicate: (historyId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  return `${dateStr}, ${timeStr}`;
}

export default function VersionHistoryPanel({
  items,
  historyEnabled,
  previewingId,
  onPreview,
  onRestore,
  onDelete,
  onDeleteMultiple,
  onRename,
  onDuplicate,
  onClear,
  onClose
}: VersionHistoryPanelProps): JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (filter === "named") return items.filter((i) => i.name !== null);
    if (filter === "unnamed") return items.filter((i) => i.name === null);
    return items;
  }, [items, filter]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpenId]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Clear selection when items change
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const toggleSelect = useCallback((id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((i) => i.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const commitRename = useCallback(
    (historyId: string) => {
      const trimmed = renameValue.trim();
      onRename(historyId, trimmed.length > 0 ? trimmed : null);
      setRenamingId(null);
      setRenameValue("");
    },
    [onRename, renameValue]
  );

  const startRename = useCallback((item: PageHistoryItem) => {
    setRenamingId(item.id);
    setRenameValue(item.name ?? "");
    setMenuOpenId(null);
  }, []);

  const isSelecting = selectedIds.size > 0;

  return (
    <div className="vh-panel">
      <div className="vh-header">
        <div className="vh-header-top">
          <strong>Version History</strong>
          <button type="button" className="vh-close-btn" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="vh-header-meta">
          <span className="vh-count">
            {items.length} version{items.length !== 1 ? "s" : ""}
            {!historyEnabled && " (saving off)"}
          </span>
          <div className="vh-filter-group">
            <select value={filter} onChange={(e) => setFilter(e.target.value as HistoryFilter)}>
              <option value="all">All versions</option>
              <option value="named">Named</option>
              <option value="unnamed">Unnamed</option>
            </select>
          </div>
        </div>
        {isSelecting && (
          <div className="vh-selection-bar">
            <span>{selectedIds.size} selected</span>
            <div className="vh-selection-actions">
              <button type="button" onClick={selectAll}>Select all</button>
              <button type="button" onClick={clearSelection}>Clear</button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  onDeleteMultiple([...selectedIds]);
                  setSelectedIds(new Set());
                }}
              >
                Delete selected
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="vh-list-container">
        {filtered.length === 0 ? (
          <div className="vh-empty">
            {items.length === 0 ? "No versions yet." : "No matching versions."}
          </div>
        ) : (
          <ul className="vh-list">
            {filtered.map((entry) => {
              const isActive = previewingId === entry.id;
              const isSelected = selectedIds.has(entry.id);

              return (
                <li
                  key={entry.id}
                  className={`vh-item${isActive ? " vh-item-active" : ""}${isSelected ? " vh-item-selected" : ""}`}
                  onClick={() => onPreview(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPreview(entry.id);
                    }
                  }}
                >
                  <div className="vh-item-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleSelect(entry.id, false)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="vh-item-content">
                    {renamingId === entry.id ? (
                      <input
                        ref={renameInputRef}
                        className="vh-rename-input"
                        value={renameValue}
                        placeholder="Version name..."
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(entry.id);
                          }
                          if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="vh-item-name">
                          {entry.name ?? formatTimestamp(entry.createdAt)}
                        </span>
                        {entry.name && (
                          <span className="vh-item-date">{formatTimestamp(entry.createdAt)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="vh-item-menu-anchor">
                    <button
                      type="button"
                      className="vh-dots-btn"
                      title="Actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === entry.id ? null : entry.id);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                      </svg>
                    </button>
                    {menuOpenId === entry.id && (
                      <div className="vh-context-menu" ref={menuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            onPreview(entry.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onRestore(entry.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2 6a5 5 0 119 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                          Restore this version
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDuplicate(entry.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M10 4V2.5A1.5 1.5 0 008.5 1h-6A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                          Make a copy
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            startRename(entry);
                            setMenuOpenId(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M8.5 2.5l3 3M1 13l.8-3.2L10.3 1.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4L4.2 12.2 1 13z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {entry.name ? "Rename" : "Name this version"}
                        </button>
                        <div className="vh-menu-divider" />
                        <button
                          type="button"
                          className="vh-menu-danger"
                          onClick={() => {
                            onDelete(entry.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <div className="vh-footer">
          <button type="button" className="danger-btn" onClick={onClear}>
            Clear all history
          </button>
        </div>
      )}
    </div>
  );
}
