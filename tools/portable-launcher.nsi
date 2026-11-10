; ================= 便携版启动器（自写 NSIS，替代 electron-builder 的 portable 目标） =================
; ★ 本文件必须保存为 UTF-8 with BOM：makensis 的 Unicode 模式靠 BOM 识别编码，
;   存成无 BOM 的 UTF-8 会报 "Bad text encoding"。
;
; 为什么自写：electron-builder 的 portable.nsi 每次启动都 RMDir /r 再解压 400MB，
; 且无法在解压前做任何判断。用户口径（2026-11-11）：
;   ① 便携 exe 放进「zip 解压出来的程序目录」里 → 直接跑同目录程序，**不解压**；
;   ② 放到别处（没有同目录程序）→ 首次解压到固定缓存，之后启动复用，不再重复解压；
;   ③ 换版本时重解一次；移走后仍然能正常启动。
;
; 传参（makensis /D）：
;   APP_VERSION   1.4.2        —— 启动器版本（同时是缓存目录名）
;   APP_VERSION4  1.4.2.0      —— VIProductVersion 需要四段数字
;   APP_7Z        app-64.7z    —— win-unpacked 压出来的 7z（根目录是程序文件）
;   OUT_FILE      ...exe
;   ICON          app-icon.ico
;   NSIS_PLUGINS  nsis-resources 的 x86-unicode 插件目录（Nsis7z）

Unicode true
!include "FileFunc.nsh"
!include "TextFunc.nsh"
!include "WordFunc.nsh"
!include "LogicLib.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef APP_VERSION4
  !define APP_VERSION4 "0.0.0.0"
!endif

!addplugindir /x86-unicode "${NSIS_PLUGINS}"

Name "FH6 Vinyl Group Editor"
OutFile "${OUT_FILE}"
Icon "${ICON}"
RequestExecutionLevel user
SilentInstall silent
; 7z 本身已经是压缩包，NSIS 再压一遍只会更慢更大（实测 101.4%），用 zlib + SetCompress off
SetCompressor zlib
CRCCheck off
WindowIcon Off
AutoCloseWindow True
BrandingText " "

VIProductVersion "${APP_VERSION4}"
VIAddVersionKey "ProductName" "FH6 Vinyl Group Editor"
VIAddVersionKey "FileDescription" "FH6 Vinyl Group Editor"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "OriginalFilename" "FH6-Vinyl-Group-Editor.exe"

!define APP_EXE "FH6 Vinyl Group Editor.exe"
!define CACHE_ROOT "$LOCALAPPDATA\FH6-Vinyl-Group-Editor"
!define CACHE_DIR "$LOCALAPPDATA\FH6-Vinyl-Group-Editor\app-${APP_VERSION}"
!define CACHE_MARK "$LOCALAPPDATA\FH6-Vinyl-Group-Editor\app-${APP_VERSION}\sve-cache-ok.txt"

Var Args
Var SiblingVer
Var Mode
Var Idx

Function .onInit
  InitPluginsDir
  ${GetParameters} $Args
  StrCpy $SiblingVer ""
  ; zip 解压环境里由同目录程序自己写下版本号（SVE_PORTABLE_MODE=sibling 时写）
  ${If} ${FileExists} "$EXEDIR\_userdata\sibling-app-version.txt"
    FileOpen $0 "$EXEDIR\_userdata\sibling-app-version.txt" r
    FileRead $0 $SiblingVer
    FileClose $0
    ${TrimNewLines} "$SiblingVer" $SiblingVer
  ${EndIf}
FunctionEnd

Section
  ; ---------- ① zip 解压出来的程序目录：直接跑，完全不解压 ----------
  ${If} ${FileExists} "$EXEDIR\resources\app.asar"
  ${AndIf} ${FileExists} "$EXEDIR\${APP_EXE}"
    StrCpy $Mode "sibling"
    ; 同目录程序比启动器旧（用户把新启动器丢进旧目录）→ 用启动器自带的新版本，
    ; 否则「更新完还提示更新」会死循环。
    ${If} $SiblingVer != ""
      ${VersionCompare} "$SiblingVer" "${APP_VERSION}" $0
      ${If} $0 < 0
        StrCpy $Mode "cache"
      ${EndIf}
    ${EndIf}
    ${If} $Mode == "sibling"
      Goto RUN_SIBLING
    ${EndIf}
  ${EndIf}

  ; ---------- ② 缓存：首次解压一次，之后直接用 ----------
  StrCpy $Mode "cache"
  ${IfNot} ${FileExists} "${CACHE_MARK}"
    RMDir /r "${CACHE_DIR}"
    CreateDirectory "${CACHE_DIR}"
    SetOutPath "${CACHE_DIR}"
    SetCompress off
    File "${APP_7Z}"
    SetCompress auto
    ClearErrors
    Nsis7z::Extract "${CACHE_DIR}\app-64.7z"
    Pop $0
    Delete "${CACHE_DIR}\app-64.7z"
    ${IfNot} ${FileExists} "${CACHE_DIR}\${APP_EXE}"
      ; 解压失败：给个看得懂的结果，别静默什么都不发生
      MessageBox MB_ICONSTOP|MB_OK "Extraction failed. Please run the app from a writable folder."
      Quit
    ${EndIf}
    FileOpen $0 "${CACHE_MARK}" w
    FileWrite $0 "${APP_VERSION}"
    FileClose $0
  ${EndIf}

  ; 清掉旧版本缓存（尽力而为：正在被旧实例占用的文件删不掉就跳过）
  FindFirst $Idx $1 "${CACHE_ROOT}\app-*"
  ${Do}
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}
    ${If} "$1" != "app-${APP_VERSION}"
      RMDir /r "${CACHE_ROOT}\$1"
    ${EndIf}
    FindNext $Idx $1
  ${Loop}
  FindClose $Idx
  Goto RUN_CACHE

RUN_SIBLING:
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("SVE_PORTABLE_MODE", "sibling").r0'
  ; ★ 必须用 Exec（不等子进程）：ExecWait 会让启动器 exe 在整个使用期间被占用，
  ;   热更新又回到「运行中的 exe 换不掉」的老坑。启动器只管拉起、立刻退出。
  Exec '"$EXEDIR\${APP_EXE}" $Args'
  Goto DONE

RUN_CACHE:
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("SVE_PORTABLE_MODE", "cache").r0'
  Exec '"${CACHE_DIR}\${APP_EXE}" $Args'

DONE:
SectionEnd
