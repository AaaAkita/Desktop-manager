import React from 'react';
import './ContextMenu.css';

const ContextMenu = ({ x, y, item, onClose, onAction, mode = 'grid' }) => {
    const menuRef = React.useRef(null);
    const [pos, setPos] = React.useState({ x, y });

    // 智能调整位置，防止溢出屏幕
    React.useLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            let newX = x;
            let newY = y;

            // Check right edge
            if (newX + rect.width > window.innerWidth) {
                newX = window.innerWidth - rect.width - 10;
            }

            // Check bottom edge
            if (newY + rect.height > window.innerHeight) {
                newY = y - rect.height; // Show above cursor if it doesn't fit below
            }

            setPos({ x: newX, y: newY });
        }
    }, [x, y]);

    // Close on click outside
    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };

        // Handle scrolling
        const handleScroll = () => {
            onClose();
        };

        // Handle window resize
        const handleResize = () => {
            onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('scroll', handleScroll, true); // Capture phase for scroll
        window.addEventListener('resize', handleResize);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [onClose]);

    if (!item) return null;

    const getMenuItems = () => {
        if (mode === 'dock') {
            return [
                { id: 'open', label: '打开' },
                { id: 'separator' },
                { id: 'removeFromDock', label: '从 Dock 移除' },
                { id: 'separator' },
                { id: 'properties', label: '属性' }
            ];
        }

        if (mode === 'desktop') {
            return [
                { id: 'paste', label: '粘贴' },
                { id: 'separator' },
                { id: 'refresh', label: '刷新' }
            ];
        }

        if (!item.category) return [];

        if (item.category === 'software') {
            return [
                { id: 'open', label: '启动' },
                { id: 'openAsAdmin', label: '以管理员身份运行' },
                { id: 'separator' },
                { id: 'togglePin', label: item.isPinned ? '取消置顶' : '置顶' },
                { id: 'separator' },
                { id: 'openLocation', label: '打开文件所在位置' },
                { id: 'separator' },
                { id: 'properties', label: '属性' }
            ];
        } else if (item.type === 'folder') {
            return [
                { id: 'open', label: '打开文件夹' },
                { id: 'separator' },
                { id: 'togglePin', label: item.isPinned ? '取消置顶' : '置顶' },
                { id: 'separator' },
                { id: 'delete', label: '删除', danger: true },
                { id: 'separator' },
                { id: 'properties', label: '属性' }
            ];
        } else if (item.type === 'archive') {
            return [
                { id: 'open', label: '打开' },
                { id: 'extract', label: '解压到此处' },
                { id: 'separator' },
                { id: 'togglePin', label: item.isPinned ? '取消置顶' : '置顶' },
                { id: 'separator' },
                { id: 'delete', label: '删除', danger: true },
                { id: 'separator' },
                { id: 'properties', label: '属性' }
            ];
        } else {
            // General file
            return [
                { id: 'open', label: '打开' },
                { id: 'openWith', label: '打开方式...' },
                { id: 'separator' },
                { id: 'togglePin', label: item.isPinned ? '取消置顶' : '置顶' },
                { id: 'separator' },
                { id: 'delete', label: '删除', danger: true },
                { id: 'separator' },
                { id: 'properties', label: '属性' }
            ];
        }
    };

    const menuItems = getMenuItems();

    const handleItemClick = (action) => {
        onAction(action, item);
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{ left: pos.x, top: pos.y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {menuItems.map((menuItem, idx) => {
                if (menuItem.id === 'separator') {
                    return <div key={`sep-${idx}`} className="context-menu-separator" />;
                }
                return (
                    <div
                        key={menuItem.id}
                        className={`context-menu-item ${menuItem.danger ? 'danger' : ''}`}
                        onClick={() => handleItemClick(menuItem.id)}
                    >
                        <span className="menu-label">{menuItem.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default ContextMenu;
