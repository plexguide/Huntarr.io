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
OutputDir=installer
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
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "Start Huntarr automatically when Windows starts"; GroupDescription: "Startup options:"; Flags: checkedonce

[Files]
Source: "dist\Huntarr\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Create empty config directories to ensure they exist with proper permissions
Source: "LICENSE"; DestDir: "{app}\config"; Flags: ignoreversion; AfterInstall: CreateConfigDirs

[Icons]
; Create Start Menu shortcuts
Name: "{group}\{#MyAppName}"; Filename: "http://localhost:9705"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Run {#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-service"; Flags: runminimized
Name: "{group}\Open {#MyAppName} Web Interface"; Filename: "http://localhost:9705"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Create Desktop shortcut if requested
Name: "{commondesktop}\{#MyAppName}"; Filename: "http://localhost:9705"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

; Add startup shortcut if the user selected that option
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-service"; Flags: runminimized; Tasks: autostart

[Run]
; Make sure any existing service is removed (for upgrades from service to non-service mode)
Filename: "{app}\{#MyAppExeName}"; Parameters: "--remove-service"; Flags: runhidden; Check: IsAdminLoggedOn
; Wait a moment for the service to be properly removed
Filename: "{sys}\cmd.exe"; Parameters: "/c timeout /t 3"; Flags: runhidden
; Grant permissions to the config directory and all subdirectories
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config"" /grant Everyone:(OI)(CI)F /T"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\logs"" /grant Everyone:(OI)(CI)F /T"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\frontend"" /grant Everyone:(OI)(CI)F /T"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
; Ensure proper permissions for each important subdirectory (in case the recursive permission failed)
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config\logs"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config\stateful"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config\user"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config\settings"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\config\history"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\frontend\templates"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
Filename: "{sys}\cmd.exe"; Parameters: "/c icacls ""{app}\frontend\static"" /grant Everyone:(OI)(CI)F"; Flags: runhidden shellexec; Check: IsAdminLoggedOn
; Launch Huntarr directly after installation
Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-service"; Description: "Start Huntarr"; Flags: nowait postinstall

Filename: "{sys}\cmd.exe"; Parameters: "/c timeout /t 5 && start http://localhost:9705"; Description: "Open Huntarr Web Interface"; Flags: nowait postinstall shellexec

; Final verification of directory permissions
Filename: "{sys}\cmd.exe"; Parameters: "/c echo Verifying installation permissions..."; Flags: runhidden shellexec postinstall; AfterInstall: VerifyInstallation

; Verify executable exists before attempting to run it
Filename: "{sys}\cmd.exe"; Parameters: "/c if exist ""{app}\{#MyAppExeName}"" (echo Executable found) else (echo ERROR: Executable not found)"; Flags: runhidden
[UninstallRun]
; Kill any running instances of Huntarr
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM ""{#MyAppExeName}"""; Flags: runhidden
; Wait a moment for processes to terminate
Filename: "{sys}\cmd.exe"; Parameters: "/c timeout /t 2"; Flags: runhidden
; Remove the Huntarr startup entry if it exists
Filename: "{sys}\cmd.exe"; Parameters: "/c if exist \"{userstartup}\{#MyAppName}.lnk\" del /f \"{userstartup}\{#MyAppName}.lnk\""; Flags: runhidden

[Code]
procedure CreateConfigDirs;
var
  DirCreationResult: Boolean;
{{ ... }}
  DirPath: String;
  WriteTestPath: String;
  WriteTestResult: Boolean;
  PermissionSetResult: Integer;
  ConfigDirs: array of String;
  i: Integer;
begin
  // Define all required configuration directories
  SetArrayLength(ConfigDirs, 13);
  ConfigDirs[0] := '\config';
  ConfigDirs[1] := '\config\logs';
  ConfigDirs[2] := '\config\stateful';
  ConfigDirs[3] := '\config\user';
  ConfigDirs[4] := '\config\settings';
  ConfigDirs[5] := '\config\history';
  ConfigDirs[6] := '\config\scheduler';
  ConfigDirs[7] := '\config\reset';
  ConfigDirs[8] := '\config\tally';
  ConfigDirs[9] := '\config\eros';
  ConfigDirs[10] := '\logs';
  ConfigDirs[11] := '\frontend\templates';
  ConfigDirs[12] := '\frontend\static';
  
  // Create all necessary configuration directories with explicit permissions
  for i := 0 to GetArrayLength(ConfigDirs) - 1 do
  begin
    DirPath := ExpandConstant('{app}' + ConfigDirs[i]);
    DirCreationResult := ForceDirectories(DirPath);
    
    if not DirCreationResult then
    begin
      Log('Failed to create directory: ' + DirPath);
      // Add fallback attempt with system command if ForceDirectories fails
      if not DirExists(DirPath) then
      begin
        Log('Attempting fallback directory creation for: ' + DirPath);
        Exec(ExpandConstant('{sys}\cmd.exe'), '/c mkdir "' + DirPath + '"', '', SW_HIDE, ewWaitUntilTerminated, PermissionSetResult);
      end;
    end else begin
      Log('Successfully created directory: ' + DirPath);
    end;
  end;
  
  // Create a small test file in each important directory to verify write permissions
  for i := 0 to GetArrayLength(ConfigDirs) - 1 do
  begin
    WriteTestPath := ExpandConstant('{app}' + ConfigDirs[i] + '\write_test.tmp');
    try
      WriteTestResult := SaveStringToFile(WriteTestPath, 'Installation test file', False);
      if WriteTestResult then
      begin
        Log('Write test succeeded for: ' + WriteTestPath);
        DeleteFile(WriteTestPath);
      end else begin
        Log('Write test failed for: ' + WriteTestPath);
      end;
    except
      Log('Exception during write test for: ' + WriteTestPath);
    end;
  end;
end;

// Check for admin rights and warn user if they're not an admin
// Verify that all directories have proper permissions after installation
procedure VerifyInstallation;
var
  VerifyResult: Integer;
  ConfigPath: String;
  ExePath: String;
  ExeVerifyResult: Integer;
begin
  ConfigPath := ExpandConstant('{app}\config');
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  
  // Log paths for troubleshooting
  Log('Verifying installation paths:');
  Log('- Application directory: ' + ExpandConstant('{app}'));
  Log('- Config directory: ' + ConfigPath);
  Log('- Executable path: ' + ExePath);
  
  // Verify the executable file exists
  if FileExists(ExePath) then
  begin
    Log('Executable file exists: ' + ExePath);
    
    // Ensure proper permissions on the executable
    if IsAdminLoggedOn then
    begin
      Log('Setting permissions on executable file...');
      Exec(ExpandConstant('{sys}\cmd.exe'), '/c icacls "' + ExePath + '" /grant Everyone:RX', '', SW_HIDE, ewWaitUntilTerminated, ExeVerifyResult);
    end;
  end
  else
  begin
    Log('ERROR: Executable file not found: ' + ExePath);
    // Try to find the executable anywhere in the application directory
    Exec(ExpandConstant('{sys}\cmd.exe'), '/c dir /s /b "' + ExpandConstant('{app}') + '\*.exe"', '', SW_HIDE, ewWaitUntilTerminated, ExeVerifyResult);
  end;
  
  // Create a verification file in the main config directory
  if SaveStringToFile(ConfigPath + '\verification.tmp', 'Verification file', False) then
  begin
    Log('Successfully created verification file in: ' + ConfigPath);
    DeleteFile(ConfigPath + '\verification.tmp');
  end
  else
  begin
    Log('WARNING: Failed to create verification file in: ' + ConfigPath);
    // Try to repair permissions if verification fails
    if IsAdminLoggedOn then
    begin
      Log('Attempting to repair permissions...');
      Exec(ExpandConstant('{sys}\cmd.exe'), '/c icacls "' + ConfigPath + '" /grant Everyone:(OI)(CI)F /T', '', SW_HIDE, ewWaitUntilTerminated, VerifyResult);
    end;
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  NonAdminWarningResult: Integer;
begin
  Log('Starting Huntarr installation...');
  
  // Warn if user is not an admin - we'll still allow installation but with limitations
  if not IsAdminLoggedOn() then
  begin
    NonAdminWarningResult := MsgBox(
      'Huntarr is being installed without administrator privileges.' + #13#10 + #13#10 +
      'This means:' + #13#10 +
      '- The Windows service option will not be available' + #13#10 +
      '- You will need to run Huntarr manually' + #13#10 + #13#10 +
      'Do you want to continue with limited installation?',
      mbConfirmation,
      MB_YESNO
    );
    
    if NonAdminWarningResult = IDNO then
    begin
      Log('User canceled installation due to lack of admin rights');
      Result := False;
      Exit;
    end;
  end;
  
  // Check if an instance is already running and try to stop it
  if IsAdminLoggedOn() then
  begin
    try
      // Try to stop the service if it exists and is running
      Exec(ExpandConstant('{sys}\net.exe'), 'stop Huntarr', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Log('Attempted to stop Huntarr service. Result: ' + IntToStr(ResultCode));
      // Give it a moment to stop
      Sleep(3000);
    except
      // Ignore errors - service might not exist yet
      Log('Exception occurred while stopping service - probably not installed');
    end;
  end;
  
  // Check if port 9705 is already in use
  try
    Exec(ExpandConstant('{sys}\netstat.exe'), '-ano | find "9705"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode = 0 then
    begin
      if MsgBox('Huntarr uses port 9705, which appears to be in use. ' +
                'Installation can continue, but Huntarr may not start properly until this port is free. ' +
                'Do you want to continue anyway?', mbConfirmation, MB_YESNO) = IDNO then
      begin
        Result := False;
        Exit;
      end;
    end;
  except
    // Ignore errors checking port usage
    Log('Exception occurred while checking port usage - continuing anyway');
  end;
  
  Result := True;
end;

// Executed when the installer is about to end
// Fix permissions if non-admin installation
procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
  Permissions: TArrayOfString;
  i: Integer;
  DirPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    // For non-admin installations, we can't use icacls easily, so try making each directory
    // writable by removing read-only attributes
    if not IsAdminLoggedOn() then
    begin
      Log('Non-admin installation - attempting to ensure directories are writable...');
      
      SetArrayLength(Permissions, 13);
      Permissions[0] := '\config';
      Permissions[1] := '\config\logs';
      Permissions[2] := '\config\stateful';
      Permissions[3] := '\config\user';
      Permissions[4] := '\config\settings';
      Permissions[5] := '\config\history';
      Permissions[6] := '\config\scheduler';
      Permissions[7] := '\config\reset';
      Permissions[8] := '\config\tally';
      Permissions[9] := '\config\eros';
      Permissions[10] := '\logs';
      Permissions[11] := '\frontend\templates';
      Permissions[12] := '\frontend\static';
      
      for i := 0 to GetArrayLength(Permissions) - 1 do
      begin
        DirPath := ExpandConstant('{app}' + Permissions[i]);
        if DirExists(DirPath) then
        begin
          // Try to make directory writable by removing read-only attribute
          Exec(ExpandConstant('{sys}\attrib.exe'), '-R "' + DirPath + '" /S /D', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
          Log('Set writable attributes for directory: ' + DirPath + ' (Result: ' + IntToStr(ErrorCode) + ')');
        end;
      end;
    end;
  end;
end;
