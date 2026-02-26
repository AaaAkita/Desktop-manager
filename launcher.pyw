#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Desktop Manager Launcher GUI
用于管理Electron应用和后端服务的开启、重启和关闭
使用Python Tkinter实现的图形界面版本

增强功能：
- 同时管理前后端服务
- 完整的日志系统（系统日志、操作日志、前端运行日志、后端运行日志）
- 日志按启动时间分目录存储
- 前端日志级别过滤
"""

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import subprocess
import psutil
import os
import time
import threading
import logging
import logging.handlers
from datetime import datetime
from pathlib import Path
import sys
import socket


class MultiProcessLogger:
    """多进程日志管理器，支持四类日志输出"""
    
    # 日志级别映射
    LEVELS = {
        'DEBUG': logging.DEBUG,
        'INFO': logging.INFO,
        'WARNING': logging.WARNING,
        'ERROR': logging.ERROR,
        'CRITICAL': logging.CRITICAL
    }
    
    def __init__(self, base_log_dir="logs"):
        """初始化日志管理器
        
        Args:
            base_log_dir: 日志根目录
        """
        self.base_log_dir = Path(base_log_dir)
        self.session_dir = None
        self.loggers = {}
        self._create_session_dir()
        self._init_loggers()
    
    def _create_session_dir(self):
        """创建本次启动的日志目录（8位数字格式：YYYYMMDD_HHMMSS）"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # 取后8位数字（MMDDHHMM）
        short_timestamp = timestamp[4:12]  # 从第5位开始取8位：MMDDHHMM
        self.session_dir = self.base_log_dir / short_timestamp
        self.session_dir.mkdir(parents=True, exist_ok=True)
        
        # 同时创建一个完整时间戳的软链接/标记文件便于识别
        marker_file = self.session_dir / f"session_{timestamp}.txt"
        marker_file.write_text(f"Session started at: {datetime.now().isoformat()}\n")
    
    def _init_loggers(self):
        """初始化四类日志记录器"""
        # 1. 系统日志 - launcher 自身运行状态
        self.loggers['system'] = self._create_logger(
            'system', 
            self.session_dir / 'system.log',
            level=logging.DEBUG
        )
        
        # 2. 操作日志 - 用户操作记录
        self.loggers['operation'] = self._create_logger(
            'operation',
            self.session_dir / 'operation.log',
            level=logging.INFO
        )
        
        # 3. 前端运行日志 - Electron/React 输出
        self.loggers['frontend'] = self._create_logger(
            'frontend',
            self.session_dir / 'frontend.log',
            level=logging.DEBUG
        )
        
        # 4. 后端运行日志 - C# 服务输出
        self.loggers['backend'] = self._create_logger(
            'backend',
            self.session_dir / 'backend.log',
            level=logging.DEBUG
        )
    
    def _create_logger(self, name, log_file, level=logging.DEBUG):
        """创建单个日志记录器
        
        Args:
            name: 日志器名称
            log_file: 日志文件路径
            level: 日志级别
            
        Returns:
            logging.Logger: 配置好的日志记录器
        """
        logger = logging.getLogger(f'desktop_manager.{name}')
        logger.setLevel(level)
        
        # 清除已有的处理器
        logger.handlers.clear()
        
        # 创建文件处理器
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(level)
        
        # 设置格式：时间 - 级别 - 消息
        formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
        return logger
    
    def get_logger(self, name):
        """获取指定类型的日志记录器
        
        Args:
            name: 日志类型 ('system', 'operation', 'frontend', 'backend')
            
        Returns:
            logging.Logger: 对应的日志记录器
        """
        return self.loggers.get(name)
    
    def get_session_dir(self):
        """获取本次会话的日志目录"""
        return self.session_dir


class TkinterLogHandler(logging.Handler):
    """Tkinter GUI 日志处理器，使用批量更新机制避免界面卡顿"""
    
    # 日志级别对应的颜色
    LEVEL_COLORS = {
        'DEBUG': '#808080',      # 灰色
        'INFO': '#000000',       # 黑色
        'WARNING': '#FF8C00',    # 橙色
        'ERROR': '#FF0000',      # 红色
        'CRITICAL': '#8B0000',   # 深红色
    }
    
    def __init__(self, text_widget, level=logging.INFO, max_lines=500, batch_interval=100):
        """初始化 GUI 日志处理器
        
        Args:
            text_widget: Tkinter Text 组件
            level: 显示的最低日志级别
            max_lines: 最大保留行数，超过会自动清理
            batch_interval: 批量更新间隔（毫秒）
        """
        super().__init__(level)
        self.text_widget = text_widget
        self.max_lines = max_lines
        self.batch_interval = batch_interval
        self.formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%H:%M:%S'
        )
        
        # 使用队列缓冲日志，避免频繁更新 GUI
        import queue
        self.log_queue = queue.Queue()
        self.batch_logs = []
        self.last_update = 0
        self.update_scheduled = False
        self._stop_flag = threading.Event()
        
        # 启动批量更新定时器
        self._schedule_batch_update()
    
    def _schedule_batch_update(self):
        """调度批量更新"""
        if not self.update_scheduled and not self._stop_flag.is_set():
            self.update_scheduled = True
            try:
                self.text_widget.after(self.batch_interval, self._batch_update)
            except RuntimeError:
                # 组件已销毁
                pass
    
    def _batch_update(self):
        """批量更新 GUI 日志显示"""
        self.update_scheduled = False
        
        # 从队列中取出所有待显示的日志
        logs_to_display = []
        try:
            while True:
                log_entry = self.log_queue.get_nowait()
                logs_to_display.append(log_entry)
        except:
            pass
        
        if logs_to_display and self.text_widget.winfo_exists():
            try:
                self.text_widget.configure(state='normal')
                
                # 批量插入日志
                for msg, level, color in logs_to_display:
                    # 检查行数，超过限制时清理旧日志
                    current_lines = int(self.text_widget.index('end-1c').split('.')[0])
                    if current_lines > self.max_lines:
                        delete_to = int(self.max_lines * 0.2)
                        self.text_widget.delete('1.0', f'{delete_to}.0')
                    
                    # 插入新日志
                    self.text_widget.insert('end', msg + '\n')
                    
                    # 为日志级别设置颜色标签
                    tag_name = f'level_{level}'
                    if tag_name not in self.text_widget.tag_names():
                        self.text_widget.tag_configure(tag_name, foreground=color)
                    
                    # 为最后一行应用颜色标签
                    last_line = int(self.text_widget.index('end-1c').split('.')[0]) - 1
                    self.text_widget.tag_add(tag_name, f'{last_line}.0', f'{last_line}.end')
                
                # 滚动到最新内容
                self.text_widget.see('end')
                self.text_widget.configure(state='disabled')
            except Exception as e:
                print(f"GUI 日志显示错误: {e}")
        
        # 继续调度下一次更新
        if not self._stop_flag.is_set():
            self._schedule_batch_update()
    
    def emit(self, record):
        """输出日志记录到队列（非阻塞）"""
        try:
            msg = self.format(record)
            level = record.levelname
            color = self.LEVEL_COLORS.get(level, '#000000')
            
            # 放入队列，不直接操作 GUI
            self.log_queue.put((msg, level, color))
        except Exception:
            self.handleError(record)
    
    def close(self):
        """关闭处理器"""
        self._stop_flag.set()
        super().close()


class ProcessOutputReader(threading.Thread):
    """进程输出读取器，用于捕获子进程的 stdout 和 stderr
    
    使用跨平台兼容的方式读取进程输出，Windows 上使用独立线程分别读取 stdout 和 stderr
    """
    
    def __init__(self, process, logger, log_prefix="", log_level="INFO", level_patterns=None):
        """初始化输出读取器
        
        Args:
            process: subprocess.Popen 对象
            logger: 日志记录器
            log_prefix: 日志前缀标识
            log_level: 默认日志级别
            level_patterns: 用于识别日志级别的模式字典
        """
        super().__init__(daemon=True)
        self.process = process
        self.logger = logger
        self.log_prefix = log_prefix
        self.log_level = log_level.upper()
        self.level_patterns = level_patterns or {
            'ERROR': ['error', 'failed', 'exception', 'fatal', '崩溃', '错误', '无法', 'fail'],
            'WARNING': ['warning', 'warn', '警告', 'timeout', '超时'],
            'DEBUG': ['debug', '调试', 'trace'],
        }
        self.running = True
        self.stdout_thread = None
        self.stderr_thread = None
    
    def _detect_level(self, line):
        """根据内容自动检测日志级别"""
        line_lower = line.lower()
        
        for level, patterns in self.level_patterns.items():
            for pattern in patterns:
                if pattern in line_lower:
                    return level
        
        return self.log_level
    
    def _should_log(self, level):
        """检查是否应该记录该级别的日志"""
        level_priority = {'DEBUG': 0, 'INFO': 1, 'WARNING': 2, 'ERROR': 3, 'CRITICAL': 4}
        current_priority = level_priority.get(self.log_level, 1)
        msg_priority = level_priority.get(level, 1)
        return msg_priority >= current_priority
    
    def _read_stream(self, stream, stream_type):
        """单独读取一个流的输出"""
        try:
            for line in iter(stream.readline, b''):
                if not self.running:
                    break
                if line:
                    try:
                        decoded_line = line.decode('utf-8', errors='replace').strip()
                        if decoded_line:
                            self._log_line(decoded_line, stream_type)
                    except Exception as e:
                        self.logger.error(f"[{self.log_prefix}] 解码日志时出错: {e}")
        except Exception as e:
            self.logger.error(f"[{self.log_prefix}] 读取 {stream_type} 时出错: {e}")
        finally:
            try:
                stream.close()
            except:
                pass
    
    def run(self):
        """启动独立的读取线程分别读取 stdout 和 stderr"""
        # 为 stdout 和 stderr 分别创建读取线程
        if self.process.stdout:
            self.stdout_thread = threading.Thread(
                target=self._read_stream,
                args=(self.process.stdout, 'OUT'),
                daemon=True
            )
            self.stdout_thread.start()
        
        if self.process.stderr:
            self.stderr_thread = threading.Thread(
                target=self._read_stream,
                args=(self.process.stderr, 'ERR'),
                daemon=True
            )
            self.stderr_thread.start()
        
        # 等待进程结束
        while self.running:
            if self.process.poll() is not None:
                # 进程已结束，等待读取线程完成
                if self.stdout_thread:
                    self.stdout_thread.join(timeout=1)
                if self.stderr_thread:
                    self.stderr_thread.join(timeout=1)
                break
            time.sleep(0.1)
    
    def _log_line(self, line, stream_type):
        """记录单行日志"""
        level = self._detect_level(line)
        
        if not self._should_log(level):
            return
        
        prefix = f"[{self.log_prefix}:{stream_type}]"
        message = f"{prefix} {line}"
        
        if level == 'ERROR':
            self.logger.error(message)
        elif level == 'WARNING':
            self.logger.warning(message)
        elif level == 'DEBUG':
            self.logger.debug(message)
        else:
            self.logger.info(message)
    
    def stop(self):
        """停止读取"""
        self.running = False


class DesktopManagerLauncher:
    """Desktop Manager 启动器主类"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("Desktop Manager")
        self.root.geometry("750x550")
        self.root.minsize(1200, 1000)
        
        # 设置应用路径
        self.frontend_path = Path("e:/software/DesktopManager/frontend")
        self.backend_path = Path("e:/software/DesktopManager/backend")
        
        # 后端服务配置
        self.backend_port = 6789
        self.backend_host = "127.0.0.1"
        
        # 进程管理
        self.frontend_process = None
        self.backend_process = None
        self.output_readers = []
        
        # GUI 日志处理器列表
        self.gui_handlers = []
        
        # 初始化日志系统
        self.logger_manager = MultiProcessLogger("logs")
        self.system_log = self.logger_manager.get_logger('system')
        self.operation_log = self.logger_manager.get_logger('operation')
        self.frontend_log = self.logger_manager.get_logger('frontend')
        self.backend_log = self.logger_manager.get_logger('backend')
        
        self.system_log.info("=" * 60)
        self.system_log.info("Desktop Manager Launcher 启动")
        self.system_log.info(f"日志目录: {self.logger_manager.get_session_dir()}")
        self.system_log.info(f"前端路径: {self.frontend_path}")
        self.system_log.info(f"后端路径: {self.backend_path}")
        
        # 检查psutil是否安装
        try:
            import psutil
        except ImportError:
            messagebox.showerror('错误', '缺少psutil库，请先安装: pip install psutil')
            self.system_log.error("缺少psutil库，启动器退出")
            self.root.destroy()
            return
        
        # 创建主框架（左右分割）
        self.main_frame = tk.Frame(self.root)
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 创建左右两个框架
        self.left_frame = tk.Frame(self.main_frame, padx=10, pady=10)
        self.left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=5)
        
        self.right_frame = tk.Frame(self.main_frame, padx=5, pady=5)
        self.right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5)
        
        # 添加标题
        self.title_label = tk.Label(
            self.left_frame, 
            text="Desktop Manager", 
            font=('Arial', 14, 'bold')
        )
        self.title_label.pack(pady=(0, 10))
        
        # 创建状态显示区域
        self.status_var = tk.StringVar(value="准备就绪")
        self.status_label = tk.Label(
            self.left_frame, 
            textvariable=self.status_var, 
            font=('Arial', 11)
        )
        self.status_label.pack(pady=5)
        
        # 创建模式选择区域
        self.startup_mode = tk.StringVar(value="development")
        
        mode_frame = tk.LabelFrame(self.left_frame, text="运行模式", padx=5, pady=5)
        mode_frame.pack(fill=tk.X, pady=5)
        
        tk.Radiobutton(
            mode_frame, 
            text="开发者模式", 
            variable=self.startup_mode, 
            value="development"
        ).pack(anchor=tk.W)
        
        tk.Radiobutton(
            mode_frame, 
            text="生产模式", 
            variable=self.startup_mode, 
            value="production"
        ).pack(anchor=tk.W)
        
        # 日志级别选择
        log_level_frame = tk.LabelFrame(self.left_frame, text="日志级别设置", padx=5, pady=5)
        log_level_frame.pack(fill=tk.X, pady=5)
        
        # 前端日志级别
        tk.Label(log_level_frame, text="进程捕获:").pack(anchor=tk.W)
        self.log_level = tk.StringVar(value="INFO")
        
        # 使用 OptionMenu 替代 Combobox
        log_level_frame_opt = tk.Frame(log_level_frame)
        log_level_frame_opt.pack(fill=tk.X, pady=2)
        
        tk.Label(log_level_frame_opt, text="级别:", width=6).pack(side=tk.LEFT)
        log_level_menu = tk.OptionMenu(
            log_level_frame_opt, 
            self.log_level, 
            "DEBUG", "INFO", "WARNING", "ERROR"
        )
        log_level_menu.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        tk.Label(log_level_frame, text="越低级别显示越多日志", 
                 font=('Arial', 8), foreground='gray').pack(anchor=tk.W)
        
        # GUI 显示日志级别
        tk.Label(log_level_frame, text="界面显示:").pack(anchor=tk.W, pady=(5,0))
        self.gui_log_level = tk.StringVar(value="INFO")
        
        gui_log_level_frame = tk.Frame(log_level_frame)
        gui_log_level_frame.pack(fill=tk.X, pady=2)
        
        tk.Label(gui_log_level_frame, text="级别:", width=6).pack(side=tk.LEFT)
        self.gui_log_level_menu = tk.OptionMenu(
            gui_log_level_frame, 
            self.gui_log_level, 
            "DEBUG", "INFO", "WARNING", "ERROR",
            command=self._on_gui_level_changed
        )
        self.gui_log_level_menu.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        # 日志说明
        help_frame = tk.LabelFrame(self.left_frame, text="日志级别说明", padx=5, pady=5)
        help_frame.pack(fill=tk.X, pady=5, expand=True)
        
        help_text = """🔴 ERROR - 错误信息
   程序运行错误，需要关注

🟠 WARNING - 警告信息
   可能有问题但可继续

🔵 INFO - 一般信息
   正常流程记录

⚪ DEBUG - 调试信息
   详细的开发调试数据"""
        
        help_label = tk.Label(
            help_frame, 
            text=help_text,
            font=('Consolas', 9),
            justify=tk.LEFT
        )
        help_label.pack(anchor=tk.W)
        
        # 创建按钮框架
        self.button_frame = tk.Frame(self.left_frame)
        self.button_frame.pack(fill=tk.X, pady=10, side=tk.BOTTOM)
        
        # 创建按钮
        self.start_button = tk.Button(
            self.button_frame, 
            text="启动", 
            command=self.start_app, 
            width=10
        )
        self.start_button.pack(side=tk.LEFT, padx=5)
        
        self.restart_button = tk.Button(
            self.button_frame, 
            text="重启", 
            command=self.restart_app, 
            width=10
        )
        self.restart_button.pack(side=tk.LEFT, padx=5)
        
        self.stop_button = tk.Button(
            self.button_frame, 
            text="停止", 
            command=self.stop_app, 
            width=10
        )
        self.stop_button.pack(side=tk.LEFT, padx=5)
        
        # 日志目录按钮
        self.log_button = tk.Button(
            self.button_frame,
            text="日志",
            command=self.open_log_dir,
            width=8
        )
        self.log_button.pack(side=tk.RIGHT, padx=5)
        
        # ===== 右侧面板：日志显示区域 =====
        log_display_frame = tk.LabelFrame(self.right_frame, text="实时日志", padx=5, pady=5)
        log_display_frame.pack(fill=tk.BOTH, expand=True)
        
        # 日志工具栏
        log_toolbar = tk.Frame(log_display_frame)
        log_toolbar.pack(fill=tk.X, pady=(0, 5))
        
        tk.Button(
            log_toolbar, 
            text="🗑️ 清空", 
            command=self.clear_gui_log,
            width=8
        ).pack(side=tk.LEFT, padx=2)
        
        tk.Button(
            log_toolbar,
            text="⏸️ 暂停",
            command=self.toggle_log_pause,
            width=8
        ).pack(side=tk.LEFT, padx=2)
        
        self.log_pause_var = tk.BooleanVar(value=False)
        
        # 显示哪些日志类型的复选框
        self.show_system_log = tk.BooleanVar(value=True)
        self.show_frontend_log = tk.BooleanVar(value=True)
        self.show_backend_log = tk.BooleanVar(value=True)
        
        tk.Checkbutton(
            log_toolbar, 
            text="系统", 
            variable=self.show_system_log,
            command=self._update_gui_log_filters
        ).pack(side=tk.RIGHT, padx=2)
        
        tk.Checkbutton(
            log_toolbar,
            text="后端",
            variable=self.show_backend_log,
            command=self._update_gui_log_filters
        ).pack(side=tk.RIGHT, padx=2)
        
        tk.Checkbutton(
            log_toolbar,
            text="前端",
            variable=self.show_frontend_log,
            command=self._update_gui_log_filters
        ).pack(side=tk.RIGHT, padx=2)
        
        tk.Label(log_toolbar, text="显示:").pack(side=tk.RIGHT, padx=2)
        
        # 日志显示文本框
        self.log_text = scrolledtext.ScrolledText(
            log_display_frame,
            wrap=tk.WORD,
            font=('Consolas', 10),
            state='disabled',
            height=20
        )
        self.log_text.pack(fill=tk.BOTH, expand=True)
        
        # 配置日志级别颜色标签
        self.log_text.tag_configure('level_DEBUG', foreground='#808080')
        self.log_text.tag_configure('level_INFO', foreground='#000000')
        self.log_text.tag_configure('level_WARNING', foreground='#FF8C00')
        self.log_text.tag_configure('level_ERROR', foreground='#FF0000')
        self.log_text.tag_configure('level_CRITICAL', foreground='#8B0000')
        
        # 添加 GUI 日志处理器
        self._setup_gui_log_handlers()
        
        # 添加状态栏
        self.status_bar = ttk.Label(
            self.root, 
            text="就绪", 
            relief=tk.SUNKEN, 
            anchor=tk.W, 
            font=('Arial', 9)
        )
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)
        
        # 绑定关闭事件
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # 初始化状态
        self.update_status()
        self.root.after(2000, self.update_status)
        
        # 记录启动信息到 GUI
        self.system_log.info("启动器初始化完成")
        self.system_log.info(f"日志目录: {self.logger_manager.get_session_dir()}")
    
    def open_log_dir(self):
        """打开日志目录"""
        log_dir = self.logger_manager.get_session_dir()
        if log_dir.exists():
            os.startfile(log_dir)
            self.operation_log.info(f"打开日志目录: {log_dir}")
    
    def _get_process_using_port(self, port, cache_timeout=5):
        """获取占用指定端口的进程信息
        
        Args:
            port: 端口号
            cache_timeout: 缓存过期时间（秒）
            
        Returns:
            list: [(pid, name, cmdline), ...] 占用该端口的进程列表
        """
        # 初始化缓存
        if not hasattr(self, '_port_cache'):
            self._port_cache = {}
        
        cache_key = f"port_{port}"
        current_time = time.time()
        
        # 检查缓存是否有效
        if cache_key in self._port_cache:
            cached_time, cached_result = self._port_cache[cache_key]
            if current_time - cached_time < cache_timeout:
                return cached_result
        
        # 执行实际检查
        processes = []
        try:
            for conn in psutil.net_connections(kind='inet'):
                if conn.laddr.port == port:
                    try:
                        proc = psutil.Process(conn.pid)
                        processes.append((
                            conn.pid,
                            proc.name(),
                            proc.cmdline() if proc.cmdline() else []
                        ))
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        processes.append((conn.pid, "Unknown", []))
        except Exception as e:
            self.system_log.error(f"获取端口 {port} 占用信息时出错: {e}")
        
        # 更新缓存
        self._port_cache[cache_key] = (current_time, processes)
        return processes
    
    def _check_and_release_ports(self):
        """检查并释放端口（在主线程中执行）
        
        Returns:
            bool: 是否成功释放或无需释放
        """
        # 检查后端端口
        backend_processes = self._get_process_using_port(self.backend_port)
        
        if backend_processes:
            # 过滤掉当前进程
            current_pid = os.getpid()
            other_processes = [(pid, name, cmdline) for pid, name, cmdline in backend_processes if pid != current_pid]
            
            if other_processes:
                proc_list = '\n'.join([f"PID {pid}: {name}" for pid, name, _ in other_processes])
                
                if not messagebox.askyesno(
                    "端口被占用",
                    f"端口 {self.backend_port} 被以下进程占用:\n\n{proc_list}\n\n是否终止这些进程并继续启动？"
                ):
                    self.system_log.info("用户取消启动")
                    return False
                
                # 用户确认后释放端口
                return self.release_port(self.backend_port, force=True)
        
        return True
    
    def release_port(self, port, force=False):
        """释放指定端口，终止占用该端口的进程
        
        Args:
            port: 要释放的端口号
            force: 是否强制终止（不询问用户）
            
        Returns:
            bool: 是否成功释放
        """
        processes = self._get_process_using_port(port)
        
        if not processes:
            self.system_log.info(f"端口 {port} 未被占用")
            return True
        
        self.system_log.warning(f"端口 {port} 被以下进程占用:")
        for pid, name, cmdline in processes:
            cmd_str = ' '.join(cmdline[:3]) + ('...' if len(cmdline) > 3 else '') if cmdline else ''
            self.system_log.warning(f"  PID {pid}: {name} {cmd_str}")
        
        # 如果不是强制模式，询问用户
        if not force:
            # 过滤掉当前 launcher 自身
            current_pid = os.getpid()
            other_processes = [(pid, name, cmdline) for pid, name, cmdline in processes if pid != current_pid]
            
            if not other_processes:
                return True
            
            # 在主线程中显示确认对话框并使用回调处理
            def ask_user_and_proceed():
                proc_list = '\n'.join([f"PID {pid}: {name}" for pid, name, _ in other_processes])
                user_confirm = messagebox.askyesno(
                    "端口被占用",
                    f"端口 {port} 被以下进程占用:\n\n{proc_list}\n\n是否终止这些进程并继续启动？"
                )
                
                if user_confirm:
                    # 用户确认后继续执行终止进程的操作
                    terminate_processes(other_processes)
                else:
                    self.system_log.info("用户取消释放端口")
            
            def terminate_processes(processes_to_terminate):
                # 终止进程
                terminated = []
                failed = []
                
                for pid, name, _ in processes_to_terminate:
                    if pid == os.getpid():  # 跳过自身
                        continue
                        
                    try:
                        proc = psutil.Process(pid)
                        proc.terminate()
                        
                        # 等待进程终止
                        try:
                            proc.wait(timeout=3)
                            terminated.append((pid, name))
                        except psutil.TimeoutExpired:
                            # 强制终止
                            proc.kill()
                            proc.wait(timeout=1)
                            terminated.append((pid, name))
                            
                    except Exception as e:
                        failed.append((pid, name, str(e)))
                
                # 记录结果
                if terminated:
                    self.system_log.info(f"已终止 {len(terminated)} 个进程:")
                    for pid, name in terminated:
                        self.system_log.info(f"  - PID {pid}: {name}")
                
                if failed:
                    self.system_log.error(f"无法终止 {len(failed)} 个进程:")
                    for pid, name, error in failed:
                        self.system_log.error(f"  - PID {pid}: {name} ({error})")
                
                # 验证端口是否已释放
                time.sleep(0.5)
                if not self._get_process_using_port(port):
                    self.system_log.info(f"✅ 端口 {port} 已成功释放")
                else:
                    self.system_log.error(f"❌ 端口 {port} 仍被占用")
            
            # 在主线程中执行询问
            self.root.after(0, ask_user_and_proceed)
            return True  # 立即返回，后续操作在回调中执行
        
        # 强制模式下直接终止进程
        def terminate_processes_force():
            # 终止进程
            terminated = []
            failed = []
            
            for pid, name, _ in processes:
                if pid == os.getpid():  # 跳过自身
                    continue
                    
                try:
                    proc = psutil.Process(pid)
                    proc.terminate()
                    
                    # 等待进程终止
                    try:
                        proc.wait(timeout=3)
                        terminated.append((pid, name))
                    except psutil.TimeoutExpired:
                        # 强制终止
                        proc.kill()
                        proc.wait(timeout=1)
                        terminated.append((pid, name))
                        
                except Exception as e:
                    failed.append((pid, name, str(e)))
            
            # 记录结果
            if terminated:
                self.system_log.info(f"已终止 {len(terminated)} 个进程:")
                for pid, name in terminated:
                    self.system_log.info(f"  - PID {pid}: {name}")
            
            if failed:
                self.system_log.error(f"无法终止 {len(failed)} 个进程:")
                for pid, name, error in failed:
                    self.system_log.error(f"  - PID {pid}: {name} ({error})")
            
            # 验证端口是否已释放
            time.sleep(0.5)
            if not self._get_process_using_port(port):
                self.system_log.info(f"✅ 端口 {port} 已成功释放")
                return True
            else:
                self.system_log.error(f"❌ 端口 {port} 仍被占用")
                return False
        
        # 执行强制终止
        return terminate_processes_force()
    
    def is_backend_running(self):
        """检查后端服务是否正在运行（通过端口检测）"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex((self.backend_host, self.backend_port))
            sock.close()
            return result == 0
        except Exception as e:
            self.system_log.error(f"检查后端状态时出错: {e}")
            return False
    
    def is_frontend_running(self):
        """检查前端应用是否正在运行"""
        try:
            for proc in psutil.process_iter(['name']):
                if proc.info['name'] == 'electron.exe':
                    return True
            return False
        except Exception as e:
            self.system_log.error(f"检查前端状态时出错: {e}")
            return False
    
    def update_status(self):
        """更新应用状态显示"""
        def check_status():
            try:
                backend_ok = self.is_backend_running()
                frontend_ok = self.is_frontend_running()
                
                # 在主线程中更新 GUI
                def update_gui():
                    if backend_ok and frontend_ok:
                        self.status_var.set("✅ 前后端运行中")
                        self.status_label.configure(foreground="green")
                    elif backend_ok:
                        self.status_var.set("🟡 后端运行中，前端未启动")
                        self.status_label.configure(foreground="orange")
                    elif frontend_ok:
                        self.status_var.set("🟡 前端运行中，后端未连接")
                        self.status_label.configure(foreground="orange")
                    else:
                        self.status_var.set("❌ 服务未运行")
                        self.status_label.configure(foreground="red")
                
                self.root.after(0, update_gui)
            except Exception as e:
                self.system_log.error(f"检查状态时出错: {e}")
        
        # 在后台线程中执行状态检查
        thread = threading.Thread(target=check_status)
        thread.daemon = True
        thread.start()
        
        # 增加检查间隔到 5 秒
        self.root.after(5000, self.update_status)
    
    def set_status(self, message, status_type="info"):
        """设置状态栏消息"""
        self.status_bar.config(text=message)
        if status_type == "error":
            self.status_bar.config(foreground="red")
        else:
            self.status_bar.config(foreground="black")
    
    def start_backend(self):
        """启动后端服务"""
        if self.is_backend_running():
            self.system_log.info("后端服务已在运行中")
            return True
        
        self.system_log.info("正在启动后端服务...")
        self.system_log.info(f"后端路径: {self.backend_path}")
        self.set_status("正在启动后端服务...")
        
        try:
            # 构建后端项目路径
            backend_proj = self.backend_path / "backend.csproj"
            
            if not backend_proj.exists():
                error_msg = f"找不到后端项目文件: {backend_proj}"
                self.system_log.error(error_msg)
                raise FileNotFoundError(error_msg)
            
            self.system_log.info(f"找到项目文件: {backend_proj}")
            
            # 检查 dotnet 命令是否可用
            try:
                dotnet_version = subprocess.run(
                    ["dotnet", "--version"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if dotnet_version.returncode == 0:
                    self.system_log.info(f"dotnet 版本: {dotnet_version.stdout.strip()}")
                else:
                    self.system_log.warning("无法获取 dotnet 版本")
            except FileNotFoundError:
                error_msg = "找不到 dotnet 命令，请确保已安装 .NET SDK 并添加到环境变量"
                self.system_log.error(error_msg)
                raise RuntimeError(error_msg)
            except Exception as e:
                self.system_log.warning(f"检查 dotnet 版本时出错: {e}")
            
            # 使用 dotnet run 启动后端
            self.system_log.info("执行命令: dotnet run --project backend.csproj")
            self.backend_process = subprocess.Popen(
                ["dotnet", "run", "--project", str(backend_proj)],
                cwd=str(self.backend_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                universal_newlines=False
            )
            
            self.system_log.info(f"后端进程已启动，PID: {self.backend_process.pid}")
            
            # 启动输出读取线程
            reader = ProcessOutputReader(
                self.backend_process,
                self.backend_log,
                log_prefix="BACKEND",
                log_level="DEBUG"
            )
            reader.start()
            self.output_readers.append(reader)
            
            # 等待一小段时间检查进程是否立即退出
            time.sleep(1)
            exit_code = self.backend_process.poll()
            if exit_code is not None:
                error_msg = f"后端进程启动后立即退出，退出码: {exit_code}"
                self.system_log.error(error_msg)
                raise RuntimeError(error_msg)
            
            # 等待后端启动（最多等待30秒）
            self.system_log.info("等待后端服务就绪...")
            for i in range(30):
                time.sleep(1)
                if self.is_backend_running():
                    self.system_log.info("✅ 后端服务启动成功")
                    return True
                
                # 检查进程是否已退出
                exit_code = self.backend_process.poll()
                if exit_code is not None:
                    error_msg = f"后端进程异常退出，退出码: {exit_code}"
                    self.system_log.error(error_msg)
                    raise RuntimeError(error_msg)
                
                # 每 5 秒记录一次进度
                if (i + 1) % 5 == 0:
                    self.system_log.info(f"等待后端就绪... {i+1}/30 秒")
            
            # 超时但进程仍在运行
            if self.backend_process.poll() is None:
                self.system_log.warning("⚠️ 后端服务启动超时，但进程仍在运行")
                self.system_log.warning(f"请检查端口 {self.backend_port} 是否被占用，或查看 backend.log 了解详情")
                return True
            else:
                error_msg = f"后端服务启动失败，退出码: {self.backend_process.returncode}"
                self.system_log.error(error_msg)
                raise RuntimeError(error_msg)
                
        except Exception as e:
            self.system_log.error(f"❌ 启动后端服务失败: {e}")
            raise
    
    def start_frontend(self):
        """启动前端应用"""
        if self.is_frontend_running():
            self.system_log.info("前端应用已在运行中")
            return True
        
        self.system_log.info("正在启动前端应用...")
        self.set_status("正在启动前端应用...")
        
        try:
            mode = self.startup_mode.get()
            log_level = self.log_level.get()
            
            # 检查 package.json 是否存在
            package_json = self.frontend_path / "package.json"
            if not package_json.exists():
                error_msg = f"找不到 package.json: {package_json}"
                self.system_log.error(error_msg)
                raise FileNotFoundError(error_msg)
            
            # 设置环境变量
            env = os.environ.copy()
            if mode == "development":
                env["NODE_ENV"] = "development"
                command = "npm run electron:dev"
                self.system_log.info(f"使用开发模式启动，日志级别: {log_level}")
            else:
                env["NODE_ENV"] = "production"
                # 生产模式：先检查构建
                dist_path = self.frontend_path / "dist"
                index_html = dist_path / "index.html"
                
                if not index_html.exists():
                    self.system_log.info("前端未构建，正在构建...")
                    self.set_status("正在构建前端应用...")
                    
                    build_process = subprocess.Popen(
                        "npm run build",
                        cwd=str(self.frontend_path),
                        shell=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE
                    )
                    build_process.wait()
                    
                    if not index_html.exists():
                        error_msg = "前端构建失败"
                        self.system_log.error(error_msg)
                        raise RuntimeError(error_msg)
                    
                    self.system_log.info("前端构建完成")
                
                command = "npm run electron"
                self.system_log.info(f"使用生产模式启动，日志级别: {log_level}")
            
            # 启动前端进程
            self.frontend_process = subprocess.Popen(
                command,
                cwd=str(self.frontend_path),
                env=env,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                universal_newlines=False
            )
            
            # 启动输出读取线程
            reader = ProcessOutputReader(
                self.frontend_process,
                self.frontend_log,
                log_prefix="FRONTEND",
                log_level=log_level
            )
            reader.start()
            self.output_readers.append(reader)
            
            # 等待前端启动（最多等待60秒）
            self.system_log.info("等待前端服务就绪...")
            for i in range(60):
                time.sleep(1)
                if self.is_frontend_running():
                    self.system_log.info("✅ 前端应用启动成功")
                    return True
                
                # 每 5 秒记录一次进度
                if (i + 1) % 5 == 0:
                    self.system_log.info(f"等待前端就绪... {i+1}/60 秒")
            
            self.system_log.warning("前端应用启动超时，但进程可能仍在启动中")
            return True
            
        except Exception as e:
            self.system_log.error(f"启动前端应用失败: {e}")
            raise
    
    def stop_backend(self):
        """停止后端服务"""
        if not self.is_backend_running():
            self.system_log.info("后端服务未在运行")
            return
        
        self.system_log.info("正在停止后端服务...")
        self.set_status("正在停止后端服务...")
        
        try:
            # 尝试终止 dotnet 进程
            for proc in psutil.process_iter(['name', 'cmdline']):
                try:
                    if proc.info['name'] == 'dotnet.exe':
                        cmdline = ' '.join(proc.info['cmdline'] or [])
                        if 'backend' in cmdline or 'DesktopManager' in cmdline:
                            proc.terminate()
                            self.system_log.info(f"终止后端进程 PID={proc.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            # 等待进程终止
            time.sleep(2)
            
            # 强制终止仍在运行的进程
            for proc in psutil.process_iter(['name', 'cmdline']):
                try:
                    if proc.info['name'] == 'dotnet.exe':
                        cmdline = ' '.join(proc.info['cmdline'] or [])
                        if 'backend' in cmdline or 'DesktopManager' in cmdline:
                            proc.kill()
                            self.system_log.info(f"强制终止后端进程 PID={proc.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            if self.backend_process and self.backend_process.poll() is None:
                self.backend_process.terminate()
                try:
                    self.backend_process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.backend_process.kill()
            
            self.system_log.info("后端服务已停止")
            
        except Exception as e:
            self.system_log.error(f"停止后端服务时出错: {e}")
    
    def stop_frontend(self):
        """停止前端应用"""
        if not self.is_frontend_running():
            self.system_log.info("前端应用未在运行")
            return
        
        self.system_log.info("正在停止前端应用...")
        self.set_status("正在停止前端应用...")
        
        try:
            # 终止所有 Electron 进程
            for proc in psutil.process_iter(['name']):
                try:
                    if proc.info['name'] == 'electron.exe':
                        proc.terminate()
                        self.system_log.info(f"终止前端进程 PID={proc.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            # 等待进程终止
            time.sleep(2)
            
            # 强制终止
            for proc in psutil.process_iter(['name']):
                try:
                    if proc.info['name'] == 'electron.exe':
                        proc.kill()
                        self.system_log.info(f"强制终止前端进程 PID={proc.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            if self.frontend_process and self.frontend_process.poll() is None:
                self.frontend_process.terminate()
                try:
                    self.frontend_process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.frontend_process.kill()
            
            self.system_log.info("前端应用已停止")
            
        except Exception as e:
            self.system_log.error(f"停止前端应用时出错: {e}")
    
    def start_app(self):
        """启动应用（前后端）"""
        mode = self.startup_mode.get()
        self.operation_log.info(f"用户点击启动按钮，模式: {mode}")
        
        # 在主线程中检查并释放端口
        if not self._check_and_release_ports():
            return  # 用户取消或释放失败
        
        # 禁用按钮
        self.disable_buttons()
        
        def start_thread():
            try:
                # 先启动后端
                self.start_backend()
                
                # 等待后端完全启动
                time.sleep(2)
                
                # 再启动前端
                self.start_frontend()
                
                # 等待前端启动
                time.sleep(2)
                
                mode_text = "开发者模式" if mode == "development" else "生产模式"
                self.root.after(0, lambda: messagebox.showinfo(
                    "成功", 
                    f"应用启动成功！\n当前模式：{mode_text}"
                ))
                self.set_status(f"应用已启动（{mode_text}）")
                self.operation_log.info(f"应用启动成功，模式: {mode_text}")
                
            except Exception as e:
                error_msg = str(e)
                self.root.after(0, lambda: messagebox.showerror("错误", f"启动失败: {error_msg}"))
                self.set_status(f"启动失败: {error_msg}", "error")
                self.operation_log.error(f"应用启动失败: {error_msg}")
            finally:
                self.root.after(0, self.enable_buttons)
        
        thread = threading.Thread(target=start_thread)
        thread.daemon = True
        thread.start()
    
    def stop_app(self):
        """停止应用（前后端）"""
        self.operation_log.info("用户点击停止按钮")
        
        if not self.is_backend_running() and not self.is_frontend_running():
            messagebox.showinfo("提示", "应用未在运行！")
            return
        
        if messagebox.askyesno("确认", "确定要停止应用吗？"):
            self.disable_buttons()
            
            def stop_thread():
                try:
                    # 先停止前端
                    self.stop_frontend()
                    
                    # 等待
                    time.sleep(1)
                    
                    # 再停止后端
                    self.stop_backend()
                    
                    time.sleep(1)
                    
                    self.root.after(0, lambda: messagebox.showinfo("成功", "应用已成功停止！"))
                    self.set_status("应用已停止")
                    self.operation_log.info("应用已停止")
                    
                except Exception as e:
                    error_msg = str(e)
                    self.root.after(0, lambda: messagebox.showerror("错误", f"停止失败: {error_msg}"))
                    self.set_status(f"停止失败: {error_msg}", "error")
                    self.operation_log.error(f"应用停止失败: {error_msg}")
                finally:
                    self.root.after(0, self.enable_buttons)
            
            thread = threading.Thread(target=stop_thread)
            thread.daemon = True
            thread.start()
    
    def restart_app(self):
        """重启应用"""
        mode = self.startup_mode.get()
        self.operation_log.info(f"用户点击重启按钮，模式: {mode}")
        self.set_status("正在重启应用...")
        
        self.disable_buttons()
        
        def restart_thread():
            try:
                # 停止前端
                self.stop_frontend()
                time.sleep(1)
                
                # 停止后端
                self.stop_backend()
                time.sleep(2)
                
                # 启动后端
                self.start_backend()
                time.sleep(2)
                
                # 启动前端
                self.start_frontend()
                time.sleep(2)
                
                mode_text = "开发者模式" if mode == "development" else "生产模式"
                self.root.after(0, lambda: messagebox.showinfo(
                    "成功", 
                    f"应用重启成功！\n当前模式：{mode_text}"
                ))
                self.set_status(f"应用已重启（{mode_text}）")
                self.operation_log.info(f"应用重启成功，模式: {mode_text}")
                
            except Exception as e:
                error_msg = str(e)
                self.root.after(0, lambda: messagebox.showerror("错误", f"重启失败: {error_msg}"))
                self.set_status(f"重启失败: {error_msg}", "error")
                self.operation_log.error(f"应用重启失败: {error_msg}")
            finally:
                self.root.after(0, self.enable_buttons)
        
        thread = threading.Thread(target=restart_thread)
        thread.daemon = True
        thread.start()
    
    def disable_buttons(self):
        """禁用所有按钮"""
        self.start_button.config(state=tk.DISABLED)
        self.restart_button.config(state=tk.DISABLED)
        self.stop_button.config(state=tk.DISABLED)
    
    def enable_buttons(self):
        """启用所有按钮"""
        self.start_button.config(state=tk.NORMAL)
        self.restart_button.config(state=tk.NORMAL)
        self.stop_button.config(state=tk.NORMAL)
    
    def _setup_gui_log_handlers(self):
        """设置 GUI 日志处理器"""
        gui_level = self.gui_log_level.get()
        
        # 为每个日志器添加 GUI 处理器
        handlers_config = [
            (self.system_log, 'system'),
            (self.frontend_log, 'frontend'),
            (self.backend_log, 'backend')
        ]
        
        for logger, log_type in handlers_config:
            handler = TkinterLogHandler(
                self.log_text,
                level=getattr(logging, gui_level),
                max_lines=500
            )
            handler.set_name(f'gui_{log_type}')
            logger.addHandler(handler)
            self.gui_handlers.append(handler)
    
    def _on_gui_level_changed(self, event=None):
        """GUI 日志级别改变时更新处理器"""
        new_level = self.gui_log_level.get()
        level_value = getattr(logging, new_level)
        
        for handler in self.gui_handlers:
            handler.setLevel(level_value)
        
        self.system_log.info(f"界面日志级别已切换为: {new_level}")
    
    def _update_gui_log_filters(self):
        """更新 GUI 日志类型过滤"""
        # 移除所有 GUI 处理器
        for handler in self.gui_handlers:
            handler.flush()
        
        self.gui_handlers.clear()
        
        # 从所有日志器中移除 GUI 处理器
        for logger_name in ['system', 'frontend', 'backend']:
            logger = self.logger_manager.get_logger(logger_name)
            for handler in logger.handlers[:]:
                if isinstance(handler, TkinterLogHandler):
                    logger.removeHandler(handler)
        
        # 重新添加启用的日志类型
        gui_level = self.gui_log_level.get()
        level_value = getattr(logging, gui_level)
        
        enabled_loggers = []
        if self.show_system_log.get():
            enabled_loggers.append((self.system_log, 'system'))
        if self.show_frontend_log.get():
            enabled_loggers.append((self.frontend_log, 'frontend'))
        if self.show_backend_log.get():
            enabled_loggers.append((self.backend_log, 'backend'))
        
        for logger, log_type in enabled_loggers:
            handler = TkinterLogHandler(
                self.log_text,
                level=level_value,
                max_lines=500
            )
            handler.set_name(f'gui_{log_type}')
            logger.addHandler(handler)
            self.gui_handlers.append(handler)
        
        self.system_log.info("日志显示过滤器已更新")
    
    def clear_gui_log(self):
        """清空 GUI 日志显示"""
        self.log_text.configure(state='normal')
        self.log_text.delete('1.0', 'end')
        self.log_text.configure(state='disabled')
        self.system_log.info("日志显示已清空")
    
    def toggle_log_pause(self):
        """暂停/恢复日志显示"""
        current = self.log_pause_var.get()
        self.log_pause_var.set(not current)
        
        for handler in self.gui_handlers:
            if self.log_pause_var.get():
                handler.setLevel(logging.CRITICAL + 1)  # 暂停所有日志
            else:
                handler.setLevel(getattr(logging, self.gui_log_level.get()))
        
        status = "已暂停" if self.log_pause_var.get() else "已恢复"
        self.system_log.info(f"日志显示{status}")
    
    def on_close(self):
        """窗口关闭事件处理"""
        self.system_log.info("用户关闭启动器窗口")
        
        # 询问是否停止服务
        if self.is_backend_running() or self.is_frontend_running():
            if messagebox.askyesno("确认", "是否同时停止应用服务？"):
                self.stop_frontend()
                self.stop_backend()
        
        # 停止所有输出读取器
        for reader in self.output_readers:
            reader.stop()
        
        self.system_log.info("Desktop Manager Launcher 退出")
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = DesktopManagerLauncher(root)
    root.mainloop()
