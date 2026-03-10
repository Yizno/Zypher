import { useEffect, useMemo, useState } from "react";

import { UNTITLED_TITLE } from "../../../shared/journalText";
import type { JournalFolder, JournalPageMeta, SearchScope, SortMode } from "../../../shared/types";
import { selectAllInputText } from "../utils/inputSelection";

const NO_FOLDER_OPTION_VALUE = "__no_folder__";
const CREATE_FOLDER_OPTION_VALUE = "__create_folder_sidebar__";

interface SidebarProps {
  pages: JournalPageMeta[];
  activePageId: string | null;
  folders: JournalFolder[];
  spellcheck: boolean;
  isOpen: boolean;
  isNarrow: boolean;
  viewMode: "pages" | "trash" | "settings";
  searchQuery: string;
  searchScope: SearchScope;
  sortMode: SortMode;
  folderFilter: string | null;
  tagFilter: string;
  selectedPageIds: string[];
  onCreatePage: () => void;
  onSelectPage: (pageId: string) => void;
  onTogglePageSelection: (pageId: string, nextSelected: boolean) => void;
  onSelectAllPages: () => void;
  onClearPageSelection: () => void;
  onRenamePage: (pageId: string, title: string) => void;
  onDeletePage: (pageId: string) => void;
  onRestorePage: (pageId: string) => void;
  onDeletePermanently: (pageId: string) => void;
  onBulkMoveToTrash: (pageIds: string[]) => void;
  onBulkRestorePages: (pageIds: string[]) => void;
  onBulkDeletePermanently: (pageIds: string[]) => void;
  onBulkAssignFolder: (pageIds: string[], folderId: string | null) => void;
  onBulkAddTags: (pageIds: string[], tags: string[]) => void;
  onOpenCreateFolderDialog: (pageIds?: string[]) => void;
  onTogglePinned: (pageId: string, nextPinned: boolean) => void;
  onChangeSearchQuery: (query: string) => void;
  onChangeSearchScope: (scope: SearchScope) => void;
  onChangeSortMode: (mode: SortMode) => void;
  onChangeFolderFilter: (folderId: string | null) => void;
  onChangeTagFilter: (tag: string) => void;
  onSwitchView: (view: "pages" | "trash" | "settings") => void;
}

function formatRelativeTime(isoTimestamp: string): string {
  const deltaMs = Date.now() - Date.parse(isoTimestamp);
  if (deltaMs < 60_000) {
    return "now";
  }

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }

  return new Date(isoTimestamp).toLocaleDateString();
}

function formatCreatedDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function parseTagInput(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3 L8 13 M3 8 L13 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function PinIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.5 L10 6.4 L14.2 7 L11.1 10 L11.9 14.2 L8 12.2 L4.1 14.2 L4.9 10 L1.8 7 L6 6.4 Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function EditIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 12.5 L4 9.5 L10.9 2.6 L13.4 5.1 L6.5 12 Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M2.6 13.4 L6.4 12.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 4.7 L12.5 4.7 L11.8 13.5 L4.2 13.5 Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M2.8 4.7 L13.2 4.7 M6 4.7 L6.4 2.9 L9.6 2.9 L10 4.7" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function RestoreIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.4 5.1 H2.8 V2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path
        d="M3 5 C3.9 3.6 5.5 2.6 7.4 2.6 C10.3 2.6 12.6 4.9 12.6 7.8 C12.6 10.7 10.3 13 7.4 13 C5.6 13 4 12.1 3.1 10.7"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
    </svg>
  );
}

export default function Sidebar({
  pages,
  activePageId,
  folders,
  spellcheck,
  isOpen,
  isNarrow,
  viewMode,
  searchQuery,
  searchScope,
  sortMode,
  folderFilter,
  tagFilter,
  selectedPageIds,
  onCreatePage,
  onSelectPage,
  onTogglePageSelection,
  onSelectAllPages,
  onClearPageSelection,
  onRenamePage,
  onDeletePage,
  onRestorePage,
  onDeletePermanently,
  onBulkMoveToTrash,
  onBulkRestorePages,
  onBulkDeletePermanently,
  onBulkAssignFolder,
  onBulkAddTags,
  onOpenCreateFolderDialog,
  onTogglePinned,
  onChangeSearchQuery,
  onChangeSearchScope,
  onChangeSortMode,
  onChangeFolderFilter,
  onChangeTagFilter,
  onSwitchView
}: SidebarProps): JSX.Element {
  const [renamePageId, setRenamePageId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [bulkFolderValue, setBulkFolderValue] = useState("");
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkToolsExpanded, setBulkToolsExpanded] = useState(false);
  const selectedPageIdSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const selectedCount = selectedPageIds.length;
  const allVisibleSelected = pages.length > 0 && selectedCount === pages.length;
  const bulkTagValues = parseTagInput(bulkTagInput);

  const sidebarClass = `sidebar ${isOpen ? "open" : "closed"} ${isNarrow ? "narrow" : ""}`;

  useEffect(() => {
    if (selectedCount !== 0) {
      return;
    }
    setBulkToolsExpanded(false);
  }, [selectedCount]);

  const handleApplyBulkTags = () => {
    if (selectedCount === 0 || bulkTagValues.length === 0) {
      return;
    }
    onBulkAddTags(selectedPageIds, bulkTagValues);
    setBulkTagInput("");
  };

  return (
    <aside className={sidebarClass}>
      <div className="sidebar-header">
        <div className="sidebar-tabs">
          <button className={viewMode === "pages" ? "active" : ""} type="button" onClick={() => onSwitchView("pages")}>
            Pages
          </button>
          <button className={viewMode === "trash" ? "active" : ""} type="button" onClick={() => onSwitchView("trash")}>
            Trash
          </button>
          <button
            className={viewMode === "settings" ? "active" : ""}
            type="button"
            onClick={() => onSwitchView("settings")}
          >
            Settings
          </button>
        </div>

        {viewMode !== "settings" ? (
          <>
            <div className="sidebar-top-actions">
              <button className="new-page-btn icon-only-btn" type="button" onClick={onCreatePage} title="New page">
                <PlusIcon />
              </button>
              <input
                className="search-input"
                value={searchQuery}
                placeholder="Search"
                spellCheck={spellcheck}
                onChange={(event) => onChangeSearchQuery(event.currentTarget.value)}
              />
            </div>

            <div className="filter-row">
              <select value={searchScope} onChange={(event) => onChangeSearchScope(event.currentTarget.value as SearchScope)}>
                <option value="all">All</option>
                <option value="title">Title</option>
                <option value="content">Content</option>
              </select>
              <select value={sortMode} onChange={(event) => onChangeSortMode(event.currentTarget.value as SortMode)}>
                <option value="recent">Recent</option>
                <option value="created">Created</option>
                <option value="alphabetical">A-Z</option>
              </select>
            </div>
            <div className="filter-row">
              <select
                value={folderFilter ?? ""}
                onChange={(event) => onChangeFolderFilter(event.currentTarget.value || null)}
              >
                <option value="">All folders</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <input
                value={tagFilter}
                placeholder="Tag"
                spellCheck={spellcheck}
                onChange={(event) => onChangeTagFilter(event.currentTarget.value)}
              />
            </div>

            {selectedCount > 0 ? (
              <div className={`bulk-tools ${bulkToolsExpanded ? "expanded" : "compact"}`}>
                <div className="bulk-tools-header">
                  <span>{selectedCount} selected</span>
                  <div className="bulk-tools-header-actions">
                    <button type="button" disabled={allVisibleSelected} onClick={onSelectAllPages}>
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClearPageSelection();
                        setBulkToolsExpanded(false);
                      }}
                    >
                      Clear
                    </button>
                    {viewMode === "pages" ? (
                      <button type="button" onClick={() => setBulkToolsExpanded((current) => !current)}>
                        {bulkToolsExpanded ? "Less" : "More"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className={`bulk-tools-row ${viewMode === "trash" ? "trash-row" : "pages-row"}`}>
                  {viewMode === "trash" ? (
                    <>
                      <button type="button" onClick={() => onBulkRestorePages(selectedPageIds)}>
                        Restore
                      </button>
                      <button type="button" className="danger-btn" onClick={() => onBulkDeletePermanently(selectedPageIds)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => onBulkMoveToTrash(selectedPageIds)}>
                        Trash
                      </button>
                      <button type="button" className="danger-btn" onClick={() => onBulkDeletePermanently(selectedPageIds)}>
                        Delete
                      </button>
                      <select
                        value={bulkFolderValue}
                        onChange={(event) => {
                          const selectedValue = event.currentTarget.value;
                          setBulkFolderValue(selectedValue);
                          if (!selectedValue) {
                            return;
                          }
                          if (selectedValue === CREATE_FOLDER_OPTION_VALUE) {
                            onOpenCreateFolderDialog(selectedPageIds);
                            setBulkFolderValue("");
                            return;
                          }

                          const nextFolderId = selectedValue === NO_FOLDER_OPTION_VALUE ? null : selectedValue;
                          onBulkAssignFolder(selectedPageIds, nextFolderId);
                          setBulkFolderValue("");
                        }}
                      >
                        <option value="">Move to folder...</option>
                        <option value={NO_FOLDER_OPTION_VALUE}>No folder</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                        <option value={CREATE_FOLDER_OPTION_VALUE}>Create folder...</option>
                      </select>
                    </>
                  )}
                </div>

                {viewMode === "pages" && bulkToolsExpanded ? (
                  <div className="bulk-tools-row bulk-tag-row">
                    <input
                      value={bulkTagInput}
                      placeholder="add tags, comma, separated"
                      spellCheck={spellcheck}
                      onChange={(event) => setBulkTagInput(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") {
                          return;
                        }
                        event.preventDefault();
                        handleApplyBulkTags();
                      }}
                    />
                    <button type="button" disabled={bulkTagValues.length === 0} onClick={handleApplyBulkTags}>
                      Add tags
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {pages.length === 0 ? (
        <div className="sidebar-empty">{viewMode === "trash" ? "Trash is empty." : "No pages."}</div>
      ) : (
        <ul className="page-list">
          {pages.map((page) => {
            const isRenaming = renamePageId === page.id;
            const isSelected = selectedPageIdSet.has(page.id);
            const itemClass = `page-item ${activePageId === page.id ? "active" : ""} ${isSelected ? "selected" : ""}`;
            return (
              <li key={page.id}>
                <div
                  className={itemClass}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (isRenaming) {
                      return;
                    }
                    onSelectPage(page.id);
                  }}
                  onKeyDown={(event) => {
                    if (isRenaming) {
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectPage(page.id);
                    }
                  }}
                >
                  <label
                    className="page-item-checkbox"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label={`Select ${page.title || UNTITLED_TITLE}`}
                      onChange={(event) => onTogglePageSelection(page.id, event.currentTarget.checked)}
                    />
                  </label>

                  <div className="page-select-btn">
                    <div className="page-item-header">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          spellCheck={spellcheck}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={(event) => selectAllInputText(event.currentTarget)}
                          onChange={(event) => setRenameValue(event.currentTarget.value)}
                          onBlur={() => {
                            onRenamePage(page.id, renameValue.trim() || UNTITLED_TITLE);
                            setRenamePageId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              onRenamePage(page.id, renameValue.trim() || UNTITLED_TITLE);
                              setRenamePageId(null);
                            }
                          }}
                        />
                      ) : (
                        <span className="page-item-title">{page.title || UNTITLED_TITLE}</span>
                      )}
                      <span className="page-item-time">{formatRelativeTime(page.updatedAt)}</span>
                    </div>
                    <span className="page-item-preview">{page.preview || "Empty page"}</span>
                    <span className="page-item-created">Created {formatCreatedDate(page.createdAt)}</span>
                  </div>

                  <div className="page-actions icon-actions">
                    <button
                      type="button"
                      className={page.pinned ? "active-pin" : ""}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePinned(page.id, !page.pinned);
                      }}
                      title={page.pinned ? "Unpin" : "Pin"}
                    >
                      <PinIcon filled={page.pinned} />
                    </button>

                    {viewMode === "trash" ? (
                      <>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRestorePage(page.id);
                          }}
                          title="Restore"
                        >
                          <RestoreIcon />
                        </button>
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeletePermanently(page.id);
                          }}
                          title="Delete"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRenamePageId(page.id);
                            setRenameValue(page.title || UNTITLED_TITLE);
                          }}
                          title="Rename"
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeletePage(page.id);
                          }}
                          title="Move to trash"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
