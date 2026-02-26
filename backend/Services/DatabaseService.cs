using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Data.Sqlite;

namespace DesktopManager.Services
{
    /// <summary>
    /// 数据库服务类，管理 SQLite 数据库操作
    /// </summary>
    public class DatabaseService
    {
        private readonly string _dbPath;
        private readonly string _connectionString;

        public DatabaseService(string dataDirectory)
        {
            _dbPath = Path.Combine(dataDirectory, "desktop_manager.db");
            _connectionString = $"Data Source={_dbPath};";
            InitializeDatabase();
        }

        /// <summary>
        /// 获取数据库连接
        /// </summary>
        public IDbConnection CreateConnection()
        {
            return new SqliteConnection(_connectionString);
        }

        /// <summary>
        /// 初始化数据库，创建表结构
        /// </summary>
        private void InitializeDatabase()
        {
            using var connection = CreateConnection();
            connection.Open();

            // 创建桌面项目表
            connection.Execute(@"
                CREATE TABLE IF NOT EXISTS DesktopItems (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Name TEXT NOT NULL,
                    Path TEXT NOT NULL UNIQUE,
                    IsDirectory INTEGER NOT NULL DEFAULT 0,
                    Extension TEXT,
                    IconPath TEXT,
                    ThumbnailPath TEXT,
                    IconBase64 TEXT,
                    Source TEXT NOT NULL DEFAULT 'UserDesktop', -- 'SystemDesktop', 'UserDesktop', 'PastedFiles'
                    IsInDock INTEGER NOT NULL DEFAULT 0,
                    SortOrder INTEGER DEFAULT 0,
                    IsPinned INTEGER NOT NULL DEFAULT 0,
                    LastModified TEXT NOT NULL,
                    CreatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");

            // 检查并添加缺失的列 (Migration)
            var hasSortOrder = connection.ExecuteScalar<int>("SELECT COUNT(*) FROM pragma_table_info('DesktopItems') WHERE name='SortOrder'") > 0;
            if (!hasSortOrder)
            {
                connection.Execute("ALTER TABLE DesktopItems ADD COLUMN SortOrder INTEGER DEFAULT 0");
            }

            var hasIsPinned = connection.ExecuteScalar<int>("SELECT COUNT(*) FROM pragma_table_info('DesktopItems') WHERE name='IsPinned'") > 0;
            if (!hasIsPinned)
            {
                connection.Execute("ALTER TABLE DesktopItems ADD COLUMN IsPinned INTEGER NOT NULL DEFAULT 0");
            }

            // 创建 Dock 栏项目表（关联 DesktopItems）
            connection.Execute(@"
                CREATE TABLE IF NOT EXISTS DockItems (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    DesktopItemId INTEGER NOT NULL,
                    SortOrder INTEGER NOT NULL DEFAULT 0,
                    CreatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (DesktopItemId) REFERENCES DesktopItems(Id) ON DELETE CASCADE
                )
            ");

            // 创建设置表
            connection.Execute(@"
                CREATE TABLE IF NOT EXISTS Settings (
                    Key TEXT PRIMARY KEY,
                    Value TEXT NOT NULL,
                    UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            ");

            // 创建索引
            connection.Execute("CREATE INDEX IF NOT EXISTS idx_desktop_items_path ON DesktopItems(Path)");
            connection.Execute("CREATE INDEX IF NOT EXISTS idx_desktop_items_source ON DesktopItems(Source)");
            connection.Execute("CREATE INDEX IF NOT EXISTS idx_desktop_items_dock ON DesktopItems(IsInDock)");
            connection.Execute("CREATE INDEX IF NOT EXISTS idx_desktop_items_sort ON DesktopItems(Source, IsPinned DESC, SortOrder ASC)");
            connection.Execute("CREATE INDEX IF NOT EXISTS idx_dock_items_order ON DockItems(SortOrder)");

            // 自动清理 DockItems 表中的重复项 (修复之前的逻辑错误导致的多重条目)
            connection.Execute(@"
                DELETE FROM DockItems 
                WHERE Id NOT IN (
                    SELECT MIN(Id) 
                    FROM DockItems 
                    GROUP BY DesktopItemId
                )
            ");

            Console.WriteLine($"✅ 数据库初始化完成: {_dbPath}");
        }

        /// <summary>
        /// 插入或更新桌面项目
        /// </summary>
        public async Task<int> UpsertDesktopItemAsync(DesktopItemEntity item)
        {
            using var connection = CreateConnection();
            
            var sql = @"
                INSERT INTO DesktopItems (Name, Path, IsDirectory, Extension, IconPath, ThumbnailPath, IconBase64, Source, IsInDock, LastModified, UpdatedAt)
                VALUES (@Name, @Path, @IsDirectory, @Extension, @IconPath, @ThumbnailPath, @IconBase64, @Source, @IsInDock, @LastModified, CURRENT_TIMESTAMP)
                ON CONFLICT(Path) DO UPDATE SET
                    Name = excluded.Name,
                    IsDirectory = excluded.IsDirectory,
                    Extension = excluded.Extension,
                    IconPath = excluded.IconPath,
                    ThumbnailPath = excluded.ThumbnailPath,
                    IconBase64 = excluded.IconBase64,
                    Source = excluded.Source,
                    LastModified = excluded.LastModified,
                    UpdatedAt = CURRENT_TIMESTAMP
                RETURNING Id
            ";

            return await connection.ExecuteScalarAsync<int>(sql, item);
        }

        /// <summary>
        /// 批量插入或更新桌面项目
        /// </summary>
        public async Task UpsertDesktopItemsAsync(IEnumerable<DesktopItemEntity> items)
        {
            using var connection = CreateConnection();
            connection.Open();

            using var transaction = connection.BeginTransaction();
            try
            {
                var sql = @"
                    INSERT INTO DesktopItems (Name, Path, IsDirectory, Extension, IconPath, ThumbnailPath, IconBase64, Source, IsInDock, LastModified, UpdatedAt)
                    VALUES (@Name, @Path, @IsDirectory, @Extension, @IconPath, @ThumbnailPath, @IconBase64, @Source, COALESCE((SELECT IsInDock FROM DesktopItems WHERE Path=@Path), @IsInDock), @LastModified, CURRENT_TIMESTAMP)
                    ON CONFLICT(Path) DO UPDATE SET
                        Name = excluded.Name,
                        IsDirectory = excluded.IsDirectory,
                        Extension = excluded.Extension,
                        IconPath = excluded.IconPath,
                        ThumbnailPath = excluded.ThumbnailPath,
                        IconBase64 = excluded.IconBase64,
                        Source = excluded.Source,
                        LastModified = excluded.LastModified,
                        UpdatedAt = CURRENT_TIMESTAMP
                ";

                await connection.ExecuteAsync(sql, items, transaction);
                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }
        }

        /// <summary>
        /// 根据路径删除桌面项目
        /// </summary>
        public async Task DeleteDesktopItemAsync(string path)
        {
            using var connection = CreateConnection();
            await connection.ExecuteAsync(
                "DELETE FROM DesktopItems WHERE Path = @Path",
                new { Path = path }
            );
        }

        /// <summary>
        /// 根据路径删除桌面项目（支持事务）
        /// </summary>
        public async Task DeleteDesktopItemAsync(string path, IDbTransaction transaction)
        {
            await transaction.Connection.ExecuteAsync(
                "DELETE FROM DesktopItems WHERE Path = @Path",
                new { Path = path },
                transaction
            );
        }

        /// <summary>
        /// 删除指定来源的所有项目（用于重新扫描前清理）
        /// </summary>
        public async Task DeleteBySourceAsync(string source)
        {
            using var connection = CreateConnection();
            await connection.ExecuteAsync(
                "DELETE FROM DesktopItems WHERE Source = @Source",
                new { Source = source }
            );
        }

        /// <summary>
        /// 获取所有桌面项目
        /// </summary>
        public async Task<IEnumerable<DesktopItemEntity>> GetAllDesktopItemsAsync()
        {
            using var connection = CreateConnection();
            return await connection.QueryAsync<DesktopItemEntity>(
                "SELECT * FROM DesktopItems ORDER BY Source, Name"
            );
        }

        /// <summary>
        /// 根据来源获取桌面项目
        /// </summary>
        public async Task<IEnumerable<DesktopItemEntity>> GetDesktopItemsBySourceAsync(string source)
        {
            using var connection = CreateConnection();
            return await connection.QueryAsync<DesktopItemEntity>(
                "SELECT * FROM DesktopItems WHERE Source = @Source ORDER BY Name",
                new { Source = source }
            );
        }

        /// <summary>
        /// 获取 Dock 栏项目
        /// </summary>
        public async Task<IEnumerable<DesktopItemEntity>> GetDockItemsAsync()
        {
            using var connection = CreateConnection();
            return await connection.QueryAsync<DesktopItemEntity>(@"
                SELECT di.* FROM DesktopItems di
                INNER JOIN DockItems dk ON di.Id = dk.DesktopItemId
                ORDER BY dk.SortOrder
            ");
        }

        /// <summary>
        /// 添加项目到 Dock 栏
        /// </summary>
        public async Task AddToDockAsync(int desktopItemId, int sortOrder = 0)
        {
            using var connection = CreateConnection();
            
            // 更新 DesktopItems 表的 IsInDock 标志
            await connection.ExecuteAsync(
                "UPDATE DesktopItems SET IsInDock = 1 WHERE Id = @Id",
                new { Id = desktopItemId }
            );

            // 防止重复：先删除已存在的记录
            await connection.ExecuteAsync(
                "DELETE FROM DockItems WHERE DesktopItemId = @DesktopItemId", 
                new { DesktopItemId = desktopItemId }
            );

            // 插入到 DockItems 表
            await connection.ExecuteAsync(@"
                INSERT INTO DockItems (DesktopItemId, SortOrder)
                VALUES (@DesktopItemId, @SortOrder)
            ", new { DesktopItemId = desktopItemId, SortOrder = sortOrder });
        }

        /// <summary>
        /// 从 Dock 栏移除项目
        /// </summary>
        public async Task RemoveFromDockAsync(int desktopItemId)
        {
            using var connection = CreateConnection();
            
            await connection.ExecuteAsync(
                "DELETE FROM DockItems WHERE DesktopItemId = @DesktopItemId",
                new { DesktopItemId = desktopItemId }
            );

            await connection.ExecuteAsync(
                "UPDATE DesktopItems SET IsInDock = 0 WHERE Id = @Id",
                new { Id = desktopItemId }
            );
        }

        /// <summary>
        /// 保存设置
        /// </summary>
        public async Task SetSettingAsync(string key, string value)
        {
            using var connection = CreateConnection();
            await connection.ExecuteAsync(@"
                INSERT INTO Settings (Key, Value, UpdatedAt)
                VALUES (@Key, @Value, CURRENT_TIMESTAMP)
                ON CONFLICT(Key) DO UPDATE SET
                    Value = excluded.Value,
                    UpdatedAt = CURRENT_TIMESTAMP
            ", new { Key = key, Value = value });
        }

        /// <summary>
        /// 获取设置
        /// </summary>
        public async Task<string?> GetSettingAsync(string key)
        {
            using var connection = CreateConnection();
            return await connection.ExecuteScalarAsync<string>(
                "SELECT Value FROM Settings WHERE Key = @Key",
                new { Key = key }
            );
        }

        /// <summary>
        /// 获取数据库统计信息
        /// </summary>
        public async Task<DatabaseStats> GetStatsAsync()
        {
            using var connection = CreateConnection();
            
            var stats = new DatabaseStats();
            stats.TotalItems = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM DesktopItems"
            );
            stats.SystemDesktopCount = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM DesktopItems WHERE Source = 'SystemDesktop'"
            );
            stats.UserDesktopCount = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM DesktopItems WHERE Source = 'UserDesktop'"
            );
            stats.PastedFilesCount = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM DesktopItems WHERE Source = 'PastedFiles'"
            );
            stats.DockItemsCount = await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM DockItems"
            );
            
            return stats;
        }

        /// <summary>
        /// 清理不存在的文件记录
        /// </summary>
        public async Task<int> CleanupNonExistentFilesAsync()
        {
            using var connection = CreateConnection();
            var items = await connection.QueryAsync<DesktopItemEntity>(
                "SELECT * FROM DesktopItems"
            );

            int deletedCount = 0;
            foreach (var item in items)
            {
                if (!File.Exists(item.Path) && !Directory.Exists(item.Path))
                {
                    await DeleteDesktopItemAsync(item.Path);
                    deletedCount++;
                }
            }

            return deletedCount;
        }

        /// <summary>
        /// 更新项目排序顺序
        /// </summary>
        public async Task UpdateSortOrderAsync(int itemId, int newSortOrder)
        {
            using var connection = CreateConnection();
            await connection.ExecuteAsync(
                "UPDATE DesktopItems SET SortOrder = @SortOrder, UpdatedAt = CURRENT_TIMESTAMP WHERE Id = @Id",
                new { Id = itemId, SortOrder = newSortOrder }
            );
        }

        /// <summary>
        /// 批量更新排序顺序（用于拖拽重排）
        /// </summary>
        public async Task BatchUpdateSortOrderAsync(Dictionary<int, int> itemSortOrders)
        {
            using var connection = CreateConnection();
            connection.Open();

            using var transaction = connection.BeginTransaction();
            try
            {
                foreach (var kvp in itemSortOrders)
                {
                    await connection.ExecuteAsync(
                        "UPDATE DesktopItems SET SortOrder = @SortOrder, UpdatedAt = CURRENT_TIMESTAMP WHERE Id = @Id",
                        new { Id = kvp.Key, SortOrder = kvp.Value },
                        transaction
                    );
                }
                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }
        }

        /// <summary>
        /// 切换置顶状态
        /// </summary>
        public async Task TogglePinAsync(int itemId, bool isPinned)
        {
            using var connection = CreateConnection();
            await connection.ExecuteAsync(
                "UPDATE DesktopItems SET IsPinned = @IsPinned, UpdatedAt = CURRENT_TIMESTAMP WHERE Id = @Id",
                new { Id = itemId, IsPinned = isPinned ? 1 : 0 }
            );
        }

        /// <summary>
        /// 获取按排序顺序排列的项目（置顶项在前，然后按 SortOrder 排序）
        /// </summary>
        public async Task<IEnumerable<DesktopItemEntity>> GetItemsSortedAsync(string source)
        {
            using var connection = CreateConnection();
            return await connection.QueryAsync<DesktopItemEntity>(@"
                SELECT * FROM DesktopItems 
                WHERE Source = @Source 
                ORDER BY IsPinned DESC, SortOrder ASC, Name ASC
            ", new { Source = source });
        }
    }

    /// <summary>
    /// 桌面项目实体类
    /// </summary>
    public class DesktopItemEntity
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public int IsDirectory { get; set; }
        public string? Extension { get; set; }
        public string? IconPath { get; set; }
        public string? ThumbnailPath { get; set; }
        public string? IconBase64 { get; set; }
        public string Source { get; set; } = "UserDesktop";
        public int IsInDock { get; set; }
        public int IsPinned { get; set; }  // 置顶状态
        public int SortOrder { get; set; } // 排序顺序
        public string LastModified { get; set; } = DateTime.Now.ToString("O");
        public string CreatedAt { get; set; } = DateTime.Now.ToString("O");
        public string UpdatedAt { get; set; } = DateTime.Now.ToString("O");

        /// <summary>
        /// 转换为前端使用的 JSON 格式
        /// </summary>
        public object ToJsonObject()
        {
            return new
            {
                Id = Id,
                Name = Name,
                Path = Path,
                IsDirectory = IsDirectory == 1,
                Extension = Extension ?? string.Empty,
                IconPath = IconPath ?? string.Empty,
                ThumbnailPath = ThumbnailPath ?? string.Empty,
                IconBase64 = IconBase64 ?? string.Empty,
                Source = Source,
                Dock = IsInDock == 1,
                IsPinned = IsPinned == 1,  // 添加置顶状态
                SortOrder = SortOrder,       // 添加排序顺序
                LastModified = LastModified
            };
        }
    }

    /// <summary>
    /// 数据库统计信息
    /// </summary>
    public class DatabaseStats
    {
        public int TotalItems { get; set; }
        public int SystemDesktopCount { get; set; }
        public int UserDesktopCount { get; set; }
        public int PastedFilesCount { get; set; }
        public int DockItemsCount { get; set; }
    }
}
