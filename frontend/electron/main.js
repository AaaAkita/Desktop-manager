const { app, BrowserWindow, ipcMain, shell, dialog, protocol, nativeImage, screen } = require('electron');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process'); // 引入子进程模块

// 后端连接配置
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 6789;
let backendSocket = null;
let pendingRequests = new Map();
let messageId = 0;
let backendProcess = null; // 后端进程引用


// 简单的文件日志记录器
const logToFile = (message, level = 'INFO') => {
    try {
        const userDataPath = app.getPath('userData');
        const logsDir = path.join(userDataPath, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const date = new Date();
        const dateStr = date.toISOString().split('T')[0];
        const logFile = path.join(logsDir, `electron-${dateStr}.log`);

        const timeStr = date.toISOString().split('T')[1].split('.')[0];
        const logEntry = `[${timeStr}] [${level}] ${message}\n`;

        fs.appendFileSync(logFile, logEntry);

        // 同时输出到控制台
        console.log(logEntry.trim());
    } catch (error) {
        console.error('Failed to write log:', error);
    }
};

const connectToBackend = async () => {
    if (backendSocket && backendSocket.readyState === 1) {
        return Promise.resolve(backendSocket);
    }

    const maxRetries = 20; // 10 seconds total (20 * 500ms)
    const retryInterval = 500;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const net = require('net');
                const socket = new net.Socket();

                let connected = false;

                socket.connect(BACKEND_PORT, BACKEND_HOST, () => {
                    logToFile('🔌 Connected to backend C# service');
                    connected = true;
                    backendSocket = socket;
                    setupSocketHandlers(socket);
                    resolve(socket);
                });

                socket.on('error', (error) => {
                    if (!connected) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            logToFile(`⏳ Backend not ready, retrying (${i + 1}/${maxRetries})...`, 'WARN');
            if (i === maxRetries - 1) throw error;
            await new Promise(r => setTimeout(r, retryInterval));
        }
    }
};

const setupSocketHandlers = (socket) => {
    socket.on('error', (error) => {
        logToFile(`🔌 Backend connection error: ${error.message}`, 'ERROR');
    });

    socket.on('close', () => {
        logToFile('🔌 Backend connection closed', 'WARN');
        backendSocket = null;
    });

    let buffer = '';
    socket.on('data', (data) => {
        try {
            buffer += data.toString('utf8');

            // Split buffer by newlines to handle multiple messages
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                const message = line.trim();
                if (!message) continue;

                const response = JSON.parse(message);
                logToFile(`📥 Backend response: ${JSON.stringify(response)}`);

                const pending = pendingRequests.get(response.requestId);
                if (pending) {
                    if (response.success) {
                        const resolvedData = response.data !== undefined ? response.data : response;
                        pending.resolve(resolvedData);
                    } else {
                        pending.reject(new Error(response.error || 'Request failed'));
                    }
                    // clear timeout
                    if (pending.timeoutId) clearTimeout(pending.timeoutId);
                    pendingRequests.delete(response.requestId);
                }
            }
        } catch (error) {
            logToFile(`🔌 Failed to parse backend response: ${error.message}`, 'ERROR');
        }
    });
};

const sendBackendRequest = async (action, data = {}) => {
    if (!backendSocket) {
        try {
            await connectToBackend();
        } catch (error) {
            logToFile(`Failed to connect to backend: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    const requestId = `msg_${Date.now()}_${messageId++}`;
    const request = {
        requestId,
        action,
        ...data
    };

    return new Promise((resolve, reject) => {
        // 设置 10 秒超时
        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                logToFile(`❌ Request timeout: ${action} (${requestId})`, 'ERROR');
                pendingRequests.delete(requestId);
                reject(new Error(`Backend request timeout: ${action}`));
            }
        }, 10000);

        pendingRequests.set(requestId, { resolve, reject, timeoutId });

        try {
            const message = JSON.stringify(request) + '\n';
            logToFile(`📤 Sending request: ${action} (${requestId})`);
            backendSocket.write(message);
        } catch (error) {
            clearTimeout(timeoutId);
            pendingRequests.delete(requestId);
            reject(error);
        }
    });
};

// Set user data path to AppData/DesktopManager globally for both Dev and Prod
const appDataPath = app.getPath('appData');
const sharedDataPath = path.join(appDataPath, 'DesktopManager');
app.setPath('userData', sharedDataPath);

// Register privileged scheme
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-icon',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            corsEnabled: true
        }
    }
]);

let mainWindow;

function createWindow() {
    // 获取当前显示器的分辨�?
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    // 图标路径：开发模式从项目根目录读取，生产模式从 resources 目录读取
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon', 'DM.ico')
        : path.join(__dirname, '../../icon/DM.ico');

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        icon: iconPath,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false,
            webSecurity: true // Enable webSecurity for better security
        },
    });

    // Set Content Security Policy (CSP) to allow loading local resources via custom protocol
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' data: local-icon:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; img-src 'self' data: local-icon: file: https:;"
                ]
            }
        });
    });

    // Forward frontend console logs to terminal
    mainWindow.webContents.on('console-message', (event, ...args) => {
        const levelMap = { 0: 'VERBOSE', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
        let level, message;

        if (args.length > 0 && typeof args[0] === 'object') {
            // New signature: (event, details)
            const details = args[0];
            level = details.level || 0;
            message = details.message || '';
        } else {
            // Old signature: (event, level, message, line, sourceId)
            level = args[0] || 0;
            message = args[1] || '';
        }

        try {
            console.log(`[Frontend ${levelMap[level] || 'LOG'}] ${message}`);
        } catch (e) {
            // Ignore write errors
        }
    });

    const nodeEnv = (process.env.NODE_ENV || '').trim();
    const isDev = nodeEnv === 'development';

    console.log('🔍 [Main] NODE_ENV:', process.env.NODE_ENV);
    console.log('🔍 [Main] Parsed NODE_ENV:', nodeEnv);
    console.log('🔍 [Main] isDev:', isDev);

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // 打开DevTools用于调试（已关闭�?
        // mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// 启动后端服务
function startBackend() {
    const isDev = !app.isPackaged;
    let backendPath;
    let backendCwd;

    if (isDev) {
        // 开发模式下，假设开发者手动启动后端，或者尝试使用 dotnet run
        // 这里我们选择不自动启动，或者打印指引
        console.log('🚧 [Main] 开发模式：正在尝试查找后端...');
        // 尝试定位后端项目文件
        const projectRoot = path.resolve(__dirname, '../../'); // e:/software/DesktopManager
        const backendProj = path.join(projectRoot, 'backend', 'backend.csproj');

        if (fs.existsSync(backendProj)) {
            console.log('🚀 [Main] 正在通过 dotnet run 启动后端...');
            backendProcess = spawn('dotnet', ['run', '--project', backendProj], {
                cwd: path.dirname(backendProj),
                detached: false,
                stdio: 'ignore' // 开发模式下忽略输出，避免干扰终端
            });
        } else {
            console.log('⚠️ [Main] 未找到后端项目，请确保后端已启动。');
            return;
        }
    } else {
        // 生产模式：后端可执行文件位于资源目录下的 backend 文件夹中
        // process.resourcesPath 指向 resources 目录
        const backendDir = path.join(process.resourcesPath, 'backend');
        // 可执行文件名称及其路径
        const backendExe = path.join(backendDir, 'backend.exe');

        console.log(`🔍 [Main] 生产模式：后端路径: ${backendExe}`);

        if (fs.existsSync(backendExe)) {
            console.log('🚀 [Main] 正在启动后端服务...');
            backendProcess = spawn(backendExe, [], {
                cwd: backendDir,
                detached: false
            });
        } else {
            console.error(`❌ [Main] 严重错误：未找到后端可执行文件于 ${backendExe}`);
            dialog.showErrorBox('启动错误', '未找到后端服务组件，请重新安装应用。');
            app.quit();
            return;
        }
    }

    if (backendProcess) {
        backendProcess.on('spawn', () => {
            console.log(`✅ [Main] 后端进程已启动 (PID: ${backendProcess.pid})`);
        });

        backendProcess.on('error', (err) => {
            console.error('❌ [Main] 启动后端失败:', err);
        });

        backendProcess.on('close', (code) => {
            console.log(`🛑 [Main] 后端进程退出，退出码: ${code}`);
            backendProcess = null;
        });
    }
}

// 关闭后端服务
function stopBackend() {
    if (backendProcess) {
        console.log('🛑 [Main] 正在关闭后端服务...');
        backendProcess.kill();
        backendProcess = null;
    }
}

app.whenReady().then(() => {
    // 启动后端
    startBackend();

    // Register protocol to serve local icons
    // protocol is imported at the top level
    // Register protocol to serve local icons
    // protocol is imported at the top level
    protocol.registerFileProtocol('local-icon', (request, callback) => {
        let url = request.url.replace('local-icon://', '');

        // Remove query parameters if any
        url = url.split('?')[0];

        try {
            let decodedUrl = decodeURIComponent(url);

            // Handle Windows paths: remove leading slash before drive letter if present
            // e.g., /C:/path -> C:/path
            if (process.platform === 'win32' && decodedUrl.startsWith('/') && /^[a-zA-Z]:/.test(decodedUrl.slice(1))) {
                decodedUrl = decodedUrl.slice(1);
            }

            // CRITICAL FIX: Add missing colon after drive letter
            // URL might be 'e/software/...' which needs to become 'e:/software/...'
            if (process.platform === 'win32' && /^[a-zA-Z]\//.test(decodedUrl)) {
                decodedUrl = decodedUrl[0] + ':' + decodedUrl.slice(1);
                console.log(`[Protocol] Fixed drive letter: ${decodedUrl}`);
            }

            // Important: Convert forward slashes to backslashes BEFORE path.normalize
            // path.normalize on Windows will convert 'e:/' to 'e/' (losing the colon)
            // So we need to use backslashes: 'e:\' which normalizes correctly
            const windowsPath = decodedUrl.replace(/\//g, '\\');
            const normalizedPath = path.normalize(windowsPath);

            console.log(`[Protocol] Serving: ${normalizedPath} (Original: ${url})`);

            // Check if file exists
            if (!fs.existsSync(normalizedPath)) {
                console.error('[Protocol] File not found:', normalizedPath);
                return callback({ error: -6 }); // NET_FILE_NOT_FOUND
            }

            // CRITICAL: Use object format {path: ...} for callback
            // This is the recommended way in Electron
            return callback({ path: normalizedPath });
        } catch (error) {
            console.error('[Protocol] Error serving:', url, error);
            return callback({ error: -2 }); // NET_FAILED
        }
    });

    // IPC Handlers
    ipcMain.handle('scan-desktop', async () => {
        try {
            const userDesktopPath = app.getPath('desktop');
            const publicDesktopPath = path.join('C:\\Users\\Public\\Desktop');

            // Helper to safe read dir
            const readDirSafe = async (dir) => {
                try {
                    if (fs.existsSync(dir)) {
                        return (await fs.promises.readdir(dir)).map(file => ({ file, dir }));
                    }
                } catch (e) {
                    // console.error(`Failed to read ${dir}`, e);
                }
                return [];
            };

            const userFiles = await readDirSafe(userDesktopPath);
            const publicFiles = await readDirSafe(publicDesktopPath);
            const allFiles = [...userFiles, ...publicFiles];

            const apps = [];

            for (const { file, dir } of allFiles) {
                if (file.startsWith('.') || file.toLowerCase() === 'desktop.ini') continue;

                const fullPath = path.join(dir, file);
                let targetPath = fullPath;
                let category = 'file'; // 'software' or 'file'
                let type = 'file'; // 'folder', 'archive', 'application', 'shortcut'

                try {
                    const stats = await fs.promises.stat(fullPath);
                    const ext = path.extname(file).toLowerCase();

                    if (stats.isDirectory()) {
                        type = 'folder';
                        category = 'file';
                    } else {
                        // Determine Type & Category
                        if (ext === '.lnk') {
                            try {
                                const shortcut = shell.readShortcutLink(fullPath);
                                if (shortcut && shortcut.target) {
                                    targetPath = shortcut.target;
                                }
                                // Check target extension to guess if it's an app
                                const targetExt = path.extname(targetPath).toLowerCase();
                                if (targetExt === '.exe') {
                                    category = 'software';
                                    type = 'application';
                                } else {
                                    category = 'file'; // Shortcut to folder or file
                                    type = 'shortcut';
                                }
                            } catch (e) {
                                category = 'file';
                            }
                        } else if (ext === '.exe') {
                            category = 'software';
                            type = 'application';
                        } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
                            category = 'file';
                            type = 'archive';
                        } else {
                            category = 'file';
                            type = 'file';
                        }
                    }

                    // Get Icon: Multi-stage fallback strategy
                    let iconImage = null;
                    const iconCandidates = [];


                    // Priority 1: Custom shortcut icon (if specified)
                    if (ext === '.lnk') {
                        try {
                            const shortcut = shell.readShortcutLink(fullPath);
                            if (shortcut) {
                                if (shortcut.icon) {
                                    // Cleaning icon path: remove resource index (e.g. "C:\...\app.exe,0" -> "C:\...\app.exe")
                                    const cleanIconPath = shortcut.icon.replace(/,\d+$/, '').trim();

                                    // Only add if we have a valid path after cleaning (handles ",0" case)
                                    if (cleanIconPath.length > 0) {
                                        iconCandidates.push(cleanIconPath);
                                    }
                                }
                                if (shortcut.target) {
                                    targetPath = shortcut.target; // Update targetPath
                                }
                            }
                        } catch (e) { }
                    }

                    // Priority 2: The target of the shortcut (or the file itself if not a shortcut)
                    if (targetPath && targetPath !== fullPath) {
                        iconCandidates.push(targetPath);
                    }

                    // Priority 3: The file itself
                    iconCandidates.push(fullPath);

                    // Execute chain
                    for (const candidatePath of iconCandidates) {
                        try {

                            // Ensure path exists before trying to get icon
                            if (!fs.existsSync(candidatePath)) continue;

                            const extName = path.extname(candidatePath).toLowerCase();

                            // If it's a direct image file (.ico, .png, etc.), load it directly
                            if (['.ico', '.png', '.jpg', '.jpeg'].includes(extName)) {
                                try {
                                    // nativeImage is valid from top-level import
                                    const img = nativeImage.createFromPath(candidatePath);
                                    if (img && !img.isEmpty()) {
                                        iconImage = img;
                                        break;
                                    }
                                } catch (err) { }
                                continue;
                            }

                            const icon = await app.getFileIcon(candidatePath, { size: 'large' });
                            if (icon && !icon.isEmpty()) {
                                iconImage = icon;
                                break; // Success!
                            }
                        } catch (e) { }
                    }

                    // If still no icon, try the very last resort: the fullPath itself as a file icon
                    if (!iconImage) {
                        try {
                            const icon = await app.getFileIcon(fullPath, { size: 'large' });
                            if (icon && !icon.isEmpty()) {
                                iconImage = icon;
                            }
                        } catch (e) { }
                    }

                    // 如果没有获取到图标，使用默认图标
                    if (!iconImage) {
                        try {
                            // 创建一个简单的默认图标（白色方块带边框�?
                            const { createCanvas } = await import('canvas');
                            const canvas = createCanvas(64, 64);
                            const ctx = canvas.getContext('2d');

                            // 绘制背景
                            ctx.fillStyle = '#6B7280';
                            ctx.fillRect(0, 0, 64, 64);

                            // 绘制边框
                            ctx.strokeStyle = '#9CA3AF';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(2, 2, 60, 60);

                            // 绘制文字
                            ctx.fillStyle = 'white';
                            ctx.font = 'bold 24px Arial';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            const initial = path.basename(file, ext).charAt(0).toUpperCase();
                            ctx.fillText(initial, 32, 32);

                            const buffer = canvas.toBuffer('image/png');
                            iconImage = nativeImage.createFromBuffer(buffer);
                        } catch (canvasErr) {
                            // 如果 canvas 不可用，使用系统默认图标
                            try {
                                iconImage = await app.getFileIcon(fullPath, { size: 'large' });
                            } catch (e) {
                                console.warn(`⚠️ 无法获取图标: ${file}`);
                            }
                        }
                    }

                    // Save icon to disk to allow user inspection and better caching
                    // Store in 'icons' folder within the project root (software folder)
                    const iconsDir = path.join(app.getPath('userData'), 'icons');
                    if (!fs.existsSync(iconsDir)) {
                        fs.mkdirSync(iconsDir, { recursive: true });
                    }

                    // Generate consistent filename based on app path
                    const hash = crypto.createHash('md5').update(fullPath).digest('hex');
                    const iconFilename = `${hash}.png`;
                    const iconPath = path.join(iconsDir, iconFilename);

                    let iconUrl = null;

                    // 检查缓存是否存在且有效
                    try {
                        if (fs.existsSync(iconPath)) {
                            const stats = await fs.promises.stat(iconPath);
                            const fileStats = await fs.promises.stat(fullPath);
                            // 如果图标缓存比文件新，则使用缓存
                            if (stats.mtime > fileStats.mtime) {
                                const cachedBuffer = await fs.promises.readFile(iconPath);
                                iconUrl = `data:image/png;base64,${cachedBuffer.toString('base64')}`;
                                console.log(`📦 使用缓存图标: ${file}`);
                            }
                        }
                    } catch (cacheErr) {
                        console.warn(`⚠️ 缓存检查失�? ${file}`, cacheErr);
                    }

                    // 如果没有缓存或缓存无效，生成新图�?
                    if (!iconUrl && iconImage) {
                        try {
                            const pngData = iconImage.toPNG();
                            // 异步保存到磁盘（不阻塞）
                            fs.promises.writeFile(iconPath, pngData).catch(err => {
                                console.warn(`⚠️ 保存图标缓存失败: ${file}`, err);
                            });

                            // 返回 Base64 数据
                            const base64Data = pngData.toString('base64');
                            iconUrl = `data:image/png;base64,${base64Data}`;
                            console.log(`�?生成新图�? ${file}`);
                        } catch (err) {
                            console.error(`�?处理图标失败: ${file}`, err);
                        }
                    }

                    // 如果仍然没有图标，使用占位符
                    if (!iconUrl) {
                        iconUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiM2QjcyODAiLz4KPHN2ZyB4PSIyMCIgeT0iMjAiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPgo8cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+Cjwvc3ZnPgo8L3N2Zz4=';
                    }

                    // Previously used protocol URL (commented out)
                    // const iconUrl = `local-icon:///${iconPath.replace(/\\/g, '/')}`;

                    apps.push({
                        name: path.basename(file, ext),
                        path: fullPath,
                        icon: iconUrl,
                        type: type,
                        category: category
                    });

                } catch (err) {
                    console.error(`Error processing ${file}:`, err);
                }
            }
            return apps;
        } catch (error) {
            console.error('Failed to scan desktop:', error);
            return [];
        }
    });

    ipcMain.handle('open-app', async (event, path) => {
        try {
            await shell.openPath(path);
            return true;
        } catch (error) {
            console.error('Failed to open app:', error);
            return false;
        }
    });

    ipcMain.handle('open-as-admin', async (event, itemPath) => {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Use PowerShell to run as administrator
            await execAsync(`powershell -Command "Start-Process \\"${itemPath}\\" -Verb RunAs"`);
            return true;
        } catch (error) {
            console.error('Failed to open as admin:', error);
            return false;
        }
    });

    ipcMain.handle('delete-item', async (event, itemPath) => {
        try {
            console.log('🗑️ Deleting item:', itemPath);

            // 调用后端删除API，利用事务处理
            const deleteResult = await sendBackendRequest('deleteItem', { path: itemPath });

            console.log('📥 Delete result:', deleteResult);

            if (deleteResult && (deleteResult.success || deleteResult.data?.success)) {
                console.log('✅ Delete successful:', itemPath);
                return true;
            } else {
                console.error('❌ Delete failed:', deleteResult?.error || deleteResult?.data?.error || 'Unknown error');
                throw new Error(deleteResult?.error || deleteResult?.data?.error || '删除失败');
            }
        } catch (error) {
            console.error('�?Failed to delete item:', error);
            throw error;
        }
    });

    ipcMain.handle('open-location', async (event, itemPath) => {
        try {
            await shell.showItemInFolder(itemPath);
            return true;
        } catch (error) {
            console.error('Failed to open location:', error);
            return false;
        }
    });

    ipcMain.handle('show-properties', async (event, itemPath) => {
        try {
            const stats = await fs.promises.stat(itemPath);
            const ext = path.extname(itemPath).toLowerCase();

            return {
                name: path.basename(itemPath),
                path: itemPath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isDirectory: stats.isDirectory(),
                extension: ext
            };
        } catch (error) {
            console.error('Failed to get properties:', error);
            return null;
        }
    });

    // 文件选择对话框（并复制到应用内部�?
    ipcMain.handle('select-file', async (event, options) => {
        try {
            console.log('📁 Opening file dialog with options:', options);

            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: options?.filters || [],
                title: options?.title || 'Select File'
            });

            if (result.canceled || result.filePaths.length === 0) {
                console.log('�?File selection canceled');
                return null;
            }

            const selectedFile = result.filePaths[0];
            console.log('�?File selected:', selectedFile);

            // 如果是壁纸选择，复制到应用内部目录
            if (options?.copyToApp) {
                console.log('📦 Copying file to app directory...');

                // 创建wallpapers目录
                const wallpapersDir = path.join(app.getPath('userData'), 'wallpapers');
                console.log('📂 Wallpapers directory:', wallpapersDir);

                if (!fs.existsSync(wallpapersDir)) {
                    console.log('⚠️  Directory does not exist, creating...');
                    fs.mkdirSync(wallpapersDir, { recursive: true });
                    console.log('�?Directory created');
                } else {
                    console.log('�?Directory already exists');
                }

                // 生成新文件名（时间戳 + 原始文件名）
                const timestamp = Date.now();
                const originalName = path.basename(selectedFile);
                const newFileName = `${timestamp}_${originalName}`;
                const destPath = path.join(wallpapersDir, newFileName);
                console.log('💾 Destination path:', destPath);

                // 复制文件
                console.log('🔄 Copying file...');
                await fs.promises.copyFile(selectedFile, destPath);
                console.log('�?File copied successfully!');

                return destPath;
            }

            return selectedFile;
        } catch (error) {
            console.error('�?Failed to select file:', error);
            return null;
        }
    });

    // 读取图片为base64
    ipcMain.handle('read-image-as-base64', async (event, filePath) => {
        try {
            const imageBuffer = await fs.promises.readFile(filePath);
            const base64 = imageBuffer.toString('base64');
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            return `data:image/${mimeType};base64,${base64}`;
        } catch (error) {
            console.error('Failed to read image:', error);
            return null;
        }
    });

    // 获取壁纸历史记录
    ipcMain.handle('get-wallpaper-history', async () => {
        try {
            const wallpapersDir = path.join(app.getPath('userData'), 'wallpapers');
            if (!fs.existsSync(wallpapersDir)) {
                return [];
            }

            const files = await fs.promises.readdir(wallpapersDir);
            const imageFiles = files
                .filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
                .map(file => ({
                    name: file,
                    path: path.join(wallpapersDir, file),
                    timestamp: parseInt(file.split('_')[0]) || 0
                }))
                .sort((a, b) => b.timestamp - a.timestamp); // 按时间降�?

            return imageFiles;
        } catch (error) {
            console.error('Failed to get wallpaper history:', error);
            return [];
        }
    });

    // 清理图标缓存
    ipcMain.handle('clear-icon-cache', async () => {
        try {
            const iconsDir = path.join(app.getPath('userData'), 'icons');
            if (!fs.existsSync(iconsDir)) {
                return { success: true, message: '缓存目录不存在' };
            }

            const files = await fs.promises.readdir(iconsDir);
            let deletedCount = 0;

            for (const file of files) {
                if (file.endsWith('.png')) {
                    await fs.promises.unlink(path.join(iconsDir, file));
                    deletedCount++;
                }
            }

            console.log(`🗑�?清理图标缓存: ${deletedCount} 个文件`);
            return { success: true, deletedCount, message: `已清�?${deletedCount} 个图标缓存` };
        } catch (error) {
            console.error('清理图标缓存失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 获取图标缓存信息
    ipcMain.handle('get-icon-cache-info', async () => {
        try {
            const iconsDir = path.join(app.getPath('userData'), 'icons');
            if (!fs.existsSync(iconsDir)) {
                return { count: 0, size: 0 };
            }

            const files = await fs.promises.readdir(iconsDir);
            let totalSize = 0;

            for (const file of files) {
                if (file.endsWith('.png')) {
                    const stats = await fs.promises.stat(path.join(iconsDir, file));
                    totalSize += stats.size;
                }
            }

            return {
                count: files.filter(f => f.endsWith('.png')).length,
                size: totalSize,
                sizeFormatted: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
            };
        } catch (error) {
            console.error('获取图标缓存信息失败:', error);
            return { count: 0, size: 0, error: error.message };
        }
    });

    // 保存Dock栏信息到后端数据库
    ipcMain.handle('save-dock-items', async (event, dockItems) => {
        try {
            console.log('📦 Saving dock items to database:', dockItems);

            // 调用后端API保存dock items到数据库
            const result = await sendBackendRequest('saveDockItems', {
                dockItems: dockItems.map(item => ({
                    path: item.path,
                    name: item.name,
                    id: item.id
                }))
            });

            if (result && result.success) {
                console.log('✅ Dock items saved to database successfully');
                return { success: true };
            } else {
                console.error('❌ Failed to save dock items:', result?.error);
                return { success: false, error: result?.error || 'Unknown error' };
            }
        } catch (error) {
            console.error('❌ Failed to save dock items:', error);
            return { success: false, error: error.message };
        }
    });

    // 读取后端生成的JSON文件获取桌面图标
    // 从后端数据库获取桌面图标
    ipcMain.handle('get-desktop-icons', async () => {
        try {
            console.log('📦 Fetching desktop icons from backend database...');
            const desktopInfo = await sendBackendRequest('getDesktopInfo');

            if (!desktopInfo || !desktopInfo.success) {
                console.error('❌ Backend error:', desktopInfo?.error);
                return { icons: [], dockItems: [] };
            }

            // 访问嵌套在data字段中的实际数据
            const actualData = desktopInfo.data || desktopInfo;

            const allItems = [
                ...(actualData.SystemDesktop || []),
                ...(actualData.UserDesktop || []),
                ...(actualData.PastedFiles || [])
            ];

            const icons = [];
            const dockItems = [];

            // 处理所有项目
            for (const item of allItems) {
                let iconPath = item.IconPath || item.iconPath;
                let iconUrl = null;

                if (iconPath && fs.existsSync(iconPath)) {
                    try {
                        const iconBuffer = await fs.promises.readFile(iconPath);
                        iconUrl = `data:image/png;base64,${iconBuffer.toString('base64')}`;
                    } catch (err) { }
                }

                if (!iconUrl) {
                    iconUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiM2QjcyODAiLz4KPHN2ZyB4PSIyMCIgeT0iMjAiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPgo8cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+Cjwvc3ZnPgo8L3N2Zz4=';
                }

                const isDir = item.IsDirectory || item.isDirectory;
                const itemPath = item.Path || item.path;
                const ext = (item.Extension || item.extension || '').toLowerCase();

                const projectItem = {
                    id: item.Id || item.id || itemPath,
                    name: item.Name || item.name,
                    path: itemPath,
                    icon: iconUrl,
                    type: isDir ? 'folder' : 'file',
                    category: isDir ? 'file' : (ext === '.lnk' ? 'software' : 'file'),
                    isPinned: item.IsPinned || item.isPinned || false
                };

                icons.push(projectItem);
            }

            // 使用后端返回的 DockItems 数组（优先）
            const backendDockItems = actualData.DockItems || [];
            if (backendDockItems.length > 0) {
                console.log(`📦 Loading ${backendDockItems.length} dock items from backend`);
                for (const item of backendDockItems) {
                    const itemPath = item.Path || item.path;
                    if (itemPath && fs.existsSync(itemPath)) {
                        // 查找对应的 projectItem
                        const projectItem = icons.find(i => i.path === itemPath);
                        if (projectItem) {
                            dockItems.push(projectItem);
                        }
                    }
                }
            }

            console.log(`✅ Loaded ${icons.length} icons, ${dockItems.length} dock items from database`);
            return { icons, dockItems };
        } catch (error) {
            console.error('❌ Failed to fetch:', error);
            return { icons: [], dockItems: [] };
        }
    });
    // 文件夹选择对话�?
    ipcMain.handle('select-directory', async (event, options) => {
        try {
            console.log('📁 Opening directory dialog with options:', options);

            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: options?.title || 'Select Directory'
            });

            if (result.canceled || result.filePaths.length === 0) {
                console.log('�?Directory selection canceled');
                return null;
            }

            const selectedDir = result.filePaths[0];
            console.log('�?Directory selected:', selectedDir);

            return selectedDir;
        } catch (error) {
            console.error('�?Failed to select directory:', error);
            return null;
        }
    });

    // 读取剪贴板中的文件路径
    ipcMain.handle('read-clipboard-files', async () => {
        try {
            const { clipboard } = require('electron');
            const files = [];

            // 方式1：使用 readBuffer 读取 FileNameW（UTF-16 LE 编码）
            const fileNameWBuffer = clipboard.readBuffer('FileNameW');
            if (fileNameWBuffer && fileNameWBuffer.length > 0) {
                // 解码 UTF-16 LE 并移除末尾的 null 字符
                const rawText = fileNameWBuffer.toString('utf16le').replace(/\0+$/, '');
                console.log('📋 FileNameW (UTF-16 LE decoded):', rawText);

                if (rawText && rawText.match(/^[a-zA-Z]:[\\\/]/)) {
                    files.push(rawText);
                    console.log('📋 Parsed clipboard files:', files);
                    return files;
                }
            }

            // 方式2：尝试 text/uri-list 格式
            const uriList = clipboard.read('text/uri-list');
            if (uriList) {
                console.log('📋 URI list:', uriList);
                const lines = uriList.split('\n').filter(f => f.trim());
                for (const line of lines) {
                    let trimmed = line.trim();
                    if (trimmed.startsWith('file://')) {
                        try {
                            const filePath = decodeURIComponent(trimmed.replace('file://', '').replace(/^\//, ''));
                            files.push(filePath);
                        } catch (e) {
                            console.warn('⚠️ Failed to decode URI:', trimmed);
                        }
                    }
                }
                if (files.length > 0) {
                    console.log('📋 Parsed clipboard files:', files);
                    return files;
                }
            }

            // 方式3：尝试纯文本
            const plainText = clipboard.readText();
            if (plainText && plainText.match(/^[a-zA-Z]:[\\\/]/)) {
                console.log('📋 Plain text path:', plainText);
                files.push(plainText.trim());
            }

            console.log('📋 Parsed clipboard files:', files);
            return files;
        } catch (error) {
            console.error('❌ Failed to read clipboard files:', error);
            return [];
        }
    });

    // 智能粘贴功能 - 转发到后端处理
    ipcMain.handle('smart-paste', async (event, { storagePath, clipboardData }) => {
        try {
            logToFile(`📋 Smart paste triggered, forwarding to backend: ${typeof clipboardData}`);

            // 直接发送到后端处理
            const result = await sendBackendRequest('smartPaste', { clipboardData });

            logToFile(`📥 Backend paste result: ${JSON.stringify(result)}`);

            if (result && (result.success || result.data?.success)) {
                // 粘贴成功后重新扫描更新数据库
                logToFile('🔄 Triggering rescan to update database...');
                try {
                    await sendBackendRequest('rescan');
                    logToFile('✅ Rescan completed successfully');
                } catch (error) {
                    logToFile(`❌ Rescan failed: ${error.message}`, 'ERROR');
                }

                return result.data || result;
            } else {
                throw new Error(result?.error || result?.data?.error || '粘贴失败');
            }

        } catch (error) {
            logToFile(`❌ Smart paste failed: ${error.message}`, 'ERROR');

            // 关键错误弹窗：确保用户看到后端通信失败或超时
            if (error.message.includes('timeout') || error.message.includes('connect')) {
                dialog.showErrorBox('智能粘贴失败', `无法连接到后端服务：${error.message}\n请检查 backend.exe 是否正在运行，或查看日志文件。`);
            }

            return { success: false, error: error.message };
        }
    });

    // 智能粘贴功能（备份，已移至后端）
    ipcMain.handle('smart-paste-backup', async (event, { storagePath, clipboardData }) => {
        try {
            // 使用统一的 AppData 粘贴文件夹路径
            const pastedFilesPath = path.join(app.getPath('userData'), 'pasted_files');
            console.log('📋 Smart paste triggered with storage path:', pastedFilesPath);
            console.log('📋 Clipboard data type:', typeof clipboardData);

            // 检查存储路径是否存�?
            if (!fs.existsSync(pastedFilesPath)) {
                console.log('📁 Creating pasted files directory:', pastedFilesPath);
                fs.mkdirSync(pastedFilesPath, { recursive: true });
            }

            // 创建YYYY/MM文件夹结�?
            const now = new Date();
            const year = now.getFullYear().toString();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const yearMonthPath = path.join(pastedFilesPath, year, month);

            console.log('📁 Creating directory structure:', yearMonthPath);

            // 递归创建目录
            fs.mkdirSync(yearMonthPath, { recursive: true });

            // 根据剪贴板内容类型执行相应操�?
            let result = null;

            if (typeof clipboardData === 'string') {
                // 文本内容
                console.log('📄 Handling text content');

                // 生成文件名：使用第一个符号（包括回车）之前的文字，或�?0个字�?
                const timestamp = Date.now();
                let baseName = '';

                // 提取�?0个字�?
                const previewText = clipboardData.substring(0, 20);
                console.log('📄 Text preview:', previewText);

                // 查找第一个符号（包括回车、空格等�?
                const firstSymbolIndex = previewText.search(/[\r\n\s,.;:?!"'()\[\]{}<>|\\/]/);
                console.log('📄 First symbol index:', firstSymbolIndex);

                if (firstSymbolIndex > 0) {
                    // 使用第一个符号之前的内容作为文件�?
                    baseName = previewText.substring(0, firstSymbolIndex).trim();
                    console.log('📄 Using text before first symbol:', baseName);
                } else {
                    // �?0个字符内没有符号，使用前20个字�?
                    baseName = previewText.trim();
                    console.log('📄 Using first 20 characters:', baseName);
                }

                // 清理文件名中的无效字�?
                const sanitizedBaseName = baseName.replace(/[<>"/\\|?*]/g, '_').replace(/\s+/g, ' ');
                console.log('📄 Sanitized base name:', sanitizedBaseName);

                // 如果清理后为空，使用默认名称
                const finalBaseName = sanitizedBaseName || 'clipboard';

                // 生成最终文件名：清理后的名�?+ 时间�?+ .txt
                const fileName = `${finalBaseName}_${timestamp}.txt`;
                const filePath = path.join(yearMonthPath, fileName);
                console.log('📄 Final file name:', fileName);

                // 检查文件是否已存在，处理冲�?
                const finalFilePath = getUniqueFilePath(filePath);

                // 写入文件
                await fs.promises.writeFile(finalFilePath, clipboardData, 'utf8');
                result = { success: true, filePath: finalFilePath, type: 'text' };

            } else if (clipboardData && typeof clipboardData === 'object' && clipboardData.type === 'image') {
                // 图像内容
                console.log('🖼�?Handling image content');

                // 生成文件名：时间�?
                const timestamp = Date.now();
                const fileName = `${timestamp}.png`;
                const filePath = path.join(yearMonthPath, fileName);

                // 检查文件是否已存在，处理冲�?
                const finalFilePath = getUniqueFilePath(filePath);

                // 写入图像文件
                if (clipboardData.data) {
                    const base64Data = clipboardData.data.replace(/^data:image\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    await fs.promises.writeFile(finalFilePath, buffer);
                    result = { success: true, filePath: finalFilePath, type: 'image' };
                } else {
                    throw new Error('图像数据无效');
                }

            } else if (clipboardData && typeof clipboardData === 'object' && clipboardData.type === 'video') {
                // 视频内容
                console.log('🎬 Handling video content');

                // 生成文件名：时间�?
                const timestamp = Date.now();
                const fileName = `${timestamp}.mp4`;
                const filePath = path.join(yearMonthPath, fileName);

                // 检查文件是否已存在，处理冲�?
                const finalFilePath = getUniqueFilePath(filePath);

                // 写入视频文件
                if (clipboardData.data) {
                    const base64Data = clipboardData.data.replace(/^data:video\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    await fs.promises.writeFile(finalFilePath, buffer);
                    result = { success: true, filePath: finalFilePath, type: 'video' };
                } else {
                    throw new Error('视频数据无效');
                }

            } else if (clipboardData && typeof clipboardData === 'object' && clipboardData.type === 'file') {
                // 文件引用
                console.log('📁 Handling file reference');

                if (!clipboardData.path) {
                    throw new Error('文件路径无效');
                }

                // 检查源文件是否存在
                if (!fs.existsSync(clipboardData.path)) {
                    throw new Error('源文件不存在');
                }

                // 获取文件�?
                const fileName = path.basename(clipboardData.path);
                const filePath = path.join(yearMonthPath, fileName);

                // 检查文件是否已存在，处理冲�?
                const finalFilePath = getUniqueFilePath(filePath);

                // 复制文件
                await fs.promises.copyFile(clipboardData.path, finalFilePath);
                result = { success: true, filePath: finalFilePath, type: 'file' };

            } else {
                throw new Error('不支持的剪贴板内容类型');
            }

            // 粘贴成功后更新JSON文件
            if (result && result.success) {
                console.log('📋 Updating JSON file with new pasted file...');
                await updateDesktopInfoJson();

                // 添加：重新扫描粘贴文件夹并更新数据库
                console.log('🔄 Triggering rescan to update database...');
                try {
                    await sendBackendRequest('rescan');
                    console.log('✅ Rescan completed successfully');
                } catch (error) {
                    console.error('❌ Rescan failed:', error);
                }
            }

            console.log('�?Smart paste completed successfully:', result);
            return result;

        } catch (error) {
            console.error('�?Smart paste failed:', error);
            return { success: false, error: error.message };
        }
    });

    // 更新desktop_info.json文件，包含粘贴文件夹中的所有文�?
    async function updateDesktopInfoJson() {
        try {
            const userDataPath = app.getPath('userData');
            const dataDir = path.join(userDataPath, 'data');

            // 确保 data 目录存在
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const jsonFilePath = path.join(dataDir, 'desktop_info.json');
            const pastedFilesPath = path.join(userDataPath, 'pasted_files');

            // 如果JSON文件存在，读取现有数�?
            let desktopInfo = {
                SystemDesktop: [],
                UserDesktop: [],
                PastedFiles: [],
                Timestamp: new Date().toISOString(),
                IconsDirectory: path.join(dataDir, 'icons'),
                ThumbnailsDirectory: path.join(dataDir, 'thumbnails'),
                PastedFilesPath: pastedFilesPath
            };

            if (fs.existsSync(jsonFilePath)) {
                try {
                    const jsonContent = await fs.promises.readFile(jsonFilePath, 'utf8');
                    const existingData = JSON.parse(jsonContent);
                    desktopInfo.SystemDesktop = existingData.SystemDesktop || [];
                    desktopInfo.UserDesktop = existingData.UserDesktop || [];
                } catch (err) {
                    console.warn('⚠️ Failed to read existing JSON file:', err.message);
                }
            }

            // 扫描粘贴文件夹中的所有文�?
            if (fs.existsSync(pastedFilesPath)) {
                const pastedItems = await collectPastedFiles(pastedFilesPath);
                desktopInfo.PastedFiles = pastedItems;
                console.log(`�?Found ${pastedItems.length} pasted files`);
            }

            // 写回JSON文件
            const jsonString = JSON.stringify(desktopInfo, null, 2);
            await fs.promises.writeFile(jsonFilePath, jsonString);
            console.log('�?JSON file updated successfully');
        } catch (error) {
            console.error('�?Failed to update JSON file:', error);
        }
    }

    // 收集粘贴文件夹中的所有文�?
    async function collectPastedFiles(rootPath) {
        const items = [];

        async function scanDirectory(currentPath) {
            try {
                const files = await fs.promises.readdir(currentPath);

                for (const file of files) {
                    const fullPath = path.join(currentPath, file);
                    const stats = await fs.promises.stat(fullPath);

                    if (stats.isDirectory()) {
                        // 递归扫描子文件夹
                        await scanDirectory(fullPath);
                    } else {
                        // 添加文件到列�?
                        const ext = path.extname(file).toLowerCase();
                        items.push({
                            Name: file,
                            Path: fullPath,
                            IsDirectory: false,
                            Extension: ext,
                            LastModified: stats.mtime
                        });
                    }
                }
            } catch (error) {
                console.error(`�?Error scanning directory ${currentPath}:`, error);
            }
        }

        await scanDirectory(rootPath);
        return items;
    }

    // 手动刷新桌面信息
    ipcMain.handle('refresh-desktop', async () => {
        try {
            console.log('🔄 Manual refresh triggered');
            await updateDesktopInfoJson();
            return { success: true };
        } catch (error) {
            console.error('�?Failed to refresh desktop:', error);
            return { success: false, error: error.message };
        }
    });

    // 辅助函数：获取唯一的文件路径（处理文件冲突�?
    function getUniqueFilePath(filePath) {
        if (!fs.existsSync(filePath)) {
            return filePath;
        }

        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);

        let counter = 1;
        let newFilePath;

        do {
            newFilePath = path.join(dir, `${baseName}_${counter}${ext}`);
            counter++;
        } while (fs.existsSync(newFilePath));

        return newFilePath;
    }

    // Backend API - 注册 Dock 应用
    ipcMain.handle('register-dock-apps', async (event, paths) => {
        try {
            const result = await sendBackendRequest('registerDockApps', { paths });
            return result;
        } catch (error) {
            console.error('�?Failed to register dock apps:', error);
            console.error('?Failed to register dock apps:', error);
            throw error;
        }
    });

    // Backend API - 获取指示器状?
    ipcMain.handle('get-indicator-state', async (event, iconId) => {
        console.log('[Main] Get indicator state for icon:', iconId);
        // TODO: Implement actual logic for getting running app indicators
        return false; // Returns true if app is running
    });

    // Toggle pin state (置顶/取消置顶)
    ipcMain.handle('toggle-pin', async (event, itemId, isPinned) => {
        try {
            console.log(`[Main] Toggle pin: itemId=${itemId}, isPinned=${isPinned}`);
            const result = await sendBackendRequest('toggle_pin', {
                itemId: itemId,
                isPinned: isPinned
            });
            return result;
        } catch (error) {
            console.error('[Main] Toggle pin failed:', error);
            throw error;
        }
    });


    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 应用程序退出前清理
app.on('will-quit', () => {
    stopBackend();
});

