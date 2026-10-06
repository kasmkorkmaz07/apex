Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Var TestMode
Var TargetDocuments
Name "Apex"
OutFile "..\outputs\Apex-Kurulum-v1.0.130.exe"
InstallDir "$PROGRAMFILES64\Apex"
RequestExecutionLevel admin
SetCompressor zlib
VIProductVersion "1.0.130.0"
VIAddVersionKey "ProductName" "Apex"
VIAddVersionKey "ProductVersion" "1.0.130.0"
VIAddVersionKey "FileVersion" "1.0.130.0"
VIAddVersionKey "FileDescription" "Apex Kurulum"
VIAddVersionKey "LegalCopyright" "Kasim Muhasebe"
Page directory
Page instfiles
Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/TESTINSTALL" $1
  ${If} ${Errors}
    StrCpy $TestMode "0"
  ${Else}
    StrCpy $TestMode "1"
  ${EndIf}
FunctionEnd
Section
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\resources\app-before-1.0.130.asar" preserved
  CopyFiles /SILENT "$INSTDIR\resources\app.asar" "$INSTDIR\resources\app-before-1.0.130.asar"
  preserved:
  File /r "public-release\Program\*.*"
  StrCpy $TargetDocuments "$DOCUMENTS"
  ${If} $TestMode == "1"
    StrCpy $TargetDocuments "$INSTDIR\TestDocuments"
  ${EndIf}
  ExecWait '"$INSTDIR\Runtime\Python\python.exe" -X utf8 "$INSTDIR\resources\migrate-install.py" "$INSTDIR" "$TargetDocuments"' $0
  ${If} $0 != 0
    MessageBox MB_OK "Apex dosyalari kuruldu; eski veri baglantisinin kontrolu gerekiyor. resources\migration-1.0.130.json raporunu inceleyin. Mevcut veriler silinmedi."
    SetErrorLevel 2
  ${EndIf}
  ${If} $TestMode != "1"
    CreateShortCut "$DESKTOP\Apex.lnk" "$INSTDIR\Apex.exe" "" "$INSTDIR\Apex.exe"
    CreateShortCut "$DESKTOP\Fis Asistani.lnk" "$INSTDIR\Apex.exe" "--fis-asistani" "$INSTDIR\Apex.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\c6fa7bb7-6887-5bcd-ad46-04cd27840674" "DisplayVersion" "1.0.130"
  ${EndIf}
SectionEnd
