# EasyProxy

<p align="center">
  <a href="README.md">简体中文</a> | <a href="README_EN.md">English</a>
</p>

## 1. 项目简介

EasyProxy 是一个基于 [Mihomo](https://github.com/MetaCubeX/mihomo) 的可视化代理管理面板，使用 Go 后端和 React 前端，面向 Linux 服务器、NAS 与软路由场景。项目采用单容器部署，节点、规则和运行配置均可在网页中管理。

主要功能：

- 聚合 Clash 订阅和常见分享链接，支持节点去重、地区识别、定时更新、筛选与并发测速。
- 通过“识别规则 + 节点组合 + 出站映射”配置分流链路，支持 GeoIP、GeoSite、远程 YAML 规则集和常见 Mihomo 规则类型。
- 提供手动选择、自动测速、故障回退和负载均衡等节点组合方式。
- 管理 Mihomo 内核，支持自动下载、手动上传、配置预览和自动应用。
- 支持 TUN 透明代理、局域网网关、内置 DNS 与 Fake-IP 防污染解析。
- 提供实时连接、流量、日志审计、配置导出、Clash Verge 订阅和面板在线更新。

官方 Docker 镜像支持 `linux/amd64` 和 `linux/arm64`。所有数据默认保存在 Compose 文件所在目录的 `./data` 中，升级或重建容器不会丢失配置。

## 2. 部署方式（Docker）

### 环境要求

- Linux 主机，并已安装 Docker Engine 与 Docker Compose 插件。
- 普通代理模式需要开放 TCP `8080` 和 `7890` 端口。
- 透明代理模式需要宿主机提供 `/dev/net/tun`，并允许容器使用 `NET_ADMIN`。

下载的 `docker-compose.yml` 默认启用 GHCR 官方镜像源和普通代理模式，可直接启动。中国大陆用户只需切换镜像源；需要透明代理时再切换运行模式。

### 不使用透明代理（普通代理模式）

适合只在浏览器、电脑或其他设备中手动填写 HTTP/SOCKS5 代理的用户。

1. 下载 Compose 文件：

```bash
mkdir -p easyproxy && cd easyproxy
curl -fL https://github.com/ZoroHasaky/EasyProxy/releases/latest/download/docker-compose.yml -o docker-compose.yml
```

2. 默认配置已经启用 GHCR 官方镜像和普通代理端口，无需修改：

```yaml
# GitHub 官方源，默认启用
image: ghcr.io/zorohasaky/easyproxy:latest

# 南京大学镜像源，默认注释
# image: ghcr.nju.edu.cn/zorohasaky/easyproxy:latest

ports:
  - "8080:8080"
  - "7890:7890"
```

中国大陆用户应在启动前注释 `ghcr.io` 镜像行，再解除南京大学镜像行的注释：

```yaml
# image: ghcr.io/zorohasaky/easyproxy:latest
image: ghcr.nju.edu.cn/zorohasaky/easyproxy:latest
```

两个 `image` 只能启用一个；普通代理模式保持 TUN 配置为注释状态。

3. 启动并查看初始密码：

```bash
docker compose up -d
docker logs easyproxy
```

启动后使用：

- 管理面板：`http://<服务器 IP>:8080`
- HTTP/SOCKS5 混合代理：`<服务器 IP>:7890`
- 初始密码：在 `docker logs easyproxy` 中查看，首次登录后需要修改密码。
- 持久化数据：保存在当前目录的 `./data`。

### 使用透明代理（TUN / 软路由模式）

适合将 EasyProxy 宿主机作为局域网默认网关和 DNS，让其他设备无需单独设置代理。

1. 确认宿主机存在 `/dev/net/tun`，并开启 IPv4 转发：

```bash
sudo sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-easyproxy.conf
sudo sysctl --system
```

2. 下载 Compose 文件：

```bash
mkdir -p easyproxy && cd easyproxy
curl -fL https://github.com/ZoroHasaky/EasyProxy/releases/latest/download/docker-compose.yml -o docker-compose.yml
```

3. 默认使用 GHCR 官方镜像。中国大陆用户应注释官方镜像行，并解除南京大学镜像行的注释；两个 `image` 只能启用一个。

4. 注释普通代理模式的整个 `ports` 段，再解除“TUN 透明代理模式”配置的注释。修改后关键部分应为：

```yaml
# ports:
#   - "8080:8080"
#   - "7890:7890"

network_mode: host
cap_add:
  - NET_ADMIN
devices:
  - /dev/net/tun:/dev/net/tun
```

`network_mode: host` 与 `ports` 不能同时使用。host 网络模式下不能在 Compose 中设置 `net.ipv4.ip_forward`，必须在宿主机设置。

5. 启动并查看初始密码：

```bash
docker compose up -d
docker logs easyproxy
```

6. 打开 `http://<服务器 IP>:8080`，进入“透明代理”，开启“TUN 透明代理”；环境预检不通过时，页面会阻止启用并显示原因。
7. 根据需要开启内置 DNS，并在顶部待应用提示中应用配置。
8. 将局域网设备的默认网关和 DNS 都设置为 EasyProxy 宿主机的局域网 IP。

如果 TUN 已开启但局域网设备仍无法转发，请根据页面黄色警告检查宿主机防火墙、Docker `FORWARD` 策略以及 `DOCKER-USER` 放行规则。

### 升级

Compose 使用 `latest` 镜像，保留当前镜像源和运行模式选择后执行：

```bash
docker compose pull
docker compose up -d
```

如果重新下载 `docker-compose.yml`，配置会恢复为 GHCR 官方镜像和普通代理模式。使用南京大学镜像或 TUN 模式的用户需要再次调整相应注释。

## 3. 使用步骤

### 首次登录与内核安装

1. 使用 `docker logs easyproxy` 查看初始密码并登录。
2. 按页面要求修改管理密码。
3. 等待 Mihomo 内核自动下载安装，侧栏的“内核状态”显示正常运行后即可继续。

容器首次启动且 `/data/core` 中没有内核时，EasyProxy 会在后台自动执行以下流程：

1. 识别运行架构；AMD64 环境还会检测 CPU 指令集，自动选择标准版或 `amd64-compatible` 兼容版。
2. 获取最新 Mihomo 版本；若已配置自定义镜像则优先使用，随后依次尝试内置加速源和 GitHub 官方源。
3. 下载本机适用的内核，执行版本与可运行性校验。
4. 校验通过后写入持久化目录，生成配置并自动启动内核。

如果自动下载失败：

1. 进入“内核管理 → 下载或手动上传内核”。
2. 点击“下载本机适用的官方内核”。该链接会根据当前架构和 AMD64 指令集选择正确文件。
3. 下载 Mihomo 官方 `.gz` 文件后，无需解压，直接点击“选择文件上传”。如果已经解压，也可以上传裸的 Mihomo 二进制文件。
4. EasyProxy 会校验上传文件，安装成功后自动启动内核。失败原因可在“实时日志”的内核日志中查看。

### 懒人使用方式：一键生成通用配置

希望快速体验时，不需要先手工编写完整规则：

1. 进入“节点池 → 订阅管理”添加订阅，或者在“节点池”中导入单节点分享链接。
2. 确认至少有一个可用且已启用的节点。
3. 进入“规则集 → 识别规则”，点击“一键生成”。
4. 选择“一键生成通用配置”。
5. 等待 Geo 数据刷新、规则和出站映射生成并自动应用。

一键生成要求 Geo 数据已启用、Geo 设置已经应用且内核正在运行；它不会自动启动内核，也不会覆盖已有规则和映射。系统会根据本机 Geo 数据中实际存在的分类生成规则：私有地址、私有域名和中国大陆 IP/域名走 `DIRECT`，其他可用的常用分类走主代理出口 `PROXY`。

主代理出口默认包含“自动测速”、用户创建的节点组合和所有已启用节点。生成完成后，可在仪表盘中选择主代理出口当前使用的节点或组合。

### 个性化链路：识别规则 + 节点组合 + 出站映射

EasyProxy 将“识别哪些流量”和“这些流量从哪里出去”拆开管理：

```text
流量 → 识别规则 → 出站映射 → 节点组合 → 实际节点
```

- **识别规则**：决定匹配什么。可按域名、域名后缀、IP/CIDR、GeoIP、GeoSite、远程 YAML 规则集或 `MATCH` 兜底规则识别流量；优先级数字越大越先匹配。
- **节点组合**：决定如何选择节点，相当于出站链路组合。支持手动选择、自动测速、故障回退和负载均衡，节点范围可选全部节点、指定地区、手动勾选或名称正则匹配。
- **出站映射**：将识别规则绑定到节点组合、单个节点或内置目标 `DIRECT`、`PROXY`、`REJECT`。没有出站映射的识别规则不会写入最终路由。

例如，让 GitHub 流量使用自动测速链路：

1. 在“识别规则”中新建 `GitHub`，选择 `DOMAIN-SUFFIX`，条件填写 `github.com`。
2. 在“节点组合”中新建 `海外自动测速`，类型选择“自动测速”，再选择需要参与测速的节点范围。
3. 在“出站映射”中将 `GitHub` 绑定到 `海外自动测速`。
4. 使用“出站测试”验证域名命中的规则和模拟链路，再应用配置。

也可以使用“根据 Geo 生成识别规则”选择本地 Geo 数据中的具体分类。该方式只创建识别规则，不会自动创建出站映射，适合继续手工搭配链路。

### 其他功能

- **订阅与节点池**：支持 Clash YAML、Base64 和常见节点链接，提供自动更新、代理回退下载、凭证去重、地区识别、节点编辑和并发测速。
- **Geo 数据**：管理 GeoIP、GeoSite 数据源、更新周期和本地数据状态，也可手动刷新或恢复推荐源。
- **透明代理与 DNS**：支持 TUN 软路由、Fake-IP/Redir-Host、局域网 DNS 接管和启动环境预检。
- **仪表盘与连接监控**：切换规则、全局和直连模式，选择主代理出口，查看实时流量、连接明细并断开连接。
- **日志审计**：按类别和级别查看订阅、规则、内核、更新等操作结果，支持查看详情和导出。
- **配置导出与分享**：导出 Clash 配置，或生成可供 Clash Verge 添加的配置订阅链接。
- **在线更新**：在“系统设置”中检查新版本并执行面板更新。

---

许可证：MIT
