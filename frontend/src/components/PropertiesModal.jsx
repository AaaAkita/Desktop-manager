import React from 'react';
import './PropertiesModal.css';

const PropertiesModal = ({ item, onClose }) => {
    if (!item) return null;

    return (
        <>
            <div className="properties-modal-backdrop" onClick={onClose} />
            <div className="properties-modal">
                <div className="properties-modal-header">
                    <h3>属性</h3>
                    <button className="close-button" onClick={onClose}>
                        ×
                    </button>
                </div>
                <div className="properties-modal-content">
                    <div className="properties-grid">
                        <div className="property-item">
                            <span className="property-label">名称:</span>
                            <span className="property-value">{item.name}</span>
                        </div>
                        <div className="property-item">
                            <span className="property-label">路径:</span>
                            <span className="property-value">{item.path}</span>
                        </div>
                        {item.size !== undefined && (
                            <div className="property-item">
                                <span className="property-label">大小:</span>
                                <span className="property-value">{item.size} KB</span>
                            </div>
                        )}
                        {item.created && (
                            <div className="property-item">
                                <span className="property-label">创建时间:</span>
                                <span className="property-value">{new Date(item.created).toLocaleString()}</span>
                            </div>
                        )}
                        {item.modified && (
                            <div className="property-item">
                                <span className="property-label">修改时间:</span>
                                <span className="property-value">{new Date(item.modified).toLocaleString()}</span>
                            </div>
                        )}
                        {item.isDirectory !== undefined && (
                            <div className="property-item">
                                <span className="property-label">类型:</span>
                                <span className="property-value">{item.isDirectory ? '文件夹' : '文件'}</span>
                            </div>
                        )}
                        {item.extension && (
                            <div className="property-item">
                                <span className="property-label">扩展名:</span>
                                <span className="property-value">{item.extension}</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="properties-modal-footer">
                    <button className="ok-button" onClick={onClose}>
                        确定
                    </button>
                </div>
            </div>
        </>
    );
};

export default PropertiesModal;