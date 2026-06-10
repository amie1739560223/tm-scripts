// ==UserScript==
// @name         CSY OS全能编辑器
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  支持角色/群聊识别、按日期/关键词搜索、多选复制/删除、编辑历史消息、时间平移与ID重排
// @author       自用
// @match        https://sully-frontend.pages.dev/*
// @match        https://qegj567-cloud.github.io/SullyOS/*
// @grant        none
// @downloadURL https://github.com/amie1739560223/tm-scripts/raw/refs/heads/main/csy-os-editor.user.js
// @updateURL   https://github.com/amie1739560223/tm-scripts/raw/refs/heads/main/csy-os-editor.user.js
// @require https://cdn.jsdelivr.net/npm/dom-to-image-more@3.4.0/dist/dom-to-image-more.min.js
// ==/UserScript==

(function() {
    'use strict';

    const DB_NAME = 'AetherOS_Data';
    let db = null;
    let allRoles = [];
    let selectedRole = null;
    let currentMessages = []; // 当前角色的所有消息（原始数组）
    let filteredMessages = []; // 搜索过滤后的消息
    let selectedIds = new Set(); // 存储选中的消息ID，确保排序不乱
    let isDragging = false;
    let offsetX = 0, offsetY = 0;
    let displayStart = 0;
    const DISPLAY_LIMIT = 50;

    const CONFIG_DB_NAME = 'CSY_Editor_Configs';


const DEFAULT_THEME_CSS = `

/* --- 1. 背景层 --- */
.sully-chat-container {
    background: #ededed !important;
    border: none !important;
    box-shadow: none !important;
}

/* --- 2. 消息行 --- */
.preview-row {
    background: transparent !important;
    border: none !important;
    padding: 6px 12px !important;
    display: block !important;
    width: 100% !important;
    box-sizing: border-box !important;
}

/* --- 3. 时间戳 (微信风格) --- */
.sully-msg-timestamp {
    font-size: 12px !important;
    color: #b2b2b2 !important;
    text-align: center !important;
    margin: 16px 0 8px 0 !important;
    background: transparent !important;
    user-select: none;
}

/* --- 4. 气泡与选中 --- */
.sully-bubble-user { background: #95ec69 !important; border-radius: 6px !important; color: #000 !important; }
.sully-bubble-ai { background: #ffffff !important; border-radius: 6px !important; color: #000 !important; }
.preview-row.selected { background-color: rgba(7, 193, 96, 0.15) !important; }

/* --- 5. 图片与表情包 --- */
.sully-is-image { background: transparent !important; padding: 0 !important; box-shadow: none !important; }
.sully-photo { max-width: 240px !important; border-radius: 10px !important; }
.sully-sticker { width: 140px !important; height: 140px !important; object-fit: contain; }

/* --- 6. 字体与布局 --- */
* { box-sizing: border-box !important; font-family: 'Quicksand', sans-serif; }
.sully-msg-content-wrapper { display: flex; width: 100%; align-items: flex-start; margin-top: 4px; }
`.trim();



    // 数据库助手
    const ConfigDB = {
        open() {
            return new Promise((res, rej) => {
                const req = indexedDB.open(CONFIG_DB_NAME, 1);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('themes')) db.createObjectStore('themes', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
                };
                req.onsuccess = () => res(req.result);
                req.onerror = rej;
            });
        },
        async saveTheme(css) {
            const db = await this.open();
            return new Promise(res => {
                const tx = db.transaction('themes', 'readwrite');
                tx.objectStore('themes').put({ id: 'current', css: css, time: Date.now() });
                tx.oncomplete = () => res();
            });
        },
        async getTheme() {
    const db = await this.open();
    return new Promise(res => {
        const tx = db.transaction('themes', 'readonly');
        tx.objectStore('themes').get('current').onsuccess = e => {
            res(e.target.result?.css || DEFAULT_THEME_CSS);
        };
    });
},

        async saveFont(name, base64) {
            const db = await this.open();
            db.transaction('fonts', 'readwrite').objectStore('fonts').put({ id: 'custom', name, data: base64 });
        },
        async getFont() {
            const db = await this.open();
            return new Promise(res => {
                db.transaction('fonts', 'readonly').objectStore('fonts').get('custom').onsuccess = e => res(e.target.result);
            });
        }
    };


    // 状态控制
    let sortOrder = 'desc'; // 'desc' 倒序, 'asc' 正序
    let isSearchMode = false;

    // 悬浮球相关变量
    let clickPrevented = false;
    let dragDistance = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;

    // 创建悬浮球
    const floatBall = document.createElement('div');
    floatBall.style.cssText = `
        position: fixed;
        top: 100px;         /* 距离顶部 100px，避免挡住某些系统的返回键 */
        left: 0px;          /* 初始贴紧左侧边缘 */
        width: 50px;
        height: 50px;
        background: #673AB7;
        border-radius: 50%;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: move;
        z-index: 9999;
        font-size: 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.2s;
        opacity: 0.3;

        -webkit-user-select: none;  /* 禁止选中 */
        -webkit-touch-callout: none; /* 彻底禁止 iOS/安卓长按弹出菜单 */
        user-select: none;
        touch-action: none;         /* 告诉浏览器：这个球的触摸由我完全接管 */
    `;


    floatBall.innerText = '⏰';
    document.body.appendChild(floatBall);


    // 创建遮罩面板
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.3); z-index: 10000; display: none;
        justify-content: center; align-items: center; backdrop-filter: blur(2px);
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 20px;
        width: 90vw;            /* ✨ 手机上占用屏幕宽度的 95% */
        max-width: 520px;       /* ✨ 电脑上最大不超过 520px */
        max-height: 85vh; overflow-y: auto;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2); position: relative;
        box-sizing: border-box; /* ✨ 确保 padding 不会撑大外框 */
    `;

    content.innerHTML = `
        <style>


/* 2. 仅将字体应用给预览层 */
    #chatPreviewLayer, #chatPreviewLayer * {
        font-family: 'Quicksand', -apple-system, system-ui, sans-serif !important;
    }

         #roleSection *, .section * {
        box-sizing: border-box;
    }
    /* 优化下拉框样式 */
    #charSelect {
        width: 100% !important;
        max-width: 100%;
        display: block;
        box-sizing: border-box; /* ✨ 极其重要：防止内边距撑破外框 */
        overflow: hidden;
        text-overflow: ellipsis; /* 文字过长显示省略号 */
    }
            .section { margin: 15px 0; padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #673AB7; }
            .btn { padding: 8px 15px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
            .btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
            .btn-primary { background: #673AB7; color: white; }
            .btn-success { background: #4CAF50; color: white; }
            .btn-warning { background: #FF9800; color: white; }
            .btn-danger { background: #f44336; color: white; }
            .btn:disabled { background: #ccc; cursor: not-allowed; }
            .message-item { padding: 8px 10px; border-bottom: 1px solid #eee; display: flex; align-items: center; background: white; transition: all 0.2s; border-radius: 4px; margin: 2px 0; }
            .message-item:hover { background: #f8f9fa; }

           .timestamp { width: 33px; font-family: 'Courier New', monospace; font-size: 11px; color: #666; flex-shrink: 0; margin-left: 7px;margin-right: 7px;line-height: 1.2;}


            .role-icon { flex-shrink: 0; font-size: 13px; color: #333; font-weight: 500; white-space: nowrap; }
            .message-content { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333; cursor: pointer; padding: 2px 4px 2px 1px;margin-left: -1px; }
            .message-content.expanded { white-space: normal; background-color: #f9f9f9; border-left: 2px solid #673AB7; }
            .highlight { background-color: #FFEB3B; font-weight: bold; }
            .locate-btn { font-size: 10px; padding: 2px 5px; background: #673AB7; color: white; border-radius: 3px; cursor: pointer; margin-left: 5px; }
            .pagination { display: flex; align-items: center; gap: 7px; font-size: 12px; }
            .pagination-btn { padding: 4px 10px; background: #e0e0e0; border: none; border-radius: 4px; cursor: pointer;
                              white-space: nowrap;/* 💡强制文字在一行显示 */
                              flex-shrink: 0;/* 💡防止在 Flex 布局中被压缩 */
                              font-size: 14px; /* 确保手机上字体不要太大 */
text-align: center;}

 /* 只需修改/添加这几行 */
#jumpDate, #searchKeyword {
    min-width: 0; /* 关键！解决输入框宽度问题 */
    max-width: 100%;
}

/* 只给有 ID 的工具栏按钮设宽度 */
#copySelectedBtn,
#expandAllBtn,
#delSelectedBtn,
#toggleSortBtn {
  width: 65px;
  box-sizing: border-box;
}


        </style>





        <div style="position: absolute; top: 10px; right: 10px; display: flex; gap: 8px;">
            <button id="hideBallBtn" class="btn btn-warning" style="padding: 5px 10px; font-size: 16px;" title="显示/隐藏悬浮球">👻</button>
            <button id="closeBtn" class="btn btn-danger" style="padding: 5px 10px;">×</button>
        </div>



        <h3 style="margin-top:0; color:#673AB7; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px;">⏰ CSY OS 全能编辑器</h3>



        <!-- ✨ 合并后的紫色框：状态与角色选择 -->
        <div class="section">
    <!-- 状态显示区 -->
    <div id="status" style="font-size:14px; padding:5px;">准备就绪</div>

    <!-- 角色选择区 -->
    <div id="roleSection"
         style="display:none; margin-top:10px; padding-top:10px; border-top: 1px solid #e0e0e0;">

        <div id="roleInfo"
             style="display:none; font-size:12px; color:#666; margin:0px 0px 3px 1px;">
        </div>

        <!-- 选择角色 + 预览/迁移 -->
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
            <div style="font-weight:bold; color:#555;">选择角色：</div>

            <div style="display:flex; gap:7px;">
                <button id="previewChatBtn" class="pagination-btn"
                        style="padding: 7px 10px; font-size:13px; width: 65px; background: #07c160; color: white;">
                    🖼️ 预览
                </button>
                <button id="dataPortalBtn" class="pagination-btn"
                        style="padding: 7px 10px; font-size:13px; width: 65px; background: #673AB7; color: white;">
                    📦 迁移
                </button>
            </div>
        </div>

        <select id="charSelect"
                style="width:100%; padding:10px; border:2px solid #e0e0e0; border-radius:6px; background:white;">
        </select>
    </div>
</div>

            <div class="section" id="messageSection" style="display:none;">
            <!-- 第一行：跳转 + 复制 + 展开 -->
            <div style="margin: 12px 0; display: flex; gap: 7px; align-items: center;">
                <input type="date" id="jumpDate" title="选择日期自动跳转" style="flex: 1; padding: 6px 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; min-width: 0;">

                <button id="expandAllBtn" class="pagination-btn" style="padding: 7px 10px; font-size:13px;">🔼 展开</button>
                <button id="toggleSortBtn" class="pagination-btn" style="padding: 7px 10px; font-size:13px;">🔃 排序</button>
            </div>
            <!-- 第二行：搜索 + 删除 + 排序 -->
            <div style="margin: 12px 0; display: flex; gap: 7px; align-items: center;">
                <input type="text" id="searchKeyword" placeholder="搜索内容(回车查找)..." style="flex: 1; padding: 6px 5px; border: 1px solid #673AB7; border-radius: 4px; font-size: 12px; min-width: 0;">
              <button id="copySelectedBtn" class="pagination-btn" style="padding: 7px 10px; font-size:13px;">📋 复制</button>
              <button id="delSelectedBtn" class="pagination-btn" style="padding: 7px 10px; font-size:13px; color: #c62828;">🗑️ 删除</button>
            </div>


            <!-- 第三行：全选 + 翻页 -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin: 15px 0 10px 0;">
                 <label style="font-size: 14px; display:flex; align-items:center; cursor:pointer;">
                     <input type="checkbox" id="selectAll" style="margin-right:4px;">全选本页
                 </label>

                 <div class="pagination">
                       <button id="prevBtn" class="pagination-btn" style="font-size: 11px; padding: 4px 10px;">◀</button>
                       <span id="pageInfo" style="margin: 0 5px;">1/1</span>
                       <button id="nextBtn" class="pagination-btn" style="font-size: 11px; padding: 4px 10px;">▶</button>
                 </div>


           </div>

            <!-- 第四行：消息列表 -->
            <div id="messageList" style="max-height:300px; overflow-y:auto; border:2px solid #e0e0e0; border-radius:6px; background:white; padding:5px;"></div>

            <!-- 第五行：底部统计区 (左侧显示选中，右侧显示总量) -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 8px; padding: 0 2px;">
                 <span id="selectedCount" style="font-size:14px; color:#673AB7; font-weight:bold;">已选 0 条</span>
                 <div id="messageStats" style="font-size:12px; color:#666;"></div>
            </div>
        </div>




        <div class="section" id="timeSection" style="display:none;">
            <div style="font-weight:bold; margin-bottom:5px;">目标时间设置：</div>
            <input type="datetime-local" id="targetTime" style="width:100%; padding:10px; border:2px solid #4CAF50; border-radius:6px;">
        </div>

<div id="result" style="padding:12px; border-radius:6px; font-size:14px; display:none; margin-top:15px;"></div>

        <div style="margin:15px 0; display:flex; gap:8px;">
            <button id="analyzeBtn" class="btn btn-warning" style="flex:1;">🔍 读取数据</button>
            <button id="updateBtn" class="btn btn-success" style="flex:1;" disabled>🚀 执行时间平移</button>
        </div>


                




    `;

    panel.appendChild(content);
    document.body.appendChild(panel);

      // 1. 创建全屏预览层 (粘贴在 appendChild(panel) 后面)
           // --- ✨ 预览层：Sully OS 极简复刻版 ---
    const previewLayer = document.createElement('div');
    previewLayer.id = 'chatPreviewLayer';
    previewLayer.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #f1f5f9; z-index: 20000; display: none;
    flex-direction: column;
    /* ✨ 完美的系统字体栈 */
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    -webkit-font-smoothing: antialiased; /* 让字体更平滑 */
`;

    previewLayer.innerHTML = `
        <!-- 1. 精简版顶部导航栏 -->
        <div style="height: 56px; background: #ededed; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;">
            <!-- 左侧返回按钮 -->
           <button id="closePreview" style="
  padding: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #111;
  display: flex;
  align-items: center;
">
  <svg width="20" height="20" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="160,200 80,128 160,56" />
  </svg>
</button>

 <!-- 中间角色名 -->
<div id="previewHeaderName" style="
    font-family: 'Quicksand', sans-serif; /* ✨ 核心：指定 Quicksand */
    font-weight: 500;                   /* ✨ 核心：使用 Semibold 500 */
    color: #000;
    font-size: 17px;                    /* ✨ 稍微调大一点，匹配该字体的视觉大小 */
    text-align: center;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.02em;             /* ✨ Quicksand 稍微张开一点间距更好看 */
">聊天预览</div>




            <!-- 右侧三个点菜单（大粗点版） -->
<div id="openSkinBtn" style="padding: 8px; color: #111; display: flex; align-items: center; cursor:pointer;">
  <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
    <circle cx="60"  cy="128" r="18"/>
    <circle cx="128" cy="128" r="18"/>
    <circle cx="196" cy="128" r="18"/>
  </svg>
</div>
        </div>

        <!-- 2. 聊天内容流 -->
        <div id="chatFlow" style="flex: 1; overflow-y: auto; padding: 15px 12px; background: #ededed;"></div>

            <!-- ✨ 新增：管理操作条 (进入勾选模式时显示) -->
        <div id="previewEditBar" style="display: none; height: 56px; background: #1e293b; align-items: center; justify-content: space-between; padding: 0 15px; flex-shrink: 0; position: absolute; bottom: 0; left: 0; width: 100%; z-index: 100; box-sizing: border-box; border-top: 1px solid #334155;">
            <div id="selectedCountText" style="color: white; font-size: 13px; font-weight: 500;">已选 0 条</div>
            <div style="display: flex; gap: 8px;">
                <button id="screenshotBtn" style="background: #07c160; color: white; border: none; padding: 6px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight:bold;">🖼️ 截图</button>
                <button id="delPreviewBtn" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight:bold;">🗑️ 删除</button>
                <button id="exitSelectBtn" style="background: transparent; color: #94a3b8; border: 1px solid #475569; padding: 6px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">取消</button>
            </div>
        </div>



        <!-- 3. 原生底部输入栏 -->
        <div style="display: flex; align-items: center; min-height: 56px; padding: 8px 6px; gap: 4px; background: #f7f7f7; border-top: 0.5px solid rgba(0, 0, 0, 0.12); flex-shrink: 0;">
            <button style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: transparent; border: none;"><svg viewBox="0 0 100 100" style="width: 27px; height: 27px;"><circle cx="50" cy="50" r="42" fill="none" stroke="#2A2A2A" stroke-width="6"></circle><g transform="translate(0, 6) scale(0.85)"><path d="M 33 50 L 40 42 A 12 12 0 0 1 40 58 Z" fill="#2A2A2A"></path><path d="M 54 36 A 20 20 0 0 1 54 64" fill="none" stroke="#2A2A2A" stroke-width="6" stroke-linecap="round"></path><path d="M 69 24 A 36 36 0 0 1 69 76" fill="none" stroke="#2A2A2A" stroke-width="6" stroke-linecap="round"></path></g></svg></button>
            <div style="flex: 1; min-height: 38px; background: #fff; border-radius: 8px; border: 0.5px solid rgba(0,0,0,0.08); display: flex; align-items: center; padding: 0 12px; color: #94a3b8; font-size: 14px;min-width: 0;"></div>
            <button style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: transparent; border: none;"><svg viewBox="-35 -35 528.71 528.71" style="width: 27px; height: 27px;"><g fill="#2A2A2A" stroke="#f7f7f7" stroke-width="12"><path d="M229.355,0C102.922,0,0,102.922,0,229.355S102.922,458.71,229.355,458.71 S458.71,355.788,458.71,229.355S355.788,0,229.355,0z M229.355,427.363c-109.192,0-198.008-88.816-198.008-198.008 S120.163,31.347,229.355,31.347s198.008,88.816,198.008,198.008S338.547,427.363,229.355,427.363z"></path><path d="M329.665,243.984h-200.62c-8.882,0-15.673,6.792-15.673,15.673 c0,63.739,52.245,115.984,115.984,115.984s115.984-52.245,115.984-115.984C345.339,250.775,338.547,243.984,329.665,243.984z M229.355,344.294c-41.273,0-75.755-29.78-83.069-68.963h166.139C305.11,314.514,270.629,344.294,229.355,344.294z"></path><circle cx="309.29" cy="164.049" r="29.257"></circle><circle cx="149.42" cy="164.049" r="29.257"></circle></g></svg></button>
            <button style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: transparent; border: none;"><svg viewBox="0 0 48 48" style="width: 27px; height: 27px;" fill="none" stroke="#2A2A2A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="21"></circle><line x1="24" y1="13" x2="24" y2="35"></line><line x1="13" y1="24" x2="35" y2="24"></line></svg></button>
        </div>


    `;
    document.body.appendChild(previewLayer);


        const portalPanel = document.createElement('div');
    portalPanel.id = 'dataPortalPanel';
    portalPanel.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 30001; display: none;
        justify-content: center; align-items: center; backdrop-filter: blur(5px);
    `;
    portalPanel.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 12px; width: 90%; max-width: 450px; font-family: 'Quicksand', sans-serif;">
            <h3 style="margin-top:0; color:#673AB7; display:flex; align-items:center; gap:8px;">📦 数据传送门 <span style="font-size:10px; font-weight:normal; background:#eee; padding:2px 6px; border-radius:4px; color:#666;">v1.0</span></h3>

            <div style="margin-bottom:15px; padding:10px; background:#f0f7ff; border-radius:8px; font-size:12px; line-height:1.5;">
                <b>当前目标：</b><span id="portalTargetInfo" style="color:#673AB7; font-weight:bold;">未选择角色</span><br>
                <span style="color:#666;">导出当前选中的消息，或注入外部数据。</span>
            </div>

            <div style="border: 1px solid #eee; padding: 12px; border-radius: 8px; margin-bottom: 15px; background:#fafafa;">
                <div style="font-weight:bold; font-size:13px; margin-bottom:8px; color:#333;">📤 导出设置</div>
                <label style="display:flex; align-items:center; font-size:12px; margin-bottom:8px; cursor:pointer;">
                    <input type="checkbox" id="exportSelectedOnly" checked style="margin-right:6px;"> 优先导出勾选项 (<span id="portalSelCount">0</span>条)
                </label>
                <div style="font-size:11px; color:#888; margin-bottom:5px;">或按时间筛选（留空不限）：</div>

<div style="display:grid; grid-template-columns:auto 1fr; gap:5px; font-size:11px; align-items:center;">
    开始时间 <input type="datetime-local" id="exportStartTime" style="padding:4px; border:1px solid #ddd; border-radius:4px;">
    结束时间 <input type="datetime-local" id="exportEndTime" style="padding:4px; border:1px solid #ddd; border-radius:4px;">
</div>
                <button id="startExportBtn" class="btn btn-primary" style="width:100%; margin-top:10px; margin-left:0; height:36px; font-weight:bold;">复制或打包迁移码</button>
            </div>

            <div style="border: 1px solid #eee; padding: 12px; border-radius: 8px; background:#fafafa;">
                <div style="font-weight:bold; font-size:13px; margin-bottom:8px; color:#333;">📥 注入数据</div>
                <textarea id="importDataInput" placeholder="在此粘贴迁移码 (Base64) 或 原始 JSON 数组..." style="width:100%; height:50px; font-size:10px; padding:8px; border:1px solid #ddd; border-radius:4px; resize:none; background:white;"></textarea>
                <div style="display:flex; gap:8px; margin-top:10px;">
                    <button id="startImportBtn" class="btn btn-success" style="flex:1; margin-left:0; font-weight:bold;">开始注入</button>
                    <button id="uploadFileBtn" class="btn btn-warning" style="padding:0 15px; margin-left:0;">导入文件</button>
                    <input type="file" id="portalFileSelect" style="display:none;" accept=".json">
                </div>
            </div>

            <button id="closePortalBtn" class="btn btn-danger" style="width:100%; margin-top:15px; margin-left:0; background:#666;">关闭</button>
        </div>
    `;
    document.body.appendChild(portalPanel);



    // ==================== ✨ 第三步：创建半透明美化工坊面板 ====================
    const skinPanel = document.createElement('div');
    skinPanel.id = 'csySkinPanel';
    skinPanel.style.cssText = `
        position: fixed; top: 0; right: -400px; width: 350px; height: 100%;
        background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(15px);
        z-index: 30000; box-shadow: -5px 0 20px rgba(0,0,0,0.1);
        transition: right 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
        font-family: 'Quicksand', sans-serif; border-left: 1px solid rgba(255,255,255,0.3);
    `;

    skinPanel.innerHTML = `
        <h3 style="margin-top:0; color:#333; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #ddd; padding-bottom:10px;">
            🎨 皮肤工坊
            <button id="closeSkinPanel" style="background:none; border:none; font-size:24px; cursor:pointer; color:#666;">×</button>
        </h3>

        <div style="margin: 15px 0; padding: 10px; background: rgba(7, 193, 96, 0.1); border-radius: 8px;">
            <label style="font-size:12px; font-weight:bold; color:#07c160; display:block; margin-bottom:5px;">本地字体上传 (.ttf)</label>
            <input type="file" id="fontUpload" accept=".ttf" style="font-size:11px; width:100%;">
            <div id="fontStatus" style="font-size:10px; color:#666; margin-top:5px; font-style:italic;">未加载自定义字体</div>
        </div>

        <div style="flex:1; display:flex; flex-direction:column; min-height:0;">
            <label style="font-size:12px; font-weight:bold; color:#666; margin-bottom:5px;">自定义 CSS 代码 (支持 .sully 类名)</label>
            <textarea id="cssEditor" spellcheck="false" style="flex:1; width:100%; background:rgba(255,255,255,0.6); border:1px solid #ccc; border-radius:8px; padding:10px; font-family:monospace; font-size:12px; resize:none; outline:none; color:#333;"></textarea>
        </div>

        <div style="margin-top:15px; display:flex; gap:10px;">
            <button id="applySkinBtn" style="flex:1; padding:12px; background:#07c160; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:14px;">保存并应用</button>
            <button id="resetSkinBtn" style="padding:12px; background:#f44336; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px;">重置</button>
        </div>
    `;
    document.body.appendChild(skinPanel);




    // ==================== 事件绑定逻辑 ====================

        // ==================== 遮罩层点击关闭逻辑 (合并修复版) ====================
    panel.addEventListener('click', (e) => {
        // 只有点到背景遮罩才触发
        if (e.target === panel) {
            // 1. 安全检查：如果正在“穿越中”，不许关闭
            const updateBtn = document.getElementById('updateBtn');
            if (updateBtn && updateBtn.disabled && updateBtn.textContent === '穿越中...') {
                console.log('正在执行关键操作，请勿关闭面板');
                return;
            }

            // 2. 执行关闭
            panel.style.display = 'none';

            // 3. ✨ 核心修复：根据隐身状态决定透明度
            floatBall.style.opacity = isBallHidden ? '0' : '0.3';
        }
    });


    document.getElementById('closeBtn').addEventListener('click', () => panel.style.display = 'none');
        // 👻 按钮点击：切换悬浮球隐身状态
    document.getElementById('hideBallBtn').addEventListener('click', () => {
        toggleBallVisibility();
        // 增加按钮文字反馈
        const btn = document.getElementById('hideBallBtn');
        btn.innerText = isBallHidden ? '👁️' : '👻';
    });

    document.getElementById('analyzeBtn').addEventListener('click', analyzeDataStructure);
    document.getElementById('charSelect').addEventListener('change', function() {
        selectedRole = this.value;
        if (selectedRole) {
            isSearchMode = false;
            selectedIds.clear(); // 切换角色清空选中
            loadMessagesForRole(selectedRole);
        }
    });

        // ✅ 新增：选完日期自动跳转
    document.getElementById('jumpDate').addEventListener('change', jumpToDate);

    // ✅ 新增：输入框里按回车(Enter)自动搜索
    document.getElementById('searchKeyword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            performSearch();
            e.target.blur(); // 搜索完自动收起手机键盘，免得挡住结果
        }
    });


    document.getElementById('toggleSortBtn').addEventListener('click', toggleSort);
    document.getElementById('expandAllBtn').addEventListener('click', toggleExpandAll);
    document.getElementById('prevBtn').addEventListener('click', () => { if (displayStart >= DISPLAY_LIMIT) { displayStart -= DISPLAY_LIMIT; renderMessageList(); } });
    document.getElementById('nextBtn').addEventListener('click', () => {
        const list = isSearchMode ? filteredMessages : currentMessages;
        if (displayStart + DISPLAY_LIMIT < list.length) { displayStart += DISPLAY_LIMIT; renderMessageList(); }
    });

        document.getElementById('selectAll').addEventListener('change', function(e) {
        const checkboxes = document.querySelectorAll('.msgCheckbox');
        const isChecked = e.target.checked;
        checkboxes.forEach(cb => {
            cb.checked = isChecked;
            // ✨ 关键修复：统一将 ID 转为字符串存入 Set
            const id = String(cb.dataset.id);
            if (isChecked) selectedIds.add(id);
            else selectedIds.delete(id);
        });
        updateSelectedCount();
    });


    document.getElementById('updateBtn').addEventListener('click', executeTimeShift);

                // 📋 复制选中内容逻辑 (增加自动清空勾选)
    document.getElementById('copySelectedBtn').addEventListener('click', () => {
        if (selectedIds.size === 0) {
            showResult('⚠️ 请先勾选要复制的消息', false);
            return;
        }

        const selectedMsgs = currentMessages.filter(msg => selectedIds.has(String(msg.id)));
        selectedMsgs.sort((a, b) => a.timestamp - b.timestamp);
        const textToCopy = selectedMsgs.map(msg => msg.content || "").join('\n');

        navigator.clipboard.writeText(textToCopy).then(() => {
            showResult(`✅ 已复制 ${selectedIds.size} 条内容`, true);

            // ✨ 自动清空逻辑
            selectedIds.clear();
            updateSelectedCount();
            const selectAllCb = document.getElementById('selectAll');
            if (selectAllCb) selectAllCb.checked = false;

            // 💡 重点：这里必须调用一次渲染，否则复选框里的勾不会消失
            renderMessageList();

        }).catch(err => {
            console.error('复制失败:', err);
            showResult('❌ 复制失败', false);
        });
    });


            document.getElementById('delSelectedBtn').addEventListener('click', async () => {
        if (selectedIds.size === 0) {
            showResult('⚠️ 请先勾选要删除的消息', false);
            return;
        }

        if (!confirm(`确定要永久删除选中的 ${selectedIds.size} 条消息吗？`)) return;

        await physicalDeleteMessages(selectedIds);

        // 重置选中状态并刷新
        selectedIds.clear();
        updateSelectedCount();
        const selectAllCb = document.getElementById('selectAll');
        if (selectAllCb) selectAllCb.checked = false;

        showResult('🗑️ 消息已从数据库物理抹除', true);
        renderMessageList();
    });


    // --- ✨ 新增：预览按钮与关闭预览的点击事件 ---

    // 1. 🖼️ 点击“预览”按钮，打开仿真界面
    document.getElementById('previewChatBtn').addEventListener('click', () => openChatPreview());


    // 2. ✕ 点击预览界面左上角的叉号，关闭预览
    document.getElementById('closePreview').addEventListener('click', () => {
        document.getElementById('chatPreviewLayer').style.display = 'none';
        // 顺便确保球的透明度正确
        floatBall.style.opacity = isBallHidden ? '0' : '0.3';
    });


    // ==================== 核心功能逻辑 ====================

     async function analyzeDataStructure() {

         // ✨ 新增：开始分析前，先重置所有选中状态
        selectedIds.clear();
        if (document.getElementById('selectedCount')) updateSelectedCount();
        const selectAllCb = document.getElementById('selectAll');
        if (selectAllCb) selectAllCb.checked = false;

        updateStatus('🔍 正在读取数据...');
        try {
            const db = await openDB();

            // 1. 读取角色表 (用于私聊起名)
            let characters = [];
            if (db.objectStoreNames.contains('characters')) {
                const charStore = db.transaction(['characters'], 'readonly').objectStore('characters');
                characters = await new Promise(r => charStore.getAll().onsuccess = e => r(e.target.result || []));
            }

            // 2. 读取群组表 (用于群聊起名)
            let groups = [];
            if (db.objectStoreNames.contains('groups')) {
                const groupStore = db.transaction(['groups'], 'readonly').objectStore('groups');
                groups = await new Promise(r => groupStore.getAll().onsuccess = e => r(e.target.result || []));
            }

            // 3. 读取全量消息
            const msgStore = db.transaction(['messages'], 'readonly').objectStore('messages');
            const allMessages = await new Promise(r => msgStore.getAll().onsuccess = e => r(e.target.result || []));

            window.allMessagesCache = allMessages;
            // ✨ 新增这一行：缓存角色表，方便渲染时取名
            window.charactersCache = characters;

            // 4. 建立会话映射 (Key 为对话框的唯一标识)
            const conversationMap = new Map();

            allMessages.forEach(msg => {
                let convId, convName, type, icon;

                if (msg.groupId) {
                    // --- 情况 A: 群聊消息 ---
                    convId = `group_${msg.groupId}`;
                    const group = groups.find(g => g.id === msg.groupId);
                    convName = group ? group.name : `群聊: ${msg.groupId}`;
                    type = 'group';
                    icon = '👥 ';
                } else if (msg.charId) {
                    // --- 情况 B: 私聊消息 ---
                    const char = characters.find(c => c.charInstanceId === msg.charId || c.id === msg.charId);
                    const mainId = char ? char.id : msg.charId; // 统一用 char-xxx 作为主键
                    convId = `private_${mainId}`;
                    convName = char ? char.name : msg.charId;
                    type = 'private';
                    icon = char ? '🤖 ' : '❓ ';
                } else {
                    return; // 忽略无效数据
                }

                if (!conversationMap.has(convId)) {
                    conversationMap.set(convId, {
                        id: convId, // 内部识别 ID
                        name: convName,
                        type: type,
                        icon: icon,
                        count: 0,
                        relatedCharIds: new Set(), // 存储该会话涉及的所有原始 charId (针对私聊多 ID 合并)
                        groupId: msg.groupId || null
                    });
                }

                const entry = conversationMap.get(convId);
                entry.count++;
                if (msg.charId) entry.relatedCharIds.add(msg.charId);
            });


                        // --- ✨ 插入：抓取用户（我）的个人头像 ---
            try {
                if (db.objectStoreNames.contains('user_profile')) {
                    const upStore = db.transaction(['user_profile'], 'readonly').objectStore('user_profile');
                    // 这里的 'me' 是你刚才在开发者工具里确认的主键
                    const upData = await new Promise(r => upStore.get('me').onsuccess = e => r(e.target.result));
                    window.userAvatarCache = upData?.avatar || '';
                    console.log('✅ 已缓存用户头像数据');
                }
            } catch(e) {
                console.log('❌ 个人头像抓取跳过', e);
            }


            // 5. 格式化为列表并排序
            allRoles = Array.from(conversationMap.values())
                .map(item => ({
                    ...item,
                    relatedCharIds: Array.from(item.relatedCharIds), // Set 转回数组
                    displayName: `${item.icon}${item.name}` // 供下拉框显示的名称
                }))
                .sort((a, b) => b.count - a.count);

            updateRoleSelect();
            showSection('roleSection', true);

            const groupCount = allRoles.filter(r => r.type === 'group').length;
            updateStatus(`✅ 读取成功！识别到 ${allRoles.length - groupCount} 个私聊和 ${groupCount} 个群聊`);

            if (allRoles.length > 0) {
                // 默认选择第一个
                if (!selectedRole || !allRoles.find(r => r.id === selectedRole)) {
                    selectedRole = allRoles[0].id;
                }
                document.getElementById('charSelect').value = selectedRole;
                loadMessagesForRole(selectedRole);
            }
        } catch (e) {
            console.error(e);
            updateStatus(`❌ 读取失败: ${e}`, true);
        }
    }

    function loadMessagesForRole(convId) {
        const convInfo = allRoles.find(r => r.id === convId);
        if (!convInfo) {
            updateStatus('❌ 无法定位会话数据', true);
            return;
        }

        if (convInfo.type === 'group') {
            // --- 如果选的是群聊：根据 groupId 提取所有人在此群的发言 ---
            currentMessages = window.allMessagesCache.filter(m => m.groupId === convInfo.groupId);
        } else {
            // --- 如果选的是私聊：提取涉及的所有角色实例 ID，且没有 groupId 的消息 ---
            const ids = convInfo.relatedCharIds;
            currentMessages = window.allMessagesCache.filter(m => !m.groupId && ids.includes(m.charId));
        }

        applySort();
        displayStart = 0;
        showSection('messageSection', true);
        showSection('timeSection', true);
        renderMessageList();
    }

    function applySort() {
        currentMessages.sort((a, b) => sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
    }

    function toggleSort() {
        sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
        document.getElementById('toggleSortBtn').innerText = `🔃 ${sortOrder === 'desc' ? '倒序' : '正序'}`;
        if (isSearchMode) {
            filteredMessages.sort((a, b) => sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
        } else {
            applySort();
        }
        renderMessageList();
    }


    function performSearch() {
        const kw = document.getElementById('searchKeyword').value.trim().toLowerCase();
        if (!kw) {
            isSearchMode = false;
            displayStart = 0;
            renderMessageList();
            return;
        }
        filteredMessages = currentMessages.filter(m => String(m.content).toLowerCase().includes(kw));
        isSearchMode = true;
        displayStart = 0;
        renderMessageList();
        updateStatus(`🔍 找到 ${filteredMessages.length} 条相关消息`);
    }

        function jumpToDate() {
        const dateVal = document.getElementById('jumpDate').value;
        if (!dateVal) return;

        const [year, month, day] = dateVal.split('-').map(Number);
        const targetTs = new Date(year, month - 1, day, 0, 0, 0).getTime();

        sortOrder = 'asc';
        document.getElementById('toggleSortBtn').innerText = `🔃 正序`;
        applySort();
        isSearchMode = false;

        const index = currentMessages.findIndex(m => m.timestamp >= targetTs);

        if (index !== -1) {
            // 💡 改进：直接跳转到以该消息为起点的分页，确保它就在第一条
            displayStart = index;
            renderMessageList();

            // 确保滚动条回到最顶端
            setTimeout(() => {
                document.getElementById('messageList').scrollTop = 0;
            }, 100);

            showResult(`📅 已精准定位至 ${dateVal}`, true);
        } else {
            showResult('📅 该日期之后没有消息记录', false);
        }
    }



      function locateMessage(id) {
        // 1. 退出搜索模式，进入普通模式
        isSearchMode = false;

        // 2. 定位通常是为了看上下文，强制切换为正序（符合阅读逻辑）
        sortOrder = 'asc';
        const sortBtn = document.getElementById('toggleSortBtn');
        if (sortBtn) sortBtn.innerText = `🔃 正序`;

        // 3. 重新应用排序，确保数据列表按时间正序排列
        applySort();

        // ✨ 核心修复：将传入的 ID 强制转为字符串，确保与消息对象中的 ID 匹配
        const targetId = String(id);
        const index = currentMessages.findIndex(m => String(m.id) === targetId);

        if (index !== -1) {
            // 4. 让 displayStart 直接等于 index，保证选中的消息出现在列表第一行
            displayStart = index;
            renderMessageList();

            // 5. 延迟执行 UI 反馈，确保 DOM 已经渲染完毕
            setTimeout(() => {
                // 查找包含该 ID 的消息行
                const targetRow = document.querySelector(`.msgCheckbox[data-id="${targetId}"]`)?.closest('.message-item');
                if (targetRow) {
                    // 视觉反馈：背景高亮
                    targetRow.style.background = '#fff9c4';
                    // 滚动到视口顶部
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 200);

            showResult('📍 已定位到上下文', true);
        } else {
            console.error("定位失败：找不到 ID", targetId);
            showResult('❌ 定位失败', false);
        }
    }




        function toggleExpandAll() {
        const btn = document.getElementById('expandAllBtn');
        const contents = document.querySelectorAll('.message-content');
        if (!btn || contents.length === 0) return;

        // 判断当前文字：如果是“展开”，就执行全部展开，并改名为“折叠”
        if (btn.innerText === '🔼 展开') {
            contents.forEach(c => c.classList.add('expanded'));
            btn.innerText = '🔽 折叠';
        } else {
            // 否则执行全部收起，并改名为“展开”
            contents.forEach(c => c.classList.remove('expanded'));
            btn.innerText = '🔼 展开';
        }
    }


        function renderMessageList() {
            // ✨ 新增：翻页或刷新列表时，确保“展开”按钮文字重置
        const expandBtn = document.getElementById('expandAllBtn');
        if (expandBtn) expandBtn.innerText = '🔼 展开';

        const list = isSearchMode ? filteredMessages : currentMessages;
        const container = document.getElementById('messageList');
        const kw = isSearchMode ? document.getElementById('searchKeyword').value.toLowerCase() : '';

        const pageItems = list.slice(displayStart, displayStart + DISPLAY_LIMIT);
        container.innerHTML = '';

        // ✨ 关键修复：用于判断本页是否已被全选
        let allPageChecked = pageItems.length > 0;

        pageItems.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'message-item';
            const date = new Date(msg.timestamp);

            // 新的时间格式化函数
const pad = (num) => String(num).padStart(2, '0');
const timeStr = `${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

            let contentHtml = msg.content || '';
            if (kw) {
                const reg = new RegExp(`(${kw})`, 'gi');
                contentHtml = String(contentHtml).replace(reg, '<span class="highlight">$1</span>');
            }

            // ✨ 关键修复：强制转换 ID 类型进行判定
            const msgId = String(msg.id);
            const isChecked = selectedIds.has(msgId);

            if (!isChecked) allPageChecked = false; // 只要有一条没勾，本页全选框就不能勾

                        // ✨ 改进后的取名逻辑
            let roleName = 'AI';
            if (msg.role === 'user') {
                roleName = '我';
            } else {
                // 从缓存的角色表里寻找匹配的名字
                const char = (window.charactersCache || []).find(c => c.charInstanceId === msg.charId || c.id === msg.charId);
                roleName = char ? char.name : 'AI';
            }


            div.innerHTML = `
                <div class="checkbox-container">
                    <input type="checkbox" class="msgCheckbox" data-id="${msgId}" ${isChecked ? 'checked' : ''}>
                </div>
                <span class="timestamp">${timeStr}</span>
                <span class="role-icon">${roleName}：</span>
                <span class="message-content">${contentHtml}</span>
                ${isSearchMode ? `<span class="locate-btn" data-id="${msgId}">定位</span>` : ''}
            `;

            // --- 📱 长按管理 + 短按展开 (全平台适配版) ---
            const contentEl = div.querySelector('.message-content');
            let pressTimer = null;
            let isLongPress = false;

            const startPress = (e) => {
                isLongPress = false;
                // 适配手机端多点触控：只处理单指触摸
                if (e.type === 'touchstart' && e.touches.length > 1) return;

                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    handleLongPress(msgId, msg.content || "");
                }, 800); // 稍微延长至0.8秒，减少滚动时的误触
            };

            const cancelPress = (e) => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            contentEl.onclick = (e) => {
                if (!isLongPress) e.target.classList.toggle('expanded');
            };

            // 鼠标事件
            contentEl.onmousedown = startPress;
            contentEl.onmouseup = cancelPress;
            contentEl.onmouseleave = cancelPress;
            // 触摸事件 (适配 iOS/Android)
            contentEl.ontouchstart = startPress;
            contentEl.ontouchend = cancelPress;
            contentEl.ontouchmove = cancelPress; // 手指滑动时取消长按，防止滚动页面时误发菜单



            // 事件：定位
            if (isSearchMode) {
                div.querySelector('.locate-btn').onclick = () => locateMessage(msgId);
            }

            // 事件：勾选
            div.querySelector('.msgCheckbox').onchange = (e) => {
                const currentId = String(e.target.dataset.id);
                if (e.target.checked) {
                    selectedIds.add(currentId);
                } else {
                    selectedIds.delete(currentId);
                    // 如果手动取消了一条，顶部的全选框必须取消
                    document.getElementById('selectAll').checked = false;
                }
                updateSelectedCount();
            };

            container.appendChild(div);
        });

        // ✨ 关键修复：根据本页实际情况，同步顶部全选框的状态
        document.getElementById('selectAll').checked = allPageChecked;

        document.getElementById('pageInfo').innerText = `${Math.floor(displayStart/DISPLAY_LIMIT)+1}/${Math.ceil(list.length/DISPLAY_LIMIT)||1}`;
        document.getElementById('messageStats').innerText = `共 ${list.length} 条`;
        document.getElementById('prevBtn').disabled = displayStart === 0;
        document.getElementById('nextBtn').disabled = displayStart + DISPLAY_LIMIT >= list.length;
        document.getElementById('updateBtn').disabled = false;
        updateSelectedCount();
    }


    function updateSelectedCount() {
        document.getElementById('selectedCount').textContent = `已选 ${selectedIds.size} 条`;
    }

        async function executeTimeShift() {
        const targetTimeInput = document.getElementById('targetTime').value;
        if (selectedIds.size === 0 || !targetTimeInput) {
            showResult('⚠️ 请勾选消息并设置时间', false);
            return;
        }

        const targetTimestamp = new Date(targetTimeInput).getTime();

        // ✨ 核心修复：根据当前选中的会话信息（私聊或群聊）来抓取正确的消息集
        const convInfo = allRoles.find(r => r.id === selectedRole);
        if (!convInfo) {
            showResult('❌ 无法识别当前会话', false);
            return;
        }

        let roleMsgs = [];
        if (convInfo.type === 'group') {
            // 如果是群聊，抓取该群所有消息
            roleMsgs = window.allMessagesCache.filter(m => m.groupId === convInfo.groupId);
        } else {
            // 如果是私聊，抓取关联的所有新旧 ID 消息
            const ids = convInfo.relatedCharIds;
            roleMsgs = window.allMessagesCache.filter(m => !m.groupId && ids.includes(m.charId));
        }

        // 按时间排序，确保逻辑一致
        roleMsgs.sort((a, b) => a.timestamp - b.timestamp);

        if (roleMsgs.length === 0) {
            showResult('❌ 未找到可更新的消息', false);
            return;
        }

        // 2. 锁定该会话现有的 ID 领地
        const originalIdPool = roleMsgs.map(m => m.id).sort((a, b) => a - b);
        const oldIdsForDeletion = roleMsgs.map(m => m.id);

        // 3. 计算选中消息中，最早的那条的偏移量
        // ✨ 修复点：selectedIds 存储的是字符串，这里需要 String(m.id)
        const selectedToMove = roleMsgs.filter(m => selectedIds.has(String(m.id)))
            .sort((a, b) => a.timestamp - b.timestamp);

        if (selectedToMove.length === 0) {
            showResult('⚠️ 选中的消息不在当前会话中', false);
            return;
        }

        const timeOffset = targetTimestamp - selectedToMove[0].timestamp;

        // 4. 应用时间平移（仅针对选中的消息）
        roleMsgs.forEach(m => {
            if (selectedIds.has(String(m.id))) {
                m.timestamp += timeOffset;
            }
        });

        // 5. 按新时间重新排序
        roleMsgs.sort((a, b) => a.timestamp - b.timestamp);

        // 6. 建立 ID 映射表并分配新 ID
        const idMap = {};
        roleMsgs.forEach((msg, index) => {
            const oldId = msg.id;
            const newId = originalIdPool[index];
            idMap[oldId] = newId;
            msg.id = newId;
        });

        // 7. 修复引用关系
        roleMsgs.forEach(msg => {
            if (msg.replyTo && msg.replyTo.id && idMap[msg.replyTo.id]) {
                msg.replyTo.id = idMap[msg.replyTo.id];
            }
        });

        // 8. 执行数据库更新
        updateStatus(`⏳ 正在重构 ${roleMsgs.length} 条记录的物理顺序...`);
        const updateBtn = document.getElementById('updateBtn');
        updateBtn.disabled = true;
        updateBtn.textContent = '穿越中...';

        try {
            const db = await openDB();
            const tx = db.transaction(['messages'], 'readwrite');
            const store = tx.objectStore('messages');

            // 批量删除
            for (let id of oldIdsForDeletion) {
                store.delete(id);
            }

            // 批量存入
            for (let newMsg of roleMsgs) {
                store.put(newMsg);
            }

            tx.oncomplete = () => {
                db.close();
                updateBtn.disabled = false;
                updateBtn.textContent = '🚀 执行时间平移';
                showResult(`✅ 成功更新 ${selectedToMove.length} 条消息，并同步重排 ID 顺序`, true);
                updateStatus('✅ 更新完成！请刷新页面查看效果');

                selectedIds.clear();
                updateSelectedCount();
                const selectAllCb = document.getElementById('selectAll');
                if (selectAllCb) selectAllCb.checked = false;

                analyzeDataStructure().then(() => {
                    if (selectedRole) renderMessageList();
                });
            };

            tx.onerror = (e) => { throw new Error(e.target.error); };

        } catch (e) {
            console.error('穿越失败:', e);
            updateBtn.disabled = false;
            updateBtn.textContent = '🚀 执行时间平移';
            updateStatus(`❌ 更新失败: ${e.message || e}`, true);
            showResult('❌ 穿越失败，请检查备份', false);
        }
    }


    // 通用辅助函数
    function openDB() { return new Promise((res, rej) => { const r = indexedDB.open(DB_NAME); r.onsuccess = () => res(r.result); r.onerror = rej; }); }
    function updateStatus(msg, err) { const s = document.getElementById('status'); s.innerText = msg; s.style.color = err ? 'red' : 'black'; }
    function showSection(id, show) { document.getElementById(id).style.display = show ? 'block' : 'none'; }

        // ✨ 统一底层：物理删除核心函数
    async function physicalDeleteMessages(idSet) {
        if (!idSet || idSet.size === 0) return;

        const db = await openDB();
        const tx = db.transaction(['messages'], 'readwrite');
        const store = tx.objectStore('messages');

        // 1. 物理删除数据库记录
        for (let id of idSet) {
            const sid = String(id);
            const nid = Number(id);
            store.delete(sid);
            store.delete(nid);
            try { store.delete(BigInt(sid)); } catch(e) {}
        }

        return new Promise((resolve) => {
            tx.oncomplete = () => {
                // 2. 统一清理内存缓存（确保主界面和预览界面数据一致）
                const idStrings = new Set(Array.from(idSet).map(String));
                window.allMessagesCache = (window.allMessagesCache || []).filter(m => !idStrings.has(String(m.id)));
                currentMessages = (currentMessages || []).filter(m => !idStrings.has(String(m.id)));
                if (typeof filteredMessages !== 'undefined') {
                    filteredMessages = filteredMessages.filter(m => !idStrings.has(String(m.id)));
                }
                resolve();
            };
        });
    }

        // ==================== ✨ 数据传送门核心模块 ====================

        // ==================== ✨ 数据传送门：增强版导出 (带自检包裹) ====================
    async function handleExport() {
        const onlySelected = document.getElementById('exportSelectedOnly').checked;
        const startVal = document.getElementById('exportStartTime').value;
        const endVal = document.getElementById('exportEndTime').value;
        const startTs = startVal ? new Date(startVal).getTime() : 0;
        const endTs = endVal ? new Date(endVal).getTime() : Infinity;


        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${year}${month}${day}_${hour}${min}${sec}`; // 格式：20260607_153045

        // 1. 筛选需要导出的消息
        const exportList = currentMessages.filter(m => {
            const isSelected = selectedIds.has(String(m.id));
            const inTimeRange = (m.timestamp >= startTs && m.timestamp <= endTs);
            return onlySelected ? isSelected : inTimeRange;
        });

        if (exportList.length === 0) {
            showResult('⚠️ 没有找到可导出的消息', false);
            return;
        }

        // 2. 按时间排序，确保逻辑一致性
        exportList.sort((a, b) => a.timestamp - b.timestamp);

        // 3. ✨ 构建工业级自检包裹 (防止截断风险)
        const packet = {
            version: "1.1",
            count: exportList.length,
            exportTime: Date.now(),
            data: exportList
        };

        const jsonStr = JSON.stringify(packet);

        // 4. ✨ Unicode 安全的 Base64 编码 (防止中文乱码)
        const base64Code = btoa(unescape(encodeURIComponent(jsonStr)));



        const choice = confirm(`📦 准备打包 ${exportList.length} 条消息。\n\n[确定]：复制迁移码（推荐）\n[取消]：存为本地文件`);

        if (choice) {
            navigator.clipboard.writeText(base64Code).then(() => {
                showResult(`✅ 已复制 ${exportList.length} 条消息的迁移码`);
            }).catch(() => {
                // 如果权限受限，回退到弹窗显示
                alert("复制权限受限，请手动保存：\n\n" + base64Code);
            });
        } else {
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Migration_${exportList.length}msgs_${timeStr}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }

        // ==================== ✨ 数据传送门：核心注入函数 (读写分离防死锁版) ====================
    async function handleImport(rawInput = null) {
        try {
            // 1. 获取并解析数据 (在操作数据库前完成所有解析工作)
            const input = rawInput || document.getElementById('importDataInput').value.trim();
            if (!input) { showResult('⚠️ 请粘贴迁移码', false); return; }

            let jsonStr = "";
            try {
                if (input.startsWith('[') || input.startsWith('{')) {
                    jsonStr = input;
                } else {
                    jsonStr = decodeURIComponent(escape(atob(input)));
                }
            } catch (e) { throw new Error("MIGRATION_TRUNCATED"); }

            let parsedData = JSON.parse(jsonStr);
            let msgArray = (parsedData.data && Array.isArray(parsedData.data)) ? parsedData.data : (Array.isArray(parsedData) ? parsedData : []);

            if (parsedData.count && parsedData.count !== msgArray.length) {
                throw new Error(`校验失败：预期 ${parsedData.count} 条，实际解析到 ${msgArray.length} 条。数据不完整！`);
            }
            if (msgArray.length === 0) return;

            // 2. 弹窗确认 (放在事务开启之前，防止阻塞事务)
            if (!confirm(`📦 自检通过！识别到 ${msgArray.length} 条消息。\n📍 目标角色: ${selectedRole}\n\n确认执行增量注入？`)) return;

            const db = await openDB();

            // --- 🔎 步骤 A: 环境信息预抓取 (Read-Only) ---
            // 我们开启一个独立的、只读的事务，快进快出
            const metadata = await new Promise((resolve, reject) => {
                const readTx = db.transaction(['messages'], 'readonly');
                const store = readTx.objectStore('messages');

                const result = { maxId: 0, ownerId: null };

                // 抓取最大 ID
                store.openKeyCursor(null, 'prev').onsuccess = e => {
                    result.maxId = e.target.result?.key || 0;
                };

                // 抓取设备码
                store.openCursor(null, 'prev').onsuccess = e => {
                    result.ownerId = e.target.result?.value?.ownerUserId || null;
                };

                readTx.oncomplete = () => resolve(result);
                readTx.onerror = () => reject("读取环境信息失败");
            });

            // --- 🔎 步骤 B: 内存中处理数据 (不涉及数据库) ---
            let nextId = (typeof metadata.maxId === 'bigint' ? metadata.maxId + 1n : (parseInt(metadata.maxId) || 0) + 1);
            const idMap = new Map();
            const currentActiveId = selectedRole.replace('private_', '').replace('group_', '');
            const isGroupConv = selectedRole.startsWith('group_');

            const preparedMsgs = msgArray.map(msg => {
                const oldId = String(msg.id);
                const newId = nextId;
                idMap.set(oldId, newId);

                if (typeof nextId === 'bigint') nextId++; else nextId++;

                const newMsg = JSON.parse(JSON.stringify(msg));
                newMsg.id = newId;

                if (isGroupConv) {
                    newMsg.groupId = currentActiveId;
                    delete newMsg.charId;
                } else {
                    newMsg.charId = currentActiveId;
                    delete newMsg.groupId;
                }

                if (metadata.ownerId) newMsg.ownerUserId = metadata.ownerId;
                else delete newMsg.ownerUserId;

                return newMsg;
            });

            // 修复回复引用
            preparedMsgs.forEach(msg => {
                if (msg.replyTo?.id && idMap.has(String(msg.replyTo.id))) {
                    msg.replyTo.id = idMap.get(String(msg.replyTo.id));
                }
            });

            // --- 🔎 步骤 C: 物理写入 (Read-Write) ---
            // 此时开启写入事务，内部没有任何 await，速度极快，绝不会超时
            const writeTx = db.transaction(['messages'], 'readwrite');
            const writeStore = writeTx.objectStore('messages');

            for (let msg of preparedMsgs) {
                writeStore.put(msg);
            }

            writeTx.oncomplete = () => {
                showResult(`✅ 成功注入 ${preparedMsgs.length} 条消息！`, true);
                setTimeout(() => location.reload(), 1000);
            };

            writeTx.onerror = (e) => {
                alert("写入数据库失败: " + e.target.error);
            };

        } catch (e) {
            console.error("Portal Error:", e);
            let userFriendlyMsg = e.message;
            if (e.message === "MIGRATION_TRUNCATED") {
                userFriendlyMsg = "❌ 迁移码不完整或解析错误！\n\n请确保复制了完整的迁移码后再试。";
            }
            alert(userFriendlyMsg);
        }
    }


    // ==================== ✨ 配套事件监听 (请确保一并替换) ====================
    document.addEventListener('click', (e) => {
        // 打开面板
        if (e.target.id === 'dataPortalBtn') {
            const portal = document.getElementById('dataPortalPanel');
            if (portal) {
                portal.style.display = 'flex';
                // 更新面板文字信息
                const conv = allRoles.find(r => r.id === selectedRole);
                const infoEl = document.getElementById('portalTargetInfo');
                const countEl = document.getElementById('portalSelCount');
                if (infoEl) infoEl.innerText = conv ? conv.displayName : '未选择会话';
                if (countEl) countEl.innerText = selectedIds.size;
            }
        }

        // 关闭面板
        if (e.target.id === 'closePortalBtn' || e.target.id === 'dataPortalPanel') {
            if (e.target === e.currentTarget || e.target.id === 'closePortalBtn') {
                document.getElementById('dataPortalPanel').style.display = 'none';
            }
        }

        // 按钮触发
        if (e.target.id === 'startExportBtn') handleExport();
        if (e.target.id === 'startImportBtn') handleImport();
        if (e.target.id === 'uploadFileBtn') document.getElementById('portalFileSelect').click();
    });

    // 文件上传监听
    const portalFileSelect = document.getElementById('portalFileSelect');
    if (portalFileSelect) {
        portalFileSelect.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => handleImport(ev.target.result);
            reader.readAsText(file);
        };
    }



    function showResult(message, isSuccess = true) {
        const resultEl = document.getElementById('result');
        if (!resultEl) return;

        resultEl.textContent = message;
        resultEl.style.background = isSuccess ? '#e8f5e9' : '#ffebee';
        resultEl.style.color = isSuccess ? '#2e7d32' : '#c62828';
        resultEl.style.display = 'block';

        // 💡 关键改进：自动滚动到这个提示框，确保用户能看见
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // 💡 优化：把显示时间从 3 秒改到 5 秒，让你有充足时间看清
        setTimeout(() => {
            resultEl.style.display = 'none';
        }, 5000);
    }

    // 默认时间
    document.getElementById('targetTime').value = new Date().toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16);




    // ==================== 悬浮球交互逻辑 (带自动贴边吸附) ====================
    let ballHideTimer = null;
    let isBallHidden = false;

    // ✨ 核心函数：自动贴边吸附
        // --- ✨ 修复后的自动贴边吸附 ---
    function snapToSide() {
        const ballWidth = floatBall.offsetWidth;
        const screenWidth = window.innerWidth;

        // ✨ 改用 getBoundingClientRect 获取精准的当前物理位置
        const rect = floatBall.getBoundingClientRect();
        const ballLeft = rect.left;

        // 开启过渡动画
        floatBall.style.transition = 'left 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';

        // 清除可能干扰的 right 属性
        floatBall.style.right = 'auto';

        if (ballLeft + ballWidth / 2 < screenWidth / 2) {
            // 离左边近，贴左
            floatBall.style.left = '0px';
        } else {
            // 离右边近，贴右
            floatBall.style.left = (screenWidth - ballWidth) + 'px';
        }
    }

    // 1. PC端逻辑
    floatBall.addEventListener('mousedown', (e) => {
        isDragging = true; clickPrevented = false; dragDistance = 0;
        floatBall.style.transition = 'none'; // 拖拽时关闭动画
        offsetX = e.clientX - floatBall.getBoundingClientRect().left;
        offsetY = e.clientY - floatBall.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const x = e.clientX - offsetX, y = e.clientY - offsetY;
        dragDistance += 1; if (dragDistance > 5) clickPrevented = true;
        floatBall.style.left = x + 'px'; floatBall.style.top = y + 'px';
        floatBall.style.right = 'auto'; floatBall.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) snapToSide(); // 松手时贴边
        isDragging = false;
    });

    floatBall.addEventListener('click', (e) => {
        if (!clickPrevented) {
            panel.style.display = 'flex';
            floatBall.style.opacity = isBallHidden ? '0' : '0.3';
        }
    });

    // 2. 手机端逻辑 (抗干扰 + 自动贴边)

    floatBall.addEventListener('touchstart', (e) => {
        isDragging = true; touchMoved = false;
        floatBall.style.transition = 'none'; // 拖拽时关闭动画
        const t = e.touches[0];
        touchStartX = t.clientX; touchStartY = t.clientY;
        offsetX = t.clientX - floatBall.getBoundingClientRect().left;
        offsetY = t.clientY - floatBall.getBoundingClientRect().top;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const t = e.touches[0];
        const dist = Math.sqrt(Math.pow(t.clientX - touchStartX, 2) + Math.pow(t.clientY - touchStartY, 2));
        if (dist > 10) touchMoved = true;
        if (touchMoved) {
            floatBall.style.left = (t.clientX - offsetX) + 'px';
            floatBall.style.top = (t.clientY - offsetY) + 'px';
            floatBall.style.right = 'auto'; floatBall.style.bottom = 'auto';
        }
    }, { passive: true });

    floatBall.addEventListener('touchend', (e) => {
        if (isDragging) snapToSide(); // 抬起时贴边
        isDragging = false;
        if (!touchMoved) {
            if (e.cancelable) e.preventDefault();
            panel.style.display = 'flex';
            floatBall.style.opacity = isBallHidden ? '0' : '0.3';
        }
    }, { passive: false });

    // ✨ 核心切换函数
    function toggleBallVisibility() {
        isBallHidden = !isBallHidden;
        floatBall.style.opacity = isBallHidden ? '0' : '0.3';
        showResult(isBallHidden ? '👻 悬浮球已隐身' : '👀 悬浮球已恢复', true);
    }




   function updateRoleSelect() {
        const s = document.getElementById('charSelect');
        // 修改了默认提示文字
        s.innerHTML = '<option value="">请选择对话...</option>';

        allRoles.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id;

            // ✨ 核心改进：使用我们在分析时生成的 displayName (已包含图标和名称)
            o.textContent = `${r.displayName} (${r.count})`;

            // 为选项增加一些详细信息提示（鼠标悬停可见）
            o.title = r.type === 'group' ? `群组ID: ${r.groupId}` : `角色主ID: ${r.id}`;

            s.appendChild(o);
        });

        // 更新说明信息
        const groupCount = allRoles.filter(r => r.type === 'group').length;
        const infoText = `共识别到 ${allRoles.length} 个对话（包含 ${groupCount} 个群聊）`;
        document.getElementById('roleInfo').innerHTML = infoText;
    }



        // ✨ 简化后的长按：直接进入编辑

        // 1. ✨ 长按触发器：现在指向自定义编辑器
    async function handleLongPress(id, oldText) {
        showCustomEditor(id, oldText);
    }

    // 2. ✨ 自定义编辑器：智能高度 + 大文本支持
    function showCustomEditor(id, text) {
        const modal = document.createElement('div');
        modal.id = 'csy-editor-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); z-index: 50000;
            display: flex; justify-content: center; align-items: center;
            font-family: 'Quicksand', sans-serif;
        `;

        // 动态高度计算：每行 22px，最小 100px，最高 450px
        const lineCount = (text.match(/\n/g) || []).length + 1;
        const calcHeight = Math.min(Math.max(lineCount * 22 + 40, 100), 450);

        modal.innerHTML = `
            <div style="background: white; width: 90%; max-width: 500px; border-radius: 12px; padding: 20px; box-sizing: border-box; box-shadow: 0 10px 25px rgba(0,0,0,0.3);">
                <h4 style="margin: 0 0 12px 0; color: #673AB7; font-size: 15px;">📝 编辑内容 (ID: ${id})</h4>
                <textarea id="csy-edit-area" style="
                    width: 100%;
                    height: ${calcHeight}px;
                    padding: 12px;
                    border: 2px solid #eee;
                    border-radius: 8px;
                    font-size: 14px;
                    line-height: 1.5;
                    resize: vertical;
                    box-sizing: border-box;
                    outline: none;
                    transition: border-color 0.2s;
                "></textarea>
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button id="csy-save-edit" style="flex: 1; padding: 10px; background: #673AB7; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px;">保存修改</button>
                    <button id="csy-cancel-edit" style="flex: 1; padding: 10px; background: #f5f5f5; color: #666; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const textarea = document.getElementById('csy-edit-area');
        textarea.value = text;
        textarea.focus();

        // 绑定事件
        document.getElementById('csy-save-edit').onclick = async () => {
            const newText = textarea.value;
            if (newText !== text) {
                await updateMessageContent(id, newText);
            }
            document.body.removeChild(modal);
        };

        document.getElementById('csy-cancel-edit').onclick = () => {
            document.body.removeChild(modal);
        };

        modal.onclick = (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        };
    }

    // 3. ✨ 核心更新函数：支持日常消息修改 + 通话气泡深度同步
        // ✨ 深度修正版：精准匹配名字前缀并同步 metadata
    async function updateMessageContent(id, newText) {
        try {
            const db = await openDB();
            const tx = db.transaction(['messages'], 'readwrite');
            const store = tx.objectStore('messages');

            // 1. 获取原始数据
            const msg = window.allMessagesCache.find(m => String(m.id) === String(id));
            if (!msg) throw new Error("缓存丢失");

            // 2. 特殊处理：如果是通话记录，在覆盖 content 前，先建立 [名字 -> 角色] 映射表
            if (msg.type === 'call_log' && msg.metadata && Array.isArray(msg.metadata.conversation)) {
                console.log('正在解析通话记录名册...');

                const nameToRole = {};
                const oldLines = msg.content.split('\n');
                const oldConv = msg.metadata.conversation;

                // 建立映射逻辑：遍历旧 content，匹配旧 metadata 的角色
                let convIdx = 0;
                oldLines.forEach(line => {
                    const sepIdx = line.indexOf(': ');
                    if (sepIdx !== -1 && convIdx < oldConv.length) {
                        const name = line.substring(0, sepIdx).trim();
                        // 建立关联，例如：{"Y": "assistant", "遇": "user"}
                        if (!nameToRole[name]) {
                            nameToRole[name] = oldConv[convIdx].role;
                        }
                        convIdx++;
                    }
                });

                console.log('已建立角色映射表:', nameToRole);

                // 3. 开始解析【新文本】并同步
                const newLines = newText.split('\n');
                const newConversation = [];

                newLines.forEach(line => {
                    const sepIdx = line.indexOf(': ');
                    if (sepIdx !== -1) {
                        const name = line.substring(0, sepIdx).trim();
                        const text = line.substring(sepIdx + 2).trim();

                        // 从映射表里查找该名字对应的 role
                        const role = nameToRole[name];
                        if (role) {
                            newConversation.push({ role: role, content: text });
                        }
                    }
                });

                // 4. 覆盖元数据
                if (newConversation.length > 0) {
                    msg.metadata.conversation = newConversation;
                    msg.metadata.turns = newConversation.length;
                    console.log(`成功同步 ${newConversation.length} 条气泡数据`);
                }
            }

            // 5. 更新主文本并存入数据库
            msg.content = newText;
            if (msg.metadata && msg.metadata.sourceText) msg.metadata.sourceText = newText;

            await new Promise((res, rej) => {
                const req = store.put(msg);
                req.onsuccess = res; req.onerror = rej;
            });

            showResult('✅ 修改成功' + (msg.type === 'call_log' ? '（气泡已实时同步）' : ''), true);
            renderMessageList();
        } catch (e) {
            console.error('同步引擎报错:', e);
            showResult('❌ 修改失败: ' + e.message, false);
        }
    }


    // ✨ 补充 B：数据库操作 - 物理删除整条
    async function deleteMessagePhysical(id) {
        try {
            const db = await openDB();
            const tx = db.transaction(['messages'], 'readwrite');
            const store = tx.objectStore('messages');
            await new Promise((res, rej) => {
    // 连续触发删除尝试，确保命中
    store.delete(id);
    store.delete(Number(id));
    try { store.delete(BigInt(id)); } catch(e) {}

    // 只需要最后一次操作的反馈即可
    const req = store.delete(id);

                req.onsuccess = res; req.onerror = rej;
            });
            window.allMessagesCache = window.allMessagesCache.filter(m => String(m.id) !== String(id));
            currentMessages = currentMessages.filter(m => String(m.id) !== String(id));
            showResult('🗑️ 消息已从数据库物理抹除', true);
            renderMessageList();
        } catch (e) { showResult('❌ 删除失败: ' + e, false); }
    }


        // ==================== 仿真预览：同步、管理与长图增强版 ====================
    let previewMessages = [];
    let previewUpIdx = 0;
    let previewDownIdx = 0;
    let selectedPreviewIds = new Set();
    let isSelectMode = false;
    const PREVIEW_PAGE_SIZE = 40;

             // --- ✨ 截图专用：工业级稳定性版 ---
       // --- ✨ 截图专用：全补丁稳定性版 ---
        async function takeLongScreenshot() {
        const selectedRows = Array.from(document.querySelectorAll('.preview-row.selected'));
        if (selectedRows.length === 0) return;
        const btn = document.getElementById('screenshotBtn');
        btn.innerText = '⌛ 合成中...';
        btn.disabled = true;

        try {
            if (typeof window.domtoimage === 'undefined') {
                await new Promise(r => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.4.0/dist/dom-to-image-more.min.js';
                    s.onload = r;
                    document.head.appendChild(s);
                });
            }

            const liveStyle = document.getElementById('csy-beautify-inject');
            const container = document.createElement('div');
            container.className = 'sully-chat-container';
            container.style.cssText = `position: absolute; left: -9999px; top: 0; width: 375px; padding: 20px 0; background: #ededed;`;
            document.body.appendChild(container);

            const styleInject = document.createElement('style');
            styleInject.innerHTML = (liveStyle ? liveStyle.innerHTML : "") + `
                .preview-row { padding: 6px 12px !important; }
                .sully-msg-timestamp { margin: 15px 0 10px 0 !important; background: transparent !important; }
            `;
            container.appendChild(styleInject);

            selectedRows.sort((a, b) => a.offsetTop - b.offsetTop);
            for (let row of selectedRows) {
                const clone = row.cloneNode(true);
                clone.classList.remove('selected');
                container.appendChild(clone);
            }

            const imagePromises = Array.from(container.querySelectorAll('img')).map(img => {
                if (img.src.startsWith('http')) {
                    return fetch(img.src).then(res => res.blob()).then(blob => new Promise(r => {
                        const rd = new FileReader();
                        rd.onloadend = () => { img.src = rd.result; r(); };
                        rd.readAsDataURL(blob);
                    })).catch(() => {});
                }
            });

                        await Promise.all(imagePromises);
            await document.fonts.ready;
            await new Promise(r => setTimeout(r, 1200));

            // ✨ 补齐：计算高度，防止报错
            const finalHeight = container.scrollHeight;

            const dataUrl = await window.domtoimage.toPng(container, {
                width: 375,
                height: finalHeight, // 使用刚才定义的变量
                scale: 2,
                filter: (node) => {
                    if (node.tagName === 'LINK' || node.tagName === 'STYLE') {
                        return !node.innerText?.includes('http');
                    }
                    return true;
                }
            });


            const link = document.createElement('a');
            link.download = `SullyShot_${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
            document.body.removeChild(container);
            showResult('✅ 截图已保存', true);
            document.getElementById('exitSelectBtn').click();
        } catch (e) { console.error(e); } finally {
            btn.innerText = '🖼️ 截图';
            btn.disabled = false;
        }
    }

    async function openChatPreview(specifiedAnchorId = null) {
        const flow = document.getElementById('chatFlow');
        const headerName = document.getElementById('previewHeaderName');
        const layer = document.getElementById('chatPreviewLayer');

        isSelectMode = false;
        selectedPreviewIds.clear();
        document.getElementById('previewEditBar').style.display = 'none';
        flow.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">同步视图中...</div>';
        layer.style.display = 'flex';

        try {
            const mainList = isSearchMode ? filteredMessages : currentMessages;
            if (!mainList || mainList.length === 0) {
                flow.innerHTML = '<div style="text-align:center; padding:20px;">无消息记录</div>';
                return;
            }

            const mainCurrentId = mainList[displayStart] ? String(mainList[displayStart].id) : null;
            previewMessages = [...currentMessages].sort((a, b) => a.timestamp - b.timestamp);

            let targetId = specifiedAnchorId ? String(specifiedAnchorId) : mainCurrentId;
            const startIdx = previewMessages.findIndex(m => String(m.id) === targetId);

            if (startIdx === -1) {
                previewUpIdx = Math.max(0, previewMessages.length - PREVIEW_PAGE_SIZE);
                previewDownIdx = previewMessages.length;
            } else {
                previewUpIdx = Math.max(0, startIdx - 10);
                previewDownIdx = Math.min(previewMessages.length, previewUpIdx + PREVIEW_PAGE_SIZE);
            }

            flow.innerHTML = '';
            flow.className = 'sully-chat-container'; // 设置底色类名
            flow.style.border = 'none';

            const convInfo = allRoles.find(r => r.id === selectedRole);
            headerName.innerText = convInfo?.name || '对话预览';

            renderPreviewSlice(previewMessages.slice(previewUpIdx, previewDownIdx), 'append');

            flow.onscroll = () => {
                if (flow.scrollTop === 0 && previewUpIdx > 0) {
                    const nextStart = Math.max(0, previewUpIdx - PREVIEW_PAGE_SIZE);
                    const slice = previewMessages.slice(nextStart, previewUpIdx);
                    previewUpIdx = nextStart;
                    renderPreviewSlice(slice, 'prepend');
                }
                if (flow.scrollHeight - flow.scrollTop - flow.clientHeight < 50 && previewDownIdx < previewMessages.length) {
                    const nextEnd = Math.min(previewMessages.length, previewDownIdx + PREVIEW_PAGE_SIZE);
                    const slice = previewMessages.slice(previewDownIdx, nextEnd);
                    previewDownIdx = nextEnd;
                    renderPreviewSlice(slice, 'append');
                }
            };

            setTimeout(() => {
                const target = targetId ? flow.querySelector(`.preview-row[data-id="${targetId}"]`) : null;
                if (target) target.scrollIntoView({ block: 'start' });
            }, 150);

        } catch (e) {
            console.error(e);
            flow.innerHTML = '<div style="color:red; text-align:center;">同步失败</div>';
        }
    }




        // --- ✨ 预览主函数：深度同步与上下文还原版 ---
            function renderPreviewSlice(slice, mode) {
        const flow = document.getElementById('chatFlow');
        const oldScrollHeight = flow.scrollHeight;
        const fragment = document.createDocumentFragment();
        const userAvatar = window.userAvatarCache || '';

        slice.forEach((msg) => {
            const isMe = msg.role === 'user';
            const charObj = (window.charactersCache || []).find(c => c.id === msg.charId || c.charInstanceId === msg.charId);
            const avatar = isMe ? userAvatar : (charObj?.avatar || '');
            const { html, isPureMedia } = parseChatContent(msg.content);
            const msgId = String(msg.id);

            // ✨ 核心修正：从全量历史中精准寻找“上一条”
            const globalIdx = previewMessages.indexOf(msg);
            const prevMsg = globalIdx > 0 ? previewMessages[globalIdx - 1] : null;
            // 判断规则：没有前一条，或者间隔超过3分钟
            const showTime = !prevMsg || (msg.timestamp - prevMsg.timestamp > 180000);

            const row = document.createElement('div');
            row.className = 'preview-row';
            row.dataset.id = msgId;

            let bubbleClass = isMe ? 'sully-bubble-user' : 'sully-bubble-ai';
            if (isPureMedia) bubbleClass += ' sully-is-image';

            const avatarStyle = `width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; background: #ccc; object-fit: cover;`;
            const avatarHtml = avatar
                ? `<img src="${avatar}" style="${avatarStyle}">`
                : `<div style="${avatarStyle}; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; background:#aaa;">${isMe ? '我' : (charObj?.name?.slice(0,1) || 'AI')}</div>`;

            row.innerHTML = `
                ${showTime ? `<div class="sully-msg-timestamp">${formatChatTime(msg.timestamp)}</div>` : ''}
                <div class="sully-msg-content-wrapper" style="flex-direction: ${isMe ? 'row-reverse' : 'row'};">
                    ${avatarHtml}
                    <div class="${bubbleClass}" style="position: relative; ${isMe ? 'margin-right: 12px;' : 'margin-left: 12px;'}
                         padding: ${isPureMedia ? '0' : '8px 12px'}; max-width: 70%; word-break: break-all; pointer-events: none; min-height: 36px;">
                        ${html}
                        ${isPureMedia ? '' : `
                            <div class="sully-bubble-tail" style="position: absolute; top: 12px; width: 0; height: 0; border: 6px solid transparent; ${isMe ? 'right: -12px;' : 'left: -12px;'}"></div>
                        `}
                    </div>
                </div>
            `;

            // 交互逻辑
            let pressTimer;
            let lastLongPressFlag = false;
            const handleStart = () => {
                lastLongPressFlag = false;
                pressTimer = setTimeout(() => {
                    lastLongPressFlag = true;
                    if(!isSelectMode) {
                        isSelectMode = true;
                        document.getElementById('previewEditBar').style.display = 'flex';
                    }
                    togglePreviewSelect(row, msgId);
                }, 1000);
            };
            const handleEnd = () => clearTimeout(pressTimer);
            row.onmousedown = handleStart; row.onmouseup = handleEnd;
            row.ontouchstart = handleStart; row.ontouchend = handleEnd;
            row.onclick = () => { if (!lastLongPressFlag && isSelectMode) togglePreviewSelect(row, msgId); };

            fragment.appendChild(row);
        });

        if (mode === 'prepend') {
            flow.insertBefore(fragment, flow.firstChild);
            flow.scrollTop = flow.scrollHeight - oldScrollHeight;
        } else {
            flow.appendChild(fragment);
        }

        // 限制 DOM 数量防止卡顿
        const allRows = flow.querySelectorAll('.preview-row');
        if (allRows.length > 400) {
            for(let i=0; i<slice.length; i++) {
                if (mode === 'prepend') { flow.lastChild.remove(); previewDownIdx--; }
                else { flow.firstChild.remove(); previewUpIdx++; }
            }
        }
    }



    function togglePreviewSelect(row, id) {
        if (selectedPreviewIds.has(id)) {
            selectedPreviewIds.delete(id);
            row.style.background = 'transparent';
            row.classList.remove('selected');
        } else {
            selectedPreviewIds.add(id);
            row.style.background = 'rgba(7, 193, 96, 0.15)'; // 高亮色
            row.classList.add('selected');
        }
        document.getElementById('selectedCountText').innerText = `已选 ${selectedPreviewIds.size} 条`;
    }

    // --- ✨ 事件监听：管理条按钮 ---

    document.addEventListener('click', async (e) => {
        // 1. 退出多选模式
        if (e.target.id === 'exitSelectBtn') {
            isSelectMode = false;
            selectedPreviewIds.clear();
            document.querySelectorAll('.preview-row').forEach(row => {
                row.classList.remove('selected');
                row.style.background = 'transparent';
            });
            document.getElementById('previewEditBar').style.display = 'none';
        }

        // 2. 预览界面删除逻辑 (已统一底层)
        if (e.target.id === 'delPreviewBtn' && selectedPreviewIds.size > 0) {
            const allVisibleRows = Array.from(document.querySelectorAll('.preview-row'));
            let anchorId = null;
            for (let row of allVisibleRows) {
                if (!selectedPreviewIds.has(row.dataset.id)) {
                    anchorId = row.dataset.id;
                    break;
                }
            }
            if (!confirm(`确定删除选中的 ${selectedPreviewIds.size} 条消息吗？`)) return;

            await physicalDeleteMessages(selectedPreviewIds);

            selectedPreviewIds.clear();
            document.getElementById('selectedCountText').innerText = `已选 0 条`;
            openChatPreview(anchorId);
            showResult('🗑️ 已批量删除', true);
        }

        // 3. 截图按钮
        if (e.target.id === 'screenshotBtn') {
            takeLongScreenshot();
        }
    });



             
        // ✨ 核心功能：智能解析（对齐皮肤工坊版）
    function parseChatContent(text) {
        if (!text) return { html: "", isPureMedia: false };

        const isBase64 = text.startsWith('data:image');
        const imgRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?)/gi;
        const match = text.match(imgRegex);
        const isImgLink = !!match;

        if (isBase64 || isImgLink) {
            const src = isBase64 ? text : match[0];
            const isSticker = isImgLink && text.length < 200;

            // ✨ 修改：不再在 JS 里写死 Style，改为只负责分配类名
            const className = isSticker ? 'sully-image-msg sully-sticker' : 'sully-image-msg sully-photo';

            // 我们只给一个最基础的大小限制，防止图片撑爆屏幕，其他的交给 CSS
            const baseStyle = "display: block; max-width: 100%; height: auto;";

            return {
                html: `<img src="${src}" class="${className}" style="${baseStyle}">`,
                isPureMedia: true
            };
        }

        // 正常文本
        return {
            html: text.replace(/\n/g, '<br>'),
            isPureMedia: false
        };
    }



    // ==================== ✨ 第四步：美化面板逻辑与样式快照 ====================

    // 1. 刷新并注入实时样式 (让预览和截图都能读到)
        async function refreshLiveStyle() {
        let liveStyle = document.getElementById('csy-beautify-inject');
        if (!liveStyle) {
            liveStyle = document.createElement('style');
            liveStyle.id = 'csy-beautify-inject';
            document.head.appendChild(liveStyle);
        }

        const css = await ConfigDB.getTheme();
        const fontData = await ConfigDB.getFont();

        let fontFace = "";
        if (fontData) {
            // ✅ 如果有用户上传的本地字体，用本地的
            fontFace = `@font-face { font-family: 'CustomFont'; src: url(${fontData.data}); }\n * { font-family: 'CustomFont', sans-serif !important; }\n`;
            document.getElementById('fontStatus').innerText = `已加载: ${fontData.name}`;
        } else {
            // ✅ 否则只声明字体族，不在这里写 @import
            fontFace = `* { font-family: 'Quicksand', 'HarmonyOS Sans', sans-serif; }\n`;
        }

        liveStyle.innerHTML = fontFace + css;
        document.getElementById('cssEditor').value = css;
    }


    // 2. 绑定预览界面的“...”入口按钮
    document.addEventListener('click', e => {
        if (e.target.closest('#openSkinBtn')) {
            skinPanel.style.right = '0';
            refreshLiveStyle();
        }
    });

    // 3. 面板内的交互事件
    document.getElementById('closeSkinPanel').onclick = () => skinPanel.style.right = '-400px';

    // 字体上传逻辑
    document.getElementById('fontUpload').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            await ConfigDB.saveFont(file.name, ev.target.result);
            refreshLiveStyle();
            showResult('✅ 字体已存入本地数据库', true);
        };
        reader.readAsDataURL(file);
    };

    // 保存样式逻辑
    document.getElementById('applySkinBtn').onclick = async () => {
        const css = document.getElementById('cssEditor').value;
        await ConfigDB.saveTheme(css);
        await refreshLiveStyle();
        showResult('✨ 样式已保存，预览已同步', true);
    };

    // 重置逻辑
    document.getElementById('resetSkinBtn').onclick = async () => {
        if (confirm('警告：这将清空你当前的自定义 CSS，恢复到默认微信预设。是否继续？')) {
            await ConfigDB.saveTheme(DEFAULT_THEME_CSS);
            refreshLiveStyle();
        }
    };

    // 初始化：启动即尝试加载一次样式
    refreshLiveStyle();

    // ========================================================================

    function formatChatTime(ts) {
        const date = new Date(ts);
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        if (date.toDateString() === now.toDateString()) return timeStr;
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
    }



})(); // 脚本结束

