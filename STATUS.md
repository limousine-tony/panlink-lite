# 项目现状总结

> 更新时间:2026-10-17 · 脚本版本:v1.8.1

## 一、项目是什么

自用的网盘直链油猴脚本,支持 **百度网盘、阿里云盘、夸克网盘、迅雷网盘** 四家。

基于审计过的原作者 panlinker(YouXiaoHou,AGPL-3.0)精简重写,已移除:远程配置、激活码、广告推广、RPC 密钥泄露点。**运行不需要任何服务器**——直链由浏览器直接向网盘官方接口获取,脚本对外只连接四家官方 API 和可选的本地 RPC。

## 二、当前文件结构

```
netdiskurl/
├── README.md                          使用说明(安装/使用/工具选型/OAuth/排障)
├── STATUS.md                          本文件:项目现状总结
├── panlink-lite.user.js               主脚本 v1.8.1(1106 行,语法检查通过)
├── private/                           敏感文件,勿上传、勿提交 git
│   └── baidu-oauth-credentials.txt    百度开放平台凭证(AppID/AppKey/SecretKey/SignKey)
└── reference/                         原版与审计材料,仅供查阅,勿安装
    ├── panlinker-6.2.3-original.user.js       原版(含远程配置/激活码)
    ├── wangpan-downloader-6.2.7-fork.user.js  网传 fork 版(另有 VPN 广告)
    ├── config-decoded.json                    原作者远程配置的解码存档
    └── README-original.md                     原版项目 README
```

## 三、当前功能(v1.8.1)

1. 在网盘「我的网盘」页面勾选文件 → 点「⬇ 直链下载」按钮
2. 弹窗列出每个文件的直链,每行 2 个操作:
   - **复制命令**(aria2c,已自动附带 UA / Cookie / Referer 头,`--out` 自动命名)
   - **RPC 推送**(Motrix / Rayburst / aria2,自动带 `out` 文件名)
3. **设置入口**:弹窗右上角 ⚙️ 齿轮 + Tampermonkey 菜单「⚙️ 设置」双入口
4. **版本可视化**:按钮 tooltip 与弹窗标题均显示版本号,一眼识别旧版残留
5. **诊断模式**:Tampermonkey 菜单「📋 复制诊断信息」,一键收集平台识别/挂载位置/勾选识别/RPC 配置(脱敏)/最近错误

> v1.8.0 起弹窗只保留 aria2 命令与 RPC 两个导出方式(移除「复制直链」「复制文件名」——迅雷的文件名问题已由 `--out` 自动命名覆盖),同时清理了无引用的 `toastNoSelection`。
> v1.8.1 移除弹窗底部批量操作区(与每行操作重复),设置移至弹窗右上角齿轮,清理随之无用的 `sleep`。

### 按钮挂载位置(统一在内容区左上操作排)

| 平台 | 挂载位置 |
| --- | --- |
| 百度 | 「打开电脑端」右侧(已排除侧栏同名项干扰) |
| 夸克 | 「添加备份」右侧 |
| 迅雷 | 「传输列表」右侧 |
| 阿里 | 搜索框右侧(兼容图标视图/列表视图) |
| 兜底 | 未找到挂载点时退回右下角悬浮按钮 |

### 百度 OAuth

- 已接入自己的应用 AppKey:`cFjj1cCYQwIr7Sk1v6EA0rYDpI9qk6fx`(脚本第 51 行附近)
- 开放平台「授权回调页」必须设置为 `oob`
- SecretKey / SignKey 不需要、也**不要**写进脚本
- 首次使用会弹一次授权,同意后 token 自动保存

## 四、版本迭代记录

| 版本 | 变更 |
| --- | --- |
| 1.0 | 初版:四平台、复制直链/命令/RPC,移除远程配置/激活/广告 |
| 1.1 | 控制台版本日志;下载失败自动兜底复制命令 |
| 1.2 | 按需求删除「下载」按钮(小文件走网盘自带下载) |
| 1.3 | 按钮统一挂到内容区左上操作排(锚点文本定位) |
| 1.4 | 修复百度侧栏同名锚点污染(left≥200 过滤 + 取最靠上);阿里改挂搜索框右侧;按钮加 nowrap 防折行 |
| 1.5.0 | 夸克伪装 `quark-cloud-drive` 客户端 UA(修复 code=undefined);夸克报错带接口 message;阿里支持图标视图勾选识别;新增「复制文件名」按钮 |
| 1.6.0 | 版本可视化(按钮 tooltip + 弹窗标题);新增「📋 复制诊断信息」菜单;RPC 批量推送显示 i/n 进度、失败行标红;迅雷复制直链时提示配合「复制文件名」;metadata 内预留 @updateURL/@downloadURL 模板(注释状态,待发布 Gist 后启用) |
| 1.6.1 | RPC 推送失败改为显示具体原因(连不上服务 / 下载器拒绝任务+原因);「保存目录」默认留空改用下载器默认目录(旧默认 `D:` 易因目录不合法被 aria2 拒绝);设置弹窗说明同步更新 |
| 1.6.2 | 适配 Rayburst(原 Motrix Next 更名继任者,引擎 Aria2 Next,JSON-RPC 兼容):设置弹窗与 README 标注其默认端口 29100、默认启用 RPC 密钥;排障新增「连不上 RPC / Unauthorized」条目 |
| 1.7.0 | 修复新版 alipan 按钮掉右下兜底:findSearchInput 取消 left>=200 强过滤(该条件误杀靠左的搜索框),改为 placeholder 匹配 + 页面上部约束;阿里勾选识别新增 React 纤维深扫兜底 deepScanReactSelection(容器 class 改版后仍能取勾选) |
| 1.7.1 | 诊断信息新增「挂载点分析」(锚点命中/搜索框 input 命中/伪搜索框候选),用于定位新版阿里按钮仍掉兜底的原因;疑似新版搜索框为自绘 div 而非 input,待诊断输出确认后做伪搜索框挂载 |
| 1.7.2 | 实锤新版阿里无标准 input 搜索框(诊断证实):新增 findSearchBox 自绘 div 搜索框定位(文本以「搜索」开头、页面顶部、最外容器优先),mountButton 兼容 input 与 div 两种搜索框;诊断输出新增「搜索框(div)」命中行 |
| 1.7.3 | 新版阿里勾选仍识别 0 项:诊断新增「勾选深扫分析」(容器选择器命中数/fiber 元素数/选中态 DOM 候选/选中卡片 fiber props 键名),待回传后精准重写阿里 getSelectedList;按钮挂载已验证成功(截图确认 inline) |
| 1.7.4 | 依据深扫回传重写阿里勾选识别,三路依次:①旧 props ②listModel 对象(aliViaListModel:从 grid/table 容器 fiber 上 20 层内找 props.listModel,防御性提取 selectedKeys/checkedKeys/getSelected 等方法) ③勾选态 checkbox DOM 反查(aliViaCheckedBox:[aria-checked/data-checked=true] 向上找卡片 fiber 里的文件对象);mapItem/fetchLinks 增加 fileName/fileSize/driveID/id 兜底字段 |
| 1.7.5 | 新版阿里勾选识别已生效(诊断确认 1 项);修复下载 403:新版列表对象的 url/downloadUrl 非下载地址(预览/缩略图),aliViaListModel/aliViaCheckedBox 返回值打 `_fromNewUi` 标,fetchLinks 对新路径对象一律走官方 get_download_url API;token 获取加固(localStorage 扫描含 access_token 的键);文件夹过滤改用 mapItem._isFolder;控制台输出直链来源 |
| 1.7.6 | 修复阿里下载仍 403 的根因:下载签名绑定的 Referer 2026-10 起由 `www.aliyundrive.com` 改为 `www.alipan.com`(实测旧值 SignatureDoesNotMatch、新值 200 直取文件),`API.ali.referer` 常量更新;命令/RPC 导出的头随之更正 |
| 1.8.0 | 弹窗精简:每行只保留「复制命令」(aria2c)/「RPC」两个操作,移除「复制直链」「复制文件名」(迅雷文件名已由 `--out` 自动命名覆盖);同步删除 doAct 死分支与无引用的 `toastNoSelection`;README/STATUS 操作说明更新 |
| 1.8.1 | 移除弹窗底部批量操作区(复制全部命令/全部推送 RPC,与每行操作重复);设置移至弹窗右上角 ⚙️ 齿轮(与 Tampermonkey 菜单双入口);清理无用的 `sleep` |

## 五、当前未决问题(重要)

**浏览器里实际运行的仍是旧版脚本,不是 v1.5.0。** 截图证据:

| 现象 | 说明 |
| --- | --- |
| 百度按钮折成两行、挂在侧栏底部 | `nowrap` 与侧栏过滤是 v1.4.0 才加的,说明运行版本 ≤ v1.3 |
| 夸克仍报 `夸克获取链接失败 (code=undefined)` | v1.5.0 的 quark UA 修复未生效 |
| 迅雷弹窗看不到「复制文件名」按钮 | 该按钮 v1.5.0 才新增 |

**处理步骤**:

1. 油猴管理面板 → 搜索「直链」→ **删除所有同名脚本条目**(可能出现两条并存)
2. 重新拖入 `panlink-lite.user.js` 安装
3. 网盘页面 `Ctrl+Shift+R` 强制刷新
4. 确认版本:鼠标悬停「⬇ 直链下载」按钮看 tooltip,或弹窗标题灰色小字,或 F12 控制台 `[panlink-lite] v1.6.0 已加载`

## 六、已知固有局限(非 bug)

1. **百度 + NDM 直链下载不可行**
   百度直链校验 `User-Agent: pan.baidu.com` + BDUSS cookie,NDM 无法发送,必 403。
   百度大文件请用「推送 RPC」(Motrix)或「复制命令」(XDown/aria2)。
2. **迅雷直链 URL 不含文件名**
   直链形如 `.../download/?fid=xxx`,下载器只能用 URL 当文件名(内容本身正确)。
   解决办法:「复制文件名」手动填,或使用 RPC/命令(自动 `--out` 命名)。
3. **有效期限**:夸克/迅雷直链有较短有效期,取到后尽快开始下载。
4. **速度限制**:百度满速需超级会员;夸克非会员限速;阿里免费用户有每日流量配额。
5. **仅支持「我的网盘」页面**:分享页需先保存到自己网盘再下载。

## 七、待办 / 可选加固

以下为未落地的优化项,视重装后的实际表现决定是否实施:

- [x] 把版本号显示在按钮 tooltip / 弹窗标题,方便一眼确认运行版本(v1.6.0 已完成)
- [x] 阿里搜索框定位加固(v1.7.0 已完成:取消 left>=200 过滤,新版 alipan 搜索框可正常识别)
- [x] 阿里勾选识别增加 React 纤维深扫兜底(v1.7.0 已完成:deepScanReactSelection)
- [x] 迅雷复制直链时 toast 提示需配合「复制文件名」(v1.6.0 已完成)
- [ ] 自动更新:发布到私有 Gist 后,启用脚本头部注释掉的 `@updateURL`/`@downloadURL`(需先建 Gist 拿 raw 地址)

## 八、下一步

1. 按「五」的步骤干净重装并确认版本
2. 四家平台各测一次取链
3. 若仍失败,记录:平台 + 控制台 `[panlink-lite]` 日志 + 错误 toast 原文
