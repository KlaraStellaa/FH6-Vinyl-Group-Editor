; ================= 便携版启动器（自写 NSIS，替代 electron-builder 的 portable 目标） =================
; ★ 本文件必须保存为 UTF-8 with BOM：makensis 的 Unicode 模式靠 BOM 识别编码，
;   存成无 BOM 的 UTF-8 会报 "Bad text encoding"。
;
; 2026-11-21 重构（用户报：更新后自己新建 1.4.6 文件夹 / 根目录变成两个版本目录 /
;   把新 exe 放进旧目录还继续提示更新 / 每次换版本都要重新解压一份 400MB）：
;   ① 程序本体固定解压到 %LOCALAPPDATA%\FH6-Vinyl-Group-Editor\app —— **目录名不再带版本号**；
;      旧版的 app-<版本> 在第一次升级时改名复用，不再新建第二个程序环境；
;   ② 首次解压时把数据目录（SVGImages / WorkCopies / WorkCopiesHistory / InjectUndo /
;      sve-logs / fonts / _userdata）一起建好；之后再启动只要环境完整就**不再解压**；
;   ③ 完整性 = 版本标记 + 包内清单 sve-files.txt 里每个文件都存在；
;      缺文件 / 标记版本不符 / 标记缺失 → 原地解压补齐（数据目录不在 7z 里，不会被覆盖）；
;   ④ 同目录已有完整程序（zip 解压目录）时按程序 exe 的**文件版本**判断：
;      同版本或更新 → 直接跑；更旧 → 把启动器自带的新版本原地解压覆盖；
;   ⑤ 启动器自己顶替了程序 exe 的位置（旧版更新留下的残局）→ 不再 Exec 自己 → 用固定缓存；
;   ⑥ 新增 SVE_APPLY_DIR 模式：程序内更新时，主程序拉起新下载的启动器并指定目标目录，
;      启动器只把自带 7z 原地解压进去、写标记，不启动进程（由 update-apply.js 调用）。
;
; 传参（makensis /D）：
;   APP_VERSION   1.4.7        —— 启动器版本 = 环境期望版本
;   APP_VERSION4  1.4.7.0      —— VIProductVersion 需要四段数字
;   APP_7Z        app-64.7z    —— win-unpacked 压出来的 7z（根目录是程序文件 + sve-files.txt）
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
!define CACHE_DIR "$LOCALAPPDATA\FH6-Vinyl-Group-Editor\app"
!define CACHE_MARK "$LOCALAPPDATA\FH6-Vinyl-Group-Editor\app\sve-cache-ok.txt"

Var Args
Var SiblingVer
Var MarkerVer
Var VerifyOk
Var Mode
Var EnvDir
Var ApplyDir
Var Pick
Var Result
Var Line
Var Idx

Function .onInit
  InitPluginsDir
  ${GetParameters} $Args
  StrCpy $SiblingVer ""
  StrCpy $MarkerVer ""
  ; 主程序内更新：目标目录走环境变量（路径可能含中文/空格，不走命令行解析）
  ReadEnvStr $ApplyDir "SVE_APPLY_DIR"
  ${If} $ApplyDir != ""
    StrCpy $Mode "apply"
  ${EndIf}
FunctionEnd

/* 读环境版本标记 */
Function ReadMarker
  StrCpy $MarkerVer ""
  ${If} ${FileExists} "$EnvDir\sve-cache-ok.txt"
    FileOpen $2 "$EnvDir\sve-cache-ok.txt" r
    FileRead $2 $MarkerVer
    FileClose $2
    ${TrimNewLines} "$MarkerVer" $MarkerVer
  ${EndIf}
FunctionEnd

/* 写环境版本标记（只有解压成功后才写：中途失败下次会重新补） */
Function WriteMarker
  FileOpen $2 "$EnvDir\sve-cache-ok.txt" w
  FileWrite $2 "${APP_VERSION}"
  FileClose $2
FunctionEnd

/* 环境完整性：包内清单 sve-files.txt 里每个文件都必须存在 */
Function VerifyEnv
  StrCpy $VerifyOk "1"
  ${IfNot} ${FileExists} "$EnvDir\sve-files.txt"
    StrCpy $VerifyOk "0"
    Return
  ${EndIf}
  FileOpen $2 "$EnvDir\sve-files.txt" r
  ${Do}
    FileRead $2 $Line
    ${If} $Line == ""
      ${ExitDo}
    ${EndIf}
    ${TrimNewLines} "$Line" $Line
    ${If} $Line != ""
    ${AndIfNot} ${FileExists} "$EnvDir\$Line"
      StrCpy $VerifyOk "0"
      ${ExitDo}
    ${EndIf}
  ${Loop}
  FileClose $2
FunctionEnd

/* 把启动器自带的 7z 解压到 $EnvDir（原地覆盖；用户数据目录不在包里） */
Function ApplyTo
  CreateDirectory "$EnvDir"
  SetOutPath "$PLUGINSDIR"
  File "${APP_7Z}"
  SetOutPath "$EnvDir"
  Nsis7z::Extract "$PLUGINSDIR\app-64.7z"
  Pop $Result
  Delete "$PLUGINSDIR\app-64.7z"
FunctionEnd

/* 首次创建环境时把数据目录一起建好（之后每次 ensure 一下，代价可忽略） */
Function EnsureDataDirs
  CreateDirectory "$EXEDIR\SVGImages"
  CreateDirectory "$EXEDIR\WorkCopies"
  CreateDirectory "$EXEDIR\WorkCopiesHistory"
  CreateDirectory "$EXEDIR\InjectUndo"
  CreateDirectory "$EXEDIR\sve-logs"
  CreateDirectory "$EXEDIR\fonts"
FunctionEnd

/* 环境完整（版本标记一致 + 清单文件都在）就什么都不做；
   缺版本标记 / 版本更旧 / 缺文件 → 原地解压补齐；版本标记更新 → 跑现有环境，不降级。 */
Function EnsureEnv
  Call ReadMarker
  ${If} $MarkerVer != ""
    ${VersionCompare} "$MarkerVer" "${APP_VERSION}" $0
    ${If} $0 == 1
      Return
    ${EndIf}
  ${EndIf}
  Call VerifyEnv
  ${If} $MarkerVer == "${APP_VERSION}"
  ${AndIf} $VerifyOk == "1"
    Return
  ${EndIf}
  Call ApplyTo
  ${If} ${FileExists} "$EnvDir\${APP_EXE}"
    Call WriteMarker
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "Extraction failed. Please run the app from a writable folder."
    Quit
  ${EndIf}
FunctionEnd

/* 清理旧的按版本命名的缓存目录（app-1.4.x）：
   只删**不含用户数据**的；目录里有 settings.json / 数据文件夹的一律保留，绝不删用户文件。 */
Function CleanOldCaches
  FindFirst $Idx $1 "${CACHE_ROOT}\app-*"
  ${Do}
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}
    StrCpy $2 "${CACHE_ROOT}\$1"
    ${If} $2 != "$EnvDir"
    ${AndIf} $2 != "$EXEDIR"
      ${IfNot} ${FileExists} "$2\settings.json"
      ${AndIfNot} ${FileExists} "$2\SVGImages\*.*"
      ${AndIfNot} ${FileExists} "$2\WorkCopies\*.*"
      ${AndIfNot} ${FileExists} "$2\WorkCopiesHistory\*.*"
      ${AndIfNot} ${FileExists} "$2\_userdata\*.*"
        RMDir /r "$2"
      ${EndIf}
    ${EndIf}
    FindNext $Idx $1
  ${Loop}
  FindClose $Idx
FunctionEnd

Section
  ; ---------- 0) 被主程序调用：只把程序解压到指定目录，不启动 ----------
  ${If} $Mode == "apply"
    StrCpy $EnvDir "$ApplyDir"
    Call ApplyTo
    ${If} ${FileExists} "$EnvDir\${APP_EXE}"
      Call WriteMarker
      SetErrorLevel 0
    ${Else}
      SetErrorLevel 1
    ${EndIf}
    Quit
  ${EndIf}

  ; ---------- 1) 自己就是同目录的程序 exe（旧版热更新留下的残局） ----------
  ;      此时绝不能走 sibling（会 Exec 自己 → 无限自启），也覆盖不了自己 → 用固定缓存
  ${If} $EXEPATH == "$EXEDIR\${APP_EXE}"
    StrCpy $Mode "cache"
    Goto CACHE_MODE
  ${EndIf}

  ; ---------- 2) 同目录已经有完整程序（zip 解压目录 / 旧缓存目录） ----------
  ${If} ${FileExists} "$EXEDIR\resources\app.asar"
  ${AndIf} ${FileExists} "$EXEDIR\${APP_EXE}"
    ; 受管目录（有版本标记）→ 完整性校验 + 原地补齐
    ${If} ${FileExists} "$EXEDIR\sve-cache-ok.txt"
      StrCpy $EnvDir "$EXEDIR"
      Call EnsureEnv
      Goto RUN_SIBLING
    ${EndIf}
    ; 普通 zip 解压目录：按程序本体文件版本判断，读不出（极老版本）才保持直接跑
    ${GetFileVersion} "$EXEDIR\${APP_EXE}" $SiblingVer
    ${If} $SiblingVer == ""
      Goto RUN_SIBLING
    ${EndIf}
    ${VersionCompare} "$SiblingVer" "${APP_VERSION}" $0
    ; 返回值：0=相同 1=同目录程序更新 2=启动器自带版本更新（同目录程序较旧 → 原地覆盖）
    ${If} $0 == 2
      ; 同目录程序比启动器旧 → 把自带的新版本原地覆盖，数据目录不在包里
      StrCpy $EnvDir "$EXEDIR"
      Call ApplyTo
      ${If} ${FileExists} "$EnvDir\${APP_EXE}"
        Call WriteMarker
      ${EndIf}
    ${EndIf}
    Goto RUN_SIBLING
  ${EndIf}

  ; ---------- 3) 空目录 / 别处：固定缓存目录（首次解压建环境，之后只校验） ----------
  StrCpy $Mode "cache"

CACHE_MODE:
  StrCpy $EnvDir "${CACHE_DIR}"
  ; 旧版按版本号建目录：第一次升级时把其中一个改名成固定 app（同卷瞬时），不再新建第二个
  ; DirState：-1=不存在 0=存在但为空 1=存在且有内容
  ${DirState} "$EnvDir" $0
  ${If} $0 == 0
    RMDir "$EnvDir"
  ${EndIf}
  ${If} $0 != 1
    StrCpy $Pick ""
    ; 第一遍：优先复用**带用户数据**的旧版本目录（老用户可能直接跑过缓存里的程序）
    FindFirst $Idx $1 "${CACHE_ROOT}\app-*"
    ${Do}
      ${If} $1 == ""
        ${ExitDo}
      ${EndIf}
      ${If} $Pick == ""
      ${AndIf} ${FileExists} "${CACHE_ROOT}\$1\${APP_EXE}"
        ${If} ${FileExists} "${CACHE_ROOT}\$1\settings.json"
        ${OrIf} ${FileExists} "${CACHE_ROOT}\$1\SVGImages\*.*"
        ${OrIf} ${FileExists} "${CACHE_ROOT}\$1\WorkCopies\*.*"
        ${OrIf} ${FileExists} "${CACHE_ROOT}\$1\WorkCopiesHistory\*.*"
        ${OrIf} ${FileExists} "${CACHE_ROOT}\$1\_userdata\*.*"
          StrCpy $Pick "$1"
        ${EndIf}
      ${EndIf}
      FindNext $Idx $1
    ${Loop}
    FindClose $Idx
    ; 第二遍：没有带数据的，就复用任意一个带程序本体的旧目录
    ${If} $Pick == ""
      FindFirst $Idx $1 "${CACHE_ROOT}\app-*"
      ${Do}
        ${If} $1 == ""
          ${ExitDo}
        ${EndIf}
        ${If} $Pick == ""
        ${AndIf} ${FileExists} "${CACHE_ROOT}\$1\${APP_EXE}"
          StrCpy $Pick "$1"
        ${EndIf}
        FindNext $Idx $1
      ${Loop}
      FindClose $Idx
    ${EndIf}
    ${If} $Pick != ""
      ClearErrors
      Rename "${CACHE_ROOT}\$Pick" "$EnvDir"
      ${If} ${Errors}
        CreateDirectory "$EnvDir"
      ${EndIf}
    ${Else}
      CreateDirectory "$EnvDir"
    ${EndIf}
  ${EndIf}
  Call EnsureEnv
  Call CleanOldCaches
  Goto RUN_CACHE

RUN_SIBLING:
  Call EnsureDataDirs
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("SVE_PORTABLE_MODE", "sibling").r0'
  ; ★ 必须用 Exec（不等子进程）：ExecWait 会让启动器 exe 在整个使用期间被占用，
  ;   热更新又回到「运行中的 exe 换不掉」的老坑。启动器只管拉起、立刻退出。
  Exec '"$EXEDIR\${APP_EXE}" $Args'
  Goto DONE

RUN_CACHE:
  Call EnsureDataDirs
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("SVE_PORTABLE_MODE", "cache").r0'
  Exec '"${CACHE_DIR}\${APP_EXE}" $Args'

DONE:
SectionEnd
