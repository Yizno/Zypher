#ifndef AppName
  #define AppName "Zypher"
#endif

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#ifndef SourceDir
  #define SourceDir "..\\release\\Zypher-win32-x64"
#endif

#ifndef OutputDir
  #define OutputDir "..\\release-installer"
#endif

#ifndef OutputBaseFilename
  #define OutputBaseFilename "Zypher-Setup"
#endif

[Setup]
AppId={{B2CEAC0A-AF13-4D5F-BD5B-9C9A1A16E9A7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\Zypher.exe
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
SetupIconFile=..\assets\icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\Zypher.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Zypher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Zypher.exe"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
var
  ModePage: TWizardPage;
  OptionsPanel: TPanel;
  ModeTitleLabel: TNewStaticText;
  ModeSubtitleLabel: TNewStaticText;
  InstallCard: TPanel;
  InstallRadio: TRadioButton;
  InstallDetailLabel: TNewStaticText;
  UpdateCard: TPanel;
  UpdateRadio: TRadioButton;
  UpdateDetailLabel: TNewStaticText;
  RepairCard: TPanel;
  RepairRadio: TRadioButton;
  RepairDetailLabel: TNewStaticText;
  UninstallCard: TPanel;
  UninstallRadio: TRadioButton;
  UninstallDetailLabel: TNewStaticText;
  ExistingInstall: Boolean;
  SelectedInstallMode: String;

const
  CardDefaultColor = $00212121;
  CardSelectedColor = $00323333;
  PageBackgroundColor = $00181818;
  TextPrimaryColor = clWhite;
  TextSecondaryColor = $00B5B5B5;

function GetUninstallRegKey: String;
begin
  Result := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B2CEAC0A-AF13-4D5F-BD5B-9C9A1A16E9A7}_is1';
end;

function IsAlreadyInstalled: Boolean;
var
  UninstallKey: String;
begin
  UninstallKey := GetUninstallRegKey();
  Result := RegKeyExists(HKCU, UninstallKey) or RegKeyExists(HKLM, UninstallKey);
end;

function GetInstalledUninstallCommand(var CommandValue: String): Boolean;
var
  UninstallKey: String;
begin
  UninstallKey := GetUninstallRegKey();

  if RegQueryStringValue(HKCU, UninstallKey, 'QuietUninstallString', CommandValue) then
  begin
    Result := True;
    exit;
  end;

  if RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', CommandValue) then
  begin
    Result := True;
    exit;
  end;

  if RegQueryStringValue(HKLM, UninstallKey, 'QuietUninstallString', CommandValue) then
  begin
    Result := True;
    exit;
  end;

  Result := RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', CommandValue);
end;

procedure SplitCommandLine(const CommandLine: String; var FileName: String; var Params: String);
var
  I: Integer;
  Input: String;
begin
  Input := Trim(CommandLine);
  FileName := '';
  Params := '';

  if Input = '' then
    exit;

  if Input[1] = '"' then
  begin
    I := 2;
    while (I <= Length(Input)) and (Input[I] <> '"') do
      I := I + 1;

    if I <= Length(Input) then
    begin
      FileName := Copy(Input, 2, I - 2);
      Params := Trim(Copy(Input, I + 1, MaxInt));
      exit;
    end;
  end;

  I := Pos(' ', Input);
  if I > 0 then
  begin
    FileName := Copy(Input, 1, I - 1);
    Params := Trim(Copy(Input, I + 1, MaxInt));
  end
  else
    FileName := Input;
end;

function RunUninstallFlow: Boolean;
var
  UninstallCommand: String;
  UninstallExe: String;
  UninstallParams: String;
  ResultCode: Integer;
  PromptResult: Integer;
begin
  Result := False;

  if not GetInstalledUninstallCommand(UninstallCommand) then
  begin
    MsgBox(
      'Zypher is marked as installed, but no uninstall command was found in the registry.',
      mbError,
      MB_OK
    );
    exit;
  end;

  PromptResult := MsgBox(
    'This will uninstall Zypher from your PC. Continue?',
    mbConfirmation,
    MB_YESNO
  );

  if PromptResult <> IDYES then
    exit;

  SplitCommandLine(UninstallCommand, UninstallExe, UninstallParams);
  if UninstallExe = '' then
  begin
    MsgBox('Could not parse the uninstall command.', mbError, MB_OK);
    exit;
  end;

  if Pos('/VERYSILENT', Uppercase(UninstallParams)) = 0 then
    UninstallParams := Trim(UninstallParams + ' /VERYSILENT /SUPPRESSMSGBOXES /NORESTART');

  WizardForm.NextButton.Enabled := False;
  WizardForm.BackButton.Enabled := False;
  WizardForm.CancelButton.Enabled := False;

  if not Exec(UninstallExe, UninstallParams, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('Failed to start uninstall process.', mbError, MB_OK);
    exit;
  end;

  if ResultCode <> 0 then
  begin
    MsgBox(
      'Uninstall process exited with code ' + IntToStr(ResultCode) + '.',
      mbError,
      MB_OK
    );
    exit;
  end;

  MsgBox('Zypher was uninstalled successfully.', mbInformation, MB_OK);
  Result := True;
end;

procedure ApplyCardStyle(Card: TPanel; Selected: Boolean);
begin
  if Selected then
    Card.Color := CardSelectedColor
  else
    Card.Color := CardDefaultColor;
end;

procedure ApplyModeVisualState;
begin
  ApplyCardStyle(InstallCard, SelectedInstallMode = 'install');
  ApplyCardStyle(UpdateCard, SelectedInstallMode = 'update');
  ApplyCardStyle(RepairCard, SelectedInstallMode = 'repair');
  ApplyCardStyle(UninstallCard, SelectedInstallMode = 'uninstall');
end;

procedure SelectMode(const Mode: String);
begin
  SelectedInstallMode := Mode;
  InstallRadio.Checked := Mode = 'install';
  UpdateRadio.Checked := Mode = 'update';
  RepairRadio.Checked := Mode = 'repair';
  UninstallRadio.Checked := Mode = 'uninstall';
  ApplyModeVisualState();
end;

procedure ModeControlClick(Sender: TObject);
begin
  if (Sender = InstallCard) or (Sender = InstallRadio) or (Sender = InstallDetailLabel) then
    SelectMode('install')
  else if (Sender = UpdateCard) or (Sender = UpdateRadio) or (Sender = UpdateDetailLabel) then
    SelectMode('update')
  else if (Sender = RepairCard) or (Sender = RepairRadio) or (Sender = RepairDetailLabel) then
    SelectMode('repair')
  else if (Sender = UninstallCard) or (Sender = UninstallRadio) or (Sender = UninstallDetailLabel) then
    SelectMode('uninstall');
end;

procedure ConfigureOption(
  Card: TPanel;
  Radio: TRadioButton;
  DetailLabel: TNewStaticText;
  TopOffset: Integer;
  TitleText: String;
  DetailText: String
);
begin
  Card.Parent := OptionsPanel;
  Card.Left := ScaleX(12);
  Card.Top := TopOffset;
  Card.Width := OptionsPanel.Width - ScaleX(24);
  Card.Height := ScaleY(58);
  Card.BevelOuter := bvNone;
  Card.ParentBackground := False;
  Card.Color := CardDefaultColor;
  Card.OnClick := @ModeControlClick;

  Radio.Parent := Card;
  Radio.Left := ScaleX(12);
  Radio.Top := ScaleY(8);
  Radio.Width := Card.Width - ScaleX(24);
  Radio.Caption := TitleText;
  Radio.Font.Style := [fsBold];
  Radio.Font.Color := TextPrimaryColor;
  Radio.ParentColor := True;
  Radio.OnClick := @ModeControlClick;

  DetailLabel.Parent := Card;
  DetailLabel.Left := ScaleX(32);
  DetailLabel.Top := ScaleY(30);
  DetailLabel.Width := Card.Width - ScaleX(44);
  DetailLabel.Caption := DetailText;
  DetailLabel.Font.Color := TextSecondaryColor;
  DetailLabel.OnClick := @ModeControlClick;
end;

procedure InitializeWizard;
begin
  ExistingInstall := IsAlreadyInstalled();
  ModePage := CreateCustomPage(
    wpWelcome,
    'Zypher Setup',
    'Choose how you want to continue.'
  );

  ModePage.Surface.Color := $1C1C1C;
  ModePage.Surface.ParentBackground := False;

  OptionsPanel := TPanel.Create(ModePage);
  OptionsPanel.Parent := ModePage.Surface;
  OptionsPanel.Left := ScaleX(0);
  OptionsPanel.Top := ScaleY(0);
  OptionsPanel.Width := ModePage.SurfaceWidth;
  OptionsPanel.Height := ModePage.SurfaceHeight;
  OptionsPanel.BevelOuter := bvNone;
  OptionsPanel.ParentBackground := False;
  OptionsPanel.Color := PageBackgroundColor;

  ModeTitleLabel := TNewStaticText.Create(ModePage);
  ModeTitleLabel.Parent := OptionsPanel;
  ModeTitleLabel.Left := ScaleX(16);
  ModeTitleLabel.Top := ScaleY(14);
  ModeTitleLabel.Width := OptionsPanel.Width - ScaleX(32);
  ModeTitleLabel.Caption := 'Setup Options';
  ModeTitleLabel.Font.Style := [fsBold];
  ModeTitleLabel.Font.Size := 13;
  ModeTitleLabel.Font.Color := TextPrimaryColor;

  ModeSubtitleLabel := TNewStaticText.Create(ModePage);
  ModeSubtitleLabel.Parent := OptionsPanel;
  ModeSubtitleLabel.Left := ScaleX(16);
  ModeSubtitleLabel.Top := ScaleY(42);
  ModeSubtitleLabel.Width := OptionsPanel.Width - ScaleX(32);
  ModeSubtitleLabel.Caption := 'Install, update, repair, or uninstall from one setup flow.';
  ModeSubtitleLabel.Font.Color := TextSecondaryColor;

  InstallCard := TPanel.Create(ModePage);
  InstallRadio := TRadioButton.Create(ModePage);
  InstallDetailLabel := TNewStaticText.Create(ModePage);
  ConfigureOption(
    InstallCard,
    InstallRadio,
    InstallDetailLabel,
    ScaleY(78),
    'Install',
    'Fresh install for this PC.'
  );

  UpdateCard := TPanel.Create(ModePage);
  UpdateRadio := TRadioButton.Create(ModePage);
  UpdateDetailLabel := TNewStaticText.Create(ModePage);
  ConfigureOption(
    UpdateCard,
    UpdateRadio,
    UpdateDetailLabel,
    ScaleY(143),
    'Update',
    'Install the newest setup files over your current Zypher installation.'
  );

  RepairCard := TPanel.Create(ModePage);
  RepairRadio := TRadioButton.Create(ModePage);
  RepairDetailLabel := TNewStaticText.Create(ModePage);
  ConfigureOption(
    RepairCard,
    RepairRadio,
    RepairDetailLabel,
    ScaleY(208),
    'Repair',
    'Reinstall app files while keeping your existing data.'
  );

  UninstallCard := TPanel.Create(ModePage);
  UninstallRadio := TRadioButton.Create(ModePage);
  UninstallDetailLabel := TNewStaticText.Create(ModePage);
  ConfigureOption(
    UninstallCard,
    UninstallRadio,
    UninstallDetailLabel,
    ScaleY(273),
    'Uninstall',
    'Remove Zypher from this PC.'
  );

  WizardForm.PageNameLabel.Font.Color := TextPrimaryColor;
  WizardForm.PageDescriptionLabel.Font.Color := TextSecondaryColor;

  if ExistingInstall then
  begin
    InstallCard.Visible := False;
    ModeSubtitleLabel.Caption := 'Zypher is already installed. Choose Update, Repair, or Uninstall.';
    SelectMode('update');
  end
  else
  begin
    UpdateCard.Visible := False;
    RepairCard.Visible := False;
    UninstallCard.Visible := False;
    ModeSubtitleLabel.Caption := 'Zypher was not found on this system. Continue with Install.';
    SelectMode('install');
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = ModePage.ID then
  begin
    if ExistingInstall then
    begin
      if
        (SelectedInstallMode <> 'update') and
        (SelectedInstallMode <> 'repair') and
        (SelectedInstallMode <> 'uninstall')
      then
      begin
        MsgBox('Select Update, Repair, or Uninstall to continue.', mbError, MB_OK);
        Result := False;
      end;
    end
    else
    begin
      if SelectedInstallMode <> 'install' then
      begin
        MsgBox('Install is the only available option when Zypher is not installed.', mbError, MB_OK);
        Result := False;
      end;
    end;

    if (Result = True) and (SelectedInstallMode = 'uninstall') then
    begin
      RunUninstallFlow();
      WizardForm.Close();
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(
  Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String
): String;
var
  ModeLabel: String;
begin
  if SelectedInstallMode = '' then
    ModeLabel := 'install'
  else
    ModeLabel := SelectedInstallMode;

  Result :=
    'Mode: ' + ModeLabel + NewLine + NewLine +
    MemoDirInfo + NewLine + NewLine +
    MemoTasksInfo;
end;
