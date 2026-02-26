import React, { useState, useEffect } from 'react';
import './InfoWidget.css';

const InfoWidget = () => {
    const [time, setTime] = useState(new Date());

    // 时间更新
    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const formatWeekday = (date) => {
        return date.toLocaleDateString('zh-CN', {
            weekday: 'long'
        });
    };

    const formatDate = (date) => {
        return date.toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric'
        });
    };

    const formatTime = (date) => {
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    return (
        <div className="info-widget">
            <div className="info-time">{formatTime(time)}</div>
            <div className="info-date-container">
                <span className="info-date">{formatDate(time)}</span>
                <span className="info-weekday">{formatWeekday(time)}</span>
            </div>
        </div>
    );
};

export default InfoWidget;
