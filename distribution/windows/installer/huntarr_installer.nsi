; Huntarr NSIS Installer Script
; Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!verbose 4 ; Increase verbosity for debugging defines
!define DEFAULT_VERSION "1.0.0-default"

!ifdef VERSIONFILE
  !echo "VERSIONFILE is defined by command line as: '${VERSIONFILE}'"
  !if /FILEEXISTS "${VERSIONFILE}"
    !define /file VERSION "${VERSIONFILE}"
    !searchreplace VERSION "${VERSION}" "\n" ""
    !searchreplace VERSION "${VERSION}" "\r" ""
    !echo "Successfully read version '${VERSION}' from '${VERSIONFILE}'"
  !else
    !error "VERSIONFILE was defined as '${VERSIONFILE}', but this file was NOT FOUND! Using default version."
    !define VERSION "${DEFAULT_VERSION}" ; Fallback
  !endif
!else
  !warning "VERSIONFILE was NOT defined on the command line. Trying relative 'version.txt'."
  !if /FILEEXISTS "version.txt" ; Relative to script path, or project root if lucky
    !define /file VERSION "version.txt"
    !searchreplace VERSION "${VERSION}" "\n" ""
    !searchreplace VERSION "${VERSION}" "\r" ""
    !echo "Successfully read version '${VERSION}' from relative 'version.txt'"
  !else
    !warning "Relative 'version.txt' also not found. Using default version '${DEFAULT_VERSION}'."
    !define VERSION "${DEFAULT_VERSION}"
  !endif
!endif

!echo "Final VERSION defined as: '${VERSION}'"

; Application details
!define APPNAME "Huntarr"
!define EXENAME "Huntarr.exe"
!define PUBLISHER "Huntarr"
!define URL "https://github.com/plexguide/Huntarr.io"

; General settings
Name "${APPNAME}"
!echo "Creating installer: Huntarr-${VERSION}-win.exe"
OutFile "installer\Huntarr-${VERSION}-win.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "Install_Dir"
RequestExecutionLevel admin ; Request admin privileges

; Interface settings
!ifdef PROJECT_ROOT
  !echo "DEBUG: Inside !ifdef PROJECT_ROOT. Value is: '${PROJECT_ROOT}'"
  !define MUI_ICON "${PROJECT_ROOT}\frontend\static\logo\huntarr.ico"
  !define MUI_UNICON "${PROJECT_ROOT}\frontend\static\logo\huntarr.ico"
!else
  !error "PROJECT_ROOT was not defined on the command line."
!endif
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--no-service"
!define MUI_FINISHPAGE_RUN_TEXT "Start Huntarr after installation"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create Desktop Shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

; Pages
!insertmacro MUI_PAGE_WELCOME
; License page commented out - no license file available
; !insertmacro MUI_PAGE_LICENSE "LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

; Install options/components
Section "Huntarr Application (required)" SecCore
  SectionIn RO ; Read-only, always selected
  
  ; Set output path to installation directory
  SetOutPath "$INSTDIR"
  
  ; Delete existing service if present (for upgrading from service to non-service)
  nsExec::ExecToLog '"$INSTDIR\${EXENAME}" --remove-service'
  
  ; Copy all files from dist directory
  !echo "Copying files from '${PROJECT_ROOT}\dist\Huntarr\*.*'"
  File /r "${PROJECT_ROOT}\dist\Huntarr\*.*"
  
  ; Copy version.txt file
  !echo "Copying version.txt from '${PROJECT_ROOT}\version.txt'"
  File "${PROJECT_ROOT}\version.txt"
  
  ; Create required directories
  CreateDirectory "$INSTDIR\config"
  CreateDirectory "$INSTDIR\config\logs"
  CreateDirectory "$INSTDIR\config\stateful"
  CreateDirectory "$INSTDIR\config\user"
  CreateDirectory "$INSTDIR\config\settings"
  CreateDirectory "$INSTDIR\config\history"
  CreateDirectory "$INSTDIR\config\scheduler"
  CreateDirectory "$INSTDIR\config\reset"
  CreateDirectory "$INSTDIR\config\tally"
  CreateDirectory "$INSTDIR\config\eros"
  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\frontend\templates"
  CreateDirectory "$INSTDIR\frontend\static"
  
  ; Set permissions (using PowerShell to avoid quoting issues)
  nsExec::ExecToLog 'powershell -Command "& {Set-Acl -Path \"$INSTDIR\config\" -AclObject (Get-Acl -Path \"$INSTDIR\config\")}"'
  nsExec::ExecToLog 'powershell -Command "& {$acl = Get-Acl -Path \"$INSTDIR\config\"; $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(\"Everyone\", \"FullControl\", \"ContainerInherit,ObjectInherit\", \"None\", \"Allow\"); $acl.SetAccessRule($accessRule); Set-Acl -Path \"$INSTDIR\config\" -AclObject $acl}"'
  nsExec::ExecToLog 'powershell -Command "& {$acl = Get-Acl -Path \"$INSTDIR\logs\"; $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(\"Everyone\", \"FullControl\", \"ContainerInherit,ObjectInherit\", \"None\", \"Allow\"); $acl.SetAccessRule($accessRule); Set-Acl -Path \"$INSTDIR\logs\" -AclObject $acl}"'
  nsExec::ExecToLog 'powershell -Command "& {$acl = Get-Acl -Path \"$INSTDIR\frontend\"; $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(\"Everyone\", \"FullControl\", \"ContainerInherit,ObjectInherit\", \"None\", \"Allow\"); $acl.SetAccessRule($accessRule); Set-Acl -Path \"$INSTDIR\frontend\" -AclObject $acl}"'
  
  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
  
  ; Write registry keys for uninstall
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "URLInfoAbout" "${URL}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${VERSION}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1
  
  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "http://localhost:9705" "" "$INSTDIR\${EXENAME}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Run ${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "--no-service" "$INSTDIR\${EXENAME}" 0 SW_SHOWMINIMIZED
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Open ${APPNAME} Web Interface.lnk" "http://localhost:9705" "" "$INSTDIR\${EXENAME}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Auto-start with Windows" SecAutoStart
  ; Create shortcut in startup folder
  CreateShortcut "$SMSTARTUP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "--no-service" "$INSTDIR\${EXENAME}" 0 SW_SHOWMINIMIZED
SectionEnd

; Function to create desktop shortcut from the finish page option
Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "http://localhost:9705" "" "$INSTDIR\${EXENAME}" 0
FunctionEnd

; Uninstaller
Section "Uninstall"
  ; Kill any running instances of Huntarr
  nsExec::ExecToLog 'taskkill /F /IM ${EXENAME}'
  Sleep 2000 ; Wait for processes to terminate
  
  ; Remove the startup shortcut if present
  Delete "$SMSTARTUP\${APPNAME}.lnk"
  
  ; Remove Start Menu shortcuts
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Run ${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Open ${APPNAME} Web Interface.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  
  ; Remove desktop shortcut
  Delete "$DESKTOP\${APPNAME}.lnk"
  
  ; Remove everything from the installation directory
  RMDir /r "$INSTDIR"
  
  ; Remove registry keys
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKLM "Software\${APPNAME}"
SectionEnd

; Descriptions
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCore} "The core Huntarr application. This is required."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAutoStart} "Automatically start Huntarr when Windows starts."
!insertmacro MUI_FUNCTION_DESCRIPTION_END
