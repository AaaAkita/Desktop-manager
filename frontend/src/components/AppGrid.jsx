import React, { useState, useEffect, useRef } from 'react';
import {
    FileText,
    Image,
    Video,
    Code,
    Terminal,
    Cpu,
    HardDrive,
    Wifi,
    Settings,
    Folder,
    AppWindow
} from 'lucide-react';

import { getFileTypeIcon, getFileTypeColor } from '../utils/fileIcons';
import './AppGrid.css';



const ITEMS_PER_PAGE = 32;

const AppGrid = ({ viewMode, searchQuery = '', settings = {}, fontColor = '#ffffff', onAppOpen, onReload, reloadKey, onShowProperties, onContextMenu }) => {
    const [realApps, setRealApps] = useState([]);
    const [previousApps, setPreviousApps] = useState([]);
    const [currentPage, setCurrentPage] = useState(0);
    const [savedPage, setSavedPage] = useState(0);
    const [newAppIds, setNewAppIds] = useState(new Set());
    const reloadCountRef = useRef(0); // 使用useRef来跟踪重新加载次数
    const failedImagesRef = useRef(new Set()); // 跟踪已记录错误的图片,避免重复日志

    // 渲染文件项，根据设置显示图标或缩略图
    const renderFileItem = (item) => {
        const { path } = item;
        const extension = path ? path.toLowerCase().match(/\.[^.]+$/)?.[0] : '';
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(extension);
        const isVideo = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(extension);

        // 检查是否应该显示缩略图
        const shouldShowThumbnail = (isImage && settings.imageDisplay === 'thumbnail') ||
            (isVideo && settings.videoDisplay === 'thumbnail');

        // console.log(`[AppGrid] Rendering ${item.name} (${extension}), settings.imageDisplay: ${settings.imageDisplay}, shouldShowThumbnail: ${shouldShowThumbnail}`);

        if (shouldShowThumbnail) {
            // Use local-icon protocol if path is absolute but doesn't have protocol
            let src = path;
            if (path && (path.match(/^[a-zA-Z]:\\/) || path.startsWith('/'))) {
                // Replace backslashes with forward slashes and encode special characters
                // but keep the driver colon if present
                const normalizedPath = path.replace(/\\/g, '/');
                // We use encodeURI to preserve standard URL characters like / and : but encode spaces and Chinese characters
                src = `local-icon://${encodeURI(normalizedPath)}`;
            }

            // 尝试加载缩略图
            return (
                <img
                    src={src}
                    alt={item.name}
                    onError={(e) => {
                        // 防止重复记录同一图片的错误(React重复渲染会导致日志洪水)
                        if (!failedImagesRef.current.has(src)) {
                            failedImagesRef.current.add(src);
                            // 缩略图加载失败时显示默认图标
                            console.warn(`⚠️ 缩略图加载失败: ${item.name}`, JSON.stringify({ path: item.path, src: src }, null, 2));
                        }
                        e.target.src = `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjM2IiBoZWlnaHQ9IjM2IiByeD0iMiIgZmlsbD0iI2ZmZiIvPjx0ZXh0IHg9IjE4IiB5PSIyMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE4IiBmaWxsPSIjODg4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCIgZm9udC1zaXplPSIxOCI+4oSi4oSiPC90ZXh0Pgo8L3N2Zz4=`;
                    }}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: settings.thumbnailStyle?.fillMode || 'cover',
                        borderRadius: `${settings.thumbnailStyle?.borderRadius || 12}px`,
                        border: settings.thumbnailStyle?.showBorder ? '2px solid white' : 'none',
                        boxShadow: settings.thumbnailStyle?.showBorder ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
                    }}
                />
            );
        } else {
            // 显示图标
            return getFileTypeIcon(item, getFileTypeColor(item));
        }
    };



    // 加载图标函数（可在组件内任何地方调用）
    const loadIcons = async () => {
        try {
            // 增加重新加载计数
            reloadCountRef.current += 1;
            const currentReloadCount = reloadCountRef.current;

            console.log('🔍 Loading icons, reload count:', currentReloadCount);
            console.log('🔍 Checking if electronAPI is available:', !!window.electronAPI);
            console.log('🔍 Checking if getDesktopIcons is available:', typeof window.electronAPI?.getDesktopIcons === 'function');

            const backendData = await window.electronAPI?.getDesktopIcons();

            // 检查是否是过时的请求
            if (currentReloadCount !== reloadCountRef.current) {
                console.log('⚠️ Skipping outdated reload request');
                return;
            }

            console.log(`✅ Loaded data from backend: ${backendData?.icons?.length || 0} icons, ${backendData?.dockItems?.length || 0} dock items`);
            console.log('📋 Backend data:', backendData);

            if (backendData && backendData.icons) {
                // 转换后端图标数据为前端期望的格式
                const newIcons = (backendData.icons || []).map(item => ({
                    id: item.id || item.name,
                    name: item.name,
                    path: item.path,
                    icon: item.icon,
                    type: item.type,
                    category: item.category,
                    isPinned: item.isPinned,
                    sortOrder: item.sortOrder,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                }));

                // console.log('🔄 Converted icons:', JSON.stringify(newIcons));

                // 检测新增的文件
                const oldIds = new Set(previousApps.map(app => app.id));
                const newlyAddedIds = newIcons
                    .filter(app => !oldIds.has(app.id))
                    .map(app => app.id);

                if (newlyAddedIds.length > 0) {
                    console.log(`🎉 Found ${newlyAddedIds.length} new apps:`, newlyAddedIds);
                    setNewAppIds(new Set(newlyAddedIds));
                    // 3秒后清除新文件标记
                    setTimeout(() => {
                        setNewAppIds(prev => {
                            const newSet = new Set(prev);
                            newlyAddedIds.forEach(id => newSet.delete(id));
                            return newSet;
                        });
                    }, 3000);
                }

                // 保存当前状态
                setPreviousApps(realApps);

                // 排序: 置顶项在前 (isPinned DESC), 然后按名称排序 (name ASC)
                const sortedIcons = newIcons.sort((a, b) => {
                    // 先按isPinned降序 (true在前)
                    if (a.isPinned !== b.isPinned) {
                        return b.isPinned ? 1 : -1;
                    }
                    // 然后按名称升序
                    return a.name.localeCompare(b.name, 'zh-CN');
                });

                // 设置新数据
                setRealApps(sortedIcons);

                // 恢复保存的页面状态（只在首次加载时）
                if (currentReloadCount === 1) {
                    const maxPage = Math.ceil(newIcons.length / ITEMS_PER_PAGE) - 1;
                    if (savedPage <= maxPage) {
                        setCurrentPage(savedPage);
                    }
                }
            } else if (Array.isArray(backendData)) {
                // 向后兼容：如果返回的是数组，则直接使用
                console.log('🔄 Using array format (backward compatibility):', backendData);
                setRealApps(backendData);
            }
        } catch (error) {
            console.error('❌ Failed to load icons from backend:', error);
            console.error('📋 Error details:', error.stack);
        }
    };

    // 保存当前页面状态
    useEffect(() => {
        setSavedPage(currentPage);
    }, [currentPage]);

    // 初始化加载图标
    useEffect(() => {
        loadIcons();
    }, [onReload, reloadKey]);

    useEffect(() => {
        setCurrentPage(0);
    }, [viewMode, searchQuery]);

    const handleAppClick = (item) => {
        if (onAppOpen) {
            onAppOpen(item);
        } else if (window.electronAPI && item.path) {
            window.electronAPI.openApp(item.path);
        }
    };



    const handleContextMenu = (e, item) => {
        // 调用父组件传入的 context menu 处理函数
        if (onContextMenu) {
            onContextMenu(e, item);
        }
    };



    // 文件类型排序优先级
    const typeOrder = {
        'folder': 0,
        'doc': 1, 'docx': 1, 'pdf': 1,
        'jpg': 2, 'jpeg': 2, 'png': 2, 'gif': 2, 'bmp': 2, 'webp': 2, 'svg': 2, 'ico': 2,
        'mp4': 3, 'avi': 3, 'mov': 3, 'mkv': 3, 'wmv': 3, 'flv': 3, 'webm': 3,
        'zip': 4, 'rar': 4, '7z': 4, 'tar': 4, 'gz': 4,
    };

    const getTypeWeight = (item) => {
        if (item.type === 'folder') return 0;
        const ext = item.path?.toLowerCase().match(/\.([^.]+)$/)?.[1];
        return typeOrder[ext] !== undefined ? typeOrder[ext] : 99;
    };

    const allItems = realApps.filter(item => {
        const categoryMatch = viewMode === 'apps'
            ? item.category === 'software'
            : item.category === 'file';

        if (!categoryMatch) return false;

        if (searchQuery && searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            const name = item.name?.toLowerCase() || '';
            return name.includes(query);
        }

        return true;
    });

    const sortedItems = [...allItems].sort((a, b) => {
        // 1. 置顶优先
        if (a.isPinned !== b.isPinned) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);

        // 2. 根据视图模式应用不同的排序逻辑
        if (viewMode === 'files') {
            // 文件模式：按类型排序，然后按名称排序
            const weightA = getTypeWeight(a);
            const weightB = getTypeWeight(b);
            if (weightA !== weightB) return weightA - weightB;
            return (a.name || '').localeCompare(b.name || '');
        } else {
            // 应用模式：按名称排序 (默认行为)
            return (a.name || '').localeCompare(b.name || '');
        }
    });

    const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE) || 1;
    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        pages.push(sortedItems.slice(i * ITEMS_PER_PAGE, (i + 1) * ITEMS_PER_PAGE));
    }

    // Drag to Switch Page Logic
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [currentTranslate, setCurrentTranslate] = useState(0);
    const containerRef = useRef(null);

    const handleDragStart = (e) => {
        setIsDragging(true);
        setStartX(e.clientX || e.touches[0].clientX);
        setCurrentTranslate(0);
    };

    const handleDragMove = (e) => {
        if (!isDragging) return;
        const x = e.clientX || e.touches[0].clientX;
        const diff = x - startX;
        setCurrentTranslate(diff);
    };

    const handleDragEnd = () => {
        if (!isDragging) return;
        setIsDragging(false);
        const threshold = 100; // Minimum drag distance to switch page

        if (currentTranslate > threshold && currentPage > 0) {
            setCurrentPage(prev => prev - 1);
        } else if (currentTranslate < -threshold && currentPage < totalPages - 1) {
            setCurrentPage(prev => prev + 1);
        }
        setCurrentTranslate(0);
    };

    return (
        <div
            className="app-grid-container"
            ref={containerRef}
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
        >
            <div
                className="pages-wrapper"
                style={{
                    transform: `translateX(-${currentPage * 100}%)`
                }}
            >
                {pages.map((pageItems, pageIndex) => (
                    <div key={pageIndex} className="app-page">
                        <div className="page-content-center">
                            {pageItems.map((item, index) => (
                                <div
                                    key={item.path || item.id || index}
                                    className={`app-card ${newAppIds.has(item.id) ? 'new-item' : ''}`}
                                    draggable={true}
                                    onDragStart={(e) => {
                                        e.dataTransfer.effectAllowed = 'copy';
                                        e.dataTransfer.setData('application/json', JSON.stringify(item));
                                        console.log('🎯 Drag started:', item.name);
                                    }}
                                    onClick={() => handleAppClick(item)}
                                    onContextMenu={(e) => handleContextMenu(e, item)}
                                >
                                    <div
                                        className="app-icon-large"
                                        style={{
                                            backgroundColor: item.category === 'file'
                                                ? 'rgba(255, 255, 255, 0.7)' // 文件类型统一白色70%透明
                                                : (item.color || 'rgba(255, 255, 255, 0.7)'),
                                            padding: '12px',
                                            boxSizing: 'border-box'
                                        }}
                                    >
                                        {/* 应用程序使用系统图标 */}
                                        {item.category === 'software' && item.icon ? (
                                            typeof item.icon === 'string' ? (
                                                <img
                                                    src={item.icon}
                                                    alt={item.name}
                                                    onError={(e) => {
                                                        console.warn(`⚠️ 图标加载失败: ${item.name}`);
                                                        e.target.style.display = 'none';
                                                        e.target.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg></div>`;
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        objectFit: 'contain',
                                                        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))'
                                                    }}
                                                />
                                            ) : (
                                                <AppWindow color="white" size={32} />
                                            )
                                        ) : item.path ? (
                                            // 文件类型根据设置显示图标或缩略图
                                            renderFileItem(item)
                                        ) : (
                                            <AppWindow color="white" size={32} />
                                        )}
                                    </div>
                                    <span className="app-name" style={{ color: fontColor }}>
                                        {item.isPinned && "📌 "}{item.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {totalPages > 1 && (
                <div className="pagination-dots">
                    {Array.from({ length: totalPages }).map((_, idx) => (
                        <div
                            key={idx}
                            className={`dot ${currentPage === idx ? 'active' : ''}`}
                            onClick={() => setCurrentPage(idx)}
                        />
                    ))}
                </div>
            )}


        </div>
    );
};

export default AppGrid;
