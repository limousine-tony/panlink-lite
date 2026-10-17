# 网盘直链下载助手 · 自用精简版（panlink-lite）

油猴脚本：在网页里勾选文件，一键拿到**直链下载地址**，推送给 Motrix/aria2 下载，或复制直链 / aria2c 命令配合 XDown 等工具使用。

支持 **百度网盘 / 阿里云盘（alipan）/ 夸克网盘 / 迅雷网盘** 四家，仅在「我的网盘」页面可用。

基于 [YouXiaoHou/panlinker](https://github.com/syhyz1990/baiduyun)（AGPL-3.0）精简重写，去掉了远程配置、激活码、广告，并修复了大文件下载占内存的问题。

---

## 特性

- **无服务器依赖**：直链由浏览器直接向网盘官方接口请求，脚本不连任何第三方服务器
- **无远程配置 / 激活码 / 广告**：所有接口硬编码在脚本里，行为不被远端控制
- **大文件友好**：直链交给 Motrix/aria2 下载，支持断点续传与批量队列，不占用浏览器内存
- **两种导出方式**：RPC 推送给 Motrix/aria2，或复制直链 / aria2c 命令（命令已带 UA/Cookie/Referer 头）

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. Tampermonkey 面板 → 新建脚本，把 `panlink-lite.user.js` 全文粘贴进去保存（或将文件拖入浏览器安装）
3. 打开网盘页面，出现「⬇ 直链下载」按钮即成功

## 使用

1. 在网盘「我的网盘」页面勾选文件（可多选）
2. 点「⬇ 直链下载」按钮（统一挂在内容区左上操作按钮排末尾：百度「打开电脑端」旁 / 夸克「添加备份」旁 / 迅雷「传输列表」旁 / 阿里搜索框右侧；找不到时退回右下角悬浮）
3. 弹窗中每个文件 2 个操作：

| 按钮 | 作用 | 配合工具 |
| --- | --- | --- |
| **复制命令** | 复制 aria2c 命令（已带 UA/Cookie/Referer 头，`--out` 自动命名） | 终端 aria2、XDown |
| **RPC** | 推送单任务到 RPC 下载器（推荐） | Motrix、Rayburst、aria2 RPC |

设置入口在弹窗右上角的 ⚙️ 齿轮（Tampermonkey 菜单里也有同名入口）。
小文件直接用网盘网页自带的下载按钮即可，不需要本脚本。
## 下载工具怎么选

| | Motrix / Rayburst | aria2 命令行 / XDown |
| --- | --- | --- |
| 对应按钮 | 推送 RPC | 复制命令 |
| 费用 | 免费 | 免费 |
| 适合 | **大文件挂机、批量队列（推荐）** | 终端党 / Linux / 服务器 |

**推荐**：装 Motrix 或其继任者 Rayburst（原 Motrix Next，4.0 起更名）一个就够（下载大文件的主力）。小文件用网盘自带下载按钮，不需要脚本。
「复制命令」的命令可贴进终端（需 aria2）或 XDown 导入。
**Rayburst 用户注意**：RPC 默认端口是 `29100`（不是旧 Motrix 的 16800），且默认启用 RPC 密钥——在脚本「⚙️ 设置」里端口填 29100，密钥去 Rayburst 设置的 RPC 项里复制粘贴。

## 百度网盘配置（仅百度需要，一次即可）

百度取直链走 OAuth，需在 [百度开放平台](https://console.bce.baidu.com/) 有应用：

1. 创建应用（或用已有应用），**安全设置 → 授权回调页** 填 `oob`
2. 把应用的 **AppKey** 填进脚本头部的 `BAIDU_CLIENT_ID`（[panlink-lite.user.js:51](panlink-lite.user.js#L51) 附近，已预填本目录的自用应用）
3. 首次使用会弹一次授权页，同意后 token 自动保存
4. `private/baidu-oauth-credentials.txt` 里的 **SecretKey / SignKey 是服务端密钥，不要放进脚本、不要外传**（隐式授权用不到它们）

百度直链满速需要超级会员；非会员官方限速。夸克非会员也有限速；阿里免费用户有每日流量配额。

## 目录结构

```text
panlink-lite.user.js          ← 主脚本，安装这个
STATUS.md                     ← 项目现状总结（版本、未决问题、待办）
reference/                    ← 原版脚本与分析材料，仅供查阅，勿安装
  panlinker-6.2.3-original.user.js     原版（仍有远程配置/激活码）
  wangpan-downloader-6.2.7-fork.user.js 网传 fork 版（另有 VPN 广告）
  config-decoded.json                   原作者远程配置的解码内容（审计存档）
  README-original.md                    原版项目 README
private/                      ← 敏感文件，勿上传、勿提交 git
  baidu-oauth-credentials.txt           百度开放平台应用凭证
```

## 脚本对外通信（审计结论）

| 目标 | 用途 |
| --- | --- |
| `pan.baidu.com` / `openapi.baidu.com` | 百度取直链 / OAuth |
| `api.aliyundrive.com` | 阿里取直链 |
| `drive.quark.cn` | 夸克取直链 |
| `api-pan.xunlei.com` | 迅雷取直链 |
| `localhost:16800`（可配置） | 你自己的 RPC 下载器 |

无统计、无上报、无远程配置。

## 已知限制 / 故障排查

- **仅支持「我的网盘」页面**。分享页请先把文件保存到自己网盘再下载
- **按钮点了提示"请先勾选"** → 网盘改版导致选择器失效，检查是否在列表视图（阿里需列表视图），或反馈平台+页面
- **百度提示获取 token 失败** → 检查开放平台回调页是否为 `oob`，或重新登录网盘后再试
- **百度下载报 403 Forbidden** → 百度直链校验 UA，NDM/IDM 直接接管直链会被拒。用「复制命令」（已带 UA/Cookie）或「推送 RPC」；小文件用网盘自带下载
- **百度能不能用 NDM 直链下载** → 不能。百度要求请求带 `User-Agent: pan.baidu.com` + BDUSS cookie，NDM 无法自定义请求头，直连必 403。百度请走「推送 RPC」或「复制命令」
- **阿里提示"请先勾选"** → v1.5.0 起图标视图/列表视图都支持；若仍失效，切到列表视图重试
- **迅雷下载的文件名/后缀不对** → 迅雷直链 URL 不含文件名，但脚本的「复制命令」/「RPC」已用 `--out` 自动命名，用这两种方式下载即正常
- **夸克报 code=undefined** → 夸克接口校验客户端 UA，v1.5.0 起已伪装为 quark-cloud-drive 客户端；若仍报错，把错误信息发我
- **夸克/迅雷直链失效快** → 直链有有效期，取到后尽快开始下载
- **反馈问题** → Tampermonkey 菜单 →「📋 复制诊断信息」，把粘贴的内容连同报错截图一起发给我；先悬停「⬇ 直链下载」按钮确认运行的是最新版本（tooltip 有版本号）
- **RPC 提示"连不上 RPC 服务"** → 下载器没开或没装（Motrix / Rayburst / aria2 需保持运行）
- **RPC 提示 Unauthorized / 下载器拒绝任务** → 端口或密钥不对。Rayburst 默认端口 29100、默认启用密钥（Rayburst 设置的 RPC 项里复制）；老 Motrix/aria2 默认 16800、通常无密钥
