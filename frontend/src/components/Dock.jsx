import React, { useRef } from 'react';
import { AppWindow } from 'lucide-react';
import { getFileTypeIcon, getFileTypeColor } from '../utils/fileIcons';
import './Dock.css';

const Dock = ({ items = [], activeItems = new Set(), onDropItem, onItemClick, onContextMenu }) => {
    const dockRef = useRef(null);

    const handleMouseMove = (e) => {
        const dock = dockRef.current;
        if (!dock) return;

        const icons = dock.querySelectorAll('.dock-item');
        const dockRect = dock.getBoundingClientRect();

        // Mouse X relative to dock
        const mouseX = e.clientX - dockRect.left;

        icons.forEach((icon) => {
            const iconRect = icon.getBoundingClientRect();
            const iconCenterX = iconRect.left - dockRect.left + iconRect.width / 2;

            const distance = Math.abs(mouseX - iconCenterX);
            const maxDistance = 110; // Reduced influence range

            let scale = 1;
            if (distance < maxDistance) {
                scale = 1 + 0.3 * (1 - distance / maxDistance); // Reduced max scacle from 1.5 to 1.3
            }

            icon.style.transform = `scale(${scale}) translateY(${-(scale - 1) * 20}px)`;
        });
    };

    const handleMouseLeave = () => {
        const dock = dockRef.current;
        if (!dock) return;
        const icons = dock.querySelectorAll('.dock-item');
        icons.forEach((icon) => {
            icon.style.transform = 'scale(1) translateY(0)';
        });
    };

    const handleDragOver = (e) => {
        // 阻止默认行为以允许放置
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        // console.log('🏗️ DragOver Dock'); // Removed spammy log
    };

    const handleDrop = (e) => {
        e.preventDefault();
        console.log('📦 Dropped on Dock');
        try {
            const data = e.dataTransfer.getData('application/json');
            console.log('📄 Dropped data:', data);

            if (data && onDropItem) {
                const item = JSON.parse(data);
                console.log('✅ Parsed item:', JSON.stringify(item));
                onDropItem(item);
            }
        } catch (error) {
            console.error('❌ Failed to parse dropped item:', error);
        }
    };

    if (items.length === 0) {
        return (
            <div className="dock-container">
                <div
                    className="dock-glass empty-dock"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', pointerEvents: 'none' }}>
                        拖拽图标到这里
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="dock-container">
            <div
                className="dock-glass"
                ref={dockRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onContextMenu={(e) => e.stopPropagation()}
            >
                {items.map((item, index) => {
                    // 检查是否活跃
                    const isActive = activeItems.has(item.path);

                    return (
                        <div
                            key={item.path || index}
                            className="dock-item"
                            onClick={() => onItemClick && onItemClick(item)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation(); // 阻止事件冒泡，避免触发桌面空白区域的右键菜单
                                onContextMenu && onContextMenu(e, item);
                            }}
                        >
                            <div
                                className="dock-icon-container"
                                style={{
                                    backgroundColor: item.category === 'file'
                                        ? 'rgba(255, 255, 255, 0.7)' // 统一文件背景
                                        : (item.color || 'rgba(255, 255, 255, 0.7)'),
                                    boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                                }}
                            >
                                {item.category === 'software' && item.icon ? (
                                    typeof item.icon === 'string' ? (
                                        <img
                                            src={item.icon && (item.icon.match(/^[a-zA-Z]:\\/) || item.icon.startsWith('/'))
                                                ? `local-icon://${encodeURI(item.icon.replace(/\\/g, '/'))}`
                                                : item.icon}
                                            alt={item.name}
                                            className="dock-icon-img"
                                            onError={(e) => {
                                                console.warn(`⚠️ Dock 图标加载失败: ${item.name}`, { icon: item.icon });
                                                e.target.style.display = 'none';
                                                e.target.parentElement.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
                                            }}
                                        />
                                    ) : (
                                        <AppWindow color="#6B7280" size={24} />
                                    )
                                ) : item.path ? (
                                    getFileTypeIcon(item, getFileTypeColor(item))
                                ) : (
                                    <AppWindow color="#6B7280" size={24} />
                                )}
                            </div>
                            {isActive && <div className="active-indicator" />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Dock;
