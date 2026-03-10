using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal enum InstallerMode
{
  Install,
  Update,
  Repair,
  Uninstall
}

internal sealed class ModeCard
{
  public InstallerMode Mode;
  public Panel Panel;
  public Label Title;
  public Label Description;
}

internal sealed class InstallerForm : Form
{
  private const int WM_NCLBUTTONDOWN = 0xA1;
  private const int HT_CAPTION = 0x2;

  private readonly Color backgroundColor = Color.FromArgb(18, 20, 24);
  private readonly Color cardColor = Color.FromArgb(31, 35, 41);
  private readonly Color cardSelectedColor = Color.FromArgb(52, 64, 77);
  private readonly Color textPrimary = Color.FromArgb(245, 245, 245);
  private readonly Color textSecondary = Color.FromArgb(173, 184, 194);
  private readonly Color accent = Color.FromArgb(228, 231, 235);

  private readonly Dictionary<InstallerMode, ModeCard> cards = new Dictionary<InstallerMode, ModeCard>();

  private Label subtitleLabel;
  private Label statusLabel;
  private ProgressBar progressBar;
  private Button continueButton;
  private Button cancelButton;
  private Label modeHintLabel;

  private bool installed;
  private string installDir;
  private InstallerMode selectedMode;
  private bool busy;

  [DllImport("user32.dll")]
  private static extern bool ReleaseCapture();

  [DllImport("user32.dll")]
  private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

  public InstallerForm()
  {
    this.Text = "Zypher Setup";
    this.StartPosition = FormStartPosition.CenterScreen;
    this.FormBorderStyle = FormBorderStyle.None;
    this.ClientSize = new Size(920, 620);
    this.BackColor = this.backgroundColor;
    this.Font = new Font("Segoe UI", 10f, FontStyle.Regular);
    this.KeyPreview = true;
    this.KeyDown += this.OnKeyDown;
    this.ShowIcon = true;
    try
    {
      var formIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      if (formIcon != null)
        this.Icon = formIcon;
    }
    catch
    {
      // Keep the default icon if extraction fails.
    }

    this.BuildUi();
    this.LoadModes();
  }

  private void BuildUi()
  {
    var titleBar = new Panel
    {
      Left = 0,
      Top = 0,
      Width = this.ClientSize.Width,
      Height = 46,
      BackColor = Color.FromArgb(22, 24, 28),
    };
    titleBar.MouseDown += this.OnTitleBarMouseDown;
    this.Controls.Add(titleBar);

    var appTitle = new Label
    {
      Left = 16,
      Top = 12,
      Width = 420,
      Height = 22,
      Text = "Zypher Installer",
      ForeColor = this.textPrimary,
      Font = new Font("Segoe UI Semibold", 12f),
      BackColor = Color.Transparent,
    };
    appTitle.MouseDown += this.OnTitleBarMouseDown;
    titleBar.Controls.Add(appTitle);

    var closeButton = new Button
    {
      Width = 42,
      Height = 30,
      Left = this.ClientSize.Width - 54,
      Top = 8,
      Text = "X",
      FlatStyle = FlatStyle.Flat,
      BackColor = Color.FromArgb(35, 38, 44),
      ForeColor = this.textPrimary,
      TabStop = false,
    };
    closeButton.FlatAppearance.BorderSize = 0;
    closeButton.Click += delegate { this.Close(); };
    titleBar.Controls.Add(closeButton);

    var heading = new Label
    {
      Left = 28,
      Top = 68,
      Width = 860,
      Height = 42,
      Text = "Choose setup mode",
      ForeColor = this.textPrimary,
      Font = new Font("Segoe UI Semibold", 20f),
    };
    this.Controls.Add(heading);

    this.subtitleLabel = new Label
    {
      Left = 30,
      Top = 116,
      Width = 850,
      Height = 26,
      Text = string.Empty,
      ForeColor = this.textSecondary,
      Font = new Font("Segoe UI", 11f),
    };
    this.Controls.Add(this.subtitleLabel);

    var cardsContainer = new Panel
    {
      Left = 22,
      Top = 154,
      Width = 876,
      Height = 350,
      BackColor = this.backgroundColor,
    };
    this.Controls.Add(cardsContainer);

    this.CreateModeCard(cardsContainer, InstallerMode.Install, "Install", "Fresh install on this PC.", 0);
    this.CreateModeCard(cardsContainer, InstallerMode.Update, "Update", "Install the latest files over your existing Zypher install.", 86);
    this.CreateModeCard(cardsContainer, InstallerMode.Repair, "Repair", "Reinstall app files while keeping existing data.", 172);
    this.CreateModeCard(cardsContainer, InstallerMode.Uninstall, "Uninstall", "Remove Zypher from this PC.", 258);

    this.modeHintLabel = new Label
    {
      Left = 30,
      Top = 518,
      Width = 700,
      Height = 22,
      Text = string.Empty,
      ForeColor = this.textSecondary,
    };
    this.Controls.Add(this.modeHintLabel);

    this.progressBar = new ProgressBar
    {
      Left = 30,
      Top = 546,
      Width = 520,
      Height = 18,
      Style = ProgressBarStyle.Blocks,
      Value = 0,
    };
    this.Controls.Add(this.progressBar);

    this.statusLabel = new Label
    {
      Left = 30,
      Top = 570,
      Width = 620,
      Height = 24,
      Text = "Ready",
      ForeColor = this.textSecondary,
    };
    this.Controls.Add(this.statusLabel);

    this.cancelButton = new Button
    {
      Left = 684,
      Top = 542,
      Width = 100,
      Height = 40,
      Text = "Cancel",
      FlatStyle = FlatStyle.Flat,
      BackColor = Color.FromArgb(35, 38, 44),
      ForeColor = this.textPrimary,
    };
    this.cancelButton.FlatAppearance.BorderColor = Color.FromArgb(66, 72, 84);
    this.cancelButton.Click += delegate { if (!this.busy) this.Close(); };
    this.Controls.Add(this.cancelButton);

    this.continueButton = new Button
    {
      Left = 796,
      Top = 542,
      Width = 100,
      Height = 40,
      Text = "Continue",
      FlatStyle = FlatStyle.Flat,
      BackColor = this.accent,
      ForeColor = Color.FromArgb(20, 22, 26),
      Font = new Font("Segoe UI Semibold", 10f),
    };
    this.continueButton.FlatAppearance.BorderColor = Color.FromArgb(230, 233, 237);
    this.continueButton.Click += this.OnContinueClicked;
    this.Controls.Add(this.continueButton);
  }

  private void CreateModeCard(Control parent, InstallerMode mode, string title, string description, int top)
  {
    var panel = new Panel
    {
      Left = 8,
      Top = top,
      Width = 860,
      Height = 74,
      BackColor = this.cardColor,
      Cursor = Cursors.Hand,
    };
    panel.Click += this.OnModeCardClicked;
    parent.Controls.Add(panel);

    var titleLabel = new Label
    {
      Left = 18,
      Top = 11,
      Width = 760,
      Height = 26,
      Text = title,
      ForeColor = this.textPrimary,
      Font = new Font("Segoe UI Semibold", 13f),
      BackColor = Color.Transparent,
      Cursor = Cursors.Hand,
    };
    titleLabel.Click += this.OnModeCardClicked;
    panel.Controls.Add(titleLabel);

    var descriptionLabel = new Label
    {
      Left = 18,
      Top = 40,
      Width = 780,
      Height = 22,
      Text = description,
      ForeColor = this.textSecondary,
      Font = new Font("Segoe UI", 10.5f),
      BackColor = Color.Transparent,
      Cursor = Cursors.Hand,
    };
    descriptionLabel.Click += this.OnModeCardClicked;
    panel.Controls.Add(descriptionLabel);

    panel.Tag = mode;
    titleLabel.Tag = mode;
    descriptionLabel.Tag = mode;

    this.cards[mode] = new ModeCard
    {
      Mode = mode,
      Panel = panel,
      Title = titleLabel,
      Description = descriptionLabel,
    };
  }

  private void LoadModes()
  {
    this.installed = InstallerEngine.TryGetInstallInfo(out this.installDir);

    if (this.installed)
    {
      this.subtitleLabel.Text = "Zypher is installed. Choose Update, Repair, or Uninstall.";
      this.cards[InstallerMode.Install].Panel.Visible = false;
      this.SelectMode(InstallerMode.Update);
    }
    else
    {
      this.subtitleLabel.Text = "Zypher is not installed. Continue with Install.";
      this.cards[InstallerMode.Update].Panel.Visible = false;
      this.cards[InstallerMode.Repair].Panel.Visible = false;
      this.cards[InstallerMode.Uninstall].Panel.Visible = false;
      this.SelectMode(InstallerMode.Install);
    }
  }

  private void SelectMode(InstallerMode mode)
  {
    this.selectedMode = mode;
    foreach (var card in this.cards.Values)
    {
      var selected = card.Mode == mode;
      card.Panel.BackColor = selected ? this.cardSelectedColor : this.cardColor;
      card.Title.ForeColor = this.textPrimary;
      card.Description.ForeColor = this.textSecondary;
    }

    if (mode == InstallerMode.Uninstall)
      this.modeHintLabel.Text = "Uninstall removes app binaries. Local app data remains under your profile.";
    else
      this.modeHintLabel.Text = "Install/Update/Repair keeps your local data and replaces program binaries.";
  }

  private async void OnContinueClicked(object sender, EventArgs e)
  {
    if (this.busy)
      return;

    if (!this.installed && this.selectedMode != InstallerMode.Install)
    {
      MessageBox.Show("Install is the only available option when Zypher is not installed.", "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      return;
    }

    if (this.installed && this.selectedMode == InstallerMode.Install)
    {
      MessageBox.Show("Choose Update, Repair, or Uninstall for existing installations.", "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      return;
    }

    this.SetBusy(true, "Working...");
    var closeAfterSuccess = false;

    try
    {
      var result = await Task.Run(() => InstallerEngine.Execute(this.selectedMode, this.installDir, Application.ExecutablePath));
      this.statusLabel.ForeColor = Color.FromArgb(167, 243, 208);
      this.statusLabel.Text = result;
      this.progressBar.Style = ProgressBarStyle.Blocks;
      this.progressBar.Value = 100;

      if (this.selectedMode == InstallerMode.Uninstall)
      {
        MessageBox.Show("Zypher was uninstalled.", "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
        this.Close();
        return;
      }

      var exePath = Path.Combine(this.installDir, "Zypher.exe");
      if (File.Exists(exePath))
      {
        var launch = MessageBox.Show("Operation completed. Launch Zypher now?", "Zypher Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (launch == DialogResult.Yes)
          InstallerEngine.LaunchInstalledApp(exePath);
      }

      closeAfterSuccess = true;
    }
    catch (Exception ex)
    {
      this.statusLabel.ForeColor = Color.FromArgb(248, 113, 113);
      this.statusLabel.Text = "Failed: " + ex.Message;
      this.progressBar.Style = ProgressBarStyle.Blocks;
      this.progressBar.Value = 0;
      MessageBox.Show(ex.Message, "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
    finally
    {
      this.SetBusy(false, this.statusLabel.Text);
      if (closeAfterSuccess)
        this.Close();
    }
  }

  private void SetBusy(bool value, string message)
  {
    this.busy = value;
    this.continueButton.Enabled = !value;
    this.cancelButton.Enabled = !value;
    this.statusLabel.ForeColor = this.textSecondary;
    this.statusLabel.Text = message;
    this.progressBar.Style = value ? ProgressBarStyle.Marquee : ProgressBarStyle.Blocks;
    if (!value && this.progressBar.Value == 0)
      this.progressBar.Value = 0;
  }

  private void OnModeCardClicked(object sender, EventArgs e)
  {
    if (this.busy)
      return;

    var source = sender as Control;
    if (source == null || source.Tag == null)
      return;

    this.SelectMode((InstallerMode)source.Tag);
  }

  private void OnKeyDown(object sender, KeyEventArgs e)
  {
    if (e.KeyCode == Keys.Escape && !this.busy)
      this.Close();
  }

  private void OnTitleBarMouseDown(object sender, MouseEventArgs e)
  {
    if (e.Button != MouseButtons.Left)
      return;

    ReleaseCapture();
    SendMessage(this.Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
  }
}

internal static class InstallerEngine
{
  private const string AppName = "Zypher";
  private const string AppVersion = "__APP_VERSION__";
  private const string Publisher = "Zypher contributors";
  private const string NewUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Zypher";
  private const string LegacyInnoUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{B2CEAC0A-AF13-4D5F-BD5B-9C9A1A16E9A7}_is1";
  private const string PayloadResourceName = "ZypherPayload.zip";

  public static bool TryGetInstallInfo(out string installDir)
  {
    installDir = ResolveInstallDirectory();
    var mainExe = Path.Combine(installDir, "Zypher.exe");
    return File.Exists(mainExe) || HasRegistryInstall();
  }

  public static string Execute(InstallerMode mode, string installDir, string currentExePath)
  {
    switch (mode)
    {
      case InstallerMode.Install:
        InstallOrReplace(ResolveInstallDirectory(), currentExePath);
        return "Install completed.";
      case InstallerMode.Update:
        EnsureInstalled();
        InstallOrReplace(ResolveInstallDirectory(), currentExePath);
        return "Update completed.";
      case InstallerMode.Repair:
        EnsureInstalled();
        InstallOrReplace(ResolveInstallDirectory(), currentExePath);
        return "Repair completed.";
      case InstallerMode.Uninstall:
        Uninstall(ResolveInstallDirectory(), currentExePath);
        return "Uninstall completed.";
      default:
        throw new InvalidOperationException("Unsupported mode.");
    }
  }

  private static void InstallOrReplace(string targetDir, string currentExePath)
  {
    StopAppProcesses();

    var tempRoot = Path.Combine(Path.GetTempPath(), "ZypherInstaller_" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(tempRoot);

    try
    {
      ExtractPayload(tempRoot);

      if (Directory.Exists(targetDir))
        DeleteDirectoryWithRetries(targetDir, 8, 400);

      Directory.CreateDirectory(targetDir);
      CopyDirectory(tempRoot, targetDir);

      var helperExePath = Path.Combine(targetDir, "Installer", "Zypher Setup.exe");
      Directory.CreateDirectory(Path.GetDirectoryName(helperExePath));
      File.Copy(currentExePath, helperExePath, true);

      CreateShortcuts(Path.Combine(targetDir, "Zypher.exe"));
      WriteUninstallRegistration(targetDir, helperExePath);
    }
    finally
    {
      if (Directory.Exists(tempRoot))
      {
        try { Directory.Delete(tempRoot, true); }
        catch { }
      }
    }
  }

  private static void Uninstall(string targetDir, string currentExePath)
  {
    StopAppProcesses();
    RemoveShortcuts();

    DeleteRegistryTree(Registry.CurrentUser, NewUninstallKey);
    DeleteRegistryTree(Registry.CurrentUser, LegacyInnoUninstallKey);
    DeleteRegistryTree(Registry.LocalMachine, LegacyInnoUninstallKey);

    if (!Directory.Exists(targetDir))
      return;

    var normalizedTarget = targetDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    var normalizedCurrent = Path.GetFullPath(currentExePath);
    var runningFromInstallDir = normalizedCurrent.StartsWith(normalizedTarget, StringComparison.OrdinalIgnoreCase);

    if (runningFromInstallDir)
    {
      ScheduleDeleteAfterExit(targetDir);
      return;
    }

    DeleteDirectoryWithRetries(targetDir, 8, 500);
  }

  private static void EnsureInstalled()
  {
    string installDir;
    if (!TryGetInstallInfo(out installDir))
      throw new InvalidOperationException("Zypher is not installed on this machine.");
  }

  private static string ResolveInstallDirectory()
  {
    var fromNew = ReadRegistryString(Registry.CurrentUser, NewUninstallKey, "InstallLocation");
    if (!string.IsNullOrWhiteSpace(fromNew))
      return fromNew;

    var fromLegacy = ReadRegistryString(Registry.CurrentUser, LegacyInnoUninstallKey, "InstallLocation");
    if (!string.IsNullOrWhiteSpace(fromLegacy))
      return fromLegacy;

    var legacyPath = ReadRegistryString(Registry.CurrentUser, LegacyInnoUninstallKey, "Inno Setup: App Path");
    if (!string.IsNullOrWhiteSpace(legacyPath))
      return legacyPath;

    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
  }

  private static bool HasRegistryInstall()
  {
    return RegistryKeyExists(Registry.CurrentUser, NewUninstallKey) ||
      RegistryKeyExists(Registry.CurrentUser, LegacyInnoUninstallKey) ||
      RegistryKeyExists(Registry.LocalMachine, LegacyInnoUninstallKey);
  }

  private static void ExtractPayload(string outputDir)
  {
    var assembly = Assembly.GetExecutingAssembly();
    var resourceName = assembly.GetManifestResourceNames()
      .FirstOrDefault(n => n.EndsWith(PayloadResourceName, StringComparison.OrdinalIgnoreCase));

    if (resourceName == null)
      throw new InvalidOperationException("Installer payload was not found in executable resources.");

    using (var stream = assembly.GetManifestResourceStream(resourceName))
    {
      if (stream == null)
        throw new InvalidOperationException("Installer payload stream is unavailable.");

      using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
      {
        foreach (var entry in archive.Entries)
        {
          if (string.IsNullOrEmpty(entry.FullName))
            continue;

          var destinationPath = Path.Combine(outputDir, entry.FullName);
          var destinationDir = Path.GetDirectoryName(destinationPath);
          if (!string.IsNullOrEmpty(destinationDir))
            Directory.CreateDirectory(destinationDir);

          if (entry.Name.Length == 0)
            continue;

          entry.ExtractToFile(destinationPath, true);
        }
      }
    }
  }

  private static void CopyDirectory(string sourceDir, string destinationDir)
  {
    foreach (var directory in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
      Directory.CreateDirectory(directory.Replace(sourceDir, destinationDir));

    foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
      File.Copy(file, file.Replace(sourceDir, destinationDir), true);
  }

  private static void StopAppProcesses()
  {
    var names = new[] { AppName };
    foreach (var name in names)
    {
      foreach (var process in Process.GetProcessesByName(name))
      {
        try
        {
          process.Kill();
          process.WaitForExit(4000);
        }
        catch { }
      }
    }
  }

  private static void WriteUninstallRegistration(string installDir, string helperExePath)
  {
    using (var key = Registry.CurrentUser.CreateSubKey(NewUninstallKey))
    {
      if (key == null)
        throw new InvalidOperationException("Could not write uninstall registry key.");

      var uninstallCommand = Quote(helperExePath) + " --mode uninstall";
      key.SetValue("DisplayName", AppName, RegistryValueKind.String);
      key.SetValue("DisplayVersion", AppVersion, RegistryValueKind.String);
      key.SetValue("Publisher", Publisher, RegistryValueKind.String);
      key.SetValue("InstallLocation", installDir, RegistryValueKind.String);
      key.SetValue("DisplayIcon", Path.Combine(installDir, "Zypher.exe"), RegistryValueKind.String);
      key.SetValue("UninstallString", uninstallCommand, RegistryValueKind.String);
      key.SetValue("QuietUninstallString", uninstallCommand + " --silent", RegistryValueKind.String);
      key.SetValue("NoModify", 1, RegistryValueKind.DWord);
      key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
      key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"), RegistryValueKind.String);
    }
  }

  private static void CreateShortcuts(string targetExe)
  {
    var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Zypher.lnk");
    var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Zypher.lnk");

    CreateShortcut(startMenu, targetExe);
    CreateShortcut(desktop, targetExe);
  }

  private static void RemoveShortcuts()
  {
    var names = new[] { AppName };
    foreach (var name in names)
    {
      TryDeleteFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), name + ".lnk"));
      TryDeleteFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", name + ".lnk"));
    }
  }

  private static void CreateShortcut(string shortcutPath, string targetExe)
  {
    try
    {
      var shellType = Type.GetTypeFromProgID("WScript.Shell");
      if (shellType == null)
        return;

      var shell = Activator.CreateInstance(shellType);
      dynamic shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
      shortcut.TargetPath = targetExe;
      shortcut.WorkingDirectory = Path.GetDirectoryName(targetExe);
      shortcut.IconLocation = targetExe + ",0";
      shortcut.Save();
    }
    catch { }
  }

  public static void LaunchInstalledApp(string exePath)
  {
    var info = new ProcessStartInfo
    {
      FileName = exePath,
      WorkingDirectory = Path.GetDirectoryName(exePath),
      UseShellExecute = false
    };

    // Installer might inherit this variable from a terminal session.
    // If set, Electron runs in Node mode and exits immediately.
    if (info.EnvironmentVariables.ContainsKey("ELECTRON_RUN_AS_NODE"))
      info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");

    Process.Start(info);
  }

  private static void ScheduleDeleteAfterExit(string installDir)
  {
    var batchPath = Path.Combine(Path.GetTempPath(), "ZypherUninstall_" + Guid.NewGuid().ToString("N") + ".cmd");
    var lines = new[]
    {
      "@echo off",
      "timeout /t 2 /nobreak >nul",
      "rmdir /s /q \"" + installDir + "\"",
      "reg delete \"HKCU\\" + NewUninstallKey + "\" /f >nul 2>&1",
      "reg delete \"HKCU\\" + LegacyInnoUninstallKey + "\" /f >nul 2>&1",
      "del \"%~f0\""
    };
    File.WriteAllLines(batchPath, lines);

    var info = new ProcessStartInfo("cmd.exe", "/c start \"\" \"" + batchPath + "\"");
    info.CreateNoWindow = true;
    info.UseShellExecute = false;
    Process.Start(info);
  }

  private static void DeleteDirectoryWithRetries(string path, int attempts, int delayMs)
  {
    Exception last = null;
    for (var attempt = 0; attempt < attempts; attempt++)
    {
      try
      {
        if (!Directory.Exists(path))
          return;

        NormalizeAttributes(path);
        Directory.Delete(path, true);
        return;
      }
      catch (Exception ex)
      {
        last = ex;
        Thread.Sleep(delayMs);
      }
    }

    if (last != null)
      throw last;
  }

  private static void NormalizeAttributes(string root)
  {
    foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
    {
      try { File.SetAttributes(file, FileAttributes.Normal); }
      catch { }
    }
  }

  private static void TryDeleteFile(string filePath)
  {
    try
    {
      if (File.Exists(filePath))
      {
        File.SetAttributes(filePath, FileAttributes.Normal);
        File.Delete(filePath);
      }
    }
    catch { }
  }

  private static bool RegistryKeyExists(RegistryKey root, string subKey)
  {
    using (var key = root.OpenSubKey(subKey))
      return key != null;
  }

  private static string ReadRegistryString(RegistryKey root, string subKey, string valueName)
  {
    using (var key = root.OpenSubKey(subKey))
    {
      if (key == null)
        return null;

      return key.GetValue(valueName) as string;
    }
  }

  private static void DeleteRegistryTree(RegistryKey root, string subKey)
  {
    try
    {
      if (RegistryKeyExists(root, subKey))
        root.DeleteSubKeyTree(subKey, false);
    }
    catch { }
  }

  private static string Quote(string value)
  {
    return "\"" + value + "\"";
  }
}

internal static class Program
{
  [STAThread]
  private static void Main(string[] args)
  {
    try
    {
      var modeFromArgs = GetModeFromArgs(args);
      var silent = args.Any(a => string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase));

      if (modeFromArgs == InstallerMode.Uninstall)
      {
        if (!silent)
        {
          var confirm = MessageBox.Show(
            "This will uninstall Zypher from this PC. Continue?",
            "Zypher Setup",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question
          );
          if (confirm != DialogResult.Yes)
            return;
        }

        var installDir = string.Empty;
        InstallerEngine.TryGetInstallInfo(out installDir);
        InstallerEngine.Execute(InstallerMode.Uninstall, installDir, Application.ExecutablePath);
        if (!silent)
          MessageBox.Show("Zypher was uninstalled.", "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return;
      }

      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new InstallerForm());
    }
    catch (Exception ex)
    {
      MessageBox.Show(ex.Message, "Zypher Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }

  private static InstallerMode? GetModeFromArgs(string[] args)
  {
    for (var i = 0; i < args.Length; i++)
    {
      if (!string.Equals(args[i], "--mode", StringComparison.OrdinalIgnoreCase))
        continue;

      if (i + 1 >= args.Length)
        continue;

      var value = args[i + 1].Trim().ToLowerInvariant();
      if (value == "install") return InstallerMode.Install;
      if (value == "update") return InstallerMode.Update;
      if (value == "repair") return InstallerMode.Repair;
      if (value == "uninstall") return InstallerMode.Uninstall;
    }

    return null;
  }
}
