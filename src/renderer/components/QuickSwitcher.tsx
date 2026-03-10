import { useMemo, useState } from "react";

import type { JournalPageMeta } from "../../../shared/types";

interface QuickSwitcherProps {
  pages: JournalPageMeta[];
  isOpen: boolean;
  spellcheck: boolean;
  onClose: () => void;
  onSelect: (pageId: string) => void;
}

export default function QuickSwitcher({ pages, isOpen, spellcheck, onClose, onSelect }: QuickSwitcherProps): JSX.Element | null {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return pages.slice(0, 30);
    }

    return pages
      .filter(
        (page) => page.title.toLowerCase().includes(normalized) || page.preview.toLowerCase().includes(normalized)
      )
      .slice(0, 30);
  }, [pages, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="quick-switcher-backdrop" onClick={onClose} role="presentation">
      <div className="quick-switcher" onClick={(event) => event.stopPropagation()} role="presentation">
        <input
          autoFocus
          value={query}
          placeholder="Jump to page..."
          spellCheck={spellcheck}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }

            if (event.key === "Enter" && filtered[0]) {
              onSelect(filtered[0].id);
              onClose();
            }
          }}
        />
        <ul>
          {filtered.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(page.id);
                  onClose();
                }}
              >
                <span>{page.title}</span>
                <small>{page.preview}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
