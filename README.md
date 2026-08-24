# EasyProxy

节点聚合 · 可视化规则编辑 · mihomo 代理面板。Go 后端 + React (shadcn/ui) 前端，单容器 Docker 部署，面向 Linux 服务器 / 软路由。

## 功能

- **节点聚合**：订阅导入（Clash YAML / Base64 / 明文链接自动识别）+ 分享链接导入（ss/vmess/vless/trojan/hysteria2/tuic），按凭证哈希去重，按旗帜/关键词自动识别地区，支持定时更新、经代理抓取、整组测速
- **可视化规则**：导入规则模板（ACL4SSR 等，URL/粘贴），分组映射向导自动猜测；规则表格支持拖拽排序/启停/改目标；策略组按地区一键生成分组，组内 url-test 速度优先；实时预览最终 YAML 并一键热重载
- **代理与透明代理**：内置管理 mihomo 内核（首次启动自动下载，失败可在网页上传），修改走 `PUT /configs` 热重载；软路由场景开 TUN（auto-route + auto-redirect）
- **实时连接监控**：连接表（虚拟滚动、速度排序、搜索、单条/全部关闭）、流量图表、实时日志
- **安全**：首启生成随机密码打印到 docker logs，首次登录强制改密；全 API session 鉴权
- **版本与自更新**：VERSION 文件为唯一真源，push 后 GitHub Actions 仅在 VERSION 变化时发版（双架构二进制 + ghcr 镜像）；面板内检测更新 → 下载 → 自动重启切换

## 部署

从 [Releases](https://github.com/ZoroHasaky/EasyProxy/releases) 下载 `docker-compose.yml`，放入任意空目录执行：

```bash
docker compose up -d
# 面板: http://<host>:8080   初始密码: docker logs easyproxy
# 代理: http/socks5 <host>:7890
```

数据持久化在 compose 同目录的 `./data` 下；升级时下载新版 `docker-compose.yml`（镜像 tag 已随版本更新）后再次执行 `docker compose up -d` 即可。

### 透明代理（TUN / 软路由）模式

`docker-compose.yml` 内已内置 TUN 所需配置（注释状态）。启用步骤：

1. 编辑 compose 文件，取消 `network_mode: host`、`cap_add: NET_ADMIN`、`devices: /dev/net/tun` 各行的注释
2. 注释掉 `ports:` 段（host 网络与端口映射互斥，端口直接监听在宿主机上；host 模式下 compose 不能设置 sysctl，如需转发请确认宿主机 `net.ipv4.ip_forward=1` 已开启，多数发行版/PVE 默认开启）
3. `docker compose up -d` 重建容器，到面板 **透明代理** 页打开 TUN 开关（会自动预检 /dev/net/tun 与 NET_ADMIN 权限），再到 **内核** 页应用配置
4. LAN 设备把网关/DNS 指向本机即可免配置走代理

## 首次使用流程

1. `docker logs easyproxy` 获取初始密码，登录并按提示修改
2. **订阅** 页添加订阅 URL（或在 **节点池** 粘贴分享链接导入）
3. **规则** 页导入规则模板（如 [ACL4SSR 模板](https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini) 对应的 YAML 模板），在「分组映射」确认映射
4. **策略组** 页点击「生成地区分组」（各地区自动生成 url-test 速度优先分组）
5. **内核** 页点击「应用配置」，代理生效；软路由场景在 **透明代理** 页开启 TUN

## 项目结构

```
├─ VERSION                  # 版本唯一真源（变化触发 Release）
├─ .github/workflows/       # CI + Release（双架构 + ghcr）
├─ backend/                 # Go 后端
│  ├─ cmd/server/           # 入口
│  └─ internal/
│     ├─ api/               # HTTP 路由/鉴权/WS 中继/静态托管
│     ├─ core/              # mihomo 下载/上传/进程管理/API 客户端
│     ├─ parser/            # 订阅格式/分享链接/地区识别
│     ├─ service/           # 配置生成/节点池/模板规则
│     ├─ store/             # SQLite (modernc 纯 Go)
│     ├─ update/            # 面板自更新（GitHub Releases + exec）
│     └─ web/               # 内嵌前端资源
├─ fronted/                 # React + Vite + Tailwind + shadcn/ui
└─ deploy/                  # Dockerfile / entrypoint / compose ×2
```

## 数据与持久化（/data 卷）

`state.db`（SQLite 全部数据）、`config.yaml`（生成的 mihomo 配置）、`core/`（内核二进制）、`bin/`（面板自更新版本）。

## 说明

- 内核不在镜像内：首次启动自动下载（依次尝试直连 GitHub 与多个内置加速镜像，也可在内核页指定优先镜像），失败可在 内核 页手动上传
- 自更新默认检测官方仓库 Release，也可在「关于」页改为自己的 fork（需包含对应架构的 `easyproxy-linux-<arch>.tar.gz`）
- TUN 模式在 compose 文件内取消注释即可启用（见上文「透明代理模式」），面板开启 TUN 前会自动预检环境权限

## License

MIT
