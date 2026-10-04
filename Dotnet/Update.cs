using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using NLog;

#if !LINUX
using System.Windows.Forms;
#endif

namespace VRCX
{
    public class Update
    {
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();
        private static readonly string VrcxSetupExecutable = Path.Join(Program.AppDataDirectory, "VRCX_Setup.exe");
        private static readonly string UpdateExecutable = Path.Join(Program.AppDataDirectory, "update.exe");
        private static readonly string TempDownload = Path.Join(Program.AppDataDirectory, "tempDownload");
        private static readonly HttpClient httpClient;
        private static CancellationToken _cancellationToken;
        public static int UpdateProgress;
        private static string AppImagePath = string.Empty;
        private static string AppImagePathOld = string.Empty;

        static Update()
        {
            var httpClientHandler = new HttpClientHandler();
            if (WebApi.ProxySet)
                httpClientHandler.Proxy = WebApi.Proxy;

            httpClient = new HttpClient(httpClientHandler);
            httpClient.DefaultRequestHeaders.Add("User-Agent", Program.Version);
        }

        public void Init(string appImagePath = "")
        {
            if (string.IsNullOrEmpty(appImagePath))
                return;

            AppImagePath = appImagePath;
            AppImagePathOld = appImagePath + ".old";
            logger.Info($"AppImagePath: {AppImagePath}");
        }

        // 返回值: 本次启动是否安装了待装更新。安装采用官方式外进程, 发现待装包时
        // 本进程直接退出, 正常情况下返回值恒为 false（保留 bool 以兼容调用方签名）
        public static bool Check()
        {
            if (Process.GetProcessesByName("VRCX_Setup").Length > 0)
                Environment.Exit(0);

            if (File.Exists(TempDownload))
                File.Delete(TempDownload);
            if (File.Exists(VrcxSetupExecutable))
                File.Delete(VrcxSetupExecutable);

            if (File.Exists(UpdateExecutable + ".consumed"))
                File.Delete(UpdateExecutable + ".consumed");

            if (!File.Exists(UpdateExecutable))
                return false;

            if (IsZipFile(UpdateExecutable))
            {
                // 拓展版 zip 更新包: 包内版本不比本地新(相同或更旧) → 仅清理跳过（防降级/防重复安装）
                if (IsZipVersionNotNewer(UpdateExecutable, out var zipVersion))
                {
                    logger.Info(
                        $"DLC zip {zipVersion} is not newer than the current version, skipping install"
                    );
                    TryCleanUpdateFile(UpdateExecutable);
                    return false;
                }

                // 官方式安装: 运行中的 VRCX.exe/VRCX.dll/libcef.dll 均被本进程锁定,
                // 进程内解压永远装不上完整包。与官方 VRCX_Setup.exe 机制一致——
                // 写出独立的安装 helper, 隐藏启动后本进程退出, 由外部进程完成解压覆盖与重启
                try
                {
                    LaunchExternalZipInstall();
                    Environment.Exit(0);
                }
                catch (Exception ex)
                {
                    // helper 启动失败: 保留 zip 下次启动重试, 本次正常启动
                    logger.Info($"Failed to launch the DLC update helper (deferred to next start): {ex.Message}");
                }
            }

            // 官方安装器字节(VRCX_Setup.exe): 移动后启动安装器, 本进程退出（官方原版行为）
            try
            {
                RunSetupInstaller();
            }
            catch (Exception ex)
            {
                // 启动失败不崩主程序: 残留文件下次启动重试
                logger.Info($"Failed to launch the setup installer (deferred to next start): {ex.Message}");
            }

            return false;
        }

        private static bool IsZipFile(string path)
        {
            try
            {
                using var stream = File.OpenRead(path);
                var magic = new byte[2];
                if (stream.Read(magic, 0, 2) != 2)
                    return false;
                return magic[0] == 0x50 && magic[1] == 0x4B;
            }
            catch
            {
                return false;
            }
        }

        // 更新包内的 Version 不比本地新（相同或更旧）→ 跳过安装防降级, 仅清理
        private static string[] VersionTokens(string name)
        {
            return System.Text.RegularExpressions.Regex
                .Replace(name ?? string.Empty, "^VRCX (DLC|Nightly)?\\s*", string.Empty,
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                .Replace('-', '.')
                .Split('.', StringSplitOptions.RemoveEmptyEntries);
        }

        private static int CompareVersionTokens(string a, string b)
        {
            var pa = VersionTokens(a);
            var pb = VersionTokens(b);
            var len = Math.Max(pa.Length, pb.Length);
            for (var i = 0; i < len; i++)
            {
                var sa = i < pa.Length ? pa[i] : null;
                var sb = i < pb.Length ? pb[i] : null;
                if (sa == null)
                    return -1;
                if (sb == null)
                    return 1;
                if (int.TryParse(sa, out var na) && int.TryParse(sb, out var nb))
                {
                    if (na != nb)
                        return na.CompareTo(nb);
                }
                else if (!string.Equals(sa, sb, StringComparison.OrdinalIgnoreCase))
                {
                    return string.Compare(sa, sb, StringComparison.OrdinalIgnoreCase);
                }
            }
            return 0;
        }

        // 更新包内的 Version 不比本地新(相同或更旧) → true; 异常或缺少 Version 条目按"是新包"处理
        private static bool IsZipVersionNotNewer(string zipPath, out string zipVersion)
        {
            zipVersion = string.Empty;
            try
            {
                var localVersion = File.ReadAllText(
                    Path.Join(Program.BaseDirectory, "Version")
                ).Trim();
                using var archive = System.IO.Compression.ZipFile.OpenRead(zipPath);
                foreach (var entry in archive.Entries)
                {
                    if (!string.Equals(entry.Name, "Version", StringComparison.OrdinalIgnoreCase))
                        continue;
                    using var reader = new StreamReader(entry.Open());
                    zipVersion = reader.ReadToEnd().Trim();
                    // 正数 = 包内版本更新, 应当安装; 仅相同或更旧才跳过
                    return CompareVersionTokens(zipVersion, localVersion) <= 0;
                }
                logger.Info("DLC zip has no Version entry, treating as an update");
                return false;
            }
            catch (Exception ex)
            {
                logger.Info($"DLC zip version check failed ({ex.Message}), treating as an update");
                return false;
            }
        }

        // 清理失败不应让已成功的更新报"安装失败"：句柄已释放后重试, 再失败改名延后到下次启动
        private static void TryCleanUpdateFile(string zipPath)
        {
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    File.Delete(zipPath);
                    return;
                }
                catch (Exception ex) when (attempt < 5)
                {
                    logger.Info($"DLC zip cleanup retry {attempt}: {ex.Message}");
                    System.Threading.Thread.Sleep(2000);
                }
                catch (Exception ex)
                {
                    logger.Info($"DLC zip cleanup deferred: {ex.Message}");
                    try
                    {
                        var consumed = zipPath + ".consumed";
                        if (File.Exists(consumed))
                            File.Delete(consumed);
                        File.Move(zipPath, consumed);
                        logger.Info("Update file locked, renamed for deferred cleanup");
                    }
                    catch (Exception moveEx)
                    {
                        logger.Warn($"Update file cleanup failed entirely: {moveEx.Message}");
                    }
                    return;
                }
            }
        }

        // 对照官方 VRCX_Setup.exe 的安装方式: 本进程只负责"退出", 安装由独立的外部进程完成。
        // 运行中的 VRCX.exe/VRCX.dll/libcef.dll 等文件被本进程锁定, 进程内解压永远装不上完整包。
        private static void LaunchExternalZipInstall()
        {
            var helperPath = Path.Join(Program.AppDataDirectory, "dlc-update-helper.ps1");
            var logPath = Path.Join(Program.AppDataDirectory, "dlc-update.log");
            File.WriteAllText(
                helperPath,
                HelperScript,
                new System.Text.UTF8Encoding(true)
            );
            logger.Info("DLC update helper written, launching external installer and exiting");

            // 去掉尾部分隔符: 带引号的参数以 \\" 结尾会被解析成转义引号, 破坏命令行
            var targetDir = Program.BaseDirectory.TrimEnd('\\', '/');
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments =
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
                    + helperPath
                    + "\" -ZipPath \""
                    + UpdateExecutable
                    + "\" -TargetDir \""
                    + targetDir
                    + "\" -LogPath \""
                    + logPath
                    + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
        }

        private static void RunSetupInstaller()
        {
            if (File.Exists(VrcxSetupExecutable))
                File.Delete(VrcxSetupExecutable);
            File.Move(UpdateExecutable, VrcxSetupExecutable);
            // 目标目录 = 当前运行目录 (/UPDATEDIR= 为 DLC 安装器自定义开关:
            // NSIS 会消费 /D= 并从 $CMDLINE 移除, 无法在脚本内读到)
            var targetDir = Program.BaseDirectory.TrimEnd('\\', '/');
            var vrcxProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = VrcxSetupExecutable,
                    Arguments = "/UPDATEDIR=\"" + targetDir + "\"",
                    UseShellExecute = true,
                    WorkingDirectory = Program.AppDataDirectory
                }
            };
            vrcxProcess.Start();
            Environment.Exit(0);
        }

        // 外部安装脚本: 等 VRCX 退出 → zip-slip 穿越预扫 → 解压临时目录 → 覆盖安装目录
        // → 标记 .consumed(下次启动清理) → 拉起 VRCX。全程写 dlc-update.log 便于诊断
        private const string HelperScript = @"
param(
    [Parameter(Mandatory = $true)][string] $ZipPath,
    [Parameter(Mandatory = $true)][string] $TargetDir,
    [Parameter(Mandatory = $true)][string] $LogPath
)
$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
    try {
        Add-Content -Path $LogPath -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message) -Encoding UTF8
    } catch { }
}

try {
    Write-Log 'DLC update: external installer started'
    $TargetDir = $TargetDir.TrimEnd('\')
    $targetPrefix = $TargetDir + '\'

    # Wait for this VRCX to fully exit (files under TargetDir are locked while it runs), max 60s
    $waited = 0
    while ($waited -lt 60) {
        $running = @(Get-Process -Name 'VRCX' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Seconds 2
        $waited += 2
    }
    $running = @(Get-Process -Name 'VRCX' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -gt 0) {
        Write-Log 'VRCX still running after 60s, aborting (zip kept for next start)'
        exit 1
    }

    # Zip-slip pre-scan: every entry must land inside the install directory
    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $zip.Entries) {
            if ([string]::IsNullOrEmpty($entry.Name)) { continue }
            $dest = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($TargetDir, $entry.FullName))
            if (-not $dest.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Log ('Unsafe zip entry: ' + $entry.FullName + ', aborting')
                exit 1
            }
        }
    } finally {
        $zip.Dispose()
    }

    # Extract to temp dir (3 attempts against antivirus locks)
    $tmp = Join-Path $env:TEMP ('vrcx-dlc-update-' + [guid]::NewGuid().ToString('N'))
    $extracted = $false
    for ($i = 1; $i -le 3; $i++) {
        try {
            if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
            [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $tmp)
            $extracted = $true
            break
        } catch {
            Write-Log ('Extract attempt ' + $i + ' failed: ' + $_.Exception.Message)
            Start-Sleep -Seconds 2
        }
    }
    if (-not $extracted) {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
        Write-Log 'Extract failed after 3 attempts, aborting (zip kept for next start)'
        exit 1
    }

    # Copy over the install directory (files not present in the zip are kept)
    Copy-Item -Path (Join-Path $tmp '*') -Destination $TargetDir -Recurse -Force
    Remove-Item -Recurse -Force $tmp

    # Mark consumed; VRCX deletes the marker on next start
    Move-Item -Path $ZipPath -Destination ($ZipPath + '.consumed') -Force
    Write-Log 'DLC update installed'

    Start-Process -FilePath (Join-Path $TargetDir 'VRCX.exe') -WorkingDirectory $TargetDir
    Write-Log 'VRCX relaunched'
    exit 0
} catch {
    Write-Log ('Helper failed: ' + $_.Exception.Message)
    exit 1
}
";

        public static async Task DownloadInstallRedist()
        {
            try
            {
                var filePath = await DownloadFile("https://aka.ms/vs/17/release/vc_redist.x64.exe");
                var installRedist = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = filePath,
                        Arguments = "/install /quiet /norestart"
                    }
                };
                installRedist.Start();
                await installRedist.WaitForExitAsync();
            }
            catch (Exception e)
            {
                var message = $"Failed to download and install the Visual C++ Redistributable: {e.Message}";
                logger.Info(message);
#if !LINUX
                MessageBox.Show(message, "Update failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
#endif
            }
        }

        private static async Task<string> DownloadFile(string fileUrl, CancellationToken cancellationToken = default)
        {
            var response = await httpClient.GetAsync(fileUrl, cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new Exception($"Failed to download the file. Status code: {response.StatusCode}");

            var fileName = GetFileNameFromContentDisposition(response);
            var tempPath = Path.Join(Path.GetTempPath(), "VRCX");
            Directory.CreateDirectory(tempPath);
            var filePath = Path.Join(tempPath, fileName);
            await using var fileStream = File.Create(filePath);
            await response.Content.CopyToAsync(fileStream, cancellationToken);
            return filePath;
        }

        private static string GetFileNameFromContentDisposition(HttpResponseMessage response)
        {
            string contentDisposition = response.Content.Headers.ContentDisposition?.ToString();
            if (contentDisposition != null)
            {
                int startIndex = contentDisposition.IndexOf("filename=", StringComparison.OrdinalIgnoreCase);
                if (startIndex >= 0)
                {
                    startIndex += "filename=".Length;
                    int endIndex = contentDisposition.IndexOf(";", startIndex, StringComparison.Ordinal);
                    if (endIndex == -1)
                    {
                        endIndex = contentDisposition.Length;
                    }

                    string fileName = contentDisposition.Substring(startIndex, endIndex - startIndex).Trim(' ', '"');
                    return fileName;
                }
            }

            throw new Exception("Unable to extract file name from content-disposition header.");
        }

        // 大文件下载经不稳定网络/代理常见中途断流: 大小/哈希校验失败自动重试, 最多 3 次
        public static async Task DownloadUpdate(string fileUrl, string hashString, int downloadSize)
        {
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    await DownloadUpdateOnce(fileUrl, hashString, downloadSize);
                    return;
                }
                catch (Exception ex)
                    when (attempt < 3 && ex is not OperationCanceledException)
                {
                    logger.Info($"Update download retry {attempt}/3: {ex.Message}");
                    UpdateProgress = 0;
                    await Task.Delay(2000);
                }
            }
        }

        private static async Task DownloadUpdateOnce(string fileUrl, string hashString, int downloadSize)
        {
            _cancellationToken = CancellationToken.None;
            const int chunkSize = 8192;

            if (File.Exists(TempDownload))
                File.Delete(TempDownload);

            await using var destination = File.OpenWrite(TempDownload);
            using var response = await httpClient.GetAsync(fileUrl, HttpCompletionOption.ResponseHeadersRead, _cancellationToken);
            await using var download = await response.Content.ReadAsStreamAsync(_cancellationToken);
            var contentLength = response.Content.Headers.ContentLength;
            var buffer = new byte[chunkSize];
            long totalBytesRead = 0;

            while (true)
            {
                if (contentLength.HasValue)
                {
                    var percentage = Math.Round((double)totalBytesRead / contentLength.Value * 100, 2);
                    UpdateProgress = (int)percentage;
                }
                var bytesRead = await download.ReadAsync(buffer.AsMemory(0, chunkSize), _cancellationToken);
                if (bytesRead == 0)
                    break;

                if (_cancellationToken.IsCancellationRequested)
                    throw new OperationCanceledException("Download was cancelled.");

                await destination.WriteAsync(buffer.AsMemory(0, bytesRead), _cancellationToken);
                totalBytesRead += bytesRead;
            }

            destination.Close();

            var data = new FileInfo(TempDownload);
            if (data.Length != downloadSize)
            {
                File.Delete(TempDownload);
                logger.Error("Downloaded file size does not match expected size");
                throw new Exception("Downloaded file size does not match expected size");
            }

            if (string.IsNullOrEmpty(hashString))
            {
                logger.Error("Hash string is empty, skipping hash check");
            }
            else
            {
                logger.Info("Checking hash");
                using (var sha256 = SHA256.Create())
                await using (var stream = File.OpenRead(TempDownload))
                {
                    var fileHashBytes = await sha256.ComputeHashAsync(stream, _cancellationToken);
                    var fileHashString = Convert.ToHexString(fileHashBytes);
                    if (!hashString.Equals(fileHashString, StringComparison.OrdinalIgnoreCase))
                    {
                        logger.Error($"Hash check failed file:{fileHashString} web:{hashString}");
                        throw new Exception("Hash check failed");
                        // can't delete file yet because it's in use
                    }
                }

                logger.Info("Hash check passed");
            }

            if (string.IsNullOrEmpty(AppImagePath))
            {
                // Windows
                if (File.Exists(UpdateExecutable))
                    File.Delete(UpdateExecutable);
                File.Move(TempDownload, UpdateExecutable);
            }
            else
            {
                // Linux
                if (File.Exists(AppImagePathOld))
                    File.Delete(AppImagePathOld);
                File.Move(AppImagePath, AppImagePathOld);
                File.Move(TempDownload, AppImagePath);
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "chmod",
                        Arguments = $"+x {AppImagePath}"
                    }
                };
                process.Start();
                await process.WaitForExitAsync();
            }

            UpdateProgress = 0;
            _cancellationToken = CancellationToken.None;
        }

        public static async Task CancelUpdate()
        {
            _cancellationToken = new CancellationToken(true);
            UpdateProgress = 0;
            await Task.Delay(100);
            try
            {
                if (File.Exists(TempDownload))
                    File.Delete(TempDownload);
            }
            catch
            {
                // ignored
            }
        }
    }
}
