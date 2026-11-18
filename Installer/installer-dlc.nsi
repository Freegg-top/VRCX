;--------------------------------
;VRCX DLC installer (基于官方 Installer/installer.nsi 适配)
;与官方差异:
;  1. 注册表独立命名空间 Software\VRCX-DLC —— 与官方 VRCX 互不覆盖
;  2. 新增「检测已安装的 VRCX」选择页: 列出本机所有 VRCX 安装目录并标注
;     拓展版/官方版, 默认预选拓展版; 安装到官方版目录时额外确认防误覆盖
;  3. 打包源为暂存目录 (DLCDIR), 不联网装 VC++ 运行库
;  4. 应用内更新: Update.cs 传 /UPDATEDIR=<运行目录>, 跳过选择页直通安装
;     (/D= 会被 NSIS 自身消费并从 $CMDLINE 移除, 所以用自定义开关)
;--------------------------------
;Plugins
;https://nsis.sourceforge.io/ApplicationID_plug-in
;https://nsis.sourceforge.io/ShellExecAsUser_plug-in
;https://nsis.sourceforge.io/NsProcess_plugin

!addplugindir "Plugins\x86-unicode"

;--------------------------------
;Version (由 package-custom.ps1 生成)
    !include "version_define_dlc.nsh"

    VIProductVersion "${PRODUCT_VERSION}"
    VIFileVersion "${PRODUCT_VERSION}"
    VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
    VIAddVersionKey "ProductName" "VRCX"
    VIAddVersionKey "ProductVersion" "${PRODUCT_DISPLAY}"
    VIAddVersionKey "LegalCopyright" "Copyright vrcx-team, pypy, natsumi"
    VIAddVersionKey "FileDescription" "VRCX DLC (Friendship management tool for VRChat)"

;--------------------------------
;Include

    !include "MUI2.nsh"
    !include "FileFunc.nsh"
    !include "LogicLib.nsh"
    !include "StrFunc.nsh"
    !include "WordFunc.nsh"
    !include "nsDialogs.nsh"

;StrFunc 函数需在全局作用域声明一次
${StrLoc}
${StrTrimNewLines}
;卸载段要用 Un 前缀变体, 也需全局声明
${UnStrLoc}

;--------------------------------
;General

    SetCompressor /SOLID lzma
    SetCompressorDictSize 16
    Unicode True
    Name "VRCX DLC"
    OutFile "${SETUP_OUTFILE}"
    InstallDir "$PROGRAMFILES64\VRCX-DLC"
    InstallDirRegKey HKLM "Software\VRCX-DLC" "InstallDir"
    RequestExecutionLevel admin
    ShowInstDetails show

;--------------------------------
;Variables

    VAR upgradeInstallation
    VAR dirOverride          ; /UPDATEDIR= 传入 (应用内更新), 有值则跳过检测页
    VAR detectedPaths        ; 候选目录清单 "路径1|路径2|..."
    VAR detectedItems        ; 候选展示项 "路径   [标签]|..."
    VAR detectedCount
    VAR dlcIndex             ; 拓展版候选的下标, -1 = 未发现
    VAR candIndex            ; ListPartAt 入参 (0 起始)
    VAR candSource           ; ListPartAt 入参: "paths" / "items"
    VAR candResult           ; ListPartAt 出参
    VAR dialog
    VAR detectLabel
    VAR detectList

;--------------------------------
;Interface Settings

    !define MUI_ABORTWARNING

;--------------------------------
;Icons

    !define MUI_ICON "../images/VRCX.ico"
    !define MUI_UNICON "../images/VRCX.ico"

;--------------------------------
;Pages

    ; 检测选择页 (在许可页之前); 显示条件在 DetectPageCreate 开头判断
    Page custom DetectPageCreate DetectPageLeave

    !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpgrade
    !insertmacro MUI_PAGE_LICENSE "..\LICENSE"

    !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpgrade
    !insertmacro MUI_PAGE_DIRECTORY

    !insertmacro MUI_PAGE_INSTFILES

    ;------------------------------
    ; Finish Page

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Launch VRCX"
    !define MUI_FINISHPAGE_RUN_FUNCTION launchVRCX

    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create desktop shortcut"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION createDesktopShortcut

    !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpgrade
    !insertmacro MUI_PAGE_FINISH

    !insertmacro MUI_UNPAGE_CONFIRM
    !insertmacro MUI_UNPAGE_INSTFILES
    !insertmacro MUI_UNPAGE_FINISH

;--------------------------------
;Languages

    !insertmacro MUI_LANGUAGE "English"

;--------------------------------
;Functions

Function SkipIfUpgrade
    StrCmp $upgradeInstallation 0 noUpgrade
        Abort
    noUpgrade:
FunctionEnd

; 检测页创建: /UPDATEDIR= 覆盖或无候选时跳过
Function DetectPageCreate
    ${If} $dirOverride != ""
        Abort
    ${EndIf}
    ${If} $detectedCount = 0
        Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "选择要安装/更新的 VRCX" "检测到本机有多个 VRCX，请选择本次要安装拓展版的目录"

    nsDialogs::Create 1018
    Pop $dialog

    ${NSD_CreateLabel} 0 0 100% 12u "检测到以下 VRCX 安装，已默认选中拓展版；也可以选择其他目录："
    Pop $detectLabel

    ${NSD_CreateListBox} 0 16u 100% 150u ""
    Pop $detectList

    StrCpy $R9 0
    fillLoop:
        StrCmp $R9 $detectedCount fillDone
        StrCpy $candIndex $R9
        StrCpy $candSource "items"
        Call ListPartAt
        ${NSD_LB_AddString} $detectList "$candResult"
        Pop $R6
        IntOp $R9 $R9 + 1
        Goto fillLoop
    fillDone:

    ; 预选拓展版候选 (若有), 并同步 $INSTDIR
    ${If} $dlcIndex >= 0
        StrCpy $candIndex $dlcIndex
        StrCpy $candSource "items"
        Call ListPartAt
        ${NSD_LB_SelectString} $detectList "$candResult"
        Pop $R6
        StrCpy $candSource "paths"
        Call ListPartAt
        StrCpy $INSTDIR $candResult
    ${EndIf}

    nsDialogs::Show
FunctionEnd

; 检测页离开: 选中项文本 = "路径   [标签]", 取 "   [" 之前的内容写入 $INSTDIR
Function DetectPageLeave
    ${NSD_LB_GetSelection} $detectList $R1
    StrCmp $R1 "" detectLeaveDone
    ${StrLoc} $R2 "$R1" "   [" "<"
    StrCmp $R2 "" detectLeaveDone
    StrCpy $INSTDIR "$R1" $R2
detectLeaveDone:
FunctionEnd

Function .onInit
    StrCpy $upgradeInstallation 0
    StrCpy $dirOverride ""
    StrCpy $detectedCount 0
    StrCpy $dlcIndex -1

    ${GetOptions} "$CMDLINE" "/UPDATEDIR=" $R0
    IfErrors noDirOverride
        StrCpy $dirOverride $R0
        ; 去除可能包裹的引号
        StrCpy $R1 "$dirOverride" 1
        StrCmp $R1 '"' 0 noTrimHead
            StrCpy $dirOverride "$dirOverride" "" 1
        noTrimHead:
        StrCpy $R1 "$dirOverride" 1 -1
        StrCmp $R1 '"' 0 noTrimTail
            StrCpy $dirOverride "$dirOverride" -1
        noTrimTail:
        StrCpy $INSTDIR "$dirOverride"
    noDirOverride:

    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "UninstallString"
    StrCmp $R0 "" notInstalled
        StrCpy $upgradeInstallation 1
    notInstalled:

    ${If} $dirOverride == ""
        Call CollectCandidates
    ${EndIf}

    ; If VRCX is already running, display a warning message
    loop:
    StrCpy $1 "VRCX.exe"
    nsProcess::_FindProcess "$1"
    Pop $R1
    ${If} $R1 = 0
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "VRCX is still running. $\n$\nClick `OK` to kill the running process or `Cancel` to cancel this installer." /SD IDOK IDCANCEL cancel
            nsExec::ExecToStack "taskkill /IM VRCX.exe"
    ${Else}
        Goto done
    ${EndIf}
    Sleep 1000
    Goto loop

    cancel:
        Abort
    done:
FunctionEnd

Function .onInstSuccess
    ${If} $upgradeInstallation = 1
        Call launchVRCX
    ${EndIf}
FunctionEnd

Function createDesktopShortcut
    CreateShortcut "$DESKTOP\VRCX.lnk" "$INSTDIR\VRCX.exe"
FunctionEnd

Function launchVRCX
    SetOutPath $INSTDIR
    ShellExecAsUser::ShellExecAsUser "" "$INSTDIR\VRCX.exe" ""
FunctionEnd

;--------------------------------
;候选目录收集 (在 .onInit 调用一次)

; 扫描注册表收集本机所有 VRCX 安装目录与版本标签:
;   来源 A: HKLM Uninstall 键枚举 (Setup 安装的官方版/拓展版)
;   来源 B: HKCU Software\VRCX-DLC 自标识 (C# 启动时写入, 覆盖便携安装)
;   来源 C: HKLM Software\VRCX-DLC InstallDir (拓展版 Setup 写入)
Function CollectCandidates
    StrCpy $detectedPaths ""
    StrCpy $detectedItems ""
    StrCpy $detectedCount 0

    ; 来源 A: HKLM Uninstall 枚举
    StrCpy $R9 0
    enumA:
        EnumRegKey $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R9
        StrCmp $R0 "" enumADone
        IntOp $R9 $R9 + 1
        ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "InstallLocation"
        StrCmp $R1 "" enumA
        Push $R1
        Call AddCandidate
        Goto enumA
    enumADone:

    ; 来源 B: HKCU Software\VRCX-DLC 自标识
    ClearErrors
    ReadRegStr $R1 HKCU "Software\VRCX-DLC" "InstallDir"
    IfErrors enumBDone
    Push $R1
    Call AddCandidate
    enumBDone:

    ; 来源 C: HKLM Software\VRCX-DLC (32 位视图, 与 Setup 写入侧一致)
    ClearErrors
    ReadRegStr $R1 HKLM "Software\VRCX-DLC" "InstallDir"
    IfErrors enumCDone
    Push $R1
    Call AddCandidate
    enumCDone:
FunctionEnd

; 添加候选目录: 去尾斜杠 -> 校验 VRCX.exe -> 去重 -> 读 Version 生成标签
; 栈顶: 目录路径
Function AddCandidate
    Exch $R0
    Push $R1
    Push $R2
    Push $R3
    ; 去除尾部反斜杠
    StrCpy $R1 "$R0" 1 -1
    StrCmp $R1 "\" 0 noTrimSlash
        StrCpy $R0 "$R0" -1
    noTrimSlash:
    IfFileExists "$R0\VRCX.exe" 0 addSkip
    ; 去重: 与已收集路径逐一比对
    StrCpy $R4 0
    dupeLoop:
        StrCmp $R4 $detectedCount dupeDone
        IntOp $R5 $R4 + 1
        ${WordFind} "$detectedPaths" "|" "+$R5" $R6
        StrCmp $R6 $R0 addSkip
        IntOp $R4 $R4 + 1
        Goto dupeLoop
    dupeDone:
    ; 读取 Version 文件生成标签
    StrCpy $R3 "VRCX"
    IfFileExists "$R0\Version" 0 addAppend
        FileOpen $R1 "$R0\Version" r
        IfErrors addAppend
        FileRead $R1 $R2
        FileClose $R1
        ${StrTrimNewLines} $R2 $R2
        StrCmp $R2 "" addAppend
        ${StrLoc} $R3 "$R2" "-dlc." ">"
        StrCmp $R3 "" addLabelOff
            StrCpy $R3 "VRCX 拓展版 $R2"
            StrCpy $dlcIndex $detectedCount
            Goto addAppend
    addLabelOff:
            StrCpy $R3 "VRCX 官方版 $R2"
    addAppend:
    ; 追加到清单
    StrCmp $detectedPaths "" addFirst
        StrCpy $detectedPaths "$detectedPaths|$R0"
        StrCpy $detectedItems "$detectedItems|$R0   [$R3]"
        Goto addCount
    addFirst:
        StrCpy $detectedPaths "$R0"
        StrCpy $detectedItems "$R0   [$R3]"
    addCount:
        IntOp $detectedCount $detectedCount + 1
    addSkip:
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
FunctionEnd

; 取 | 分隔清单的第 N 项 (入参: $candIndex 0 起始 + $candSource, 出参: $candResult)
Function ListPartAt
    Push $R0
    Push $R1
    IntOp $R0 $candIndex + 1
    ${If} $candSource == "paths"
        ${WordFind} "$detectedPaths" "|" "+$R0" $R1
    ${Else}
        ${WordFind} "$detectedItems" "|" "+$R0" $R1
    ${EndIf}
    StrCpy $candResult "$R1"
    Pop $R1
    Pop $R0
FunctionEnd

;--------------------------------
;Installer Sections

Section "Install" SecInstall
    StrCmp $upgradeInstallation 0 noUpgrade
        DetailPrint "Uninstall previous version..."
        ExecWait '"$INSTDIR\Uninstall.exe" /S _?=$INSTDIR'
        Delete $INSTDIR\Uninstall.exe
        Goto afterUpgrade
    noUpgrade:

    afterUpgrade:

    ; 目标目录是官方版时额外确认, 防止误覆盖。
    ; P1-9: 必须在 File /r 复制之前读原始 $INSTDIR\Version —— 复制之后 Version
    ; 已被 DLC 文件覆盖, 检测永远失效; 用户 Cancel 时 Abort 不复制
    IfFileExists "$INSTDIR\Version" 0 skipOfficialCheck
        FileOpen $0 "$INSTDIR\Version" r
        IfErrors skipOfficialCheck
        FileRead $0 $1
        FileClose $0
        ${StrTrimNewLines} $1 $1
        ${StrLoc} $2 "$1" "-dlc." ">"
        StrCmp $2 "" 0 skipOfficialCheck
            MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "目标目录似乎是官方版 VRCX（Version: $1）。$\n$\n继续将覆盖官方版程序文件（官方的用户数据在 AppData，不受影响）。$\n$\n确定继续？" IDOK officialOk
            Abort
    officialOk:
    skipOfficialCheck:

    SetOutPath "$INSTDIR"

    File /r /x *.log /x *.pdb "${DLCDIR}\*.*"

    WriteRegStr HKLM "Software\VRCX-DLC" "InstallDir" $INSTDIR
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "DisplayName" "VRCX DLC"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "Publisher" "vrcx-team"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "DisplayVersion" "${PRODUCT_DISPLAY}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "DisplayArch" "x64"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "DisplayIcon" "$\"$INSTDIR\VRCX.ico$\""

    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM  "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC" "EstimatedSize" "$0"

    ${GetParameters} $R2
    ${GetOptions} $R2 /SKIP_SHORTCUT= $3
    StrCmp $3 "true" noShortcut
        CreateShortCut "$SMPROGRAMS\VRCX.lnk" "$INSTDIR\VRCX.exe"
        ApplicationID::Set "$SMPROGRAMS\VRCX.lnk" "VRCX"
    noShortcut:

    WriteRegStr HKCU "Software\Classes\vrcx" "" "URL:vrcx"
    WriteRegStr HKCU "Software\Classes\vrcx" "FriendlyTypeName" "VRCX"
    WriteRegStr HKCU "Software\Classes\vrcx" "URL Protocol" ""
    WriteRegExpandStr HKCU "Software\Classes\vrcx\DefaultIcon" "" "$INSTDIR\VRCX.ico"
    WriteRegStr HKCU "Software\Classes\vrcx\shell" "" "open"
    WriteRegStr HKCU "Software\Classes\vrcx\shell\open" "FriendlyAppName" "VRCX"
    WriteRegStr HKCU "Software\Classes\vrcx\shell\open\command" "" '"$INSTDIR\VRCX.exe" /uri="%1" /params="%2 %3 %4"'
SectionEnd

;--------------------------------
;Uninstaller Section

Section "Uninstall"
    ; If VRCX is already running, display a warning message and exit
    StrCpy $1 "VRCX.exe"
    nsProcess::_FindProcess "$1"
    Pop $R1
    ${If} $R1 = 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "VRCX is still running. Cannot uninstall this software.$\nPlease close VRCX and try again." /SD IDOK
        Abort
    ${EndIf}

    RMDir /r "$INSTDIR"

    DeleteRegKey HKLM "Software\VRCX-DLC"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCX-DLC"
    ; P1-9: Program.cs WriteDlcRegistryMarker 写入的 HKCU 标记键, 卸载时一并清理
    DeleteRegKey HKCU "Software\VRCX-DLC"
    ; P1-9: 仅当 vrcx 协议指向本安装目录时才删, 防止误删官方版的协议注册
    ReadRegStr $9 HKCU "Software\Classes\vrcx\shell\open\command" ""
    ${UnStrLoc} $8 "$9" "$INSTDIR" ">"
    StrCmp $8 "" 0 deleteVrcxProtocol
        DetailPrint "vrcx protocol does not point to this install dir, keeping registry key"
        Goto keepVrcxProtocol
    deleteVrcxProtocol:
        DeleteRegKey HKCU "Software\Classes\vrcx"
    keepVrcxProtocol:

    ${IfNot} ${Silent}
        Delete "$SMPROGRAMS\VRCX.lnk"
        Delete "$DESKTOP\VRCX.lnk"
    ${EndIf}
SectionEnd
