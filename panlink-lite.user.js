// ==UserScript==
// @name         网盘直链下载助手 · 自用精简版
// @namespace    https://github.com/syhyz1990/baiduyun
// @version      1.8.1
// @author       基于 YouXiaoHou 的 panlinker 精简重写
// @description  百度 / 阿里 / 夸克 / 迅雷 网盘直链获取。复制 aria2c 命令或 RPC 推送给 Motrix/aria2/Rayburst。无远程配置、无激活码、无广告。
// @license      AGPL-3.0-or-later
// @match        *://pan.baidu.com/*
// @match        *://yun.baidu.com/*
// @match        *://www.aliyundrive.com/*
// @match        *://www.alipan.com/*
// @match        *://pan.quark.cn/*
// @match        *://pan.xunlei.com/*
// @match        *://openapi.baidu.com/*
// @connect      pan.baidu.com
// @connect      openapi.baidu.com
// @connect      api.aliyundrive.com
// @connect      drive.quark.cn
// @connect      api-pan.xunlei.com
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        window.close
// @grant        unsafeWindow
// @grant        unsafeWindow
// @run-at       document-idle
// 若要开启自动更新：把脚本发布到私有 Gist，取消下行注释并替换为你的 raw 地址
// （Gist raw 用 /raw/panlink-lite.user.js 这种不带 commit hash 的形式，始终指向最新版）
// @updateURL    https://gist.githubusercontent.com/<你的用户名>/<gist_id>/raw/panlink-lite.user.js
// @downloadURL  https://gist.githubusercontent.com/<你的用户名>/<gist_id>/raw/panlink-lite.user.js
// ==/UserScript==

/*
 * 使用说明
 * 1. 网盘页面勾选文件 → 点「⬇ 直链下载」
 * 2. 每个文件 2 个操作：复制 aria2c 命令 / 推送 RPC（小文件直接用网盘自带下载）
 * 3. RPC 参数在 Tampermonkey 菜单「⚙️ 设置」里配置（Motrix 默认 http://localhost:16800/jsonrpc）
 * 4. 百度直链下载需要 BDUSS：优先 GM_cookie 自动读取，失效时在设置里手动粘贴
 *
 * 已知限制（对应原版功能取舍）
 * - 仅支持「我的网盘」页面；分享页请先保存到自己的网盘再下
 * - 百度直链配合超级会员才能满速；下载时会带上 User-Agent: pan.baidu.com + Cookie: BDUSS
 * - 本脚本只负责导出直链/命令/推送 RPC，不触发浏览器下载，大文件不占内存
 */

(function () {
    'use strict';

    /* ===================== 常量配置（全部本地硬编码，无远程配置） ===================== */

    const BAIDU_UA = 'pan.baidu.com';
    // 百度开放平台应用 client_id = 应用的 AppKey（API Key），见 private/baidu-oauth-credentials.txt
    // 注意：SecretKey / SignKey 服务端密钥绝不放进本脚本，隐式授权(response_type=token)用不到它
    const BAIDU_CLIENT_ID = 'cFjj1cCYQwIr7Sk1v6EA0rYDpI9qk6fx';

    const API = {
        baidu: {
            filemetas: 'https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1',
            authorize: `https://openapi.baidu.com/oauth/2.0/authorize?client_id=${BAIDU_CLIENT_ID}&response_type=token&redirect_uri=oob&confirm_login=0&scope=basic,netdisk`,
        },
        ali: {
            getDownloadUrl: 'https://api.aliyundrive.com/v2/file/get_download_url',
            // 2026-10 起下载签名绑定的 Referer 是 alipan.com（旧 aliyundrive.com 会 403 SignatureDoesNotMatch）
            referer: 'https://www.alipan.com/',
        },
        quark: {
            download: 'https://drive.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc',
            // 夸克接口校验客户端 UA，需伪装为 quark-cloud-drive（Electron 客户端）
            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch',
        },
        xunlei: {
            files: 'https://api-pan.xunlei.com/drive/v1/files/',
        },
    };

    const DEFAULTS = {
        rpcDomain: 'http://localhost',
        rpcPort: '16800',
        rpcPath: '/jsonrpc',
        rpcToken: '',
        rpcDir: '', // 留空 = 用下载器自己的默认下载目录，避免目录不存在被 aria2 拒绝
        bduss: '',
    };

    /* ===================== 基础工具 ===================== */

    const cfg = (key) => {
        const v = GM_getValue(key, undefined);
        return v === undefined ? DEFAULTS[key] : v;
    };
    const setCfg = (key, value) => GM_setValue(key, value);

    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const fixFilename = (name) => String(name || '').replace(/[!?&|`"'*/:<>\\]/g, '_');

    const sizeFormat = (value) => {
        if (value !== +value) return '';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let idx = Math.floor(Math.log(value) / Math.log(1024));
        idx = Math.min(idx, units.length - 1);
        return (value / Math.pow(1024, idx)).toFixed(1) + units[idx];
    };

    function copyText(text, tip) {
        GM_setClipboard(text, 'text');
        toast(tip || '已复制到剪贴板');
    }

    /* ---------- 网络请求（GM_xmlhttpRequest，跨域 + 自定义头） ---------- */

    function gmRequest({ method = 'GET', url, headers = {}, data, responseType }) {
        return new Promise((resolve, reject) => {
            const payload = data && typeof data === 'object' && !(data instanceof Blob)
                ? JSON.stringify(data) : data;
            GM_xmlhttpRequest({
                method, url, headers, data: payload,
                responseType: responseType || 'json',
                onload: (res) => resolve(res.response ?? res.responseText),
                onerror: reject,
            });
        });
    }

    const gmGet = (url, headers, type) => gmRequest({ url, headers, responseType: type });
    const gmPost = (url, data, headers, type) => gmRequest({ method: 'POST', url, data, headers, responseType: type });

    /* ---------- React/Vue 内部状态读取（用于拿“勾选列表”） ---------- */

    function findReact(dom, traverseUp = 0) {
        if (!dom) return null;
        const key = Object.keys(dom).find((k) =>
            k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$') || k.startsWith('__reactContainer$'));
        const fiber = key && dom[key];
        if (!fiber) return null;
        // 旧版 React
        if (fiber._currentElement) {
            let comp = fiber._currentElement._owner;
            for (let i = 0; i < traverseUp; i++) comp = comp._currentElement._owner;
            return comp._instance;
        }
        const up = (f) => {
            let p = f.return;
            while (p && typeof p.type === 'string') p = p.return;
            return p;
        };
        let comp = up(fiber);
        for (let i = 0; i < traverseUp; i++) comp = up(comp);
        return comp && (comp.stateNode || comp);
    }

    function fiberProps(obj) {
        return (obj && (obj.props || obj.memoizedProps || obj.pendingProps)) || {};
    }

    // 兜底：React 纤维深扫——遍历页面节点沿 fiber 链向上找「列表数据 + 选中键」共存的组件，
    // 用于阿里等改版后容器 class 变化、常规定位失效的场景（开销仅在点击时发生一次）
    function deepScanReactSelection(idKeys = ['fileId', 'file_id', 'id']) {
        const idOf = (v) => String(...idKeys.map((k) => v && v[k]).filter((x) => x !== undefined && x !== null).slice(0, 1));
        const results = [];
        const seen = new Set();
        const els = document.querySelectorAll('*');
        for (const el of els) {
            const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) continue;
            let fiber = el[key];
            for (let up = 0; fiber && up < 15; up++, fiber = fiber.return) {
                const props = fiber.memoizedProps;
                if (!props || typeof props !== 'object') continue;
                const list = props.dataSource || props.list || props.fileList || props.items;
                if (!Array.isArray(list) || !list.length) continue;
                const keysRaw = props.selectedKeys ?? props.selectedRowKeys;
                if (keysRaw == null) continue;
                const keys = Array.isArray(keysRaw) ? keysRaw.map(String) : String(keysRaw).split(',');
                if (!keys.length || !keys[0]) continue;
                const picked = list.filter((v) => keys.includes(idOf(v)));
                if (!picked.length) continue;
                const sig = picked.map(idOf).join(',');
                if (!seen.has(sig)) { seen.add(sig); results.push(...picked); }
            }
        }
        return results;
    }

    /* ===================== 提示 / 弹窗 UI ===================== */

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        const css = `
            #pl-fab.pl-float{position:fixed;right:22px;bottom:88px;z-index:99999;background:#09aaff;color:#fff;border:none;
                border-radius:22px;padding:10px 18px;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);}
            #pl-fab.pl-float:hover{background:#0090dd}
            #pl-fab.pl-inline{display:inline-flex;align-items:center;justify-content:center;gap:4px;margin-left:8px;
                padding:5px 12px;height:32px;border:1px solid #09aaff;border-radius:6px;background:#fff;
                color:#09aaff;font-size:13px;cursor:pointer;flex-shrink:0;white-space:nowrap;}
            #pl-fab.pl-inline:hover{background:#eef8ff}
            #pl-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:100001;background:#222;color:#fff;
                padding:9px 18px;border-radius:6px;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none;max-width:70vw}
            #pl-toast.pl-show{opacity:.92}
            #pl-toast.pl-err{background:#c0392b}
            #pl-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:7vh}
            .pl-modal{background:#fff;border-radius:10px;width:min(860px,92vw);max-height:80vh;display:flex;flex-direction:column;
                box-shadow:0 12px 40px rgba(0,0,0,.3);font-size:13px;color:#333;overflow:hidden}
            .pl-head{padding:14px 18px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
            .pl-head b{font-size:15px}
            .pl-close{cursor:pointer;font-size:20px;line-height:1;color:#888;padding:2px 6px}
            .pl-close:hover{color:#333}
            .pl-cfg{cursor:pointer;font-size:15px;line-height:1;color:#888;padding:2px 6px;margin-left:2px}
            .pl-cfg:hover{color:#333}
            .pl-body{flex:1;overflow-y:auto;padding:10px 18px}
            .pl-note{background:#fff8e6;border:1px solid #f0e0b0;color:#8a6d3b;padding:8px 12px;border-radius:6px;margin-bottom:10px;line-height:1.6}
            .pl-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px dashed #eee}
            .pl-row:last-child{border-bottom:none}
            .pl-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .pl-size{color:#999;margin-left:8px;flex-shrink:0}
            .pl-btn{border:1px solid #ccc;background:#f7f7f7;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap}
            .pl-btn:hover{background:#e8e8e8}
            .pl-btn.pl-primary{background:#09aaff;border-color:#09aaff;color:#fff}
            .pl-btn.pl-primary:hover{background:#0090dd}
            .pl-foot{padding:12px 18px;border-top:1px solid #eee;display:flex;gap:8px;flex-wrap:wrap}
            .pl-form label{display:flex;align-items:center;gap:10px;margin-bottom:12px}
            .pl-form span{flex:0 0 110px;text-align:right;color:#666}
            .pl-form input{flex:1;padding:7px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px}
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function toast(msg, isError) {
        injectStyles();
        let el = document.getElementById('pl-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'pl-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.toggle('pl-err', !!isError);
        el.classList.add('pl-show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('pl-show'), 2800);
    }

    function openModal(innerHtml) {
        injectStyles();
        closeModal();
        const mask = document.createElement('div');
        mask.id = 'pl-mask';
        mask.innerHTML = `<div class="pl-modal">${innerHtml}</div>`;
        document.body.appendChild(mask);
        mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
        mask.querySelectorAll('.pl-close').forEach((el) => el.addEventListener('click', closeModal));
        return mask;
    }
    const closeModal = () => { const m = document.getElementById('pl-mask'); if (m) m.remove(); };

    /* ===================== 设置 ===================== */

    function showSettings() {
        const fields = [
            ['rpcDomain', 'RPC 域名'],
            ['rpcPort', 'RPC 端口'],
            ['rpcPath', 'RPC 路径'],
            ['rpcToken', 'RPC 密钥'],
            ['rpcDir', '保存目录'],
            ['bduss', 'BDUSS(可选)'],
        ];
        const rows = fields.map(([key, label]) =>
            `<label><span>${label}</span><input data-key="${key}" value="${escapeHtml(cfg(key))}" placeholder=""></label>`).join('');
        const mask = openModal(`
            <div class="pl-head"><b>助手设置</b><span class="pl-close">×</span></div>
            <div class="pl-body pl-form">
                <div class="pl-note">RPC 用于推送给 Motrix / aria2 / Rayburst（默认 http://localhost:16800/jsonrpc）。
                Rayburst（原 Motrix Next）默认端口是 <b>29100</b> 且默认启用密钥：端口填 29100，密钥在 Rayburst 设置的 RPC/进阶项里复制。
                「保存目录」留空 = 用下载器自己的默认下载目录；填则必须是已存在的完整路径（如 D:/Downloads）。
                BDUSS 留空时自动用 GM_cookie 读取百度 Cookie；读不到（如 Cookie 被设为 httpOnly 且管理器不支持）再手动粘贴。</div>
                ${rows}
            </div>
            <div class="pl-foot">
                <button class="pl-btn pl-primary" id="pl-save">保存</button>
                <button class="pl-btn" id="pl-cancel">取消</button>
            </div>`);
        mask.querySelector('#pl-save').addEventListener('click', () => {
            mask.querySelectorAll('input[data-key]').forEach((input) => setCfg(input.dataset.key, input.value.trim()));
            closeModal();
            toast('设置已保存');
        });
        mask.querySelector('#pl-cancel').addEventListener('click', closeModal);
    }

    /* ===================== 诊断模式 ===================== */

    // 一键收集排障信息：平台识别 / 按钮挂载位置 / 勾选识别结果 / RPC 配置（脱敏）/ 最近错误
    function collectDiagnostics() {
        const v = GM_info.script.version;
        const lines = [
            `panlink-lite v${v}`,
            `时间: ${new Date().toLocaleString()}`,
            `页面: ${location.href}`,
            `UA: ${navigator.userAgent}`,
        ];
        if (!platform) {
            lines.push('平台识别: 未匹配（当前站点不在支持列表）');
        } else {
            lines.push(`平台识别: ${platform.name}`);
            lines.push(`页面状态: detectPage=${platform.detectPage() || '非 home（请在「我的网盘」页诊断）'}`);
            const btn = document.getElementById('pl-fab');
            lines.push(`按钮挂载: ${btn ? (btn.classList.contains('pl-inline') ? '操作排/搜索框（inline）' : '右下悬浮（兜底）') : '未挂载'}`);
            // 挂载点分析：解释按钮为什么掉到兜底
            lines.push(`挂载点分析: mountAfterSearch=${!!platform.mountAfterSearch}`);
            const anchorTexts = platform.mountAfter || [];
            const anchor = findAnchorButton(anchorTexts);
            lines.push(`  锚点文本: ${anchorTexts.join(' / ') || '(无)'}`);
            lines.push(`  锚点命中: ${anchor ? `${anchor.tagName}.${String(anchor.className).split(' ')[0].slice(0, 30)} "${(anchor.textContent || '').trim()}"` : '未命中'}`);
            const si = findSearchInput();
            lines.push(`  搜索框(input): ${si ? si.outerHTML.slice(0, 140) : '未命中'}`);
            const sb = findSearchBox();
            if (sb) {
                const r = sb.getBoundingClientRect();
                lines.push(`  搜索框(div): ${sb.tagName}.${String(sb.className).split(' ')[0].slice(0, 24)} @(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
            } else {
                lines.push(`  搜索框(div): 未命中`);
            }
            // 伪搜索框候选：页面顶部文本含「搜索」的小元素（自绘搜索框的线索）
            const cands = [];
            document.querySelectorAll('div, span, a').forEach((el) => {
                const t = (el.textContent || '').trim();
                if (t.length < 2 || t.length > 20 || !/搜索|search/i.test(t)) return;
                if (el.children.length > 2) return;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.top > 260) return;
                cands.push(`${el.tagName}.${String(el.className).split(' ')[0].slice(0, 24)} "${t}" @(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
            });
            lines.push(`  伪搜索框候选: ${cands.length ? cands.slice(0, 6).join(' | ') : '无'}`);
            let selected = [];
            try {
                selected = platform.getSelectedList() || [];
            } catch (e) {
                lines.push(`勾选读取异常: ${e && (e.message || e)}`);
            }
            lines.push(`勾选识别: ${selected.length} 项`);
            // 深扫分析：阿里等改版后勾选识别失败时，输出真实 DOM/fiber 线索
            try {
                lines.push('勾选深扫分析:');
                diagnoseSelection().split('\n').forEach((l) => lines.push(`  ${l}`));
            } catch (e) { /* 诊断失败不影响主流程 */ }
            selected.slice(0, 3).forEach((item, i) => {
                try {
                    const m = platform.mapItem(item);
                    lines.push(`  [${i}] name=${m.name} size=${m.size} isFolder=${m._isFolder}`);
                } catch (e) {
                    lines.push(`  [${i}] mapItem 失败: ${e && (e.message || e)}`);
                }
            });
        }
        lines.push(`RPC 配置: ${cfg('rpcDomain')}:${cfg('rpcPort')}${cfg('rpcPath')} 密钥=${cfg('rpcToken') ? '已设置' : '空'} 目录=${cfg('rpcDir')}`);
        if (lastError) lines.push(`最近错误: ${lastError}`);
        return lines.join('\n');
    }

    /* ===================== 下载动作 ===================== */

    function buildAria2Cmd(item) {
        let cmd = `aria2c "${item.link}" --out "${fixFilename(item.name)}"`;
        (item.headers || []).forEach((h) => { cmd += ` --header "${h}"`; });
        return cmd;
    }

    async function sendToRPC(item) {
        const rpcUrl = `${cfg('rpcDomain')}:${cfg('rpcPort')}${cfg('rpcPath')}`;
        const token = cfg('rpcToken');
        const options = { out: fixFilename(item.name), header: item.headers || [] };
        const dir = cfg('rpcDir');
        if (dir) options.dir = dir; // 留空则不带 dir，由下载器决定存放位置
        let res;
        try {
            res = await gmPost(rpcUrl, {
                id: Date.now(), jsonrpc: '2.0', method: 'aria2.addUri',
                params: token ? [`token:${token}`, [item.link], options] : [[item.link], options],
            }, { 'Content-Type': 'application/json' }, 'json');
        } catch (e) {
            // 网络层失败：端口上没有服务在监听（下载器没开/没装）或地址填错
            throw new Error('连不上 RPC 服务（下载器未运行或未安装？域名/端口是否正确？）');
        }
        if (res && res.result) return res.result;
        // 下载器返回的 JSON-RPC 业务错误（密钥不对、目录不存在等）
        const m = res && res.error && (res.error.message || `code=${res.error.code}`);
        throw new Error(m ? `下载器拒绝任务: ${m}` : 'RPC 返回异常，请检查端口/路径/密钥');
    }

    /* ===================== 平台模块 ===================== */

    /* ---------- 百度网盘 ---------- */

    const baidu = {
        name: '百度网盘',
        // 按钮挂载：插到该按钮右侧（内容区左上操作排）
        mountAfter: ['打开电脑端'],

        detectPage() {
            const p = location.pathname;
            if (/^\/disk\/(home|main)/.test(p)) return 'home';
            return '';
        },

        getSelectedList() {
            try {
                const req = unsafeWindow.require || window.require;
                return req('system-core:context/context.js').instanceForSystem.list.getSelected();
            } catch (e) {
                try {
                    return document.querySelector('.wp-s-core-pan').__vue__.selectedList;
                } catch (e2) {
                    return [];
                }
            }
        },

        mapItem(v) {
            return {
                name: v.server_filename || v.filename,
                size: v.size,
                link: v.dlink,
                _isFolder: +v.isdir === 1,
                _fsId: v.fs_id,
            };
        },

        async ensureToken() {
            let token = GM_getValue('baidu_access_token', '');
            if (token) return token;
            return this.fetchToken();
        },

        // 静默 OAuth：POST 授权表单 → 从重定向里拿 access_token（首次会授权一次，之后静默）
        async fetchToken() {
            try {
                let final = await this.getFinalUrl(API.baidu.authorize);
                if (final.includes('access_token=')) {
                    const t = final.match(/access_token=([^&]+)/)[1];
                    GM_setValue('baidu_access_token', t);
                    return t;
                }
                if (final.includes('authorize')) {
                    const html = await gmGet(API.baidu.authorize, {}, 'text');
                    const bdstoken = (html.match(/name="bdstoken"\s+value="([^"]+)"/) || [])[1];
                    const client_id = (html.match(/name="client_id"\s+value="([^"]+)"/) || [])[1] || BAIDU_CLIENT_ID;
                    await gmPost(API.baidu.authorize, new URLSearchParams({
                        grant_permissions_arr: 'netdisk', bdstoken, client_id,
                        response_type: 'token', display: 'page', grant_permissions: 'basic,netdisk',
                    }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 'text');
                    final = await this.getFinalUrl(API.baidu.authorize);
                }
                const t = (final.match(/access_token=([^&]+)/) || [])[1];
                if (t) GM_setValue('baidu_access_token', t);
                return t || '';
            } catch (e) {
                return '';
            }
        },

        getFinalUrl(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    onload: (res) => resolve(res.finalUrl),
                    onerror: reject,
                });
            });
        },

        async getBDUSS() {
            const manual = cfg('bduss');
            if (manual) return manual;
            return new Promise((resolve) => {
                try {
                    GM_cookie('list', { name: 'BDUSS' }, (cookies, error) => {
                        if (!error && cookies && cookies[0] && cookies[0].value) return resolve(cookies[0].value);
                        resolve('');
                    });
                } catch (e) {
                    resolve('');
                }
            });
        },

        async fetchLinks(selected) {
            const files = selected.filter((v) => +v.isdir !== 1);
            if (!files.length) return [];
            const fsids = encodeURIComponent('[' + files.map((v) => v.fs_id).join(',') + ']');
            let token = await this.ensureToken();
            if (!token) throw new Error('获取百度 access_token 失败，请重新登录网盘');
            let res = await gmGet(`${API.baidu.filemetas}&fsids=${fsids}&access_token=${token}`, { 'User-Agent': BAIDU_UA });
            if (res && res.errno === 9019) { // token 失效
                GM_setValue('baidu_access_token', '');
                token = await this.fetchToken();
                res = await gmGet(`${API.baidu.filemetas}&fsids=${fsids}&access_token=${token}`, { 'User-Agent': BAIDU_UA });
            }
            if (!res || res.errno !== 0) throw new Error(`获取直链失败 (errno=${res && res.errno})`);
            const bduss = await this.getBDUSS();
            return res.list.map((v) => {
                const item = this.mapItem(v);
                item.link = v.dlink + (v.dlink.includes('access_token=') ? '' : `&access_token=${token}`);
                item.headers = [`User-Agent: ${BAIDU_UA}`].concat(bduss ? [`Cookie: BDUSS=${bduss}`] : []);
                return item;
            });
        },

        note() {
            return '百度：直链校验 User-Agent，外部下载器直连会 403。请用「复制命令」（已带 UA/Cookie）或「推送 RPC」下载；小文件可直接用网盘自带下载。满速需超级会员。';
        },
    };

    /* ---------- 阿里云盘 / alipan ---------- */

    // 路径二：新版阿里把勾选状态收进 listModel 对象（诊断证实：listModel,isFolder 在卡片 fiber ↑3）
    function aliViaListModel() {
        const dom = document.querySelector('[class*="node-list-grid-view"], [class*="node-list-table-view"]');
        if (!dom) return [];
        const fkey = Object.keys(dom).find((k) => k.startsWith('__reactFiber$'));
        if (!fkey) return [];
        let listModel = null;
        let fiber = dom[fkey];
        for (let up = 0; fiber && up < 20; up++, fiber = fiber.return) {
            const p = fiber.memoizedProps;
            if (p && p.listModel) { listModel = p.listModel; break; }
        }
        if (!listModel) return [];
        // 文件列表
        let list = [];
        for (const k of ['list', 'dataSource', 'fileList', 'items']) {
            const v = listModel[k];
            if (Array.isArray(v) && v.length) { list = v; break; }
        }
        const tryArr = (v) => {
            if (Array.isArray(v) && v.length) {
                keys = v.map((x) => String((x && (x.fileId ?? x.file_id ?? x.id)) ?? x));
                return true;
            }
            return false;
        };
        let keys = [];
        if (!tryArr(listModel.selectedKeys) && !tryArr(listModel.checkedKeys)) {
            for (const m of ['getSelectedKeys', 'getSelected', 'getCheckedKeys', 'getSelectedList']) {
                if (typeof listModel[m] !== 'function') continue;
                try {
                    const r = listModel[m]();
                    if (r instanceof Set) { if (tryArr([...r])) break; }
                    else if (Array.isArray(r)) {
                        // 直接返回文件对象数组
                        if (r.length && r[0] && (r[0].fileId || r[0].file_id || r[0].id)) { r.forEach((x) => { x._fromNewUi = true; }); console.log('[panlink-lite] 阿里勾选(listModel.getSelected 直接命中):', r.length); return r; }
                        if (tryArr(r)) break;
                    }
                } catch (e) { /* 试下一个方法名 */ }
            }
        }
        if (keys.length && list.length) {
            const picked = list.filter((v) => keys.includes(String(v.fileId ?? v.file_id ?? v.id)));
            picked.forEach((v) => { v._fromNewUi = true; });
            if (picked.length) console.log('[panlink-lite] 阿里勾选(listModel 键匹配):', picked.length);
            return picked;
        }
        return [];
    }

    // 路径三：勾选态 checkbox DOM 反查——[aria-checked/data-checked=true] 向上找卡片 fiber 里的文件对象
    function aliViaCheckedBox() {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('[aria-checked="true"], [data-checked="true"]').forEach((cb) => {
            const r = cb.getBoundingClientRect();
            if (r.width === 0 || r.left < 100 || r.top < 100) return; // 限定内容区，排除侧栏/顶栏
            let el = cb;
            for (let d = 0; el && d < 10; el = el.parentElement, d++) {
                const fkey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
                if (!fkey) continue;
                let fiber = el[fkey];
                for (let up = 0; fiber && up < 6; up++, fiber = fiber.return) {
                    const p = fiber.memoizedProps;
                    if (!p || typeof p !== 'object') continue;
                    for (const c of [p.item, p.data, p.fileInfo, p.file, p.node]) {
                        if (c && typeof c === 'object' && (c.fileId || c.file_id || c.id) && (c.name || c.fileName)) {
                            const id = String(c.fileId ?? c.file_id ?? c.id);
                            if (!seen.has(id)) { seen.add(id); c._fromNewUi = true; out.push(c); }
                            return;
                        }
                    }
                }
            }
        });
        if (out.length) console.log('[panlink-lite] 阿里勾选(checkbox DOM 反查):', out.length);
        return out;
    }

    const ali = {
        name: '阿里云盘',
        // 阿里无常驻按钮排，挂到搜索框右侧（顶行）
        mountAfterSearch: true,

        detectPage() {
            return /^\/drive/.test(location.pathname) ? 'home' : '';
        },

        getSelectedList() {
            // 列表视图 / 图标视图的容器 class 前缀（阿里改版会换 hash 后缀，前缀相对稳定）
            const containerSel = [
                '[class^="node-list-table-view--"]',
                '[class^="node-list-grid-view--"]',
                '[class*="node-list-table-view"]',
                '[class*="node-list-grid-view"]',
            ];
            for (const sel of containerSel) {
                const dom = document.querySelector(sel);
                if (!dom) continue;
                for (let up = 0; up <= 2; up++) {
                    try {
                        const props = fiberProps(findReact(dom, up));
                        const fileList = props.dataSource || props.list || props.fileList || [];
                        const keysRaw = props.selectedKeys ?? props.selectedRowKeys ?? props.selected ?? [];
                        const keys = Array.isArray(keysRaw) ? keysRaw.map(String) : String(keysRaw).split(',');
                        const picked = fileList.filter((v) => keys.includes(String(v.fileId ?? v.file_id ?? v.id)));
                        if (picked.length) return picked;
                    } catch (e) { /* 尝试下一个 */ }
                }
            }
            // 路径二：新版阿里把勾选收进 listModel 对象
            try {
                const viaModel = aliViaListModel();
                if (viaModel.length) return viaModel;
            } catch (e) { /* 试下一条 */ }
            // 路径三：勾选态 checkbox DOM 反查文件对象
            try {
                const viaDom = aliViaCheckedBox();
                if (viaDom.length) return viaDom;
            } catch (e) { /* 试下一条 */ }
            // 兜底：容器 class 改版后走纤维深扫
            try {
                return deepScanReactSelection();
            } catch (e) {
                return [];
            }
        },

        mapItem(v) {
            return {
                name: v.name || v.fileName || v.displayName || '',
                size: v.size ?? v.fileSize ?? 0,
                link: v.downloadUrl || v.url || '',
                _isFolder: v.type === 'folder' || v.isFolder === true,
                _driveId: v.driveId || v.drive_id || v.driveID,
                _fileId: v.fileId || v.file_id || v.id,
            };
        },

        getToken() {
            try {
                const t = JSON.parse(localStorage.getItem('token') || '{}');
                if (t.access_token) return t;
            } catch (e) { /* 继续扫描 */ }
            // 新版 UI 可能更换 token 存储键：扫描 localStorage 里含 access_token 的 JSON
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const raw = localStorage.getItem(localStorage.key(i));
                    if (!raw || raw.indexOf('access_token') === -1) continue;
                    const obj = JSON.parse(raw);
                    if (obj && obj.access_token) return obj;
                }
            } catch (e) { /* 忽略 */ }
            return {};
        },

        async fetchLinks(selected) {
            const token = this.getToken();
            if (!token.access_token) throw new Error('未登录阿里云盘或 token 缺失，请刷新页面');
            const files = selected.filter((v) => !this.mapItem(v)._isFolder);
            const out = [];
            for (const v of files) {
                const item = this.mapItem(v);
                // 新版 UI 的列表对象里的 url/downloadUrl 多是非下载地址（预览/缩略图），
                // 来自新版路径的对象一律走官方 API 取链
                let link = v._fromNewUi ? '' : (v.downloadUrl || v.url || '');
                let viaApi = false;
                if (!link) {
                    viaApi = true;
                    const res = await gmPost(API.ali.getDownloadUrl, {
                        drive_id: v.driveId || v.drive_id || v.driveID,
                        file_id: v.fileId || v.file_id || v.id,
                    }, {
                        authorization: `${token.token_type} ${token.access_token}`,
                        'content-type': 'application/json;charset=utf-8',
                        referer: API.ali.referer,
                        'x-canary': 'client=windows,app=adrive,version=v6.0.0',
                    });
                    if (res && res.code === 'AccessTokenInvalid') throw new Error('阿里 token 已过期，请刷新页面');
                    if (res && res.code) throw new Error(`阿里接口报错: ${res.code} ${res.message || res.msg || ''}`);
                    link = (res && res.url) || '';
                }
                console.log(`[panlink-lite] 阿里直链来源: ${viaApi ? 'API' : '列表字段'} → ${String(link).slice(0, 90)}`);
                item.link = link || '获取下载地址失败，请刷新重试';
                item.headers = [`Referer: ${API.ali.referer}`];
                out.push(item);
            }
            return out;
        },

        note() {
            return '阿里：直链自带签名，命令与 RPC 已带 Referer 头，小文件也可用网盘自带下载。';
        },
    };

    /* ---------- 夸克网盘 ---------- */

    const quark = {
        name: '夸克网盘',
        mountAfter: ['添加备份', '新建文件夹', '上传文件'],

        detectPage() {
            return /^\/list/.test(location.pathname) ? 'home' : '';
        },

        getSelectedList() {
            try {
                const dom = document.getElementsByClassName('file-list')[0];
                const props = fiberProps(findReact(dom, 0));
                const fileList = props.list || props.dataSource || [];
                const keys = props.selectedRowKeys || props.selectedKeys || [];
                return fileList.filter((v) => keys.includes(v.fid ?? v.file_id));
            } catch (e) {
                return [];
            }
        },

        mapItem(v) {
            return {
                name: v.file_name || v.name,
                size: v.size,
                link: v.download_url || '',
                _isFolder: v.file === false || v.dir === true,
                _fid: v.fid,
            };
        },

        async fetchLinks(selected) {
            const fids = selected.map((v) => v.fid ?? v.file_id).filter(Boolean).map(String);
            if (!fids.length) throw new Error('未能取到文件 fid，请刷新页面重试');
            const res = await gmPost(API.quark.download, { fids }, {
                'content-type': 'application/json;charset=utf-8',
                'user-agent': API.quark.ua,
            });
            if (res && +res.code === 31001) throw new Error('夸克未登录，请先登录后刷新页面');
            if (!res || +res.code !== 0) {
                const msg = (res && (res.message || res.msg || res.error)) || (typeof res === 'string' ? res.slice(0, 60) : '');
                throw new Error(`夸克获取链接失败 (code=${res && res.code}${msg ? ' ' + msg : ''})`);
            }
            return (res.data || [])
                .filter((v) => v.file !== false)
                .map((v) => {
                    const item = this.mapItem(v);
                    item.headers = [`Cookie: ${document.cookie}`];
                    return item;
                });
        },

        note() {
            return '夸克：直链需要带 Cookie，命令与 RPC 已自动附带；非会员有限速。';
        },
    };

    /* ---------- 迅雷网盘 ---------- */

    const xunlei = {
        name: '迅雷网盘',
        mountAfter: ['传输列表', '添加'],

        detectPage() {
            return /^\/$/.test(location.pathname) ? 'home' : '';
        },

        getSelectedList() {
            try {
                const doms = document.querySelectorAll('[class*="SourceListItem__item"]');
                const out = [];
                for (const dom of doms) {
                    const vm = dom.__vue__;
                    if (vm && vm.selected && vm.info && vm.selected.includes(vm.info.id)) {
                        out.push(vm.info);
                    }
                }
                return out;
            } catch (e) {
                return [];
            }
        },

        mapItem(v) {
            return {
                name: v.name,
                size: +v.size,
                link: v.downloadUrl || '',
                _isFolder: v.kind === 'drive#folder',
                _id: v.id,
            };
        },

        getToken() {
            let credentials = {}, captcha = {};
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (/^credentials_/.test(key)) credentials = JSON.parse(localStorage.getItem(key) || '{}');
                    if (/^captcha_[\w]{16}/.test(key)) captcha = JSON.parse(localStorage.getItem(key) || '{}');
                }
                const deviceid = /(\w{32})/.exec(String(localStorage.getItem('deviceid') || ''))[0] || '';
                return { credentials, captcha, deviceid };
            } catch (e) {
                return { credentials: {}, captcha: {}, deviceid: '' };
            }
        },

        async fetchLinks(selected) {
            const token = this.getToken();
            if (!token.credentials.access_token) throw new Error('未登录迅雷网盘或 token 缺失，请刷新页面');
            const files = selected.filter((v) => v.kind !== 'drive#folder');
            const out = [];
            for (const v of files) {
                const item = this.mapItem(v);
                if (v.downloadUrl) {
                    out.push(item);
                    continue;
                }
                try {
                    const res = await gmGet(API.xunlei.files + v.id, {
                        Authorization: `${token.credentials.token_type} ${token.credentials.access_token}`,
                        'content-type': 'application/json',
                        'x-captcha-token': token.captcha.token,
                        'x-device-id': token.deviceid,
                    });
                    item.link = (res && res.web_content_link) || '获取下载地址失败，请刷新重试';
                } catch (e) {
                    item.link = '获取下载地址失败，请刷新重试';
                }
                out.push(item);
            }
            return out;
        },

        note() {
            return '迅雷：直链不含文件名，命令与 RPC 已自动用 --out 命名，直接下载即可。';
        },
    };

    // 勾选深扫分析：诊断专用，收集新版阿里勾选识别的失败线索
    function diagnoseSelection() {
        const lines = [];
        const containerSel = ['[class^="node-list-table-view--"]', '[class^="node-list-grid-view--"]', '[class*="node-list-table-view"]', '[class*="node-list-grid-view"]'];
        lines.push(`容器选择器: ${containerSel.map((s) => `${s.slice(0, 28)}=${document.querySelectorAll(s).length}`).join(' ')}`);
        let fiberCount = 0;
        document.querySelectorAll('*').forEach((el) => {
            if (Object.keys(el).some((x) => x.startsWith('__reactFiber$'))) fiberCount++;
        });
        lines.push(`fiber 元素数: ${fiberCount}`);
        const sel = [];
        document.querySelectorAll('[class*="selected"],[class*="Selected"],[class*="checked"],[class*="Checked"],[aria-checked="true"],[aria-selected="true"]').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.left < 100 || r.top < 100) return;
            if (sel.length < 8) sel.push(`${el.tagName}[${String(el.className).slice(0, 50)}] @(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
        });
        lines.push(`选中态候选: ${sel.length ? sel.join(' | ') : '无'}`);
        const probe = [];
        document.querySelectorAll('[class*="selected"],[class*="Selected"],[class*="checked"],[aria-checked="true"]').forEach((el) => {
            if (probe.length >= 3) return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.left < 100 || r.top < 100) return;
            const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
            if (!k) { probe.push(`${el.tagName}: 无 fiber`); return; }
            let f = el[k];
            for (let up = 0; f && up < 8; up++, f = f.return) {
                const p = f.memoizedProps;
                if (p && typeof p === 'object') {
                    probe.push(`${el.tagName}↑${up}: ${Object.keys(p).slice(0, 12).join(',')}`);
                }
            }
        });
        lines.push(`选中卡片 fiber props: ${probe.length ? probe.join(' || ') : '无'}`);
        return lines.join('\n');
    }

    /* ===================== 主流程 UI ===================== */

    const PLATFORMS = [
        { test: () => /(^|\.)baidu\.com$/.test(location.host), impl: baidu },
        { test: () => /(^|\.)(aliyundrive|alipan)\.com$/.test(location.host), impl: ali },
        { test: () => /(^|\.)quark\.cn$/.test(location.host), impl: quark },
        { test: () => /(^|\.)xunlei\.com$/.test(location.host), impl: xunlei },
    ];

    let platform = null;
    let currentList = []; // [{name, size, link, headers}]
    let lastError = ''; // 最近一次错误，供诊断信息使用
    const noteError = (e) => { lastError = `${new Date().toLocaleTimeString()} ${e && (e.message || e)}`; };

    function renderList(note) {
        const rows = currentList.map((it, i) => `
            <div class="pl-row" data-idx="${i}">
                <div class="pl-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
                <div class="pl-size">${sizeFormat(it.size)}</div>
                <button class="pl-btn" data-act="cmd">复制命令</button>
                <button class="pl-btn pl-primary" data-act="rpc">RPC</button>
            </div>`).join('');

        const mask = openModal(`
            <div class="pl-head"><b>${platform.name} · 直链下载 <span style="color:#999;font-weight:400;font-size:12px">v${GM_info.script.version}</span></b><span class="pl-cfg" id="pl-cfg" title="设置">⚙️</span><span class="pl-close" title="v${GM_info.script.version}">×</span></div>
            <div class="pl-body">
                <div class="pl-note">${escapeHtml(note || '')}</div>
                ${rows}
            </div>`);

        const doAct = (act, item) => {
            if (act === 'cmd') copyText(buildAria2Cmd(item), 'aria2c 命令已复制');
            if (act === 'rpc') {
                sendToRPC(item)
                    .then(() => toast(`已推送：${item.name}`))
                    .catch((e) => { noteError(e); toast(`RPC 推送失败：${e.message || e}`, true); });
            }
        };

        mask.querySelectorAll('.pl-row').forEach((row) => {
            row.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-act]');
                if (!btn) return;
                doAct(btn.dataset.act, currentList[+row.dataset.idx]);
            });
        });

        // 设置入口：弹窗右上角齿轮（与 Tampermonkey 菜单双入口）
        mask.querySelector('#pl-cfg').addEventListener('click', showSettings);
    }

    async function openHelper() {
        if (!platform) return;
        if (platform.detectPage() !== 'home') {
            toast('请到「我的网盘」页面使用；分享文件请先保存到网盘', true);
            return;
        }
        let selected = [];
        try {
            selected = platform.getSelectedList() || [];
        } catch (e) {
            selected = [];
        }
        if (!selected.length) {
            toast('请先勾选要下载的文件', true);
            return;
        }
        const onlyFolder = selected.every((v) => {
            const m = platform.mapItem(v);
            return m._isFolder;
        });
        if (onlyFolder) {
            toast('请打开文件夹后勾选文件', true);
            return;
        }

        toast('正在获取直链…');
        try {
            currentList = (await platform.fetchLinks(selected)).filter((it) => it.link && !it._isFolder);
            if (!currentList.length) {
                toast('没有获取到可下载的文件直链', true);
                return;
            }
            renderList(platform.note());
        } catch (e) {
            toast(e.message || '获取直链失败', true);
            noteError(e);
        }
    }

    // 统一挂载位置：内容区左上「原生操作按钮排」末尾（或搜索框右侧），找不到退回右下悬浮
    // 找文本锚点按钮：取内容区（left≥200，排除左侧栏同名项）里最靠上的文本精确匹配
    function findAnchorButton(texts) {
        for (const text of texts) {
            let best = null;
            const nodes = document.querySelectorAll('button, a, span, div');
            for (const node of nodes) {
                if ((node.textContent || '').trim() !== text) continue;
                if (node.children.length > 2) continue;
                const rect = node.getBoundingClientRect();
                if (rect.width === 0 || rect.left < 200 || rect.top < 30) continue; // 隐藏 / 侧边栏 / 页面顶栏
                if (!best || rect.top < best.rect.top) best = { node, rect };
            }
            if (best) {
                // 收敛到可点击的按钮外壳（可能是包了一层的 div）
                return best.node.closest('button, a, li, [class*="btn"], [class*="button"]') || best.node;
            }
        }
        return null;
    }

    // 找内容区顶部的搜索框（阿里用；新版 UI 搜索框较靠左，placeholder 匹配已足够特异，
    // 不再用 left>=200 强过滤——那会误杀 alipan 实际的搜索框，只保留「位于页面上部」约束）
    function findSearchInput() {
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
        for (const input of inputs) {
            const ph = (input.getAttribute('placeholder') || '');
            const r = input.getBoundingClientRect();
            if (r.width === 0 || r.left < 100 || r.top < 10 || r.top > 200) continue;
            if (/搜索|search/i.test(ph)) return input;
        }
        return null;
    }

    // 找自绘搜索框容器（新版阿里：div 里放"搜索云盘内文件"文字，无标准 input）
    function findSearchBox() {
        const cands = [];
        document.querySelectorAll('div, span, a').forEach((el) => {
            const t = (el.textContent || '').trim();
            if (t.length < 2 || t.length > 20 || !/^搜索|search/i.test(t)) return;
            if (el.children.length > 2) return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.left < 100 || r.top < 10 || r.top > 260) return;
            cands.push(el);
        });
        // document order 中外层在前，同坐标时第一个就是最外容器（如 top-left--*）
        return cands[0] || null;
    }

    function createButton(inline) {
        const btn = document.createElement('button');
        btn.id = 'pl-fab';
        btn.className = inline ? 'pl-inline' : 'pl-float';
        btn.textContent = '⬇ 直链下载';
        // 版本可视化：悬停即见当前运行版本，一眼识别旧版残留
        btn.title = `panlink-lite v${GM_info.script.version}`;
        btn.addEventListener('click', openHelper);
        return btn;
    }

    function mountButton() {
        injectStyles();
        if (document.getElementById('pl-fab')) return true;
        try {
            // 1) 锚点按钮右侧（百度「打开电脑端」/ 夸克「添加备份」/ 迅雷「传输列表」）
            const anchor = findAnchorButton(platform.mountAfter || []);
            if (anchor && anchor.parentElement) {
                anchor.parentElement.insertBefore(createButton(true), anchor.nextSibling);
                console.log('[panlink-lite] 按钮已挂到操作排：', (anchor.textContent || '').trim(), '右侧');
                return true;
            }
            // 2) 搜索框右侧（阿里：无常驻按钮排；标准 input 与自绘 div 搜索框都兼容）
            if (platform.mountAfterSearch) {
                const anchor = findSearchInput() || findSearchBox();
                if (anchor && anchor.parentElement) {
                    anchor.parentElement.insertAdjacentElement('afterend', createButton(true));
                    console.log('[panlink-lite] 按钮已挂到搜索框右侧');
                    return true;
                }
            }
            // 3) 兜底：右下角悬浮按钮
            if (document.body) {
                document.body.appendChild(createButton(false));
                console.log('[panlink-lite] 未找到左上挂载点，已改用右下角悬浮按钮');
                return true;
            }
        } catch (e) {
            console.warn('[panlink-lite] 注入失败：', e);
            noteError(e);
        }
        return false;
    }

    function boot() {
        // 百度 OAuth 回调页：捕获 access_token 后自动关闭
        if (/openapi\.baidu\.com/.test(location.host)) {
            const m = location.href.match(/access_token=([^&]+)/);
            if (m) {
                GM_setValue('baidu_access_token', m[1]);
                toast('已保存百度 access_token');
                setTimeout(() => window.close(), 600);
            }
            return;
        }

        platform = (PLATFORMS.find((p) => p.test()) || {}).impl || null;
        console.log(`[panlink-lite] v${GM_info.script.version} 已加载，当前站点：`, location.host, '识别平台：', platform ? platform.name : '未匹配');
        if (!platform) return;
        GM_registerMenuCommand('⚙️ 设置', showSettings);
        GM_registerMenuCommand('📋 复制诊断信息', () => {
            copyText(collectDiagnostics(), '诊断信息已复制，反馈问题时请一并粘贴');
        });
        // 网盘多为 SPA：body 可能晚到，且页面切换会冲掉注入的节点，定期补挂
        // （按钮已存在时 mountButton 直接返回，轮询开销可忽略）
        setInterval(mountButton, 1500);
    }

    boot();
})();
