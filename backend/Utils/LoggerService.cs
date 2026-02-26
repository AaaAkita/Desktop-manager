using Serilog;
using Serilog.Events;
using System;
using System.IO;

namespace DesktopManager.Utils
{
    public static class LoggerService
    {
        private static ILogger? _logger;

        // 初始化日志系统
        public static void Initialize(string logDirectory = "logs")
        {
            // 确保日志目录存在
            if (!Directory.Exists(logDirectory))
            {
                Directory.CreateDirectory(logDirectory);
            }

            // 配置 Serilog
            _logger = new LoggerConfiguration()
                .MinimumLevel.Debug()  // 最低日志级别
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)  // 过滤框架日志
                .Enrich.FromLogContext()
                .Enrich.WithProperty("Application", "DesktopManager")
                .WriteTo.Console(
                    outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}"
                )
                .WriteTo.File(
                    path: Path.Combine(logDirectory, "backend-.log"),
                    rollingInterval: RollingInterval.Day,  // 按天滚动
                    rollOnFileSizeLimit: true,
                    fileSizeLimitBytes: 10 * 1024 * 1024,  // 10MB
                    retainedFileCountLimit: 7,  // 保留7天
                    outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff} {Level:u3}] {Message:lj}{NewLine}{Exception}"
                )
                .CreateLogger();

            Log.Logger = _logger;
            Log.Information("🚀 日志系统初始化完成");
        }

        // Debug 级别
        public static void Debug(string message, params object[] args)
        {
            _logger?.Debug(message, args);
        }

        // Information 级别
        public static void Info(string message, params object[] args)
        {
            _logger?.Information(message, args);
        }

        // Warning 级别
        public static void Warning(string message, params object[] args)
        {
            _logger?.Warning(message, args);
        }

        // Error 级别
        public static void Error(string message, params object[] args)
        {
            _logger?.Error(message, args);
        }

        // Error with Exception
        public static void Error(Exception ex, string message, params object[] args)
        {
            _logger?.Error(ex, message, args);
        }

        // Fatal 级别
        public static void Fatal(string message, params object[] args)
        {
            _logger?.Fatal(message, args);
        }

        // Fatal with Exception
        public static void Fatal(Exception ex, string message, params object[] args)
        {
            _logger?.Fatal(ex, message, args);
        }

        // 关闭日志系统
        public static void Close()
        {
            Log.CloseAndFlush();
        }
    }
}
