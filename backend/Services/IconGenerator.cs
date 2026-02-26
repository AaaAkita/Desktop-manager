using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using DesktopManager.Utils;

namespace DesktopManager.Services
{
    public class IconGenerator
    {
        private readonly string _iconsDirectory;
        private readonly string _thumbnailsDirectory;

        public IconGenerator(string iconsDirectory, string thumbnailsDirectory)
        {
            _iconsDirectory = iconsDirectory;
            _thumbnailsDirectory = thumbnailsDirectory;

            // 确保目录存在
            Directory.CreateDirectory(_iconsDirectory);
            Directory.CreateDirectory(_thumbnailsDirectory);
        }

        // 保存图标到文件
        public string? SaveIconToFile(Icon icon, string name, string extension)
        {
            try
            {
                if (icon == null)
                    return null;

                string safeFileName = GetSafeFileName(name);
                string iconFileName = $"{safeFileName}{extension}.png";
                string iconPath = Path.Combine(_iconsDirectory, iconFileName);

                using (var bitmap = icon.ToBitmap())
                {
                    bitmap.Save(iconPath, ImageFormat.Png);
                }

                return iconPath;
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "保存图标时出错");
                return null;
            }
        }

        // 生成图片缩略图
        public string? GenerateImageThumbnail(string imagePath, string name)
        {
            try
            {
                // 使用WindowsThumbnailProvider获取原生缩略图
                using (var thumbnail = WindowsThumbnailProvider.GetThumbnail(imagePath, 200, 200, WindowsThumbnailProvider.ThumbnailOptions.ThumbnailOnly))
                {
                    if (thumbnail != null)
                    {
                        string safeFileName = GetSafeFileName(name);
                        string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                        string thumbnailPath = Path.Combine(_thumbnailsDirectory, thumbnailFileName);

                        thumbnail.Save(thumbnailPath, ImageFormat.Png);
                        return thumbnailPath;
                    }
                    else
                    {
                        // 如果获取原生缩略图失败，使用传统方法
                        using (var image = Image.FromFile(imagePath))
                        {
                            int thumbnailWidth = 200;
                            int thumbnailHeight = 200;

                            using (var fallbackThumbnail = new Bitmap(thumbnailWidth, thumbnailHeight))
                            {
                                using (var graphics = Graphics.FromImage(fallbackThumbnail))
                                {
                                    graphics.CompositingQuality = CompositingQuality.HighQuality;
                                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                    graphics.SmoothingMode = SmoothingMode.HighQuality;

                                    graphics.DrawImage(image, 0, 0, thumbnailWidth, thumbnailHeight);
                                }

                                string safeFileName = GetSafeFileName(name);
                                string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                                string thumbnailPath = Path.Combine(_thumbnailsDirectory, thumbnailFileName);

                                fallbackThumbnail.Save(thumbnailPath, ImageFormat.Png);
                                return thumbnailPath;
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "生成图片缩略图时出错: {ImagePath}", imagePath);
                return null;
            }
        }

        // 生成视频缩略图
        public string? GenerateVideoThumbnail(string videoPath, string name)
        {
            try
            {
                // 使用WindowsThumbnailProvider获取原生视频缩略图
                using (var thumbnail = WindowsThumbnailProvider.GetThumbnail(videoPath, 200, 200, WindowsThumbnailProvider.ThumbnailOptions.ThumbnailOnly))
                {
                    if (thumbnail != null)
                    {
                        string safeFileName = GetSafeFileName(name);
                        string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                        string thumbnailPath = Path.Combine(_thumbnailsDirectory, thumbnailFileName);

                        thumbnail.Save(thumbnailPath, ImageFormat.Png);
                        return thumbnailPath;
                    }
                    else
                    {
                        // 如果获取原生缩略图失败，使用默认图标
                        using (var bitmap = SystemIcons.WinLogo.ToBitmap())
                        {
                            string safeFileName = GetSafeFileName(name);
                            string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                            string thumbnailPath = Path.Combine(_thumbnailsDirectory, thumbnailFileName);

                            bitmap.Save(thumbnailPath, ImageFormat.Png);
                            return thumbnailPath;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "生成视频缩略图时出错: {VideoPath}", videoPath);
                return null;
            }
        }

        // 获取文件或目录的图标
        public Icon? GetIcon(string path, bool isDirectory)
        {
            try
            {
                if (isDirectory)
                {
                    return SystemIcons.GetStockIcon(StockIconId.Folder, StockIconOptions.SmallIcon);
                }
                else
                {
                    // 尝试获取关联图标
                    Icon? icon = Icon.ExtractAssociatedIcon(path);
                    if (icon != null)
                    {
                        return icon;
                    }

                    // 如果失败，返回默认图标
                    return SystemIcons.WinLogo;
                }
            }
            catch
            {
                return SystemIcons.WinLogo;
            }
        }

        // 将图标转换为 Base64 字符串
        public string IconToBase64(Icon icon)
        {
            try
            {
                using (var ms = new MemoryStream())
                {
                    icon.ToBitmap().Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        // 获取安全的文件名
        private string GetSafeFileName(string fileName)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                fileName = fileName.Replace(c, '_');
            }
            return fileName;
        }

        #region WindowsThumbnailProvider

        /// <summary>
        /// Windows 原生缩略图提供者
        /// </summary>
        private static class WindowsThumbnailProvider
        {
            [Flags]
            public enum ThumbnailOptions
            {
                None = 0x00,
                BiggerSizeOk = 0x01,
                InMemoryOnly = 0x02,
                IconOnly = 0x04,
                ThumbnailOnly = 0x08,
                InCacheOnly = 0x10
            }

            [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IShellItem
            {
            }

            [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IShellItemImageFactory
            {
                [PreserveSig]
                int GetImage([In, MarshalAs(UnmanagedType.Struct)] NativeSize size, [In] ThumbnailOptions flags, [Out] out IntPtr phbm);
            }

            [StructLayout(LayoutKind.Sequential)]
            private struct NativeSize
            {
                private int width;
                private int height;

                public int Width
                {
                    set { width = value; }
                }

                public int Height
                {
                    set { height = value; }
                }
            }

            [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
            private static extern void SHCreateItemFromParsingName(
                [In][MarshalAs(UnmanagedType.LPWStr)] string pszPath,
                [In] IntPtr pbc,
                [In][MarshalAs(UnmanagedType.LPStruct)] Guid riid,
                [Out][MarshalAs(UnmanagedType.Interface, IidParameterIndex = 2)] out IShellItemImageFactory ppv);

            public static Bitmap? GetThumbnail(string fileName, int width, int height, ThumbnailOptions options)
            {
                try
                {
                    var guid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"); // IShellItemImageFactory
                    SHCreateItemFromParsingName(fileName, IntPtr.Zero, guid, out IShellItemImageFactory factory);

                    var nativeSize = new NativeSize
                    {
                        Width = width,
                        Height = height
                    };

                    factory.GetImage(nativeSize, options, out IntPtr hBitmap);

                    if (hBitmap != IntPtr.Zero)
                    {
                        var bitmap = Bitmap.FromHbitmap(hBitmap);
                        DeleteObject(hBitmap);
                        return bitmap;
                    }

                    return null;
                }
                catch
                {
                    return null;
                }
            }

            [DllImport("gdi32.dll")]
            private static extern bool DeleteObject(IntPtr hObject);
        }

        #endregion

        #region SystemIcons Extension

        private static class SystemIcons
        {
            public static Icon WinLogo => System.Drawing.SystemIcons.WinLogo;

            public static Icon GetStockIcon(StockIconId iconId, StockIconOptions options)
            {
                var info = new StockIconInfo
                {
                    cbSize = (uint)Marshal.SizeOf(typeof(StockIconInfo))
                };

                SHGetStockIconInfo(iconId, options, ref info);
                var icon = (Icon)Icon.FromHandle(info.hIcon).Clone();
                DestroyIcon(info.hIcon);
                return icon;
            }

            [DllImport("Shell32.dll")]
            private static extern int SHGetStockIconInfo(StockIconId siid, StockIconOptions uFlags, ref StockIconInfo psii);

            [DllImport("user32.dll")]
            private static extern bool DestroyIcon(IntPtr handle);

            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
            private struct StockIconInfo
            {
                public uint cbSize;
                public IntPtr hIcon;
                public int iSysIconIndex;
                public int iIcon;
                [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
                public string szPath;
            }
        }

        private enum StockIconId
        {
            Folder = 3
        }

        [Flags]
        private enum StockIconOptions : uint
        {
            Icon = 0x000000100,
            SmallIcon = 0x000000001
        }

        #endregion
    }
}
