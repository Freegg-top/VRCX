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

        public static void Check()
        {
            if (Process.GetProcessesByName("VRCX_Setup").Length > 0)
                Environment.Exit(0);

            if (File.Exists(TempDownload))
                File.Delete(TempDownload);
            if (File.Exists(VrcxSetupExecutable))
                File.Delete(VrcxSetupExecutable);

            if (File.Exists(UpdateExecutable))
            {
                // 新写入的 update.exe 常被杀软实时扫描短暂占用（读取/搬移/删除都可能失败），
                // 启动时整体重试后再报错——绝大多数情况下重试期内锁即释放
                const int maxAttempts = 5;
                for (var attempt = 1; ; attempt++)
                {
                    try
                    {
                        InstallUpdate();
                        break;
                    }
                    catch (Exception ex) when (attempt < maxAttempts)
                    {
                        logger.Info($"Update install retry {attempt}/{maxAttempts}: {ex.Message}");
                        System.Threading.Thread.Sleep(2000);
                    }
                    catch (Exception ex)
                    {
                        var message = $"Failed to install the update: {ex.Message}";
                        logger.Info(message);
#if !LINUX
                        MessageBox.Show(message, "Update failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
#endif
                        break;
                    }
                }
            }
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

        // 自定义分发: 便携 zip 更新包直接解压覆盖安装目录（带置顶安装弹窗，体验与官方安装器一致）
        private static void ExtractZipOverInstallDirectory(string zipPath)
        {
            var installDirectory = Program.BaseDirectory;
            System.Windows.Forms.Form progressForm = null;
            System.Windows.Forms.Label progressLabel = null;
            try
            {
                progressForm = new System.Windows.Forms.Form
                {
                    Text = "VRCX 拓展版 更新",
                    Size = new System.Drawing.Size(380, 110),
                    StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen,
                    TopMost = true,
                    FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog,
                    ControlBox = false,
                    ShowInTaskbar = false
                };
                progressLabel = new System.Windows.Forms.Label
                {
                    Dock = System.Windows.Forms.DockStyle.Fill,
                    TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
                    Text = "正在安装拓展版更新…"
                };
                progressForm.Controls.Add(progressLabel);
                progressForm.Show();
                System.Windows.Forms.Application.DoEvents();
            }
            catch
            {
                // 界面创建失败不影响安装本体
            }

            using var archive = System.IO.Compression.ZipFile.OpenRead(zipPath);
            var entryTotal = archive.Entries.Count;
            var entryDone = 0;
            foreach (var entry in archive.Entries)
            {
                var destinationPath = Path.Join(installDirectory, entry.FullName);
                var directory = Path.GetDirectoryName(destinationPath);
                if (!string.IsNullOrEmpty(directory))
                    Directory.CreateDirectory(directory);
                if (string.IsNullOrEmpty(entry.Name))
                    continue;
                entry.ExtractToFile(destinationPath, true);
                entryDone++;
                if (progressLabel != null && entryDone % 20 == 0)
                {
                    progressLabel.Text = $"正在安装拓展版更新… {entryDone}/{entryTotal}";
                    System.Windows.Forms.Application.DoEvents();
                }
            }
            // 完成提示停留片刻，让用户看到安装窗
            if (progressLabel != null)
            {
                progressLabel.Text = "安装完成，正在启动…";
                System.Windows.Forms.Application.DoEvents();
                System.Threading.Thread.Sleep(1200);
            }
            if (progressForm != null)
            {
                try { progressForm.Close(); } catch { }
            }
            // 清理失败不应让已成功的更新报"安装失败"：杀软/残留句柄常短暂占用，重试后再顺延
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    File.Delete(zipPath);
                    break;
                }
                catch (Exception ex) when (attempt < 5)
                {
                    logger.Info($"Custom zip update extracted; cleanup retry {attempt}: {ex.Message}");
                    System.Threading.Thread.Sleep(2000);
                }
                catch (Exception ex)
                {
                    logger.Info($"Custom zip update extracted; cleanup of {zipPath} deferred: {ex.Message}");
                    break;
                }
            }
            logger.Info("Custom zip update extracted over the install directory");
        }

        private static void InstallUpdate()
        {
            var setupArguments = string.Empty;

            // 异常向上抛给 Check() 的重试循环；全部重试失败才弹窗
            if (IsZipFile(UpdateExecutable))
            {
                ExtractZipOverInstallDirectory(UpdateExecutable);
                return;
            }

            if (File.Exists(VrcxSetupExecutable))
                File.Delete(VrcxSetupExecutable);
            File.Move(UpdateExecutable, VrcxSetupExecutable);
            var vrcxProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = VrcxSetupExecutable,
                    Arguments = setupArguments,
                    UseShellExecute = true,
                    WorkingDirectory = Program.AppDataDirectory
                }
            };
            vrcxProcess.Start();
            Environment.Exit(0);
        }

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

        public static async Task DownloadUpdate(string fileUrl, string hashString, int downloadSize)
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
