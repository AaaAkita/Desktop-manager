import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import AppGrid from './components/AppGrid';
import Dock from './components/Dock';
import ContextMenu from './components/ContextMenu';
import SettingsModal from './components/SettingsModal';
import PropertiesModal from './components/PropertiesModal';
import './App.css';

function App() {
  const [viewMode, setViewMode] = useState('apps'); // 'apps' or 'files'
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    wallpaper: null,
    wallpaperMode: 'cover', // 'cover' | 'contain' | 'stretch' | 'tile'
    imageDisplay: 'icon', // 'icon' | 'thumbnail'
    videoDisplay: 'icon',
    thumbnailStyle: {
      borderRadius: 12,
      fillMode: 'cover',
      showBorder: true
    },
    fontColor: '#ffffff', // 桌面字体颜色，默认为白色
    clipboardStoragePath: null // 剪贴板内容存储路径
  });

  // console.log('[App] Initial settings:', settings);

  // 背景图片base64缓存
  const [backgroundBase64, setBackgroundBase64] = useState(null);

  // 粘贴操作状态
  const [pasteStatus, setPasteStatus] = useState(null); // 'success' | 'error' | null
  const [pasteMessage, setPasteMessage] = useState('');

  // 从localStorage加载设置
  useEffect(() => {
    const saved = localStorage.getItem('desktopSettings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  }, []);



  // 粘贴事件处理
  const handlePaste = async (e) => {
    // 忽略在输入框等可编辑元素中的粘贴事件
    const activeElement = document.activeElement;
    const isInput = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );

    if (isInput || ['INPUT', 'TEXTAREA'].includes(e.target?.tagName) || e.target?.isContentEditable) {
      return; // 让浏览器处理原生输入框的粘贴
    }

    try {
      setPasteStatus('processing');
      setPasteMessage('正在处理粘贴操作...');

      // 检查是否有文件内容（优先检查，因为复制文件时也可能包含文本）
      if (window.electronAPI && window.electronAPI.readClipboardFiles) {
        try {
          const filePaths = await window.electronAPI.readClipboardFiles();
          if (filePaths && filePaths.length > 0) {
            console.log('📁 Files detected in clipboard:', filePaths.length);

            // 处理多文件粘贴
            if (filePaths.length > 1) {
              let successCount = 0;
              let errorCount = 0;
              const errorMessages = [];

              for (const filePath of filePaths) {
                try {
                  const clipboardData = {
                    type: 'file',
                    path: filePath,
                    name: filePath.split('\\').pop()
                  };
                  await executeSmartPaste(clipboardData);
                  successCount++;
                } catch (error) {
                  errorCount++;
                  errorMessages.push(`${filePath.split('\\').pop()}: ${error.message}`);
                }
              }

              // 显示多文件粘贴结果
              setPasteStatus('success');
              setPasteMessage(`粘贴完成：成功 ${successCount} 个，失败 ${errorCount} 个`);
              if (errorCount > 0) {
                console.error('Some files failed to paste:', errorMessages);
              }

              // 刷新桌面图标
              reloadDesktopIcons();

              // 3秒后自动消失
              setTimeout(() => {
                setPasteStatus(null);
                setPasteMessage('');
              }, 3000);

              return;
            } else {
              // 单个文件粘贴
              const clipboardData = {
                type: 'file',
                path: filePaths[0],
                name: filePaths[0].split('\\').pop()
              };
              console.log('📁 File path from clipboard:', filePaths[0]);
              await executeSmartPaste(clipboardData);
              return;
            }
          }
        } catch (err) {
          console.error('Failed to read clipboard files:', err);
        }
      }

      // 检查是否有文本内容
      if (e.clipboardData && e.clipboardData.types && e.clipboardData.types.includes('text/plain')) {
        const text = e.clipboardData.getData('text/plain');
        if (text) {
          await executeSmartPaste(text);
          return;
        }
      }

      // 检查是否有图像内容
      if (e.clipboardData && e.clipboardData.items) {
        for (const item of e.clipboardData.items) {
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              // 转换为base64
              const reader = new FileReader();
              reader.onload = async (event) => {
                try {
                  const base64Data = event.target.result;
                  const clipboardData = {
                    type: 'image',
                    data: base64Data,
                    format: item.type.split('/')[1] // 保留原始图像格式
                  };
                  await executeSmartPaste(clipboardData);
                } catch (error) {
                  handlePasteError(error);
                }
              };
              reader.onerror = (error) => {
                handlePasteError(new Error('读取图像数据失败'));
              };
              reader.readAsDataURL(blob);
              return; // 等待异步处理完成
            }
          }
        }
      }

      // 剪贴板为空
      throw new Error('剪贴板为空或不支持的内容类型');

    } catch (error) {
      handlePasteError(error);
    }
  };

  // 执行智能粘贴
  const executeSmartPaste = async (clipboardData) => {
    try {
      console.log('📋 Executing smart paste with data:', clipboardData);
      console.log('📋 Storage path:', settings.clipboardStoragePath);

      if (window.electronAPI && window.electronAPI.smartPaste) {
        console.log('✅ Calling electronAPI.smartPaste');
        const result = await window.electronAPI.smartPaste({
          storagePath: settings.clipboardStoragePath,
          clipboardData: clipboardData
        });

        console.log('📋 Smart paste result:', result);

        if (result.success) {
          setPasteStatus('success');
          setPasteMessage(`粘贴成功！文件已保存到: ${result.filePath}`);
          console.log('✅ Smart paste completed successfully');

          // 刷新桌面图标列表
          reloadDesktopIcons();

          // 3秒后自动消失
          setTimeout(() => {
            setPasteStatus(null);
            setPasteMessage('');
          }, 3000);
        } else {
          throw new Error(result.error || '粘贴失败');
        }
      } else {
        console.error('❌ electronAPI.smartPaste not available');
        throw new Error('智能粘贴功能需要在Electron环境中使用');
      }
    } catch (error) {
      console.error('❌ Smart paste execution failed:', error);
      handlePasteError(error);
    }
  };

  // 处理粘贴错误
  const handlePasteError = (error) => {
    setPasteStatus('error');
    const msg = `粘贴失败: ${error.message}`;
    setPasteMessage(msg);
    console.error('Paste error:', error);

    // 强制弹出 alert 让用户看到具体错误
    // 因为 toast 消失太快，且 console 在打包后不可见
    alert(msg);

    // 3秒后自动消失
    setTimeout(() => {
      setPasteStatus(null);
      setPasteMessage('');
    }, 3000);
  };

  // 清除粘贴状态
  const clearPasteStatus = () => {
    setPasteStatus(null);
    setPasteMessage('');
  };

  // 添加和移除粘贴事件监听器
  useEffect(() => {
    // 将粘贴事件监听器挂载到 document 上，以确保能捕获全局粘贴事件
    // 之前挂载到 .app-container 可能导致只有在容器聚焦时才能触发
    document.addEventListener('paste', handlePaste);
    console.log('✅ Paste event listener added to document');

    return () => {
      document.removeEventListener('paste', handlePaste);
      console.log('✅ Paste event listener removed from document');
    };
  }, []); // 空依赖数组，确保只在组件挂载时添加一次事件监听器

  // 当壁纸路径变化时，加载为base64
  useEffect(() => {
    const loadWallpaperAsBase64 = async () => {
      console.log('🖼️ [App] Settings wallpaper changed:', settings.wallpaper);
      if (settings.wallpaper && window.electronAPI?.readImageAsBase64) {
        try {
          console.log('🖼️ [App] Reading wallpaper as base64...');
          const base64 = await window.electronAPI.readImageAsBase64(settings.wallpaper);
          if (base64) {
            console.log('🖼️ [App] Wallpaper loaded successfully (length):', base64.length);
            setBackgroundBase64(base64);
          } else {
            console.warn('🖼️ [App] Wallpaper base64 is empty/null');
            setBackgroundBase64(null);
          }
        } catch (error) {
          console.error('❌ [App] Failed to load wallpaper:', error);
          setBackgroundBase64(null);
        }
      } else {
        console.log('🖼️ [App] No wallpaper set or API unavailable');
        setBackgroundBase64(null);
      }
    };

    loadWallpaperAsBase64();
  }, [settings.wallpaper]);

  // 保存设置到localStorage
  const handleSettingsSave = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem('desktopSettings', JSON.stringify(newSettings));
    // setShowSettings(false); // Instant save: don't close modal
  };

  // 壁纸背景样式
  const backgroundStyle = (() => {
    if (!backgroundBase64) {
      return {};
    }

    const style = {
      backgroundImage: `url("${backgroundBase64}")`,
      backgroundSize: settings.wallpaperMode === 'tile' ? 'auto' :
        settings.wallpaperMode === 'stretch' ? '100% 100%' :
          settings.wallpaperMode,
      backgroundPosition: 'center',
      backgroundRepeat: settings.wallpaperMode === 'tile' ? 'repeat' : 'no-repeat'
    };

    return style;
  })();

  // Dock 状态管理
  const [dockItems, setDockItems] = useState([]);
  const [dockItemsLoaded, setDockItemsLoaded] = useState(false); // 防止初始化时空数组覆盖后端数据
  const [activeApps, setActiveApps] = useState(new Set()); // 存储活跃应用的 path 或 id
  const [showProperties, setShowProperties] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 创建稳定的onReload回调
  const handleReload = useCallback(() => {
    setReloadKey(prev => prev + 1);
  }, []);

  // 重新加载桌面图标（使用useCallback避免不必要的重新渲染）
  const reloadDesktopIcons = useCallback(async () => {
    try {
      // 更新reloadKey来触发AppGrid重新加载
      setReloadKey(prev => prev + 1);

      const backendData = await window.electronAPI?.getDesktopIcons();
      console.log(`✅ Reloaded data from backend: ${backendData?.icons?.length || 0} icons, ${backendData?.dockItems?.length || 0} dock items`);

      // 加载Dock栏项目
      if (backendData && backendData.dockItems && backendData.dockItems.length > 0) {
        const dockItems = backendData.dockItems.map(item => ({
          id: item.id || item.name,
          name: item.name,
          path: item.path,
          icon: item.icon,
          type: item.type,
          category: item.category
        }));
        setDockItems(dockItems);
      }
    } catch (error) {
      console.error('Failed to reload desktop icons:', error);
    }
  }, []);

  // 从后端JSON文件加载Dock设置
  useEffect(() => {
    const loadDockItems = async () => {
      try {
        const backendData = await window.electronAPI?.getDesktopIcons();
        console.log(`✅ Loaded data from backend: ${backendData?.icons?.length || 0} icons, ${backendData?.dockItems?.length || 0} dock items`);
        console.log('📋 Backend data:', backendData);

        // 加载Dock栏项目
        if (backendData && backendData.dockItems && backendData.dockItems.length > 0) {
          const dockItems = backendData.dockItems.map(item => ({
            id: item.id || item.name,
            name: item.name,
            path: item.path,
            icon: item.icon,
            type: item.type,
            category: item.category
          }));
          console.log('🔄 Loaded dock items:', dockItems);
          setDockItems(dockItems);
        }
      } catch (error) {
        console.error('Failed to load dock items:', error);
      } finally {
        // 无论成功或失败，都标记加载完成，允许后续保存操作
        setDockItemsLoaded(true);
      }
    };
    loadDockItems();
  }, []);

  // 保存Dock设置到后端JSON文件
  const saveDockItems = async (items) => {
    try {
      // 调用后端IPC处理程序保存Dock栏信息
      if (window.electronAPI?.saveDockItems) {
        const result = await window.electronAPI.saveDockItems(items);
        console.log('📦 Save dock items result:', result);
      }
      // 暂时使用localStorage作为备份
      localStorage.setItem('dockItems', JSON.stringify(items));
    } catch (error) {
      console.error('Failed to save dock items:', error);
    }
  };

  // 当dockItems变化时保存（仅在初始加载完成后）
  useEffect(() => {
    if (dockItemsLoaded) {
      saveDockItems(dockItems);
    }
  }, [dockItems, dockItemsLoaded]);

  // 添加到Dock
  const addToDock = (item) => {
    setDockItems(prev => {
      // 使用 path 作为唯一标识进行去重
      // 如果 item 没有 path (例如 mock 数据)，则使用 id
      const uniqueId = item.path || item.id;

      if (!uniqueId) return prev;

      const exists = prev.some(i => (i.path && i.path === item.path) || (item.id && i.id === item.id));
      if (exists) {
        return prev;
      }
      return [...prev, item];
    });
  };

  // 从Dock移除
  const removeFromDock = (itemPath) => {
    setDockItems(prev => prev.filter(i => i.path !== itemPath));
  };

  // 标记应用为活跃
  const markAppActive = (itemPath) => {
    setActiveApps(prev => {
      const newSet = new Set(prev);
      newSet.add(itemPath);
      return newSet;
    });
  };

  // 处理应用打开（同时处理Dock添加和活跃状态）
  const handleAppOpen = async (item) => {
    if (!item.path) return;

    // 1. 打开应用
    if (window.electronAPI) {
      try {
        await window.electronAPI.openApp(item.path);

        // 2. 自动添加到Dock (根据用户反馈：不要自动添加，仅手动添加)
        // addToDock(item);

        // 3. 移除活跃标记逻辑 (根据用户要求：无法监管就不显示高亮)
        // markAppActive(item.path);

      } catch (error) {
        console.error('Failed to open app:', error);
      }
    }
  };

  // 统一的右键菜单状态
  // type: 'dock' | 'desktop' | 'grid'
  const [contextMenu, setContextMenu] = useState(null);

  // 处理 Dock 右键菜单
  const handleDockContextMenu = (e, item) => {
    e.preventDefault();
    setContextMenu({
      type: 'dock',
      x: e.clientX,
      y: e.clientY,
      item: item
    });
  };

  const handleDockContextAction = async (action, item) => {
    // 关闭菜单
    setContextMenu(null);

    if (!item.path) return;

    try {
      switch (action) {
        case 'open':
          await handleAppOpen(item);
          break;
        case 'removeFromDock':
          removeFromDock(item.path);
          break;
        case 'properties':
          if (window.electronAPI) {
            const props = await window.electronAPI.showProperties(item.path);
            if (props) {
              setSelectedItem(props);
              setShowProperties(true);
            }
          }
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Dock action failed:', error);
    }
  };

  // 处理 Grid (AppGrid) 右键菜单
  const handleGridContextMenu = (e, item) => {
    e.preventDefault();
    // 阻止事件冒泡，防止触发 desktop 菜单
    // e.stopPropagation(); // 注意：grid item 上的事件可能不会冒泡到 App 容器，但为了保险起见

    setContextMenu({
      type: 'grid',  // 对应 ContextMenu 组件的 mode? ContextMenu 组件好像没有 'grid' mode，只有 'dock', 'desktop' 和 默认 (null/undefined)
      // 查看 ContextMenu.jsx: mode = 'grid' (components default) implies software/file specific items
      x: e.clientX,
      y: e.clientY,
      item: item
    });
  };

  const handleGridContextAction = async (action, item) => {
    // 关闭菜单
    setContextMenu(null);

    if (!window.electronAPI || !item.path) return;

    try {
      switch (action) {
        case 'open':
          await handleAppOpen(item); // 复用 handleAppOpen
          break;
        case 'openAsAdmin':
          await window.electronAPI.openAsAdmin(item.path);
          break;
        case 'delete':
          if (confirm(`确定要删除 "${item.name}" 吗？`)) {
            try {
              const success = await window.electronAPI.deleteItem(item.path);
              if (success) {
                alert(`✅ "${item.name}" 已成功删除`);
                reloadDesktopIcons(); // 触发刷新
              }
            } catch (error) {
              alert(`❌ 删除失败: ${error.message || '未知错误'}`);
              console.error('Delete operation failed:', error);
            }
          }
          break;
        case 'openLocation':
          await window.electronAPI.openLocation(item.path);
          break;
        case 'properties':
          const props = await window.electronAPI.showProperties(item.path);
          if (props) {
            setSelectedItem(props);
            setShowProperties(true);
          }
          break;
        case 'openWith':
          await window.electronAPI.openApp(item.path);
          break;
        case 'togglePin':
          if (window.electronAPI && window.electronAPI.togglePin) {
            await window.electronAPI.togglePin(item.id, !item.isPinned);
            reloadDesktopIcons();
          }
          break;
        default:
          console.log('Unhandled grid action:', action);
      }
    } catch (error) {
      console.error('Grid context menu action failed:', error);
    }
  };


  // 处理空白区域右键菜单
  const handleDesktopContextMenu = (e) => {
    // 检查点击目标是否是空白区域，避免在图标等元素上触发
    const target = e.target;
    // 如果点击在 app-card 或其子元素上，不触发桌面右键菜单
    // 注意：由于 AppGrid 传递了 stopPropagation，这里其实主要处理 header/footer 等其他区域，或者 grid 的缝隙
    if (target.closest('.app-card') || target.closest('.dock-item')) {
      return;
    }

    e.preventDefault();
    // e.stopPropagation(); // App 容器是最外层，不需要 stopPropagation

    setContextMenu({
      type: 'desktop',
      x: e.clientX,
      y: e.clientY,
      item: { category: 'desktop' }
    });
  };

  // 处理空白区域右键菜单操作
  const handleDesktopContextAction = async (action) => {
    setContextMenu(null);

    switch (action) {
      case 'paste':
        try {
          setPasteStatus('processing');
          setPasteMessage('正在处理粘贴操作...');

          // 获取剪贴板内容
          let clipboardData = null;

          // 尝试获取文本内容
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              clipboardData = text;
            }
          } catch (err) {
            console.error('Failed to read clipboard text:', err);
          }

          // 尝试获取文件内容（通过 Electron 的 clipboard API）
          if (!clipboardData) {
            try {
              // 使用 Electron 的 clipboard 模块读取文件路径
              if (window.electronAPI && window.electronAPI.readClipboardFiles) {
                const filePaths = await window.electronAPI.readClipboardFiles();
                if (filePaths && filePaths.length > 0) {
                  clipboardData = {
                    type: 'file',
                    path: filePaths[0],
                    name: filePaths[0].split('\\').pop()
                  };
                }
              }
            } catch (err) {
              console.error('Failed to read clipboard files:', err);
            }
          }

          // 尝试获取图像内容
          if (!clipboardData) {
            try {
              const clipboardItems = await navigator.clipboard.read();
              for (const item of clipboardItems) {
                for (const type of item.types) {
                  if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      const base64Data = event.target.result;
                      clipboardData = { type: 'image', data: base64Data };
                      await executeSmartPaste(clipboardData);
                    };
                    reader.onerror = () => {
                      handlePasteError(new Error('读取图像数据失败'));
                    };
                    reader.readAsDataURL(blob);
                    return;
                  }
                }
              }
            } catch (err) {
              console.error('Failed to read clipboard image:', err);
            }
          }

          // 执行智能粘贴
          if (clipboardData) {
            await executeSmartPaste(clipboardData);
          } else {
            throw new Error('剪贴板为空或不支持的内容类型');
          }
        } catch (error) {
          handlePasteError(error);
        }
        break;
      case 'refresh':
        // 使用新的刷新机制，保持当前页面状态
        reloadDesktopIcons();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="app-container"
      style={backgroundStyle}
      onContextMenu={handleDesktopContextMenu}
    >
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onSearchChange={setSearchQuery}
        onSettingsClick={() => setShowSettings(true)}
      />
      <AppGrid
        viewMode={viewMode}
        searchQuery={searchQuery}
        settings={settings}
        fontColor={settings.fontColor}
        onAppOpen={handleAppOpen}
        onReload={handleReload}
        reloadKey={reloadKey}
        onShowProperties={(props) => {
          setSelectedItem(props);
          setShowProperties(true);
        }}
        onContextMenu={handleGridContextMenu}
      />
      <Dock
        items={dockItems}
        activeItems={activeApps}
        onDropItem={addToDock}
        onItemClick={handleAppOpen}
        onContextMenu={handleDockContextMenu}
      />

      {/* Unified Context Menu */}
      {contextMenu && (
        <ContextMenu
          mode={contextMenu.type === 'grid' ? undefined : contextMenu.type} // passing undefined for grid to use default logic in ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onClose={() => setContextMenu(null)}
          onAction={
            contextMenu.type === 'dock' ? handleDockContextAction :
              contextMenu.type === 'desktop' ? handleDesktopContextAction :
                handleGridContextAction
          }
        />
      )}

      {/* 设置弹窗 */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 属性弹窗 */}
      {showProperties && (
        <PropertiesModal
          item={selectedItem}
          onClose={() => setShowProperties(false)}
        />
      )}

      {/* 粘贴操作反馈 */}
      {pasteStatus && (
        <div className={`paste-feedback paste-${pasteStatus}`}>
          <div className="paste-message">{pasteMessage}</div>
          <button className="paste-close-btn" onClick={() => {
            setPasteStatus(null);
            setPasteMessage('');
          }}>×</button>
        </div>
      )}
    </div>
  );
}

export default App;
