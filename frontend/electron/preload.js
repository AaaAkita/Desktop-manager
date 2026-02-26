const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanDesktop: () => ipcRenderer.invoke('scan-desktop'),
    openApp: (path) => ipcRenderer.invoke('open-app', path),
    openAsAdmin: (path) => ipcRenderer.invoke('open-as-admin', path),
    deleteItem: (path) => ipcRenderer.invoke('delete-item', path),
    openLocation: (path) => ipcRenderer.invoke('open-location', path),
    showProperties: (path) => ipcRenderer.invoke('show-properties', path),
    selectFile: (options) => ipcRenderer.invoke('select-file', options),
    selectDirectory: (options) => ipcRenderer.invoke('select-directory', options),
    readImageAsBase64: (path) => ipcRenderer.invoke('read-image-as-base64', path),
    getWallpaperHistory: () => ipcRenderer.invoke('get-wallpaper-history'),
    clearIconCache: () => ipcRenderer.invoke('clear-icon-cache'),
    getIconCacheInfo: () => ipcRenderer.invoke('get-icon-cache-info'),
    smartPaste: (data) => ipcRenderer.invoke('smart-paste', data),
    readClipboardFiles: () => ipcRenderer.invoke('read-clipboard-files'),
    refreshDesktop: () => ipcRenderer.invoke('refresh-desktop'),
    // Backend API
    getDesktopIcons: () => ipcRenderer.invoke('get-desktop-icons'),
    saveDockItems: (items) => ipcRenderer.invoke('save-dock-items', items),
    registerDockApps: (paths) => ipcRenderer.invoke('register-dock-apps', paths),
    getIndicatorState: (iconId) => ipcRenderer.invoke('get-indicator-state', iconId),
    togglePin: (itemId, isPinned) => ipcRenderer.invoke('toggle-pin', itemId, isPinned)
});
