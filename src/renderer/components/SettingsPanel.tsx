import { useEffect, useMemo, useRef, useState } from "react";

import { BUILT_IN_FONT_FAMILIES, getSelectableFontFamilies } from "../../../shared/fonts";
import type { AppSettings, BackupItem, ExportFormat, MemoryReplayItem, SecurityState } from "../../../shared/types";
import {
  formatAccessDate,
  getDefaultReviewSelection,
  getNextMonthlyReviewAccessDate,
  getNextYearlyReviewAccessDate,
  isMonthlyReviewAccessDate,
  isYearlyReviewAccessDate
} from "../../../shared/reviewWindows";
import { selectAllInputText } from "../utils/inputSelection";

interface SettingsPanelProps {
  settings: AppSettings;
  backups: BackupItem[];
  memories: MemoryReplayItem[];
  securityState: SecurityState;
  securityBusy: boolean;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onImportFonts: () => void;
  onRemoveImportedFont: (fontId: string) => void;
  onClearAllHistory: () => void;
  onCreateBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  onRefreshMemories: () => void;
  onOpenMemory: (pageId: string) => void;
  onGenerateReview: (period: "month" | "year", year: number, month?: number) => void;
  onExport: (format: ExportFormat) => void;
  onImport: () => void;
  onEnablePin: (pin: string) => Promise<void>;
  onChangePin: (currentPin: string, newPin: string) => Promise<void>;
  onDisablePin: (pin: string) => Promise<void>;
  onLockNow: () => Promise<void>;
  onResetEncryptedData: () => Promise<void>;
  focusSection?: "reviews" | null;
  focusSectionToken?: number;
}

const PIN_PATTERN = /^[^\s]{4,64}$/;

export default function SettingsPanel({
  settings,
  backups,
  memories,
  securityState,
  securityBusy,
  onUpdateSettings,
  onImportFonts,
  onRemoveImportedFont,
  onClearAllHistory,
  onCreateBackup,
  onRestoreBackup,
  onRefreshMemories,
  onOpenMemory,
  onGenerateReview,
  onExport,
  onImport,
  onEnablePin,
  onChangePin,
  onDisablePin,
  onLockNow,
  onResetEncryptedData,
  focusSection = null,
  focusSectionToken = 0
}: SettingsPanelProps): JSX.Element {
  const defaultReviewSelection = useMemo(() => getDefaultReviewSelection(new Date()), []);
  const [reviewYear, setReviewYear] = useState<number>(defaultReviewSelection.year);
  const [reviewMonth, setReviewMonth] = useState<number>(defaultReviewSelection.month);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changeCurrentPin, setChangeCurrentPin] = useState("");
  const [changeNewPin, setChangeNewPin] = useState("");
  const [changeConfirmPin, setChangeConfirmPin] = useState("");
  const [disablePin, setDisablePin] = useState("");
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [cooldownNowMs, setCooldownNowMs] = useState<number>(() => Date.now());
  const reviewsSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!securityState.cooldownUntil) {
      return;
    }

    const cooldownAt = Date.parse(securityState.cooldownUntil);
    if (!Number.isFinite(cooldownAt) || cooldownAt <= Date.now()) {
      return;
    }

    setCooldownNowMs(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCooldownNowMs(now);
      if (now >= cooldownAt) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [securityState.cooldownUntil]);

  const cooldownLabel = useMemo(() => {
    if (!securityState.cooldownUntil) {
      return null;
    }
    const cooldownAt = Date.parse(securityState.cooldownUntil);
    if (!Number.isFinite(cooldownAt)) {
      return null;
    }
    const delta = Math.max(0, cooldownAt - cooldownNowMs);
    if (delta <= 0) {
      return null;
    }
    return `${Math.ceil(delta / 1000)}s`;
  }, [cooldownNowMs, securityState.cooldownUntil]);

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        value: index + 1,
        label: new Date(2000, index, 1).toLocaleString(undefined, { month: "long" })
      })),
    []
  );
  const today = new Date();
  const monthlyReviewEnabled = isMonthlyReviewAccessDate(today);
  const yearlyReviewEnabled = isYearlyReviewAccessDate(today);
  const nextMonthlyReviewDate = monthlyReviewEnabled ? null : getNextMonthlyReviewAccessDate(today);
  const nextYearlyReviewDate = yearlyReviewEnabled ? null : getNextYearlyReviewAccessDate(today);
  const availableFonts = useMemo(() => getSelectableFontFamilies(settings.importedFonts), [settings.importedFonts]);

  const validatePin = (pin: string): string | null => {
    if (!PIN_PATTERN.test(pin)) {
      return "Password must be 4-64 characters with no spaces.";
    }
    return null;
  };

  const submitEnablePin = async (): Promise<void> => {
    const validation = validatePin(newPin);
    if (validation) {
      setSecurityError(validation);
      return;
    }
    if (newPin !== confirmPin) {
      setSecurityError("Password confirmation does not match.");
      return;
    }
    setSecurityError(null);
    await onEnablePin(newPin);
    setNewPin("");
    setConfirmPin("");
  };

  const submitChangePin = async (): Promise<void> => {
    const validation = validatePin(changeNewPin);
    if (validation) {
      setSecurityError(validation);
      return;
    }
    if (changeNewPin !== changeConfirmPin) {
      setSecurityError("Password confirmation does not match.");
      return;
    }
    setSecurityError(null);
    await onChangePin(changeCurrentPin, changeNewPin);
    setChangeCurrentPin("");
    setChangeNewPin("");
    setChangeConfirmPin("");
  };

  const submitDisablePin = async (): Promise<void> => {
    const validation = validatePin(disablePin);
    if (validation) {
      setSecurityError(validation);
      return;
    }
    setSecurityError(null);
    await onDisablePin(disablePin);
    setDisablePin("");
  };

  useEffect(() => {
    if (focusSection !== "reviews") {
      return;
    }

    reviewsSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, [focusSection, focusSectionToken]);

  const renderSecuritySection = (): JSX.Element => {
    return (
      <section>
        <h3>Security</h3>
        <label>
          <span>Idle lock timeout (minutes)</span>
          <input
            value={settings.idleLockMinutes}
            min={1}
            max={180}
            type="number"
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ idleLockMinutes: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Self-destruct after repeated failed password attempts</span>
          <input
            checked={settings.selfDestructOnFailedPin}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings({
                selfDestructOnFailedPin: event.currentTarget.checked
              })
            }
          />
        </label>
        <label>
          <span>Failed password attempts before wipe</span>
          <input
            value={settings.selfDestructPinFailureLimit}
            min={1}
            max={100}
            type="number"
            disabled={!settings.selfDestructOnFailedPin}
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ selfDestructPinFailureLimit: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Show "Forgot Password? Reset data" on the lock screen</span>
          <input
            checked={settings.allowResetFromLockScreen}
            type="checkbox"
            onChange={(event) => onUpdateSettings({ allowResetFromLockScreen: event.currentTarget.checked })}
          />
        </label>
        {settings.selfDestructOnFailedPin ? (
          <div className="settings-note">When the limit is reached, Zypher immediately wipes all local journal data.</div>
        ) : null}

        {securityState.pinEnabled ? (
          <>
            <div className="security-status">
              <strong>Password protection enabled</strong>
              <span>
                Failed attempts: {securityState.failedAttempts}
                {cooldownLabel ? ` | Cooldown: ${cooldownLabel}` : ""}
              </span>
            </div>

            <div className="settings-actions">
              <button type="button" disabled={securityBusy} onClick={() => void onLockNow()}>
                Lock now
              </button>
            </div>

            <label>
              <span>Current password</span>
              <input
                type="password"
                maxLength={64}
                value={changeCurrentPin}
                disabled={securityBusy}
                onChange={(event) => setChangeCurrentPin(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>New password</span>
              <input
                type="password"
                maxLength={64}
                value={changeNewPin}
                disabled={securityBusy}
                onChange={(event) => setChangeNewPin(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                type="password"
                maxLength={64}
                value={changeConfirmPin}
                disabled={securityBusy}
                onChange={(event) => setChangeConfirmPin(event.currentTarget.value)}
              />
            </label>
            <div className="settings-actions">
              <button type="button" disabled={securityBusy} onClick={() => void submitChangePin()}>
                Change password
              </button>
            </div>

            <label>
              <span>Password to disable protection</span>
              <input
                type="password"
                maxLength={64}
                value={disablePin}
                disabled={securityBusy}
                onChange={(event) => setDisablePin(event.currentTarget.value)}
              />
            </label>
            <div className="settings-actions">
              <button type="button" disabled={securityBusy} onClick={() => void submitDisablePin()}>
                Disable password and decrypt data
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              <span>New password</span>
              <input
                type="password"
                maxLength={64}
                value={newPin}
                disabled={securityBusy}
                onChange={(event) => setNewPin(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                maxLength={64}
                value={confirmPin}
                disabled={securityBusy}
                onChange={(event) => setConfirmPin(event.currentTarget.value)}
              />
            </label>
            <div className="settings-actions">
              <button type="button" disabled={securityBusy} onClick={() => void submitEnablePin()}>
                Enable password protection
              </button>
            </div>
          </>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="danger-btn"
            disabled={securityBusy}
            onClick={() => void onResetEncryptedData()}
          >
            Forgot Password? Reset encrypted data
          </button>
        </div>

        {securityError ? <div className="security-error">{securityError}</div> : null}
      </section>
    );
  };

  return (
    <div className="settings-panel">
      <section>
        <h3>General</h3>
        <label>
          <span>Open last page on launch</span>
          <input
            checked={settings.openLastPageOnLaunch}
            type="checkbox"
            onChange={(event) => onUpdateSettings({ openLastPageOnLaunch: event.currentTarget.checked })}
          />
        </label>
        <label>
          <span>Sidebar open by default</span>
          <input
            checked={settings.sidebarOpenByDefault}
            type="checkbox"
            onChange={(event) => onUpdateSettings({ sidebarOpenByDefault: event.currentTarget.checked })}
          />
        </label>
        <label>
          <span>Show launch popups for On This Day memories and reviews</span>
          <input
            checked={settings.launchPopupsEnabled}
            type="checkbox"
            onChange={(event) => onUpdateSettings({ launchPopupsEnabled: event.currentTarget.checked })}
          />
        </label>
      </section>

      <section>
        <h3>Editor</h3>
        <label>
          <span>Default font (for all text using "Default")</span>
          <select value={settings.defaultFont} onChange={(event) => onUpdateSettings({ defaultFont: event.currentTarget.value })}>
            {availableFonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-subsection">
          <div className="settings-subsection-header">
            <strong>Custom fonts</strong>
            <button type="button" onClick={onImportFonts}>
              Import fonts
            </button>
          </div>
          <div className="settings-note">
            Import your own `.ttf`, `.otf`, `.woff`, or `.woff2` files to use them in the editor and as the default font.
          </div>
          <div className="settings-note">
            Imported fonts stay local to this device unless you use an Encrypted ZIP (Full App) backup.
          </div>
          <ul className="settings-font-list">
            {settings.importedFonts.length === 0 ? (
              <li className="settings-font-empty">No imported fonts yet.</li>
            ) : (
              settings.importedFonts.map((font) => (
                <li key={font.id}>
                  <div>
                    <strong>{font.family}</strong>
                    <span>{font.originalName}</span>
                  </div>
                  <button type="button" className="danger-btn" onClick={() => onRemoveImportedFont(font.id)}>
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="settings-note">Built-in editor fonts: {BUILT_IN_FONT_FAMILIES.join(", ")}.</div>
        </div>
        <label>
          <span>Default font size (for text using "Default")</span>
          <input
            value={settings.fontSize}
            min={12}
            max={30}
            type="number"
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ fontSize: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Line height</span>
          <input
            value={settings.lineHeight}
            min={1.2}
            max={2.2}
            step={0.1}
            type="number"
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ lineHeight: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Tab size</span>
          <input
            value={settings.tabSize}
            min={1}
            max={8}
            type="number"
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ tabSize: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Autosave delay (ms)</span>
          <input
            value={settings.autosaveDelayMs}
            min={200}
            max={5000}
            type="number"
            onFocus={(event) => selectAllInputText(event.currentTarget)}
            onChange={(event) => onUpdateSettings({ autosaveDelayMs: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Show spellcheck underlines</span>
          <input checked={settings.spellcheck} type="checkbox" onChange={(event) => onUpdateSettings({ spellcheck: event.currentTarget.checked })} />
        </label>
      </section>

      <section>
        <h3>History</h3>
        <label>
          <span>Save page history snapshots</span>
          <input
            checked={settings.historySnapshotsEnabled}
            type="checkbox"
            onChange={(event) => onUpdateSettings({ historySnapshotsEnabled: event.currentTarget.checked })}
          />
        </label>
        <div className="settings-note">Turn this off to stop creating entries in the page History restore menu.</div>
        <div className="settings-actions">
          <button type="button" className="danger-btn" onClick={onClearAllHistory}>
            Delete all saved history
          </button>
        </div>
        <div className="settings-note">This permanently removes saved History snapshots for every page, but keeps the pages themselves.</div>
      </section>

      <section>
        <h3>Appearance</h3>
        <label>
          <span>Theme</span>
          <select value={settings.theme} onChange={(event) => onUpdateSettings({ theme: event.currentTarget.value as AppSettings["theme"] })}>
            <option value="matte">Matte dark</option>
            <option value="graphite">Graphite</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </label>
        <label>
          <span>Accent color</span>
          <input value={settings.accentColor} type="color" onChange={(event) => onUpdateSettings({ accentColor: event.currentTarget.value })} />
        </label>
        <label>
          <span>High contrast boost</span>
          <input checked={settings.highContrast} type="checkbox" onChange={(event) => onUpdateSettings({ highContrast: event.currentTarget.checked })} />
        </label>
      </section>

      {renderSecuritySection()}

      <section ref={reviewsSectionRef}>
        <h3>Memories & Reviews</h3>
        <div className="settings-actions">
          <button type="button" onClick={onRefreshMemories}>
            Refresh On This Day
          </button>
        </div>
        {memories.length === 0 ? (
          <div className="settings-note">No On This Day memories for 1, 2, or 5 years ago.</div>
        ) : (
          <ul className="memory-list">
            {memories.map((memory) => (
              <li key={memory.id}>
                <div>
                  <strong>{memory.title}</strong>
                  <span className="memory-meta">
                    {memory.yearOffset} year{memory.yearOffset === 1 ? "" : "s"} ago - {new Date(memory.createdAt).toLocaleDateString()}
                  </span>
                  <span className="memory-preview">{memory.preview || "No preview available."}</span>
                </div>
                <button type="button" onClick={() => onOpenMemory(memory.pageId)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="review-controls">
          <label>
            <span>Year</span>
            <input
              type="number"
              min={1970}
              max={9999}
              value={reviewYear}
              onChange={(event) => setReviewYear(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Month</span>
            <select value={reviewMonth} onChange={(event) => setReviewMonth(Number(event.currentTarget.value))}>
              {monthLabels.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            disabled={!monthlyReviewEnabled}
            onClick={() => onGenerateReview("month", reviewYear, reviewMonth)}
          >
            Generate Monthly Review
          </button>
          <button type="button" disabled={!yearlyReviewEnabled} onClick={() => onGenerateReview("year", reviewYear)}>
            Generate Year in Review
          </button>
        </div>
        {!monthlyReviewEnabled && nextMonthlyReviewDate ? (
          <div className="settings-note">Monthly review generation unlocks on {formatAccessDate(nextMonthlyReviewDate)}.</div>
        ) : null}
        {!yearlyReviewEnabled && nextYearlyReviewDate ? (
          <div className="settings-note">Year in Review unlocks on {formatAccessDate(nextYearlyReviewDate)}.</div>
        ) : null}
      </section>

      <section>
        <h3>Data</h3>
        <div className="settings-actions">
          <button type="button" onClick={onCreateBackup}>
            Create backup
          </button>
          <button type="button" onClick={onImport}>
            Import JSON / Encrypted ZIP (Key Prompt)
          </button>
          <button type="button" onClick={() => onExport("json")}>
            Export JSON
          </button>
          <button type="button" onClick={() => onExport("json-encrypted")}>
            Export JSON (Encrypted)
          </button>
          <button type="button" onClick={() => onExport("encrypted-zip")}>
            Export Encrypted ZIP (Full App)
          </button>
          <button type="button" onClick={() => onExport("html")}>
            Export HTML
          </button>
          <button type="button" onClick={() => onExport("txt")}>
            Export TXT
          </button>
          <button type="button" onClick={() => onExport("md")}>
            Export MD
          </button>
        </div>
        <ul className="backup-list">
          {backups.slice(0, 12).map((backup) => (
            <li key={backup.id}>
              <span>{new Date(backup.createdAt).toLocaleString()}</span>
              <button type="button" onClick={() => onRestoreBackup(backup.id)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Shortcuts</h3>
        <label>
          <span>New Page</span>
          <input
            value={settings.shortcuts.newPage}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, newPage: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span>Find in Note</span>
          <input
            value={settings.shortcuts.focusSearch}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, focusSearch: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span>Quick Switcher</span>
          <input
            value={settings.shortcuts.quickSwitcher}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, quickSwitcher: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span>Toggle Sidebar</span>
          <input
            value={settings.shortcuts.toggleSidebar}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, toggleSidebar: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span>Open Settings</span>
          <input
            value={settings.shortcuts.openSettings}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, openSettings: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span>Lock App</span>
          <input
            value={settings.shortcuts.lockApp}
            onChange={(event) =>
              onUpdateSettings({ shortcuts: { ...settings.shortcuts, lockApp: event.currentTarget.value } })
            }
          />
        </label>
      </section>
    </div>
  );
}
