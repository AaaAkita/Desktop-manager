using Microsoft.Extensions.Caching.Memory;
using System;
using System.Drawing;
using System.IO;
using DesktopManager.Utils;

namespace DesktopManager.Services
{
    public class IconCacheService
    {
        private readonly IMemoryCache _cache;
        private readonly IconGenerator _iconGenerator;
        private readonly long _maxCacheSize;
        private long _currentCacheSize;
        private readonly object _sizeLock = new object();

        public IconCacheService(IconGenerator iconGenerator, int maxCacheSizeMB = 100)
        {
            _iconGenerator = iconGenerator;
            _maxCacheSize = maxCacheSizeMB * 1024 * 1024; // 转换为字节
            _currentCacheSize = 0;

            var cacheOptions = new MemoryCacheOptions
            {
                SizeLimit = _maxCacheSize,
                CompactionPercentage = 0.25 // 当达到限制时，清理25%的缓存
            };

            _cache = new MemoryCache(cacheOptions);
        }

        // 获取图标（带缓存）
        public Icon? GetIconCached(string path, bool isDirectory)
        {
            string cacheKey = $"icon_{path}_{isDirectory}";

            if (_cache.TryGetValue(cacheKey, out Icon? cachedIcon))
            {
                LoggerService.Debug("✅ 图标缓存命中: {FileName}", Path.GetFileName(path));
                return cachedIcon;
            }

            // 缓存未命中，生成新图标
            var icon = _iconGenerator.GetIcon(path, isDirectory);

            if (icon != null)
            {
                // 估算图标大小（约4KB per icon）
                long estimatedSize = 4096;

                var cacheEntryOptions = new MemoryCacheEntryOptions()
                    .SetSize(estimatedSize)
                    .SetPriority(CacheItemPriority.Normal)
                    .SetSlidingExpiration(TimeSpan.FromMinutes(30)) // 30分钟未使用则过期
                    .RegisterPostEvictionCallback((key, value, reason, state) =>
                    {
                        lock (_sizeLock)
                        {
                            _currentCacheSize -= estimatedSize;
                        }
                        LoggerService.Debug("🗑️ 图标缓存移除: {Key} (原因: {Reason})", key, reason);
                    });

                _cache.Set(cacheKey, icon, cacheEntryOptions);

                lock (_sizeLock)
                {
                    _currentCacheSize += estimatedSize;
                }

                LoggerService.Debug("📦 图标已缓存: {FileName} (当前缓存: {CacheSizeKB}KB)", Path.GetFileName(path), _currentCacheSize / 1024);
            }

            return icon;
        }

        // 获取缩略图（带缓存）
        public string? GetThumbnailCached(string path, string name, bool isImage)
        {
            string cacheKey = $"thumbnail_{path}";

            if (_cache.TryGetValue(cacheKey, out string? cachedPath))
            {
                if (File.Exists(cachedPath))
                {
                    LoggerService.Debug("✅ 缩略图缓存命中: {Name}", name);
                    return cachedPath;
                }
            }

            // 缓存未命中，生成新缩略图
            string? thumbnailPath = isImage
                ? _iconGenerator.GenerateImageThumbnail(path, name)
                : _iconGenerator.GenerateVideoThumbnail(path, name);

            if (!string.IsNullOrEmpty(thumbnailPath))
            {
                // 估算缩略图大小（约20KB per thumbnail）
                long estimatedSize = 20480;

                var cacheEntryOptions = new MemoryCacheEntryOptions()
                    .SetSize(estimatedSize)
                    .SetPriority(CacheItemPriority.Low) // 缩略图优先级较低
                    .SetSlidingExpiration(TimeSpan.FromMinutes(60)) // 1小时未使用则过期
                    .RegisterPostEvictionCallback((key, value, reason, state) =>
                    {
                        lock (_sizeLock)
                        {
                            _currentCacheSize -= estimatedSize;
                        }
                    });

                _cache.Set(cacheKey, thumbnailPath, cacheEntryOptions);

                lock (_sizeLock)
                {
                    _currentCacheSize += estimatedSize;
                }

                LoggerService.Debug("📦 缩略图已缓存: {Name} (当前缓存: {CacheSizeKB}KB)", name, _currentCacheSize / 1024);
            }

            return thumbnailPath;
        }

        // 获取Base64图标（带缓存）
        public string GetIconBase64Cached(Icon icon, string path)
        {
            string cacheKey = $"icon_base64_{path}";

            if (_cache.TryGetValue(cacheKey, out string? cachedBase64))
            {
                return cachedBase64;
            }

            string base64 = _iconGenerator.IconToBase64(icon);

            if (!string.IsNullOrEmpty(base64))
            {
                long estimatedSize = base64.Length;

                var cacheEntryOptions = new MemoryCacheEntryOptions()
                    .SetSize(estimatedSize)
                    .SetPriority(CacheItemPriority.High) // Base64使用频率高
                    .SetSlidingExpiration(TimeSpan.FromHours(2));

                _cache.Set(cacheKey, base64, cacheEntryOptions);

                lock (_sizeLock)
                {
                    _currentCacheSize += estimatedSize;
                }
            }

            return base64;
        }

        // 清空缓存
        public void ClearCache()
        {
            if (_cache is MemoryCache memoryCache)
            {
                memoryCache.Compact(1.0); // 清空100%的缓存
            }

            lock (_sizeLock)
            {
                _currentCacheSize = 0;
            }

            LoggerService.Info("🧹 图标缓存已清空");
        }

        // 获取缓存统计信息
        public (long CurrentSize, long MaxSize, double UsagePercentage) GetCacheStats()
        {
            lock (_sizeLock)
            {
                double percentage = (_currentCacheSize / (double)_maxCacheSize) * 100;
                return (_currentCacheSize, _maxCacheSize, percentage);
            }
        }
    }
}
