import React, { useState } from 'react';
import { Search, Settings } from 'lucide-react';
import InfoWidget from './InfoWidget';
import './Header.css';

const Header = ({ viewMode, setViewMode, onSearchChange, onSettingsClick }) => {
    const [focused, setFocused] = useState(false);
    const [searchValue, setSearchValue] = useState('');

    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearchValue(value);
        onSearchChange(value);
    };

    return (
        <div 
            className="header-container"
            onContextMenu={(e) => e.stopPropagation()}
        >
            <div className="header-left">
                <InfoWidget />
            </div>

            <div className="header-center">
                <div className={`search-bar ${focused ? 'focused' : ''}`}>
                    <Search className="search-icon" size={20} />
                    <input
                        type="text"
                        placeholder="搜索项目..."
                        value={searchValue}
                        onChange={handleSearchChange}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                    />
                </div>
            </div>

            <div className="header-right">
                <button
                    className="settings-btn"
                    onClick={onSettingsClick}
                    title="设置"
                >
                    <Settings size={20} />
                </button>

                <div className="view-toggle">
                    <button
                        className={`toggle-option ${viewMode === 'apps' ? 'active' : ''}`}
                        onClick={() => setViewMode('apps')}
                    >
                        软件
                    </button>
                    <button
                        className={`toggle-option ${viewMode === 'files' ? 'active' : ''}`}
                        onClick={() => setViewMode('files')}
                    >
                        文件
                    </button>
                    <div className={`toggle-slider ${viewMode === 'files' ? 'slide-right' : ''}`} />
                </div>
            </div>
        </div>
    );
};

export default Header;
