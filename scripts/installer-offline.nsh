!macro customInstall
  CreateShortCut "$DESKTOP\Fis Asistani.lnk" "$INSTDIR\Apex.exe" "--fis-asistani" "$INSTDIR\Apex.exe" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Fis Asistani.lnk"
!macroend
