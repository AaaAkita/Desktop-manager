import {
    RiFolderFill,
    RiFilePdfFill,
    RiFileWordFill,
    RiFileExcelFill,
    RiFilePptFill,
    RiImageFill,
    RiVideoFill,
    RiFileZipFill,
    RiFileFill
} from '@remixicon/react';

/**
 * 根据文件类型返回对应的 Remix Icon 填充样式图标组件
 * @param {Object} item - 文件项
 * @param {string} color - 图标颜色（填充色）
 */
export const getFileTypeIcon = (item, color = 'white') => {
    const { type, path } = item;
    const extension = path ? path.toLowerCase().match(/\.[^.]+$/)?.[0] : '';

    const iconProps = {
        size: 36,
        color: color, // 使用填充颜色
    };

    // 文件夹
    if (type === 'folder') {
        return <RiFolderFill {...iconProps} />;
    }

    // 压缩包
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(extension)) {
        return <RiFileZipFill {...iconProps} />;
    }

    // Office 文档 - Word
    if (['.doc', '.docx'].includes(extension)) {
        return <RiFileWordFill {...iconProps} />;
    }

    // Office 文档 - Excel
    if (['.xls', '.xlsx', '.csv'].includes(extension)) {
        return <RiFileExcelFill {...iconProps} />;
    }

    // Office 文档 - PowerPoint
    if (['.ppt', '.pptx'].includes(extension)) {
        return <RiFilePptFill {...iconProps} />;
    }

    // PDF
    if (extension === '.pdf') {
        return <RiFilePdfFill {...iconProps} />;
    }

    // 图片
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(extension)) {
        return <RiImageFill {...iconProps} />;
    }

    // 视频
    if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(extension)) {
        return <RiVideoFill {...iconProps} />;
    }

    // 默认文件图标
    return <RiFileFill {...iconProps} />;
};

/**
 * 根据文件类型返回对应的低饱和度背景颜色
 */
export const getFileTypeColor = (item) => {
    const { type, path } = item;
    const extension = path ? path.toLowerCase().match(/\.[^.]+$/)?.[0] : '';

    // 文件夹 - 暖灰金（降低饱和度）
    if (type === 'folder') return '#C5A572';

    // Office 文档 - 低饱和度版本
    if (['.doc', '.docx'].includes(extension)) return '#7B91AC'; // 雾蓝
    if (['.xls', '.xlsx', '.csv'].includes(extension)) return '#729F7E'; // 雾绿
    if (['.ppt', '.pptx'].includes(extension)) return '#C17965'; // 暖灰橙

    // PDF - 雾玫红
    if (extension === '.pdf') return '#B36971';

    // 媒体文件 - 低饱和度版本
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(extension)) return '#B56B87'; // 雾粉
    if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv'].includes(extension)) return '#6FA6C9'; // 雾蓝

    // 压缩包 - 暖灰橙
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(extension)) return '#C49966';

    // 默认颜色
    return 'rgba(255, 255, 255, 0.7)'; // 半透明白
};
