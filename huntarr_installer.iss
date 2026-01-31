#define MyAppName "Huntarr"
#define ReadVersionFile(str fileName) \
   Local[0] = FileOpen(fileName), \
   Local[1] = FileRead(Local[0]), \
   FileClose(Local[0]), \
   Local[1]

#define MyAppVersion ReadVersionFile("version.txt")
#define MyAppPublisher "Huntarr"
#define MyAppURL "https://github.com/plexguide/Huntarr.io"
#define MyAppExeName "Huntarr.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
; Do not use the same AppId value in installers for other applications.
AppId={{22AE2CDB-5F87-4E42-B5C3-28E121D4BDFF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=LICENSE
OutputDir=.\installer
OutputBaseFilename=Huntarr_Setup
SetupIconFile=frontend\static\logo\huntarr.ico
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=no
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 0,6.1
; Start automatically - same pattern as Sonarr "Select Additional Tasks" (Service = no tray, Startup = tray can show)
Name: "windowsService"; Description: "Install Windows Service (Starts when the computer starts as the LocalService user, you will need to change the user to access network shares)"; GroupDescription: "Start automatically"; Flags: exclusive unchecked
Name: "startupShortcut"; Description: "Create shortcut in Startup folder (Starts when you log into Windows)"; GroupDescription: "Start automatically"; Flags: exclusive
Name: "none"; Description: "Do not start automatically"; GroupDescription: "Start automatically"; Flags: exclusive unchecked

[Files]
Source: "dist\Huntarr\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Create empty config directories to ensure they exist with proper permissions
Source: "LICENSE"; DestDir: "{app}\config"; Flags: ignoreversion; AfterInstall: CreateConfigDirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
; Startup shortcut - same as Sonarr: run in user session so system tray can appear
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: startupShortcut

[Run]
; Remove any existing service first (same as Sonarr)
Filename: "{app}\{#MyAppExeName}"; Parameters: "--remove-service"; Flags: runhidden
Filename: "{sys}\cmd.exe"; Parameters: "/c timeout /t 3"; Flags: runhidden
; Grant permissions to the config directory
Filename: "{sys}\cmd.exe"; Parameters: '/c icacls "{app}\config" /grant Everyone:(OI)(CI)F'; Flags: runhidden shellexec
; If user chose Windows Service: install and start (no tray - Session 0)
Filename: "{app}\{#MyAppExeName}"; Parameters: "--install-service"; StatusMsg: "Installing Windows Service"; Tasks: windowsService; Flags: runhidden
Filename: "{sys}\net.exe"; Parameters: "start Huntarr"; Flags: runhidden; Tasks: windowsService
; Post-install: open Web UI
Filename: "http://localhost:9705"; Description: "Open Huntarr Web Interface"; Flags: postinstall shellexec nowait
; If user chose Startup or None: run Huntarr now (tray will show; at logon Startup shortcut runs it)
Filename: "{app}\{#MyAppExeName}"; Description: "Start Huntarr"; Flags: postinstall skipifsilent nowait; Tasks: startupShortcut none

[UninstallRun]
; Stop and remove the Windows Service if it was installed
Filename: "{sys}\net.exe"; Parameters: "stop Huntarr"; Flags: runhidden
Filename: "{sys}\cmd.exe"; Parameters: "/c timeout /t 3"; Flags: runhidden
Filename: "{app}\{#MyAppExeName}"; Parameters: "--remove-service"; Flags: runhidden

[UninstallDelete]
; Remove Startup folder shortcut if it was created (same as Sonarr)
Type: files; Name: "{userstartup}\{#MyAppName}.lnk"

[Code]
procedure CreateConfigDirs;
begin
  // Create necessary directories with explicit permissions
  ForceDirectories(ExpandConstant('{app}\config\logs'));
  ForceDirectories(ExpandConstant('{app}\config\stateful'));
  ForceDirectories(ExpandConstant('{app}\config\user'));
end;

// Check for running services and processes before install
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Try to stop the service if it's already running
  Exec(ExpandConstant('{sys}\net.exe'), 'stop Huntarr', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Give it a moment to stop
  Sleep(2000);
  Result := True;
end;

// Handle cleaning up before uninstall
function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  // Try to stop the service before uninstalling
  Exec(ExpandConstant('{sys}\net.exe'), 'stop Huntarr', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(2000);
  Result := True;
end; 