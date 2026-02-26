# AGENTS.md - DesktopManager 项目指南

## 项目概述

DesktopManager 是一个 Windows 桌面管理应用：
- **后端**: .NET 8.0 C#（TCP Server，端口 6789）
- **前端**: Electron 40 + React 19 + Vite 7
- **启动器**: Python Tkinter GUI (`launcher.pyw`)
- **数据库**: SQLite（`data/desktop_manager.db`，通过 Dapper ORM）

## 构建/运行命令

### 后端
```bash
cd backend
dotnet restore       # 恢复依赖
dotnet run           # 启动 TCP 服务器（端口 6789）
dotnet build         # 仅构建
```

### 前端
```bash
cd frontend
npm install          # 安装依赖
npm run dev          # 启动 Vite 开发服务器（端口 5173）
npm run build        # 生产构建
npm run lint         # ESLint 检查
npm run electron     # 启动 Electron（等待后端就绪）
npm run electron:dev # 联合开发模式（Vite + Electron）
```

### 启动器
```bash
python launcher.pyw  # 一键启动
```

## 代码风格

### JavaScript/React
- **缩进**: 2 空格
- **引号**: 单引号
- **组件命名**: PascalCase（`AppGrid.jsx`）
- **变量命名**: camelCase（`dockItems`）
- **常量命名**: UPPER_SNAKE_CASE（`BACKEND_PORT`）
- **错误处理**: try/catch 包裹所有 async 操作

### C#
- **命名**: PascalCase（类/方法/属性），camelCase（局部变量），`_camelCase`（私有字段）
- **异步方法**: 后缀 `Async`（`GetDockItemsAsync`）
- **错误处理**: try/catch + Console.WriteLine 日志

## 架构说明

### 通信协议
前后端通过 **TCP Socket + JSON 行协议** 通信：
- 后端：`TcpListener(IPAddress.Any, 6789)`
- 前端：`net.Socket` 连接 `127.0.0.1:6789`
- 请求格式：`{ "requestId": "...", "action": "...", ... }\n`

### 数据流
1. 后端启动 → 扫描桌面文件 → 写入 SQLite
2. 前端请求 `getDesktopInfo` → 后端查询数据库返回 JSON
3. 前端渲染图标/Dock → 用户操作 → IPC → 主进程 → TCP → 后端处理

### 关键路径（硬编码）
- 数据目录: `e:\software\DesktopManager\data`
- 粘贴文件: `e:\software\DesktopManager\pasted_files`

> ⚠️ 修改这些路径需同步更新 `Program.cs` 和 `launcher.pyw`

## 关键文件

| 文件 | 职责 |
|---|---|
| `backend/Program.cs` | TCP 服务器、桌面扫描、请求处理 |
| `backend/Services/DatabaseService.cs` | SQLite 数据库操作 |
| `backend/Services/FileScanner.cs` | 文件扫描逻辑 |
| `backend/Services/IconGenerator.cs` | 图标生成 |
| `frontend/electron/main.js` | Electron 主进程、IPC、TCP 客户端 |
| `frontend/electron/preload.js` | API 暴露给渲染进程 |
| `frontend/src/App.jsx` | React 主组件、状态管理 |
| `launcher.pyw` | 进程管理 GUI |

## 测试

无自动化测试。手动测试流程：
1. `cd backend && dotnet run`
2. `cd frontend && npm run electron:dev`
3. 或直接运行 `python launcher.pyw`

## 依赖

- **后端**: System.Drawing.Common 8.0.7, Microsoft.Data.Sqlite 9.0.1, Dapper 2.1.35
- **前端**: React 19, Electron 40, Vite 7, lucide-react, ESLint 9
- **启动器**: psutil (必需), tkinter (内置)
