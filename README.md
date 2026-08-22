# EasyProxy

节点聚合 · 可视化规则编辑 · mihomo 代理面板。Go 后端 + React (shadcn/ui) 前端，单容器 Docker 部署，面向 Linux 服务器 / 软路由。

## 功能

- **节点聚合**：订阅导入（Clash YAML / Base64 / 明文链接自动识别）+ 分享链接导入（ss/vmess/vless/trojan/hysteria2/tuic），按凭证哈希去重，按旗帜/关键词自动识别地区，支持定时更新、经代理抓取、整组测速
- **可视化规则**：导入规则模板（ACL4SSR 等，URL/粘贴），分组映射向导自动猜测；规则表格支持拖拽排序/启停/改目标；策略组按地区一键生成分组，组内 url-test 速度优先；实时预览最终 YAML 并一键热重载
- **代理与透明代理**：内置管理 mihomo 内核（首次启动自动下载，失败可在网页上传），修改走 `PUT /configs` 热重载；软路由场景开 TUN（auto-route + auto-redirect）
- **实时连接监控**：连接表（虚拟滚动、速度排序、搜索、单条/全部关闭）、流量图表、实时日志
- **安全**：首启生成随机密码打印到 docker logs，首次登录强制改密；全 API session 鉴权
- **版本与自更新**：VERSION 文件为唯一真源，push 后 GitHub Actions 仅在 VERSION 变化时发版（双架构二进制 + ghcr 镜像）；面板内检测更新 → 下载 → 自动重启切换

## 快速开始

### 普通代理模式（设备手动设置代理）

```bash
git clone https://github.com/yourname/EasyProxy.git && cd EasyProxy
docker compose -f deploy/docker-compose.yml up -d --build
# 面板: http://<host>:8080   初始密码: docker logs easyproxy
# 代理: http/socks5 <host>:7890
```

### 软路由透明代理模式（TUN）

```bash
docker compose -f deploy/docker-compose.router.yml up -d --build
# 启动后在 面板 → 部署 → 透明代理(TUN) 打开开关并「应用配置」
# LAN 设备把网关/DNS 指向本机即可免配置走代理
```

## 首次使用流程

1. `docker logs easyproxy` 获取初始密码，登录并按提示修改
2. **订阅** 页添加订阅 URL（或在 **节点池** 粘贴分享链接导入）
3. **规则** 页导入规则模板（如 [ACL4SSR 模板](https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini) 对应的 YAML 模板），在「分组映射」确认映射
4. **策略组** 页点击「生成地区分组」（各地区自动生成 url-test 速度优先分组）
5. **部署** 页点击「应用配置」，代理生效；软路由场景开启 TUN

## 构建

```bash
# 前端（产物输出到 backend/internal/web/dist）
cd frontend && npm ci && npm run build
# 后端（单二进制，内嵌前端）
cd backend && go build -ldflags "-X main.version=$(cat ../VERSION)" -o easyproxy ./cmd/server
# Docker
docker build -f deploy/Dockerfile -t easyproxy .
```

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
├─ frontend/                # React + Vite + Tailwind + shadcn/ui
└─ deploy/                  # Dockerfile / entrypoint / compose ×2
```

## 数据与持久化（/data 卷）

`state.db`（SQLite 全部数据）、`config.yaml`（生成的 mihomo 配置）、`core/`（内核二进制）、`bin/`（面板自更新版本）。

## 说明

- 内核不在镜像内：首次启动自动从 GitHub 下载（部署设置可配镜像前缀加速），失败可在 部署 → 内核 页面上传
- 自更新需要设置页配置更新源仓库（owner/repo）且 Release 中包含对应架构的 `easyproxy-linux-<arch>.tar.gz`
- TUN 模式必须使用 `docker-compose.router.yml`（host 网络 + NET_ADMIN + /dev/net/tun）

## License

MIT
