using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using DesktopManager.Models;
using DesktopManager.Utils;

namespace DesktopManager.Services
{
    public class FileScanner
    {
        private readonly IconCacheService _iconCacheService;

        public FileScanner(IconCacheService iconCacheService)
        {
            _iconCacheService = iconCacheService;
        }

        // 收集桌面项目（异步）
        public async Task<List<DesktopItem>> CollectDesktopItemsAsync(string desktopPath, string source, CancellationToken cancellationToken = default)
        {
            var items = new List<DesktopItem>();

            if (!Directory.Exists(desktopPath))
            {
                LoggerService.Warning("路径不存在: {DesktopPath}", desktopPath);
                return items;
            }

            try
            {
                // 检查取消请求
                cancellationToken.ThrowIfCancellationRequested();

                // 获取所有文件和文件夹
                string[] files = Directory.GetFiles(desktopPath);
                string[] directories = Directory.GetDirectories(desktopPath);

                // 处理文件
                foreach (string file in files)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    var item = await CreateDesktopItemAsync(file, false, source, cancellationToken);
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }

                // 处理文件夹
                foreach (string directory in directories)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    var item = await CreateDesktopItemAsync(directory, true, source, cancellationToken);
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                LoggerService.Info("⚠️ 扫描被取消: {DesktopPath}", desktopPath);
                throw;
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "收集桌面项目时出错");
            }

            return items;
        }

        // 收集粘贴文件夹中的所有文件（异步）
        public async Task<List<DesktopItem>> CollectPastedFilesAsync(string rootPath, CancellationToken cancellationToken = default)
        {
            var items = new List<DesktopItem>();

            if (!Directory.Exists(rootPath))
            {
                LoggerService.Warning("粘贴文件夹不存在: {RootPath}", rootPath);
                return items;
            }

            try
            {
                // 递归收集所有文件
                await CollectFilesRecursiveAsync(rootPath, rootPath, items, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                LoggerService.Info("⚠️ 扫描被取消: {RootPath}", rootPath);
                throw;
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "收集粘贴文件时出错");
            }

            return items;
        }

        // 递归收集文件（异步）
        private async Task CollectFilesRecursiveAsync(string rootPath, string currentPath, List<DesktopItem> items, CancellationToken cancellationToken)
        {
            try
            {
                // 检查取消请求
                cancellationToken.ThrowIfCancellationRequested();

                // 获取所有文件和文件夹
                string[] files = Directory.GetFiles(currentPath);
                string[] directories = Directory.GetDirectories(currentPath);

                // 处理文件
                foreach (string file in files)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    var item = await CreateDesktopItemAsync(file, false, "PastedFiles", cancellationToken);
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }

                // 递归处理子文件夹
                foreach (string directory in directories)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    // 检查是否为年月组织目录
                    if (!IsDateOrganizationFolder(rootPath, directory))
                    {
                        var item = await CreateDesktopItemAsync(directory, true, "PastedFiles", cancellationToken);
                        if (item != null)
                        {
                            items.Add(item);
                        }
                    }

                    // 递归处理子文件夹中的内容
                    await CollectFilesRecursiveAsync(rootPath, directory, items, cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "收集文件时出错: {CurrentPath}", currentPath);
            }
        }

        // 创建桌面项目（异步）- Public 以便 FileWatcherService 调用
        public async Task<DesktopItem?> CreateDesktopItemAsync(string path, bool isDirectory, string source, CancellationToken cancellationToken)
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();

                string name = Path.GetFileName(path);
                string extension = isDirectory ? string.Empty : Path.GetExtension(path);

                // 处理快捷方式
                if (extension.ToLower() == ".lnk" && !isDirectory)
                {
                    string? targetPath = ShellLinkHelper.RetrieveTargetPath(path);
                    if (!string.IsNullOrEmpty(targetPath))
                    {
                        path = targetPath;
                        isDirectory = Directory.Exists(path);
                    }
                }

                // 使用 Task.Run 在后台线程异步获取图标
                var icon = await Task.Run(() => _iconCacheService.GetIconCached(path, isDirectory), cancellationToken);
                string? iconPath = null;
                string iconBase64 = string.Empty;

                if (icon != null)
                {
                    // SaveIconToFile 仍然需要从 IconGenerator 调用，暂时保留
                    // iconPath = _iconGenerator.SaveIconToFile(icon, name, extension);
                    iconBase64 = await Task.Run(() => _iconCacheService.GetIconBase64Cached(icon, path), cancellationToken);
                }

                // 异步生成缩略图
                string? thumbnailPath = null;
                if (!isDirectory && IsImageFile(extension))
                {
                    thumbnailPath = await Task.Run(() => _iconCacheService.GetThumbnailCached(path, name, true), cancellationToken);
                }
                else if (!isDirectory && IsVideoFile(extension))
                {
                    thumbnailPath = await Task.Run(() => _iconCacheService.GetThumbnailCached(path, name, false), cancellationToken);
                }

                return new DesktopItem
                {
                    Name = name,
                    Path = path,
                    IsDirectory = isDirectory,
                    Extension = extension,
                    IconPath = iconPath ?? string.Empty,
                    ThumbnailPath = thumbnailPath ?? string.Empty,
                    IconBase64 = iconBase64,
                    Source = source,
                    Dock = false,
                    LastModified = File.Exists(path) ? File.GetLastWriteTime(path) : Directory.GetLastWriteTime(path)
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "创建桌面项目实体时出错: {Path}", path);
                return null;
            }
        }

        // 检查是否为年月组织文件夹
        private static bool IsDateOrganizationFolder(string rootPath, string dirPath)
        {
            try
            {
                // 获取相对路径并规范化分隔符
                string relative = Path.GetRelativePath(rootPath, dirPath).Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
                string[] parts = relative.Split(Path.DirectorySeparatorChar);

                // 年份层级 (根目录下第一级，4位数字)
                if (parts.Length == 1)
                {
                    string p = parts[0];
                    return p.Length == 4 && int.TryParse(p, out _);
                }

                // 月份层级 (根目录下第二级，2位数字，或带"月"字样)
                if (parts.Length == 2)
                {
                    string p = parts[1];
                    // 支持单纯数字如 "02" 或带单位如 "02月" (为了更健壮)
                    if (p.EndsWith("月")) p = p.Substring(0, p.Length - 1);
                    return (p.Length == 2 || p.Length == 1) && int.TryParse(p, out _);
                }
            }
            catch { }
            return false;
        }

        // 检查是否为图片文件
        private static bool IsImageFile(string extension)
        {
            string[] imageExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".ico", ".svg" };
            return Array.Exists(imageExtensions, ext => ext.Equals(extension, StringComparison.OrdinalIgnoreCase));
        }

        // 检查是否为视频文件
        private static bool IsVideoFile(string extension)
        {
            string[] videoExtensions = { ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v" };
            return Array.Exists(videoExtensions, ext => ext.Equals(extension, StringComparison.OrdinalIgnoreCase));
        }

        // 获取安全的文件名
        private static string GetSafeFileName(string fileName)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                fileName = fileName.Replace(c, '_');
            }
            return fileName;
        }

        #region ShellLinkHelper

        /// <summary>
        /// ShellLinkHelper class for resolving shortcuts
        /// </summary>
        private static class ShellLinkHelper
        {
            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
            private struct WIN32_FIND_DATAW
            {
                public uint dwFileAttributes;
                public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
                public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
                public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
                public uint nFileSizeHigh;
                public uint nFileSizeLow;
                public uint dwReserved0;
                public uint dwReserved1;
                [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
                public string cFileName;
                [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
                public string cAlternateFileName;
            }

            [Flags]
            private enum SLR_FLAGS
            {
                SLR_NO_UI = 0x1,
                SLR_ANY_MATCH = 0x2,
                SLR_UPDATE = 0x4,
                SLR_NOUPDATE = 0x8,
                SLR_NOSEARCH = 0x10,
                SLR_NOTRACK = 0x20,
                SLR_NOLINKINFO = 0x40,
                SLR_INVOKE_MSI = 0x80
            }

            [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IShellLinkW
            {
                void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, out WIN32_FIND_DATAW pfd, uint fFlags);
                void GetIDList(out IntPtr ppidl);
                void SetIDList(IntPtr pidl);
                void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
                void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
                void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
                void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
                void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
                void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
                void GetHotkey(out short pwHotkey);
                void SetHotkey(short wHotkey);
                void GetShowCmd(out int piShowCmd);
                void SetShowCmd(int iShowCmd);
                void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
                void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
                void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
                void Resolve(IntPtr hwnd, uint fFlags);
                void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
            }

            [ComImport, Guid("00021401-0000-0000-C000-000000000046"), ClassInterface(ClassInterfaceType.None)]
            private class ShellLink
            {
            }

            [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IPersistFile
            {
                void GetClassID(out Guid pClassID);
                void IsDirty();
                void Load([In, MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
                void Save([In, MarshalAs(UnmanagedType.LPWStr)] string pszFileName, [In, MarshalAs(UnmanagedType.Bool)] bool fRemember);
                void SaveCompleted([In, MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
                void GetCurFile([In, MarshalAs(UnmanagedType.LPWStr)] string ppszFileName);
            }

            public static string? RetrieveTargetPath(string shortcutPath)
            {
                try
                {
                    var link = new ShellLink();
                    ((IPersistFile)link).Load(shortcutPath, 0);

                    var path = new StringBuilder(260);
                    ((IShellLinkW)link).GetPath(path, path.Capacity, out _, 0);

                    string targetPath = path.ToString();
                    if (string.IsNullOrEmpty(targetPath))
                    {
                        return null;
                    }

                    return targetPath;
                }
                catch
                {
                    return null;
                }
            }
        }

        #endregion
    }
}
