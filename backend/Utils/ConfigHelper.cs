using Microsoft.Extensions.Configuration;
using System;
using System.IO;

namespace DesktopManager.Utils
{
    public class ConfigHelper
    {
        private static IConfiguration? _configuration;

        public static void Initialize(string basePath)
        {
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);

            _configuration = builder.Build();
        }

        private static string GetBaseAppDataPath()
        {
            var appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appDataPath, "DesktopManager");
        }

        public static string GetPastedFilesPath()
        {
            return _configuration?["AppSettings:PastedFilesPath"] ?? Path.Combine(GetBaseAppDataPath(), "pasted_files");
        }

        public static string GetDatabasePath()
        {
            return _configuration?["AppSettings:DatabasePath"] ?? Path.Combine(GetBaseAppDataPath(), "data", "desktop_manager.db");
        }

        public static string GetIconsPath()
        {
            return _configuration?["AppSettings:IconsPath"] ?? Path.Combine(GetBaseAppDataPath(), "data", "icons");
        }

        public static string GetThumbnailsPath()
        {
            return _configuration?["AppSettings:ThumbnailsPath"] ?? Path.Combine(GetBaseAppDataPath(), "data", "thumbnails");
        }

        public static int GetServerPort()
        {
            return int.TryParse(_configuration?["AppSettings:ServerPort"], out int port) ? port : 6789;
        }

        public static int GetIconCacheSizeMB()
        {
            return int.TryParse(_configuration?["AppSettings:IconCacheSizeMB"], out int size) ? size : 100;
        }

        public static int GetThumbnailMaxSizeMB()
        {
            return int.TryParse(_configuration?["AppSettings:ThumbnailMaxSizeMB"], out int size) ? size : 10;
        }
    }
}
