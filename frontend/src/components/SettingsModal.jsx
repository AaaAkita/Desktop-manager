import React, { useState, useEffect } from 'react';
import { X, Folder, FileText, Image, Palette, Settings, Monitor, Image as ImageIcon, Maximize, Scan, StretchHorizontal } from 'lucide-react';
import './SettingsModal.css';

const SettingsModal = ({ settings, onSave, onClose }) => {
    const [localSettings, setLocalSettings] = useState(() => ({
        ...settings,
        thumbnailStyle: {
            borderRadius: 12,
            objectFit: 'cover',
            showBorder: false
        }
    }));
    const [activeTab, setActiveTab] = useState('appearance'); // 'appearance' | 'files' | 'system'
    const [wallpaperPreview, setWallpaperPreview] = useState(null); // base64预览
    const [wallpaperPath, setWallpaperPath] = useState(settings.wallpaper || ''); // 原始路径

    // Load initial wallpaper preview
    useEffect(() => {
        const loadInitialWallpaper = async () => {
            if (settings.wallpaper && window.electronAPI && window.electronAPI.readImageAsBase64) {
                try {
                    const base64Data = await window.electronAPI.readImageAsBase64(settings.wallpaper);
                    if (base64Data) {
                        setWallpaperPreview(base64Data);
                    }
                } catch (error) {
                    console.error("Failed to load wallpaper preview:", error);
                }
            }
        };
        loadInitialWallpaper();
    }, [settings.wallpaper]);

    // Helper to update both local state and parent state immediately
    const updateSettings = (newSettings) => {
        setLocalSettings(newSettings);
        onSave(newSettings);
    };

    // 选择壁纸文件
    const handleWallpaperSelect = async () => {
        if (window.electronAPI && window.electronAPI.selectFile) {
            // copyToApp: true 会将图片复制到应用内部
            const filePath = await window.electronAPI.selectFile({
                filters: [
                    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
                ],
                copyToApp: true
            });

            if (filePath) {
                // 文件已复制到应用内部，直接使用路径
                setWallpaperPath(filePath);

                // 转换为base64用于预览
                const base64Data = await window.electronAPI.readImageAsBase64(filePath);
                if (base64Data) {
                    setWallpaperPreview(base64Data);
                }
                // Immediately save wallpaper path
                updateSettings({ ...localSettings, wallpaper: filePath });
            }
        } else {
            alert('壁纸选择需要在Electron环境中使用');
        }
    };

    // 应用壁纸到设置
    // const applyWallpaper = () => {
    //     // 使用原始路径保存，而不是base64
    //     setLocalSettings(prev => ({ ...prev, wallpaper: wallpaperPath }));
    //     // 提供视觉反馈
    //     alert('✅ 壁纸已应用！点击Save按钮保存设置。');
    // };

    // 清除壁纸
    const clearWallpaper = () => {
        setWallpaperPreview(null);
        setWallpaperPath('');
        updateSettings({ ...localSettings, wallpaper: '' });
    };

    // 保存设置
    // const handleSave = () => {
    //     onSave(localSettings);
    // };

    // 获取预览样式
    const getPreviewStyle = () => {
        if (!wallpaperPreview) return { backgroundColor: '#f5f5f5' };

        // wallpaperPreview 现在是 base64 data URL，可以直接使用
        return {
            backgroundImage: `url("${wallpaperPreview}")`,
            backgroundSize: localSettings.wallpaperMode === 'tile' ? 'auto' :
                localSettings.wallpaperMode === 'stretch' ? '100% 100%' :
                    localSettings.wallpaperMode,
            backgroundPosition: 'center',
            backgroundRepeat: localSettings.wallpaperMode === 'tile' ? 'repeat' : 'no-repeat'
        };
    };

    // 打开剪贴板文件夹
    const handleOpenClipboardFolder = async () => {
        const path = settings.clipboardStoragePath || './DATA/clipboard';
        if (window.electronAPI && window.electronAPI.openLocation) {
            try {
                // 如果是相对路径，后端可能会处理，或者我们尝试直接传递
                // 通常 openLocation 会打开资源管理器并选中文件，或者打开文件夹
                await window.electronAPI.openLocation(path);
            } catch (error) {
                console.error("Failed to open clipboard folder:", error);
                alert("打开文件夹失败，请检查路径是否存在。");
            }
        } else {
            alert("此功能需要在 Electron 环境中使用");
        }
    };

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>

                {/* 侧边栏导航 */}
                <div className="settings-sidebar">
                    <div className="sidebar-header">
                        <h2>设置</h2>
                    </div>
                    <nav className="sidebar-nav">
                        <button
                            className={`nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('appearance')}
                        >
                            <Palette size={18} />
                            <span>外观</span>
                        </button>
                        <button
                            className={`nav-item ${activeTab === 'files' ? 'active' : ''}`}
                            onClick={() => setActiveTab('files')}
                        >
                            <Folder size={18} />
                            <span>文件</span>
                        </button>
                        <button
                            className={`nav-item ${activeTab === 'system' ? 'active' : ''}`}
                            onClick={() => setActiveTab('system')}
                        >
                            <Settings size={18} />
                            <span>系统</span>
                        </button>
                    </nav>
                </div>

                {/* 右侧内容区 */}
                <div className="settings-main">
                    <button className="close-btn-floating" onClick={onClose}>
                        <X size={20} />
                    </button>

                    <div className="settings-content-wrapper">
                        {activeTab === 'appearance' && (
                            <div className="tab-content fade-in">
                                <section className="settings-section">
                                    <h3>壁纸设置</h3>
                                    <div className="light-card">
                                        <div className="wallpaper-hero-section">
                                            {/* 1. Hero Preview Area - Always visible if wallpaper exists or placeholder */}
                                            <div className="wallpaper-preview-hero" style={getPreviewStyle()}>
                                                {!wallpaperPreview && (
                                                    <div className="preview-placeholder">
                                                        <ImageIcon size={48} strokeWidth={1} style={{ opacity: 0.5, marginBottom: 10 }} />
                                                        <span>无壁纸预览</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 2. Visual Mode Selection */}
                                            {wallpaperPreview && (
                                                <div className="mode-selection-row">
                                                    <button
                                                        className={`mode-option ${localSettings.wallpaperMode === 'cover' ? 'active' : ''}`}
                                                        onClick={() => updateSettings({ ...localSettings, wallpaperMode: 'cover' })}
                                                        title="覆盖 (Cover)"
                                                    >
                                                        <div className="mode-icon cover"></div>
                                                        <span>覆盖</span>
                                                    </button>
                                                    <button
                                                        className={`mode-option ${localSettings.wallpaperMode === 'contain' ? 'active' : ''}`}
                                                        onClick={() => updateSettings({ ...localSettings, wallpaperMode: 'contain' })}
                                                        title="适应 (Contain)"
                                                    >
                                                        <div className="mode-icon contain"></div>
                                                        <span>适应</span>
                                                    </button>
                                                    <button
                                                        className={`mode-option ${localSettings.wallpaperMode === 'stretch' ? 'active' : ''}`}
                                                        onClick={() => updateSettings({ ...localSettings, wallpaperMode: 'stretch' })}
                                                        title="拉伸 (Stretch)"
                                                    >
                                                        <div className="mode-icon stretch" style={{ width: 30 }}></div>
                                                        <span>拉伸</span>
                                                    </button>
                                                </div>
                                            )}

                                            {/* 3. Large Action Buttons */}
                                            <div className="setting-col">
                                                <button className="choose-image-btn" onClick={handleWallpaperSelect}>
                                                    <ImageIcon size={20} />
                                                    <span>更换背景图片...</span>
                                                </button>

                                                {/* Removed Actions Float - Now Instant */}
                                                {wallpaperPreview && (
                                                    <div className="wallpaper-actions-float">
                                                        <button className="btn-danger-light" onClick={clearWallpaper} style={{ marginLeft: 'auto' }}>
                                                            移除壁纸
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="settings-section">
                                    <h3>字体颜色</h3>
                                    <div className="light-card">
                                        <div className="setting-row">
                                            <div className="setting-info">
                                                <label>桌面文字颜色</label>
                                                <div className="file-path-display" style={{ marginTop: 4 }}>
                                                    确保文字在壁纸上清晰可见
                                                </div>
                                            </div>
                                            <div className="color-circle-wrapper">
                                                <div style={{
                                                    width: 24, height: 24, borderRadius: '50%',
                                                    background: localSettings.fontColor || '#ffffff',
                                                    border: '1px solid rgba(0,0,0,0.1)'
                                                }}></div>
                                                <input
                                                    type="color"
                                                    value={localSettings.fontColor || '#ffffff'}
                                                    onChange={(e) => updateSettings({ ...localSettings, fontColor: e.target.value })}
                                                    style={{ opacity: 0, width: 0, height: 0, padding: 0, border: 0 }}
                                                    id="fontColorPicker"
                                                />
                                                <label htmlFor="fontColorPicker" style={{
                                                    fontSize: 13, color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 500
                                                }}>
                                                    {localSettings.fontColor || '#ffffff'}
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'files' && (
                            <div className="tab-content fade-in">
                                <section className="settings-section">
                                    <h3>显示偏好</h3>
                                    <div className="light-card">
                                        <div className="setting-row">
                                            <div className="setting-info">
                                                <label>图片显示</label>
                                            </div>
                                            <div className="segmented-control">
                                                <button
                                                    className={`segment-btn ${localSettings.imageDisplay === 'icon' ? 'active' : ''}`}
                                                    onClick={() => updateSettings({ ...localSettings, imageDisplay: 'icon' })}
                                                >
                                                    图标
                                                </button>
                                                <button
                                                    className={`segment-btn ${localSettings.imageDisplay === 'thumbnail' ? 'active' : ''}`}
                                                    onClick={() => updateSettings({ ...localSettings, imageDisplay: 'thumbnail' })}
                                                >
                                                    缩略图
                                                </button>
                                            </div>
                                        </div>
                                        <div className="separator-light" />
                                        <div className="setting-row">
                                            <div className="setting-info">
                                                <label>视频显示</label>
                                            </div>
                                            <div className="segmented-control">
                                                <button
                                                    className={`segment-btn ${localSettings.videoDisplay === 'icon' ? 'active' : ''}`}
                                                    onClick={() => updateSettings({ ...localSettings, videoDisplay: 'icon' })}
                                                >
                                                    图标
                                                </button>
                                                <button
                                                    className={`segment-btn ${localSettings.videoDisplay === 'thumbnail' ? 'active' : ''}`}
                                                    onClick={() => updateSettings({ ...localSettings, videoDisplay: 'thumbnail' })}
                                                >
                                                    缩略图
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </section>


                            </div>
                        )}

                        {activeTab === 'system' && (
                            <div className="tab-content fade-in">
                                <section className="settings-section">
                                    <h3>剪贴板设置</h3>
                                    <div className="light-card">
                                        <div className="setting-row">
                                            <div className="setting-info">
                                                <label>存储位置</label>
                                                <div className="path-display-simple">./DATA/clipboard</div>
                                            </div>
                                            <button className="btn-light" onClick={handleOpenClipboardFolder} style={{ padding: '6px 16px', fontSize: 13 }}>
                                                打开文件夹
                                            </button>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
