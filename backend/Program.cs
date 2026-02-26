﻿using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Text.Json;
using System.Drawing.Drawing2D;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using DesktopManager.Services;
using DesktopManager.Utils;

namespace DesktopInfoCollector
{
    class Program
    {
        static string iconsDirectory = string.Empty;
        static string thumbnailsDirectory = string.Empty;
        static string dataDirectory = string.Empty;
        static string pastedFilesPath = @"e:\software\DesktopManager\pasted_files";
        static DatabaseService? dbService;
        
        static FileSystemWatcher? systemDesktopWatcher;
        static FileSystemWatcher? userDesktopWatcher;
        static FileSystemWatcher? pastedFilesWatcher;
        static System.Timers.Timer? debounceTimer;
        
        static async Task Main(string[] args)
        {
            // 注册全局异常处理器
            SetupGlobalExceptionHandlers();
            
            try
            {
                Console.WriteLine("🚀 启动桌面管理器后端服务...");
                
                // 初始化目录结构 - 使用 %APPDATA%/DesktopManager
                var appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                var appDirectory = Path.Combine(appDataPath, "DesktopManager");
                
                dataDirectory = Path.Combine(appDirectory, "data");
                pastedFilesPath = Path.Combine(appDirectory, "pasted_files");
                
                iconsDirectory = Path.Combine(dataDirectory, "icons");
                thumbnailsDirectory = Path.Combine(dataDirectory, "thumbnails");
                var logsDirectory = Path.Combine(appDirectory, "logs");

                // 初始化日志服务 (最优先)
                LoggerService.Initialize(logsDirectory);
                LoggerService.Info("🚀 启动桌面管理器后端服务...");
                LoggerService.Info($"📂 数据目录: {dataDirectory}");
                LoggerService.Info($"📂 粘贴目录: {pastedFilesPath}");
                
                Console.WriteLine($"📂 数据目录: {dataDirectory}");
                
                // 创建必要的目录结构
                if (!Directory.Exists(appDirectory)) Directory.CreateDirectory(appDirectory);
                if (!Directory.Exists(dataDirectory)) Directory.CreateDirectory(dataDirectory);
                if (!Directory.Exists(pastedFilesPath)) Directory.CreateDirectory(pastedFilesPath);
                
                Directory.CreateDirectory(iconsDirectory);
                Directory.CreateDirectory(thumbnailsDirectory);
                
                // 初始化数据库
                Console.WriteLine("📦 初始化数据库...");
                dbService = new DatabaseService(dataDirectory);
                
                // 首次运行时收集桌面信息
                await RescanAllAsync();

                // 初始化文件监听器
                InitializeFileWatchers();
                
                // 启动TCP服务器
                StartTcpServer();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 错误: {ex.Message}");
                Console.WriteLine($"📋 堆栈跟踪: {ex.StackTrace}");
            }
        }

        // 初始化文件监听器
        static void InitializeFileWatchers()
        {
            try
            {
                // 初始化去抖动计时器 (500ms)
                debounceTimer = new System.Timers.Timer(500);
                debounceTimer.AutoReset = false;
                debounceTimer.Elapsed += async (sender, e) => 
                {
                    Console.WriteLine("⏱️ 检测到文件变更，触发自动刷新...");
                    await RescanAllAsync();
                    
                    // TODO: 通知前端刷新 (目前前端通过轮询或手动刷新，后续可增加WebSocket推送)
                    // 由于当前是TCP请求-响应模式，后端无法主动推送到前端。
                    // 但这里RescanAllAsync会更新数据库，前端下次请求时会获取最新数据。
                    // 若要实现实时推送，需要维护客户端连接列表并广播。
                };

                // 监听系统桌面
                string systemDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
                if (Directory.Exists(systemDesktopPath))
                {
                    systemDesktopWatcher = new FileSystemWatcher(systemDesktopPath);
                    ConfigureWatcher(systemDesktopWatcher, "系统桌面");
                }

                // 监听用户桌面
                string userDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (Directory.Exists(userDesktopPath))
                {
                    userDesktopWatcher = new FileSystemWatcher(userDesktopPath);
                    ConfigureWatcher(userDesktopWatcher, "用户桌面");
                }

                // 监听粘贴文件夹
                if (Directory.Exists(pastedFilesPath))
                {
                    pastedFilesWatcher = new FileSystemWatcher(pastedFilesPath);
                    ConfigureWatcher(pastedFilesWatcher, "粘贴文件夹");
                }
                
                Console.WriteLine("👀 文件监控已启动");
                LoggerService.Info("👀 文件监控已启动");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 初始化文件监控失败: {ex.Message}");
                LoggerService.Error(ex, "初始化文件监控失败");
            }
        }

        static void ConfigureWatcher(FileSystemWatcher watcher, string name)
        {
            watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite;
            watcher.IncludeSubdirectories = true; // 粘贴文件夹需要递归监听，桌面通常只有一层但也可以递归
            
            watcher.Changed += (s, e) => OnFileChanged(e, name);
            watcher.Created += (s, e) => OnFileChanged(e, name);
            watcher.Deleted += (s, e) => OnFileChanged(e, name);
            watcher.Renamed += (s, e) => OnFileChanged(e, name);
            
            watcher.EnableRaisingEvents = true;
            Console.WriteLine($"   - 正在监听: {name} ({watcher.Path})");
            LoggerService.Info($"   - 正在监听: {name} ({watcher.Path})");
        }

        static void OnFileChanged(FileSystemEventArgs e, string watcherName)
        {
            // 忽略临时文件和数据库文件
            if (e.Name != null && (e.Name.StartsWith("~") || e.Name.EndsWith(".tmp") || e.Name.EndsWith(".db") || e.Name.EndsWith(".db-journal") || e.Name.EndsWith(".log")))
                return;
                
            Console.WriteLine($"📝 文件变更 [{watcherName}]: {e.ChangeType} - {e.Name}");
            LoggerService.Info($"📝 文件变更 [{watcherName}]: {e.ChangeType} - {e.Name}");
            
            // 重置去抖动计时器
            debounceTimer?.Stop();
            debounceTimer?.Start();
        }
        
        // 设置全局异常处理器
        static void SetupGlobalExceptionHandlers()
        {
            // 捕获未处理的同步异常
            AppDomain.CurrentDomain.UnhandledException += (sender, args) =>
            {
                var ex = args.ExceptionObject as Exception;
                if (ex != null)
                {
                    Console.WriteLine($"❌ 捕获到未处理的异常: {ex.Message}");
                    Console.WriteLine($"📋 堆栈跟踪: {ex.StackTrace}");
                    
                    // 记录到日志（如果已初始化）
                    try
                    {
                        LoggerService.Error(ex, "未处理的全局异常");
                    }
                    catch
                    {
                        // 日志服务可能未初始化，忽略错误
                    }
                }
                
                if (args.IsTerminating)
                {
                    Console.WriteLine("⚠️ 应用程序即将终止");
                }
            };
            
            // 捕获未观察到的Task异常
            TaskScheduler.UnobservedTaskException += (sender, args) =>
            {
                Console.WriteLine($"❌ 捕获到未观察的Task异常: {args.Exception.Message}");
                
                // 记录到日志
                try
                {
                    LoggerService.Error(args.Exception, "未观察的Task异常");
                }
                catch
                {
                    // 日志服务可能未初始化，忽略错误
                }
                
                // 标记异常已处理，防止应用崩溃
                args.SetObserved();
            };
            
            Console.WriteLine("✅ 全局异常处理器已设置");
        }
        
        // 启动TCP服务器
        static void StartTcpServer()
        {
            try
            {
                // 创建TCP监听器，监听6789端口
                TcpListener server = new TcpListener(IPAddress.Any, 6789);
                server.Start();
                LoggerService.Info("✅ 后端服务已启动，监听端口: 6789");
                Console.WriteLine("✅ 后端服务已启动，监听端口: 6789");
                Console.WriteLine("等待前端连接...");
                
                while (true)
                {
                    // 接受客户端连接
                    TcpClient client = server.AcceptTcpClient();
                    LoggerService.Info($"✅ 前端已连接: {client.Client.RemoteEndPoint}");
                    Console.WriteLine("✅ 前端已连接");
                    
                    // 处理客户端请求
                    HandleClient(client);
                }
            }
            catch (Exception ex)
            {
                LoggerService.Error(ex, "启动TCP服务器时出错");
                Console.WriteLine($"启动TCP服务器时出错: {ex.Message}");
            }
        }
        
        // 处理客户端请求
        static void HandleClient(TcpClient client)
        {
            ThreadPool.QueueUserWorkItem(async (state) =>
            {
                try
                {
                    using (client)
                    using (NetworkStream stream = client.GetStream())
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        string? message;
                        while ((message = await reader.ReadLineAsync()) != null)
                        {
                            if (string.IsNullOrEmpty(message)) continue;
                            
                            // 日志记录收到的请求
                            LoggerService.Info($"📥 收到请求: {message.Length} chars");
                            
                            // 处理请求
                            string response = await ProcessRequest(message);
                            
                            // 发送响应
                            byte[] responseBytes = Encoding.UTF8.GetBytes(response + "\n");
                            await stream.WriteAsync(responseBytes, 0, responseBytes.Length);
                            
                            LoggerService.Info("📤 发送响应");
                        }
                    }
                }
                catch (Exception ex)
                {
                    LoggerService.Error(ex, "处理客户端请求时出错");
                    Console.WriteLine($"处理客户端请求时出错: {ex.Message}");
                }
                finally
                {
                    LoggerService.Info("🔌 前端连接已关闭");
                    Console.WriteLine("🔌 前端连接已关闭");
                }
            });
        }
        
        // 处理前端请求（使用数据库）
        static async Task<string> ProcessRequest(string message)
        {
            if (dbService == null)
            {
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = "数据库服务未初始化"
                });
            }

            try
            {
                // 解析请求
                using var document = System.Text.Json.JsonDocument.Parse(message);
                var root = document.RootElement;
                
                // 提取requestId
                string requestId = "";
                if (root.TryGetProperty("requestId", out var requestIdElement))
                {
                    requestId = requestIdElement.GetString() ?? "";
                }
                
                if (!root.TryGetProperty("action", out var actionElement))
                {
                    return System.Text.Json.JsonSerializer.Serialize(new {
                        requestId,
                        success = false,
                        error = "请求中缺少action字段"
                    });
                }
                
                string action = actionElement.GetString() ?? "";
                
                switch (action)
                {
                    case "rescan":
                        // 重新扫描桌面信息
                        RescanAll();
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = true,
                            message = "重新扫描完成"
                        });
                        
                    case "getDesktopInfo":
                        {
                            // 从数据库获取桌面信息
                            var desktopInfo = GetDesktopInfoFromDatabase();
                            // 解析并添加requestId
                            using var desktopDoc = System.Text.Json.JsonDocument.Parse(desktopInfo);
                            var desktopRoot = desktopDoc.RootElement;
                            var desktopResponse = new {
                                requestId,
                                success = desktopRoot.GetProperty("success").GetBoolean(),
                                data = desktopRoot
                            };
                            return System.Text.Json.JsonSerializer.Serialize(desktopResponse);
                        }
                        
                    case "deleteItem":
                        // 删除文件/文件夹
                        if (root.TryGetProperty("path", out var pathElement))
                        {
                            string path = pathElement.GetString() ?? "";
                            var deleteResult = DeleteItemFromDatabase(path);
                            // 解析并添加requestId
                            using var deleteDoc = System.Text.Json.JsonDocument.Parse(deleteResult);
                            var deleteRoot = deleteDoc.RootElement;
                            string deleteMessage = "";
                            if (deleteRoot.TryGetProperty("message", out var messageElement))
                            {
                                deleteMessage = messageElement.GetString() ?? "";
                            }
                            var deleteResponse = new {
                                requestId,
                                success = deleteRoot.GetProperty("success").GetBoolean(),
                                message = deleteMessage
                            };
                            return System.Text.Json.JsonSerializer.Serialize(deleteResponse);
                        }
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = false,
                            error = "缺少path参数"
                        });
                        
                    case "addToDock":
                        // 添加到Dock栏
                        if (root.TryGetProperty("path", out var dockPathElement))
                        {
                            string path = dockPathElement.GetString() ?? "";
                            var addResult = AddToDockInDatabase(path);
                            // 解析并添加requestId
                            using var addDoc = System.Text.Json.JsonDocument.Parse(addResult);
                            var addRoot = addDoc.RootElement;
                            string addMessage = "";
                            if (addRoot.TryGetProperty("message", out var messageElement))
                            {
                                addMessage = messageElement.GetString() ?? "";
                            }
                            var addResponse = new {
                                requestId,
                                success = addRoot.GetProperty("success").GetBoolean(),
                                message = addMessage
                            };
                            return System.Text.Json.JsonSerializer.Serialize(addResponse);
                        }
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = false,
                            error = "缺少path参数"
                        });
                        
                    case "removeFromDock":
                        // 从Dock栏移除
                        if (root.TryGetProperty("path", out var undockPathElement))
                        {
                            string path = undockPathElement.GetString() ?? "";
                            var removeResult = RemoveFromDockInDatabase(path);
                            // 解析并添加requestId
                            using var removeDoc = System.Text.Json.JsonDocument.Parse(removeResult);
                            var removeRoot = removeDoc.RootElement;
                            string removeMessage = "";
                            if (removeRoot.TryGetProperty("message", out var messageElement))
                            {
                                removeMessage = messageElement.GetString() ?? "";
                            }
                            var removeResponse = new {
                                requestId,
                                success = removeRoot.GetProperty("success").GetBoolean(),
                                message = removeMessage
                            };
                            return System.Text.Json.JsonSerializer.Serialize(removeResponse);
                        }
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = false,
                            error = "缺少path参数"
                        });
                        
                    case "getStats":
                        // 获取数据库统计信息
                        var stats = dbService.GetStatsAsync().Result;
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = true,
                            data = stats
                        });
                    
                    case "smartPaste":
                        // 智能粘贴处理
                        if (root.TryGetProperty("clipboardData", out var clipboardDataElement))
                        {
                            var pasteResult = HandleSmartPaste(clipboardDataElement);
                            using var pasteDoc = System.Text.Json.JsonDocument.Parse(pasteResult);
                            var pasteRoot = pasteDoc.RootElement;
                            var pasteResponse = new {
                                requestId,
                                success = pasteRoot.GetProperty("success").GetBoolean(),
                                data = pasteRoot
                            };
                            return System.Text.Json.JsonSerializer.Serialize(pasteResponse);
                        }
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = false,
                            error = "缺少clipboardData参数"
                        });
                        
                    case "update_sort_order":
                        {
                            // 更新项目排序顺序
                            if (!root.TryGetProperty("itemId", out var itemIdElement) ||
                                !root.TryGetProperty("sortOrder", out var sortOrderElement))
                            {
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = false,
                                    error = "缺少 itemId 或 sortOrder 参数"
                                });
                            }

                            int itemId = itemIdElement.GetInt32();
                            int sortOrder = sortOrderElement.GetInt32();
                            
                            await dbService.UpdateSortOrderAsync(itemId, sortOrder);
                            
                            return System.Text.Json.JsonSerializer.Serialize(new {
                                requestId,
                                success = true,
                                message = "排序顺序已更新"
                            });
                        }
                    
                    case "batch_update_sort":
                        {
                            // 批量更新排序
                            if (!root.TryGetProperty("items", out var itemsElement))
                            {
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = false,
                                    error = "缺少 items 参数"
                                });
                            }

                            var itemSortOrders = new Dictionary<int, int>();
                            foreach (var item in itemsElement.EnumerateArray())
                            {
                                if (item.TryGetProperty("id", out var id) &&
                                    item.TryGetProperty("sortOrder", out var sort))
                                {
                                    itemSortOrders[id.GetInt32()] = sort.GetInt32();
                                }
                            }
                            
                            await dbService.BatchUpdateSortOrderAsync(itemSortOrders);
                            
                            return System.Text.Json.JsonSerializer.Serialize(new {
                                requestId,
                                success = true,
                                message = $"已更新 {itemSortOrders.Count} 个项目的排序"
                            });
                        }
                    
                    case "toggle_pin":
                        {
                            // 切换置顶状态
                            if (!root.TryGetProperty("itemId", out var itemIdElement) ||
                                !root.TryGetProperty("isPinned", out var isPinnedElement))
                            {
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = false,
                                    error = "缺少 itemId 或 isPinned 参数"
                                });
                            }

                            int itemId = itemIdElement.GetInt32();
                            bool isPinned = isPinnedElement.GetBoolean();
                            
                            await dbService.TogglePinAsync(itemId, isPinned);
                            
                            return System.Text.Json.JsonSerializer.Serialize(new {
                                requestId,
                                success = true,
                                message = isPinned ? "已置顶" : "已取消置顶"
                            });
                        }
                    
                    case "saveDockItems":
                        {
                            // 批量保存Dock栏项目
                            if (!root.TryGetProperty("dockItems", out var dockItemsElement))
                            {
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = false,
                                    error = "缺少 dockItems 参数"
                                });
                            }

                            try
                            {
                                // 获取所有桌面项目
                                var allItems = await dbService.GetAllDesktopItemsAsync();
                                
                                // 构建路径到ID的映射
                                var pathToId = allItems.ToDictionary(i => i.Path, i => i.Id);
                                
                                // 收集要添加到dock的路径
                                var dockPaths = new HashSet<string>();
                                foreach (var dockItem in dockItemsElement.EnumerateArray())
                                {
                                    if (dockItem.TryGetProperty("path", out var saveDockItemElement))
                                    {
                                        var saveDockPath = saveDockItemElement.GetString();
                                        if (!string.IsNullOrEmpty(saveDockPath))
                                        {
                                            dockPaths.Add(saveDockPath);
                                        }
                                    }
                                }

                                // 更新所有项目的dock状态
                                foreach (var item in allItems)
                                {
                                    bool shouldBeInDock = dockPaths.Contains(item.Path);
                                    bool isCurrentlyInDock = item.IsInDock == 1;

                                    if (shouldBeInDock && !isCurrentlyInDock)
                                    {
                                        await dbService.AddToDockAsync(item.Id);
                                    }
                                    else if (!shouldBeInDock && isCurrentlyInDock)
                                    {
                                        await dbService.RemoveFromDockAsync(item.Id);
                                    }
                                }

                                Console.WriteLine($"✅ Dock栏已保存，共 {dockPaths.Count} 个项目");
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = true,
                                    message = $"已保存 {dockPaths.Count} 个Dock项目"
                                });
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"❌ 保存Dock栏失败: {ex.Message}");
                                return System.Text.Json.JsonSerializer.Serialize(new {
                                    requestId,
                                    success = false,
                                    error = ex.Message
                                });
                            }
                        }
                    
                    default:
                        return System.Text.Json.JsonSerializer.Serialize(new {
                            requestId,
                            success = false,
                            error = $"未知的请求类型: {action}"
                        });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 处理请求时出错: {ex.Message}");
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
        }

        // 从数据库获取桌面信息
        static string GetDesktopInfoFromDatabase()
        {
            try
            {
                // 获取各类项目（按排序顺序）
                var systemDesktopItems = dbService.GetItemsSortedAsync("SystemDesktop").Result;
                var userDesktopItems = dbService.GetItemsSortedAsync("UserDesktop").Result;
                var pastedFiles = dbService.GetItemsSortedAsync("PastedFiles").Result;
                var dockItems = dbService.GetDockItemsAsync().Result;

                // 构建响应（兼容原有JSON格式）
                var response = new
                {
                    success = true,
                    SystemDesktop = systemDesktopItems.Select(i => i.ToJsonObject()).ToList(),
                    UserDesktop = userDesktopItems.Select(i => i.ToJsonObject()).ToList(),
                    PastedFiles = pastedFiles.Select(i => i.ToJsonObject()).ToList(),
                    DockItems = dockItems.Select(i => i.ToJsonObject()).ToList(),
                    Timestamp = DateTime.Now,
                    IconsDirectory = iconsDirectory,
                    ThumbnailsDirectory = thumbnailsDirectory,
                    PastedFilesPath = pastedFilesPath
                };

                return System.Text.Json.JsonSerializer.Serialize(response);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 从数据库获取桌面信息时出错: {ex.Message}");
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
        }

        // 从数据库删除项目
        static string DeleteItemFromDatabase(string path)
        {
            Microsoft.Data.Sqlite.SqliteTransaction transaction = null;
            Microsoft.Data.Sqlite.SqliteConnection connection = null;
            
            try
            {
                // 打开数据库连接
                connection = (Microsoft.Data.Sqlite.SqliteConnection)dbService.CreateConnection();
                connection.Open();
                
                // 开始事务
                transaction = connection.BeginTransaction();
                
                // 1. 尝试删除实际文件/文件夹
                bool fileDeleted = false;
                if (File.Exists(path))
                {
                    File.Delete(path);
                    fileDeleted = true;
                }
                else if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                    fileDeleted = true;
                }
                else
                {
                    // 文件不存在，直接删除数据库记录
                    fileDeleted = true;
                }
                
                // 2. 如果文件删除成功，删除数据库记录
                if (fileDeleted)
                {
                    dbService.DeleteDesktopItemAsync(path, transaction).Wait();
                }
                
                // 3. 提交事务
                transaction.Commit();
                
                Console.WriteLine($"🗑️ 已删除: {path}");
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = true,
                    message = "删除成功"
                });
            }
            catch (Exception ex)
            {
                // 4. 发生错误，回滚事务
                if (transaction != null)
                {
                    try
                    {
                        transaction.Rollback();
                    }
                    catch (Exception rollbackEx)
                    {
                        Console.WriteLine($"❌ 事务回滚失败: {rollbackEx.Message}");
                    }
                }
                
                Console.WriteLine($"❌ 删除失败: {ex.Message}");
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
            finally
            {
                // 5. 清理资源
                if (transaction != null)
                {
                    transaction.Dispose();
                }
                if (connection != null)
                {
                    connection.Dispose();
                }
            }
        }

        // 添加到Dock栏
        static string AddToDockInDatabase(string path)
        {
            try
            {
                // 先查找项目
                var allItems = dbService.GetAllDesktopItemsAsync().Result;
                var item = allItems.FirstOrDefault(i => i.Path == path);
                
                if (item == null)
                {
                    return System.Text.Json.JsonSerializer.Serialize(new {
                        success = false,
                        error = "项目不存在"
                    });
                }

                dbService.AddToDockAsync(item.Id).Wait();
                
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = true,
                    message = "已添加到Dock栏"
                });
            }
            catch (Exception ex)
            {
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
        }

        // 从Dock栏移除
        static string RemoveFromDockInDatabase(string path)
        {
            try
            {
                var allItems = dbService.GetAllDesktopItemsAsync().Result;
                var item = allItems.FirstOrDefault(i => i.Path == path);
                
                if (item == null)
                {
                    return System.Text.Json.JsonSerializer.Serialize(new {
                        success = false,
                        error = "项目不存在"
                    });
                }

                dbService.RemoveFromDockAsync(item.Id).Wait();
                
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = true,
                    message = "已从Dock栏移除"
                });
            }
            catch (Exception ex)
            {
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
        }
        
        // ShellLinkHelper class for resolving shortcuts
        public class ShellLinkHelper
        {
            [Flags]
            private enum SLGP_FLAGS
            {
                SLGP_SHORTPATH = 0x1,
                SLGP_UNCPRIORITY = 0x2,
                SLGP_RAWPATH = 0x4,
            }

            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
            private struct WIN32_FIND_DATAW
            {
                public uint dwFileAttributes;
                public long ftCreationTime;
                public long ftLastAccessTime;
                public long ftLastWriteTime;
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
            public enum SLR_FLAGS
            {
                SLR_NO_UI = 0x1,
                SLR_ANY_MATCH = 0x2,
                SLR_UPDATE = 0x4,
                SLR_NOUPDATE = 0x8,
                SLR_NOSEARCH = 0x10,
                SLR_NOTRACK = 0x20,
                SLR_NOLINKINFO = 0x40,
                SLR_INVOKE_MSI = 0x80,
            }

            [ComImport]
            [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            [Guid("000214F9-0000-0000-C000-000000000046")]
            private interface IShellLinkW
            {
                void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, ref WIN32_FIND_DATAW pfd, SLGP_FLAGS fFlags);
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
                void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
                void Resolve(ref IntPtr hwnd, SLR_FLAGS fFlags);
                void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
            }

            [ComImport]
            [Guid("00021401-0000-0000-C000-000000000046")]
            private class ShellLink
            {
            }

            [ComImport]
            [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            [Guid("0000010b-0000-0000-C000-000000000046")]
            private interface IPersistFile
            {
                void GetClassID(out Guid pClassID);
                void IsDirty();
                void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
                void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
                void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
                void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
            }

            public static string RetrieveTargetPath(string path)
            {
                var link = new ShellLink();
                const int STGM_READ = 0;

                try
                {
                    ((IPersistFile)link).Load(path, STGM_READ);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"加载快捷方式时出错 ({path}): {ex.Message}");
                    Marshal.ReleaseComObject(link);
                    return string.Empty;
                }

                IntPtr hwnd = IntPtr.Zero;
                ((IShellLinkW)link).Resolve(ref hwnd, 0);

                const int MAX_PATH = 260;
                StringBuilder buffer = new StringBuilder(MAX_PATH);

                var data = default(WIN32_FIND_DATAW);
                ((IShellLinkW)link).GetPath(buffer, buffer.Capacity, ref data, SLGP_FLAGS.SLGP_SHORTPATH);
                var target = buffer.ToString();

                Marshal.ReleaseComObject(link);

                return target;
            }
        }
        
        // WindowsThumbnailProvider class for getting native thumbnails
        public class WindowsThumbnailProvider
        {
            [Flags]
            public enum ThumbnailOptions
            {
                RESIZETOFIT = 0x00,
                BiggerSizeOk = 0x01,
                InMemoryOnly = 0x02,
                IconOnly = 0x04,
                ThumbnailOnly = 0x08,
                InCacheOnly = 0x10,
            }

            private const string IShellItem2Guid = "7E9FB0D3-919F-4307-AB2E-9B1860310C93";

            [ComImport]
            [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
            private interface IShellItem
            {
            }

            [ComImport]
            [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
            [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            private interface IShellItemImageFactory
            {
                [PreserveSig]
                int GetImage(
                [In, MarshalAs(UnmanagedType.Struct)] NativeSize size,
                [In] ThumbnailOptions flags,
                [Out] out IntPtr phbm);
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

            [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            private static extern int SHCreateItemFromParsingName(
                [MarshalAs(UnmanagedType.LPWStr)] string path,
                IntPtr pbc,
                ref Guid riid,
                [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

            [DllImport("gdi32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            private static extern bool DeleteObject(IntPtr hObject);

            public static Bitmap GetThumbnail(string fileName, int width, int height, ThumbnailOptions options)
            {
                IntPtr hBitmap = IntPtr.Zero;
                IShellItem nativeShellItem = null;

                try
                {
                    Guid shellItem2Guid = new Guid(IShellItem2Guid);
                    int retCode = SHCreateItemFromParsingName(fileName, IntPtr.Zero, ref shellItem2Guid, out nativeShellItem);

                    if (retCode != 0)
                    {
                        Console.WriteLine($"创建ShellItem失败，错误码: {retCode}");
                        return null;
                    }

                    NativeSize nativeSize = new NativeSize
                    {
                        Width = width,
                        Height = height,
                    };

                    int hr = ((IShellItemImageFactory)nativeShellItem).GetImage(nativeSize, options, out hBitmap);

                    // if extracting image thumbnail and failed, extract shell icon
                    if (options == ThumbnailOptions.ThumbnailOnly && hr != 0)
                    {
                        hr = ((IShellItemImageFactory)nativeShellItem).GetImage(nativeSize, ThumbnailOptions.IconOnly, out hBitmap);
                    }

                    if (hr != 0 || hBitmap == IntPtr.Zero)
                    {
                        Console.WriteLine($"获取缩略图失败，错误码: {hr}");
                        return null;
                    }

                    return Image.FromHbitmap(hBitmap);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"获取缩略图时出错 ({fileName}): {ex.Message}");
                    return null;
                }
                finally
                {
                    if (hBitmap != IntPtr.Zero)
                    {
                        DeleteObject(hBitmap);
                    }
                    if (nativeShellItem != null)
                    {
                        Marshal.ReleaseComObject(nativeShellItem);
                    }
                }
            }
        }
        
        // 重新扫描桌面和粘贴文件夹（使用数据库）
        static async Task RescanAllAsync()
        {
            if (dbService == null)
            {
                Console.WriteLine("❌ 数据库服务未初始化");
                return;
            }

            try
            {
                Console.WriteLine("🔄 开始重新扫描...");
                
                // 清理已不存在的文件记录
                var cleanedCount = await dbService.CleanupNonExistentFilesAsync();
                if (cleanedCount > 0)
                {
                    Console.WriteLine($"🗑️ 清理了 {cleanedCount} 个不存在的文件记录");
                }
                
                // 获取桌面路径
                string systemDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
                string userDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                
                // 收集桌面项目
                var systemDesktopItems = CollectDesktopItems(systemDesktopPath, "SystemDesktop");
                var userDesktopItems = CollectDesktopItems(userDesktopPath, "UserDesktop");
                var pastedItems = CollectPastedFiles(pastedFilesPath);
                
                // 合并所有项目并保存到数据库
                var allItems = new List<DesktopItemEntity>();
                allItems.AddRange(systemDesktopItems);
                allItems.AddRange(userDesktopItems);
                allItems.AddRange(pastedItems);
                
                await dbService.UpsertDesktopItemsAsync(allItems);
                
                // 获取数据库统计
                var stats = await dbService.GetStatsAsync();
                Console.WriteLine($"✅ 重新扫描完成！总计: {stats.TotalItems}, 系统桌面: {stats.SystemDesktopCount}, 用户桌面: {stats.UserDesktopCount}, 粘贴文件: {stats.PastedFilesCount}, Dock栏: {stats.DockItemsCount}");
                
                // 清理失效的图标和缩略图文件
                CleanupInvalidFiles(allItems);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 重新扫描时出错: {ex.Message}");
            }
        }

        // 同步版本的 RescanAll（用于兼容旧代码）
        static void RescanAll()
        {
            RescanAllAsync().GetAwaiter().GetResult();
        }
        
        // 收集桌面项目（返回数据库实体）
        static List<DesktopItemEntity> CollectDesktopItems(string desktopPath, string source)
        {
            var items = new List<DesktopItemEntity>();
            
            if (!Directory.Exists(desktopPath))
            {
                Console.WriteLine($"路径不存在: {desktopPath}");
                return items;
            }
            
            try
            {
                // 获取所有文件和文件夹
                string[] files = Directory.GetFiles(desktopPath);
                string[] directories = Directory.GetDirectories(desktopPath);
                
                // 处理文件
                foreach (string file in files)
                {
                    var item = CreateDesktopItemEntity(file, false, source);
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }
                
                // 处理文件夹
                foreach (string directory in directories)
                {
                    var item = CreateDesktopItemEntity(directory, true, source);
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"收集桌面项目时出错: {ex.Message}");
            }
            
            return items;
        }
        
        // 收集粘贴文件夹中的所有文件（返回数据库实体）
        static List<DesktopItemEntity> CollectPastedFiles(string rootPath)
        {
            var items = new List<DesktopItemEntity>();
            
            if (!Directory.Exists(rootPath))
            {
                Console.WriteLine($"粘贴文件夹不存在: {rootPath}");
                return items;
            }
            
            try
            {
                // 递归收集所有文件
                CollectFilesRecursive(rootPath, rootPath, items);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"收集粘贴文件时出错: {ex.Message}");
            }
            
            return items;
        }
        
        // 递归收集文件（返回数据库实体）
        static void CollectFilesRecursive(string rootPath, string currentPath, List<DesktopItemEntity> items)
        {
            try
            {
                // 获取所有文件和文件夹
                string[] files = Directory.GetFiles(currentPath);
                string[] directories = Directory.GetDirectories(currentPath);
                
                // 处理文件
                foreach (string file in files)
                {
                    var item = CreateDesktopItemEntity(file, false, "PastedFiles");
                    if (item != null)
                    {
                        items.Add(item);
                    }
                }
                
                // 递归处理子文件夹
                foreach (string directory in directories)
                {
                    // 检查是否为年月组织目录
                    if (!IsDateOrganizationFolder(rootPath, directory))
                    {
                        var item = CreateDesktopItemEntity(directory, true, "PastedFiles");
                        if (item != null)
                        {
                            items.Add(item);
                        }
                    }
                    
                    // 递归处理子文件夹中的内容
                    CollectFilesRecursive(rootPath, directory, items);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"收集文件时出错 ({currentPath}): {ex.Message}");
            }
        }
        
        // 清理失效的图标和缩略图文件（从数据库实体列表中获取有效路径）
        static void CleanupInvalidFiles(List<DesktopItemEntity> items)
        {
            try
            {
                Console.WriteLine("🧹 开始清理失效的图标和缩略图文件...");
                
                // 收集有效的图标和缩略图路径
                var validIconPaths = new HashSet<string>();
                var validThumbnailPaths = new HashSet<string>();
                
                foreach (var item in items)
                {
                    if (!string.IsNullOrEmpty(item.IconPath))
                        validIconPaths.Add(item.IconPath);
                    if (!string.IsNullOrEmpty(item.ThumbnailPath))
                        validThumbnailPaths.Add(item.ThumbnailPath);
                }
                
                // 清理失效的图标文件
                if (Directory.Exists(iconsDirectory))
                {
                    int deletedCount = 0;
                    foreach (string iconFile in Directory.GetFiles(iconsDirectory))
                    {
                        if (!validIconPaths.Contains(iconFile))
                        {
                            try
                            {
                                File.Delete(iconFile);
                                deletedCount++;
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"⚠️ 删除图标文件时出错 ({iconFile}): {ex.Message}");
                            }
                        }
                    }
                    if (deletedCount > 0)
                        Console.WriteLine($"🗑️ 删除 {deletedCount} 个失效的图标文件");
                }
                
                // 清理失效的缩略图文件
                if (Directory.Exists(thumbnailsDirectory))
                {
                    int deletedCount = 0;
                    foreach (string thumbnailFile in Directory.GetFiles(thumbnailsDirectory))
                    {
                        if (!validThumbnailPaths.Contains(thumbnailFile))
                        {
                            try
                            {
                                File.Delete(thumbnailFile);
                                deletedCount++;
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"⚠️ 删除缩略图文件时出错 ({thumbnailFile}): {ex.Message}");
                            }
                        }
                    }
                }
                
                Console.WriteLine("清理完成。");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"清理失效文件时出错: {ex.Message}");
            }
        }
        
        // 创建桌面项目实体（用于数据库）
        static DesktopItemEntity CreateDesktopItemEntity(string path, bool isDirectory, string source)
        {
            try
            {
                string name = Path.GetFileName(path);
                string extension = isDirectory ? "" : Path.GetExtension(path).ToLower();
                
                // 获取图标
                Icon icon = GetIconForPath(path, isDirectory);
                string? iconBase64 = ConvertIconToBase64(icon);
                string? iconPath = null;
                string? thumbnailPath = null;
                
                // 生成图标文件
                iconPath = SaveIconToFile(icon, name, extension);
                
                // 生成缩略图（如果是图片或视频）
                if (!isDirectory && IsImageFile(extension))
                {
                    thumbnailPath = GenerateImageThumbnail(path, name);
                }
                else if (!isDirectory && IsVideoFile(extension))
                {
                    thumbnailPath = GenerateVideoThumbnail(path, name);
                }
                
                return new DesktopItemEntity
                {
                    Name = name,
                    Path = path,
                    IsDirectory = isDirectory ? 1 : 0,
                    Extension = extension,
                    IconBase64 = iconBase64,
                    IconPath = iconPath,
                    ThumbnailPath = thumbnailPath,
                    Source = source,
                    LastModified = File.GetLastWriteTime(path).ToString("O")
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"创建桌面项目时出错 ({path}): {ex.Message}");
                return null;
            }
        }

        // 保留旧方法以兼容
        static DesktopItem CreateDesktopItem(string path, bool isDirectory)
        {
            var entity = CreateDesktopItemEntity(path, isDirectory, "UserDesktop");
            if (entity == null) return null;
            
            return new DesktopItem
            {
                Name = entity.Name,
                Path = entity.Path,
                IsDirectory = entity.IsDirectory == 1,
                Extension = entity.Extension,
                IconBase64 = entity.IconBase64,
                IconPath = entity.IconPath,
                ThumbnailPath = entity.ThumbnailPath,
                LastModified = DateTime.Parse(entity.LastModified)
            };
        }
        
        // 保存图标到文件
        static string? SaveIconToFile(Icon icon, string name, string extension)
        {
            try
            {
                if (icon == null)
                    return null;
                
                string safeFileName = GetSafeFileName(name);
                string iconFileName = $"{safeFileName}{extension}.png";
                string iconPath = Path.Combine(iconsDirectory, iconFileName);
                
                using (var bitmap = icon.ToBitmap())
                {
                    bitmap.Save(iconPath, System.Drawing.Imaging.ImageFormat.Png);
                }
                
                return iconPath;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"保存图标时出错: {ex.Message}");
                return null;
            }
        }
        
        // 生成图片缩略图
        static string? GenerateImageThumbnail(string imagePath, string name)
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
                        string thumbnailPath = Path.Combine(thumbnailsDirectory, thumbnailFileName);
                        
                        thumbnail.Save(thumbnailPath, System.Drawing.Imaging.ImageFormat.Png);
                        return thumbnailPath;
                    }
                    else
                    {
                        // 如果获取原生缩略图失败，使用传统方法
                        using (var image = Image.FromFile(imagePath))
                        {
                            // 生成缩略图
                            int thumbnailWidth = 200;
                            int thumbnailHeight = 200;
                            
                            using (var fallbackThumbnail = new Bitmap(thumbnailWidth, thumbnailHeight))
                            {
                                using (var graphics = Graphics.FromImage(fallbackThumbnail))
                                {
                                    graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
                                    graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                                    graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                                    
                                    graphics.DrawImage(image, 0, 0, thumbnailWidth, thumbnailHeight);
                                }
                                
                                string safeFileName = GetSafeFileName(name);
                                string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                                string thumbnailPath = Path.Combine(thumbnailsDirectory, thumbnailFileName);
                                
                                fallbackThumbnail.Save(thumbnailPath, System.Drawing.Imaging.ImageFormat.Png);
                                return thumbnailPath;
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"生成图片缩略图时出错 ({imagePath}): {ex.Message}");
                return null;
            }
        }
        
        // 生成视频缩略图
        static string? GenerateVideoThumbnail(string videoPath, string name)
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
                        string thumbnailPath = Path.Combine(thumbnailsDirectory, thumbnailFileName);
                        
                        thumbnail.Save(thumbnailPath, System.Drawing.Imaging.ImageFormat.Png);
                        return thumbnailPath;
                    }
                    else
                    {
                        // 如果获取原生缩略图失败，使用默认图标
                        using (var bitmap = SystemIcons.WinLogo.ToBitmap())
                        {
                            string safeFileName = GetSafeFileName(name);
                            string thumbnailFileName = $"{safeFileName}_thumbnail.png";
                            string thumbnailPath = Path.Combine(thumbnailsDirectory, thumbnailFileName);
                            
                            bitmap.Save(thumbnailPath, System.Drawing.Imaging.ImageFormat.Png);
                            return thumbnailPath;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"生成视频缩略图时出错 ({videoPath}): {ex.Message}");
                return null;
            }
        }
        
        // 检查是否为图片文件
        static bool IsImageFile(string extension)
        {
            string[] imageExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp" };
            return Array.Exists(imageExtensions, ext => ext == extension);
        }
        
        // 检查是否为视频文件
        static bool IsVideoFile(string extension)
        {
            string[] videoExtensions = { ".mp4", ".avi", ".wmv", ".mov", ".mkv", ".flv", ".webm" };
            return Array.Exists(videoExtensions, ext => ext == extension);
        }
        
        // 获取安全的文件名
        static string GetSafeFileName(string fileName)
        {
            string invalidChars = new string(Path.GetInvalidFileNameChars());
            string safeFileName = fileName;
            foreach (char c in invalidChars)
            {
                safeFileName = safeFileName.Replace(c, '_');
            }
            return safeFileName;
        }
        
        static Icon GetIconForPath(string path, bool isDirectory)
        {
            if (isDirectory)
            {
                // 使用默认图标
                return SystemIcons.WinLogo;
            }
            else
            {
                try
                {
                    // 检查是否为快捷方式
                    if (Path.GetExtension(path).Equals(".lnk", StringComparison.OrdinalIgnoreCase))
                    {
                        // 解析快捷方式，获取目标路径
                        string targetPath = ShellLinkHelper.RetrieveTargetPath(path);
                        if (!string.IsNullOrEmpty(targetPath) && File.Exists(targetPath))
                        {
                            // 获取目标文件的图标
                            return Icon.ExtractAssociatedIcon(targetPath);
                        }
                    }
                    
                    // 获取文件的图标
                    return Icon.ExtractAssociatedIcon(path);
                }
                catch
                {
                    return SystemIcons.WinLogo;
                }
            }
        }
        
        static string? ConvertIconToBase64(Icon icon)
        {
            if (icon == null)
                return null;
            
            using (var stream = new MemoryStream())
            {
                icon.ToBitmap().Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                byte[] bytes = stream.ToArray();
                return Convert.ToBase64String(bytes);
            }
        }
        
        // 处理智能粘贴
        static string HandleSmartPaste(System.Text.Json.JsonElement clipboardDataElement)
        {
            try
            {
                Console.WriteLine("📋 开始处理智能粘贴...");
                LoggerService.Info("📋 开始处理智能粘贴...");
                
                // 验证粘贴路径配置
                if (string.IsNullOrEmpty(pastedFilesPath))
                {
                    var msg = "粘贴路径未配置或为空";
                    Console.WriteLine($"❌ {msg}");
                    LoggerService.Error(msg);
                    throw new Exception(msg);
                }

                // 创建粘贴文件夹结构
                var now = DateTime.Now;
                var year = now.Year.ToString();
                var month = now.Month.ToString("D2");
                var yearMonthPath = Path.Combine(pastedFilesPath, year, month);
                
                LoggerService.Info($"📁 目标路径: {yearMonthPath}");

                // 创建目录
                if (!Directory.Exists(yearMonthPath))
                {
                    LoggerService.Info($"📁 目录不存在，尝试创建: {yearMonthPath}");
                    Directory.CreateDirectory(yearMonthPath);
                }
                
                Console.WriteLine($"📁 创建粘贴目录: {yearMonthPath}");
                
                // 处理不同类型的剪贴板数据
                if (clipboardDataElement.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    // 文本内容
                    string textContent = clipboardDataElement.GetString();
                    Console.WriteLine("📄 处理文本内容");
                    LoggerService.Info("📄 处理文本内容");
                    
                    // 生成文件名
                    string timestamp = DateTime.Now.Ticks.ToString();
                    string baseName = "clipboard";
                    
                    // 提取前20个字符作为文件名基础
                    if (!string.IsNullOrEmpty(textContent) && textContent.Length > 20)
                    {
                        baseName = textContent.Substring(0, 20);
                    }
                    else if (!string.IsNullOrEmpty(textContent))
                    {
                        baseName = textContent;
                    }
                    
                    // 清理文件名
                    string sanitizedBaseName = SanitizeFileName(baseName);
                    string fileName = $"{sanitizedBaseName}_{timestamp}.txt";
                    string filePath = Path.Combine(yearMonthPath, fileName);
                    
                    // 处理文件冲突
                    filePath = GetUniqueFilePath(filePath);
                    
                    // 写入文件
                    Console.WriteLine($"正在写入文件: {filePath}...");
                    LoggerService.Info($"正在写入文件: {filePath}...");
                    try {
                        File.WriteAllText(filePath, textContent, Encoding.UTF8);
                        Console.WriteLine($"✅ 文本文件已保存: {filePath}");
                        LoggerService.Info($"✅ 文本文件已保存: {filePath}");
                    } catch (Exception ex) {
                        Console.WriteLine($"❌ 写入文件失败: {ex.Message}");
                        LoggerService.Error(ex, $"写入文件失败: {filePath}");
                        throw;
                    }
                    
                    return System.Text.Json.JsonSerializer.Serialize(new {
                        success = true,
                        filePath = filePath,
                        type = "text"
                    });
                }
                else if (clipboardDataElement.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    // 对象类型（图像、文件等）
                    if (clipboardDataElement.TryGetProperty("type", out var typeElement))
                    {
                        string type = typeElement.GetString();
                        LoggerService.Info($"处理类型: {type}");
                        
                        switch (type)
                        {
                            case "image":
                                // 处理图像内容
                                if (clipboardDataElement.TryGetProperty("data", out var imageDataElement))
                                {
                                    string imageData = imageDataElement.GetString();
                                    Console.WriteLine("🖼️ 处理图像内容");
                                    
                                    // 获取图像格式
                                    string format = "png";
                                    if (clipboardDataElement.TryGetProperty("format", out var formatElement))
                                    {
                                        format = formatElement.GetString();
                                    }
                                    
                                    // 验证图像格式
                                    if (!IsSupportedImageFormat(format))
                                    {
                                        throw new Exception($"不支持的图像格式: {format}");
                                    }
                                    
                                    // 生成文件名
                                    string timestamp = DateTime.Now.Ticks.ToString();
                                    string fileName = $"{timestamp}.{format}";
                                    string filePath = Path.Combine(yearMonthPath, fileName);
                                    
                                    // 处理文件冲突
                                    filePath = GetUniqueFilePath(filePath);
                                    
                                    // 保存图像
                                    if (SaveImageFromBase64(imageData, filePath))
                                    {
                                        Console.WriteLine($"✅ 图像文件已保存: {filePath}");
                                        LoggerService.Info($"✅ 图像文件已保存: {filePath}");
                                        return System.Text.Json.JsonSerializer.Serialize(new {
                                            success = true,
                                            filePath = filePath,
                                            type = "image"
                                        });
                                    }
                                    else
                                    {
                                        throw new Exception("保存图像失败");
                                    }
                                }
                                break;
                                
                            case "file":
                                // 处理文件引用 (已支持文件夹)
                                if (clipboardDataElement.TryGetProperty("path", out var pathElement))
                                {
                                    string sourcePath = pathElement.GetString();
                                    Console.WriteLine($"📁 处理文件引用: {sourcePath}");
                                    LoggerService.Info($"📁 处理文件引用: {sourcePath}");
                                    
                                    // 检查源文件或文件夹是否存在
                                    if (!File.Exists(sourcePath) && !Directory.Exists(sourcePath))
                                    {
                                        throw new Exception($"源文件不存在: {sourcePath}");
                                    }
                                    
                                    // 检查是否为文件夹
                                    bool isDirectory = Directory.Exists(sourcePath);
                                    
                                    // 获取文件名或文件夹名
                                    string fileName = Path.GetFileName(sourcePath);
                                    // 如果是根目录驱动器（如 E:\），GetFileName 可能为空，需处理
                                    if (string.IsNullOrEmpty(fileName)) fileName = Path.GetPathRoot(sourcePath).Replace(":", "");

                                    string targetPath = Path.Combine(yearMonthPath, fileName);
                                    
                                    // 处理文件冲突
                                    if (isDirectory)
                                    {
                                        targetPath = GetUniqueDirectoryPath(targetPath);
                                    }
                                    else
                                    {
                                        targetPath = GetUniqueFilePath(targetPath);
                                    }
                                    
                                    LoggerService.Info($"📋 复制开始: {sourcePath} -> {targetPath}");

                                    try {
                                        // 复制文件或文件夹
                                        if (isDirectory)
                                        {
                                            // 复制文件夹及其内容
                                            CopyDirectory(sourcePath, targetPath);
                                            Console.WriteLine($"✅ 文件夹已复制: {targetPath}");
                                            LoggerService.Info($"✅ 文件夹已复制: {targetPath}");
                                        }
                                        else
                                        {
                                            // 复制文件
                                            File.Copy(sourcePath, targetPath, false);
                                            Console.WriteLine($"✅ 文件已复制: {targetPath}");
                                            LoggerService.Info($"✅ 文件已复制: {targetPath}");
                                        }
                                    } catch (Exception copyEx) {
                                        LoggerService.Error(copyEx, $"复制失败: {sourcePath} -> {targetPath}");
                                        throw;
                                    }
                                    
                                    return System.Text.Json.JsonSerializer.Serialize(new {
                                        success = true,
                                        filePath = targetPath,
                                        type = isDirectory ? "directory" : "file"
                                    });
                                }
                                break;
                                
                            case "video":
                                // 处理视频内容
                                if (clipboardDataElement.TryGetProperty("data", out var videoDataElement))
                                {
                                    string videoData = videoDataElement.GetString();
                                    Console.WriteLine("🎬 处理视频内容");
                                    LoggerService.Info("🎬 处理视频内容");
                                    
                                    // 生成文件名
                                    string timestamp = DateTime.Now.Ticks.ToString();
                                    string fileName = $"{timestamp}.mp4";
                                    string filePath = Path.Combine(yearMonthPath, fileName);
                                    
                                    // 处理文件冲突
                                    filePath = GetUniqueFilePath(filePath);
                                    
                                    // 保存视频
                                    if (SaveVideoFromBase64(videoData, filePath))
                                    {
                                        Console.WriteLine($"✅ 视频文件已保存: {filePath}");
                                        LoggerService.Info($"✅ 视频文件已保存: {filePath}");
                                        return System.Text.Json.JsonSerializer.Serialize(new {
                                            success = true,
                                            filePath = filePath,
                                            type = "video"
                                        });
                                    }
                                    else
                                    {
                                        throw new Exception("保存视频失败");
                                    }
                                }
                                break;
                        }
                    }
                    
                    throw new Exception("不支持的剪贴板内容类型或类型未指定");
                }
                else
                {
                    throw new Exception("不支持的剪贴板数据格式");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 智能粘贴处理失败: {ex.Message}");
                LoggerService.Error(ex, "智能粘贴处理失败");
                return System.Text.Json.JsonSerializer.Serialize(new {
                    success = false,
                    error = ex.Message
                });
            }
        }
        
        // 检查是否为支持的图像格式
        static bool IsSupportedImageFormat(string format)
        {
            string[] supportedFormats = { "jpg", "jpeg", "png", "gif", "bmp" };
            return supportedFormats.Contains(format.ToLower());
        }
        
        // 检查是否为支持的文件格式
        static bool IsSupportedFileFormat(string extension)
        {
            string[] supportedFormats = { ".txt", ".doc", ".docx", ".ppt", ".pptx", ".xlsx", ".xls", ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".bmp" };
            return supportedFormats.Contains(extension);
        }
        
        // 清理文件名
        static string SanitizeFileName(string fileName)
        {
            string invalidChars = new string(Path.GetInvalidFileNameChars());
            string sanitized = fileName;
            foreach (char c in invalidChars)
            {
                sanitized = sanitized.Replace(c, '_');
            }
            return sanitized;
        }
        
        // 获取唯一文件路径
        static string GetUniqueFilePath(string filePath)
        {
            if (!File.Exists(filePath))
            {
                return filePath;
            }
            
            string directory = Path.GetDirectoryName(filePath);
            string fileName = Path.GetFileNameWithoutExtension(filePath);
            string extension = Path.GetExtension(filePath);
            
            int counter = 1;
            string newFilePath;
            
            do
            {
                newFilePath = Path.Combine(directory, $"{fileName}_{counter}{extension}");
                counter++;
            } while (File.Exists(newFilePath));
            
            return newFilePath;
        }
        
        // 获取唯一文件夹路径
        static string GetUniqueDirectoryPath(string directoryPath)
        {
            if (!Directory.Exists(directoryPath))
            {
                return directoryPath;
            }
            
            string parentDirectory = Path.GetDirectoryName(directoryPath);
            string directoryName = Path.GetFileName(directoryPath);
            
            int counter = 1;
            string newDirectoryPath;
            
            do
            {
                newDirectoryPath = Path.Combine(parentDirectory, $"{directoryName}_{counter}");
                counter++;
            } while (Directory.Exists(newDirectoryPath));
            
            return newDirectoryPath;
        }
        
        // 复制文件夹及其内容
        static void CopyDirectory(string sourceDir, string destDir)
        {
            // 创建目标文件夹
            Directory.CreateDirectory(destDir);
            
            // 复制所有文件
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string fileName = Path.GetFileName(file);
                string destFile = Path.Combine(destDir, fileName);
                File.Copy(file, destFile, false);
            }
            
            // 递归复制所有子文件夹
            foreach (string subDir in Directory.GetDirectories(sourceDir))
            {
                string subDirName = Path.GetFileName(subDir);
                string destSubDir = Path.Combine(destDir, subDirName);
                CopyDirectory(subDir, destSubDir);
            }
        }
        
        // 从Base64保存图像
        static bool SaveImageFromBase64(string base64Data, string filePath)
        {
            try
            {
                // 移除Base64前缀
                if (base64Data.StartsWith("data:image/"))
                {
                    int commaIndex = base64Data.IndexOf(',');
                    if (commaIndex > 0)
                    {
                        base64Data = base64Data.Substring(commaIndex + 1);
                    }
                }
                
                // 解码并保存
                byte[] imageBytes = Convert.FromBase64String(base64Data);
                File.WriteAllBytes(filePath, imageBytes);
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 保存图像失败: {ex.Message}");
                return false;
            }
        }
        
        // 从Base64保存视频
        static bool SaveVideoFromBase64(string base64Data, string filePath)
        {
            try
            {
                // 移除Base64前缀
                if (base64Data.StartsWith("data:video/"))
                {
                    int commaIndex = base64Data.IndexOf(',');
                    if (commaIndex > 0)
                    {
                        base64Data = base64Data.Substring(commaIndex + 1);
                    }
                }
                
                // 解码并保存
                byte[] videoBytes = Convert.FromBase64String(base64Data);
                File.WriteAllBytes(filePath, videoBytes);
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 保存视频失败: {ex.Message}");
                return false;
            }
        }
        // 检查是否为年月组织文件夹
        static bool IsDateOrganizationFolder(string rootPath, string dirPath)
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
                
                // 月份层级 (根目录下第二级，2位数字，或带“月”字样)
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
    }
    
    class DesktopItem
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public bool IsDirectory { get; set; }
        public string Extension { get; set; }
        public string? IconBase64 { get; set; }
        public string? IconPath { get; set; }
        public string? ThumbnailPath { get; set; }
        public DateTime LastModified { get; set; }
    }
}
