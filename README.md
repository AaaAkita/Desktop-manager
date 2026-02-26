# Desktop Manager

一个现代化的桌面管理器，使用 C# 后端 + Electron + React 前端架构，提供美观、高效的桌面应用管理体验。

## 目录

- [项目结构](#项目结构)
- [技术架构](#技术架构)
- [运行方式](#运行方式)
- [功能特性](#功能特性)
- [系统要求](#系统要求)
- [项目状态](#项目状态)

---

## 项目结构

```
DesktopManager/
├── backend/                 # 后端服务 (C# .NET 8.0)
│   ├── Program.cs           # TCP 服务器入口，桌面扫描与请求处理
│   ├── Services/
│   │   ├── DatabaseService.cs   # SQLite 数据库操作
│   │   ├── FileScanner.cs       # 文件扫描服务
│   │   ├── IconCacheService.cs  # 图标缓存管理
│   │   └── IconGenerator.cs     # 图标生成服务
│   ├── Models/
│   │   └── DataModels.cs        # 数据模型定义
│   ├── Utils/
│   │   ├── ConfigHelper.cs      # 配置工具
│   │   └── LoggerService.cs     # 日志服务
│   ├── backend.csproj           # 项目配置
│   └── appsettings.json         # 应用配置
├── frontend/                # 前端应用 (Electron + React + Vite)
│   ├── electron/
│   │   ├── main.js              # Electron 主进程（IPC 处理、TCP 客户端）
│   │   └── preload.js           # 预加载脚本（API 暴露）
│   ├── src/
│   │   ├── App.jsx              # 主应用组件
│   │   ├── main.jsx             # React 入口
│   │   ├── App.css              # 应用样式
│   │   ├── index.css            # 全局样式
│   │   ├── components/          # UI 组件
│   │   │   ├── Header.jsx/css       # 顶部导航栏
│   │   │   ├── AppGrid.jsx/css      # 应用/文件网格
│   │   │   ├── Dock.jsx/css         # Dock 栏
│   │   │   ├── ContextMenu.jsx/css  # 右键菜单
│   │   │   ├── SettingsModal.jsx/css # 设置弹窗
│   │   │   ├── PropertiesModal.jsx/css # 属性查看
│   │   │   └── InfoWidget.jsx/css   # 信息小组件
│   │   ├── services/
│   │   │   └── backendService.js    # 后端通信服务
│   │   ├── styles/
│   │   │   └── variables.css        # CSS 变量定义
│   │   └── utils/
│   │       └── fileIcons.jsx        # 文件类型图标
│   ├── index.html               # HTML 模板
│   ├── package.json             # 依赖配置
│   ├── vite.config.js           # Vite 构建配置
│   └── eslint.config.js         # 代码检查配置
├── data/                    # 运行时数据（自动生成）
│   ├── desktop_manager.db       # SQLite 数据库
│   ├── desktop_info.json        # 桌面信息快照
│   ├── icons/                   # 图标缓存
│   └── thumbnails/              # 缩略图缓存
├── pasted_files/            # 剪贴板粘贴文件存储
├── logs/                    # 运行日志
├── launcher.pyw             # 一键启动器（Python Tkinter GUI）
├── AGENTS.md                # AI 编码指南
├── README.md                # 项目说明
└── .gitignore               # Git 忽略配置
```

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────┐
│              Launcher (Python)              │
│         一键启动 + 日志监控 + 进程管理        │
└──────────┬───────────────┬──────────────────┘
           │               │
     启动后端服务      启动前端应用
           │               │
           ▼               ▼
┌──────────────────┐ ┌────────────────────────┐
│   Backend (C#)   │ │    Frontend (Electron)  │
│   .NET 8.0       │ │    React 19 + Vite 7    │
│   TCP Server     │◄┤    TCP Client           │
│   Port: 6789     │ │    Port: 5173 (dev)     │
│                  │ │                          │
│  ┌────────────┐  │ │  ┌──────────────────┐   │
│  │ Database   │  │ │  │  IPC Handlers    │   │
│  │ Service    │  │ │  │  (main.js)       │   │
│  │ (SQLite)   │  │ │  └──────────────────┘   │
│  └────────────┘  │ │  ┌──────────────────┐   │
│  ┌────────────┐  │ │  │  React App       │   │
│  │ File       │  │ │  │  (App.jsx)       │   │
│  │ Scanner    │  │ │  └──────────────────┘   │
│  └────────────┘  │ │                          │
│  ┌────────────┐  │ └────────────────────────┘
│  │ Icon       │  │
│  │ Generator  │  │
│  └────────────┘  │
└──────────────────┘
```

### 前端 (frontend/)

| 项目 | 版本 | 用途 |
|---|---|---|
| Electron | ^40.1.0 | 桌面应用框架 |
| React | ^19.2.0 | UI 框架 |
| Vite | ^7.2.4 | 构建工具 |
| lucide-react | ^0.563.0 | 主要图标库 |
| @tabler/icons-react | ^3.36.1 | 备用图标库 |
| @remixicon/react | ^4.9.0 | 备用图标库 |

### 后端 (backend/)

| 项目 | 版本 | 用途 |
|---|---|---|
| .NET | 8.0 | 运行时框架 |
| System.Drawing.Common | 8.0.7 | 图标提取 |
| Microsoft.Data.Sqlite | 9.0.1 | SQLite 数据库 |
| Dapper | 2.1.35 | ORM 映射 |

### 通信协议

前后端通过 **TCP Socket + JSON 行协议** 通信：
- 后端监听 `127.0.0.1:6789`
- 前端通过 Electron 主进程 (`net.Socket`) 连接
- 每条消息为一行 JSON，以 `\n` 分隔
- 请求必须包含 `requestId` 和 `action` 字段

### 数据存储

- **SQLite 数据库** (`data/desktop_manager.db`)：持久化桌面项目、Dock 配置、排序和置顶状态
- **图标缓存** (`data/icons/`)：提取的应用图标 PNG 文件
- **缩略图缓存** (`data/thumbnails/`)：图片/视频文件缩略图
- **粘贴文件** (`pasted_files/`)：按年/月自动组织的用户粘贴内容

---

## 运行方式

### 🚀 一键启动（推荐）

双击 `launcher.pyw` 即可启动整个应用。启动器会自动：
1. 启动后端 C# 服务（自动编译 + 运行）
2. 启动前端 Electron 应用
3. 提供日志监控界面
4. 管理进程生命周期

**前置条件**：Python 3.6+、psutil 库 (`pip install psutil`)

### 🔧 手动启动（开发调试）

#### 1. 启动后端

```bash
cd backend
dotnet restore    # 首次运行，恢复依赖
dotnet run        # 启动 TCP 服务器（端口 6789）
```

#### 2. 启动前端

```bash
cd frontend
npm install       # 首次运行，安装依赖
npm run electron:dev   # 同时启动 Vite + Electron
```

或分步启动：
```bash
npm run dev       # 终端1：启动 Vite（端口 5173）
npm run electron  # 终端2：启动 Electron
```

### 端口配置

| 服务 | 端口 | 用途 |
|---|---|---|
| 后端 TCP | 6789 | 前后端通信 |
| Vite Dev | 5173 | 前端开发服务器（仅开发模式） |

---

## 功能特性

### 核心功能
- 📱 **桌面扫描** — 自动扫描系统桌面和用户桌面，提取图标并展示
- 🔍 **实时搜索** — 快速搜索和过滤应用及文件
- 🖼️ **壁纸管理** — 自定义壁纸，支持 cover / contain / stretch / tile 模式
- 📁 **文件操作** — 属性查看、删除、打开位置、管理员运行
- 📋 **智能粘贴** — 识别剪贴板内容类型（文本/图片/文件），按年月自动归档
- 🎯 **Dock 栏** — 应用拖放添加，右键菜单管理，持久化存储
- 📌 **置顶排序** — 支持图标置顶和自定义排序
- 🎨 **美观界面** — 毛玻璃效果、响应式布局、macOS 风格 Dock 动画

### 技术亮点
- **TCP Socket 通信** — 高效稳定的前后端实时通信
- **SQLite 持久化** — 数据库驱动的数据管理，支持排序和置顶
- **图标缓存机制** — 智能缓存提升启动速度
- **Windows API 集成** — 原生快捷方式解析和缩略图生成
- **异步架构** — 全链路 async/await，保持 UI 响应

---

## 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11 |
| .NET SDK | 8.0+ |
| Node.js | 18+ |
| npm | 9+ |
| Python | 3.6+（启动器） |
| 内存 | ≥ 4GB RAM |
| 磁盘 | ≥ 500MB 可用空间 |
| 分辨率 | ≥ 1024×768 |

---

## 项目状态

### 已实现
- ✅ 桌面图标扫描和展示
- ✅ 应用启动（普通 / 管理员）
- ✅ Dock 栏（拖放添加、右键菜单、持久化）
- ✅ 壁纸设置（多种显示模式）
- ✅ 智能粘贴（文本 / 图片 / 文件）
- ✅ 搜索过滤
- ✅ 文件管理（属性查看、删除、打开位置）
- ✅ 界面自适应
- ✅ 图标置顶和自定义排序
- ✅ SQLite 数据库持久化

### 未来计划
- 主题切换（浅色/深色）
- 更多文件操作（复制、移动、重命名）
- 性能优化和稳定性提升
- 插件系统

---

## 许可证

MIT License