interface TitleBarProps {
  title: string;
  isSidebarOpen: boolean;
  isExpanded: boolean;
  onToggleSidebar: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

function SidebarIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="1.5" rx="0.75" />
      <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" />
      <rect x="2" y="11.5" width="12" height="1.5" rx="0.75" />
    </svg>
  );
}

function MinimizeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="3" y="11" width="10" height="1.5" rx="0.75" />
    </svg>
  );
}

function MaximizeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="3.2" y="3.2" width="9.6" height="9.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RestoreIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="5.2" y="3.2" width="7.6" height="7.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="3.2" y="5.2" width="7.6" height="7.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

export default function TitleBar({
  title,
  isSidebarOpen,
  isExpanded,
  onToggleSidebar,
  onMinimize,
  onToggleMaximize,
  onClose
}: TitleBarProps): JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <button
          aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          className={`icon-btn sidebar-toggle-btn ${isSidebarOpen ? "active" : ""}`}
          type="button"
          onClick={onToggleSidebar}
        >
          <SidebarIcon />
        </button>
      </div>
      <div className="titlebar-center" onDoubleClick={onToggleMaximize} role="presentation">
        <span className="titlebar-title">{title}</span>
      </div>
      <div className="titlebar-right">
        <button aria-label="Minimize window" className="window-btn" type="button" onClick={onMinimize}>
          <MinimizeIcon />
        </button>
        <button
          aria-label={isExpanded ? "Restore window" : "Maximize window"}
          className="window-btn"
          type="button"
          onClick={onToggleMaximize}
        >
          {isExpanded ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button aria-label="Close window" className="window-btn window-btn-close" type="button" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
