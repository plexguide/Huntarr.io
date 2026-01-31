; Huntarr Windows installer - mirrors Sonarr's installer structure exactly
; https://github.com/Sonarr/Sonarr/blob/v5-develop/distribution/windows/setup/sonarr.iss

#define MyAppName "Huntarr"
#define MyAppPublisher "Huntarr"
#define MyAppURL "https://github.com/plexguide/Huntarr.io"
#define MyAppExeName "Huntarr.exe"
#define ReadVersionFile(str fileName) \
  Local[0] = FileOpen(fileName), \
  Local[1] = FileRead(Local[0]), \
  FileClose(Local[0]), \
  Local[1]
#define MyAppVersion ReadVersionFile("version.txt")

[Setup]
AppId={{22AE2CDB-5F87-4E42-B5C3-28E121D4BDFF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
UsePreviousAppDir=no
DefaultDirName={commonappdata}\{#MyAppName}\bin
DisableDirPage=yes
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=Huntarr_Setup
OutputDir=installer
SolidCompression=yes
AllowUNCPath=False
UninstallDisplayIcon={app}\{#MyAppExeName}
DisableReadyPage=True
Compression=lzma2/normal
CompressionThreads=2
VersionInfoVersion={#MyAppVersion}
SetupLogging=yes
AppverName={#MyAppName}
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=frontend\static\logo\huntarr.ico
LicenseFile=LICENSE

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopIcon"; Description: "{cm:CreateDesktopIcon}"
Name: "windowsService"; Description: "Install Windows Service (Starts when the computer starts as the LocalService user, you will need to change the user to access network shares)"; GroupDescription: "Start automatically"; Flags: exclusive unchecked
Name: "startupShortcut"; Description: "Create shortcut in Startup folder (Starts when you log into Windows)"; GroupDescription: "Start automatically"; Flags: exclusive
Name: "none"; Description: "Do not start automatically"; GroupDescription: "Start automatically"; Flags: exclusive unchecked

[Files]
Source: "dist\Huntarr\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "LICENSE"; DestDir: "{app}\config"; Flags: ignoreversion; AfterInstall: CreateConfigDirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopIcon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: startupShortcut

[InstallDelete]
Name: "{app}"; Type: filesandordirs

[Run]
Filename: "{app}\{#MyAppExeName}"; StatusMsg: "Removing previous Windows Service"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; StatusMsg: "Installing Windows Service"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; Tasks: windowsService
Filename: "{sys}\net.exe"; Parameters: "start Huntarr"; Flags: runhidden; Tasks: windowsService
Filename: "http://localhost:9705"; Description: "Open Huntarr Web UI"; Flags: postinstall shellexec nowait; Tasks: windowsService
Filename: "{app}\{#MyAppExeName}"; Description: "Start Huntarr"; Flags: postinstall skipifsilent nowait; Tasks: startupShortcut none

[UninstallRun]
Filename: "{sys}\net.exe"; Parameters: "stop Huntarr"; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated skipifdoesntexist

[UninstallDelete]
Type: files; Name: "{userstartup}\{#MyAppName}.lnk"

[Code]
procedure CreateConfigDirs;
begin
  ForceDirectories(ExpandConstant('{app}\config\logs'));
  ForceDirectories(ExpandConstant('{app}\config\stateful'));
  ForceDirectories(ExpandConstant('{app}\config\user'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\net.exe'), 'stop Huntarr', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
