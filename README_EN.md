# EasyProxy

<p align="center">
  <a href="README.md">简体中文</a> | <a href="README_EN.md">English</a>
</p>

## 1. Overview

EasyProxy is a visual proxy management panel built on [Mihomo](https://github.com/MetaCubeX/mihomo). It uses a Go backend and a React frontend, and is designed for Linux servers, NAS devices, and soft-router deployments. It runs as a single container and lets you manage nodes, routing rules, and runtime settings in the browser.

Key features:

- Aggregate Clash subscriptions and common share links, with node de-duplication, region detection, scheduled updates, filtering, and concurrent latency tests.
- Build traffic routing with Recognition Rules, Node Groups, and Outbound Mappings. GeoIP, GeoSite, remote YAML rule sets, and common Mihomo rule types are supported.
- Choose nodes manually, by automatic latency testing, failover, or load balancing.
- Manage the Mihomo core with automatic downloads, manual uploads, configuration previews, and automatic configuration application.
- Use TUN transparent proxying, LAN gateway mode, built-in DNS, and Fake-IP DNS pollution resistance.
- Monitor real-time connections and traffic, audit logs, export configurations, create Clash Verge subscriptions, and update the panel online.

The official Docker image supports linux/amd64 and linux/arm64. By default, all data is stored in ./data next to the Compose file, so configuration persists across upgrades and container recreation.

## 2. Deployment (Docker)

### Requirements

- A Linux host with Docker Engine and the Docker Compose plugin installed.
- Normal proxy mode requires TCP ports 8080 and 7890 to be reachable.
- Transparent proxy mode requires /dev/net/tun on the host and the NET_ADMIN capability for the container.

The downloaded docker-compose.yml defaults to the official GHCR image and normal proxy mode, so it can be started as-is. Switch the image source for mainland China, and switch the run mode only when transparent proxying is needed.

### Normal proxy mode (without transparent proxying)

Use this mode when you want to configure an HTTP/SOCKS5 proxy manually in browsers, computers, or other devices.

1. Download the Compose file:

~~~bash
mkdir -p easyproxy && cd easyproxy
curl -fL https://github.com/ZoroHasaky/EasyProxy/releases/latest/download/docker-compose.yml -o docker-compose.yml
~~~

2. The default configuration already enables the official GHCR image and normal proxy ports. No changes are required:

~~~yaml
# Official GitHub Container Registry image, enabled by default
image: ghcr.io/zorohasaky/easyproxy:latest

# Nanjing University mirror, commented out by default
# image: ghcr.nju.edu.cn/zorohasaky/easyproxy:latest

ports:
  - "8080:8080"
  - "7890:7890"
~~~

Users in mainland China should comment out the ghcr.io image line and uncomment the Nanjing University mirror before starting:

~~~yaml
# image: ghcr.io/zorohasaky/easyproxy:latest
image: ghcr.nju.edu.cn/zorohasaky/easyproxy:latest
~~~

Only one image line may be enabled. Keep the TUN configuration commented out in normal proxy mode.

3. Start the container and view the initial password:

~~~bash
docker compose up -d
docker logs easyproxy
~~~

After startup:

- Management panel: http://<server IP>:8080
- HTTP/SOCKS5 mixed proxy: <server IP>:7890
- Initial password: shown in docker logs easyproxy; you must change it after the first sign-in.
- Persistent data: ./data in the current directory.

### Transparent proxy mode (TUN / soft-router mode)

Use this mode when the EasyProxy host will act as the default gateway and DNS server for LAN devices, so they do not need individual proxy settings.

1. Confirm that the host has /dev/net/tun and enable IPv4 forwarding:

~~~bash
sudo sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-easyproxy.conf
sudo sysctl --system
~~~

2. Download the Compose file:

~~~bash
mkdir -p easyproxy && cd easyproxy
curl -fL https://github.com/ZoroHasaky/EasyProxy/releases/latest/download/docker-compose.yml -o docker-compose.yml
~~~

3. GHCR is the default image source. Users in mainland China should comment out the official image line and uncomment the Nanjing University mirror; only one image line may be enabled.

4. Comment out the entire normal-mode ports section, then uncomment the TUN transparent proxy mode section. The relevant part should look like this:

~~~yaml
# ports:
#   - "8080:8080"
#   - "7890:7890"

network_mode: host
cap_add:
  - NET_ADMIN
devices:
  - /dev/net/tun:/dev/net/tun
~~~

network_mode: host cannot be used with ports. In host network mode, net.ipv4.ip_forward cannot be set in Compose; it must be enabled on the host.

5. Start the container and view the initial password:

~~~bash
docker compose up -d
docker logs easyproxy
~~~

6. Open http://<server IP>:8080, then go to **Transparent Proxy** and enable **TUN Transparent Proxy**. The page blocks activation and explains the cause if the environment check fails.
7. Enable built-in DNS if needed, then apply the pending configuration from the notification at the top of the page.
8. Set both the default gateway and DNS server of LAN devices to the EasyProxy host's LAN IP address.

If TUN is enabled but LAN devices still cannot forward traffic, follow the yellow warning on the page to check the host firewall, Docker FORWARD policy, and DOCKER-USER allow rules.

### Upgrade

Compose uses the latest image. After preserving your selected image source and run mode, run:

~~~bash
docker compose pull
docker compose up -d
~~~

If you download docker-compose.yml again, it returns to the official GHCR image and normal proxy mode. Users of the Nanjing University mirror or TUN mode must adjust the relevant comments again.

## 3. Getting Started

### First sign-in and core installation

1. Find the initial password with docker logs easyproxy and sign in.
2. Change the management password when prompted.
3. Wait for the Mihomo core to download and install automatically. Continue once the sidebar shows the core as running.

When the container starts for the first time and /data/core does not contain a core, EasyProxy performs the following steps in the background:

1. Detects the current architecture. On AMD64, it also detects CPU instruction support and chooses either the standard build or the amd64-compatible build.
2. Retrieves the latest Mihomo version. A configured custom mirror is tried first, followed by built-in acceleration mirrors and the official GitHub source.
3. Downloads the appropriate core and validates its version and executability.
4. Saves the validated core in persistent storage, generates the configuration, and starts it automatically.

If automatic download fails:

1. Go to **Kernel -> Download or Upload a Core**.
2. Click **Download the Official Core for This Device**. The link chooses the correct file for the current architecture and AMD64 instruction set.
3. Download the official Mihomo .gz file and click **Select File to Upload** without extracting it. A standalone, already-extracted Mihomo binary can also be uploaded.
4. EasyProxy validates and installs the upload, then starts the core automatically. Check **Logs -> Kernel Logs** for the reason if installation fails.

### Quick start: generate a common configuration

To try EasyProxy quickly, you do not need to write the entire routing configuration by hand:

1. Go to **Nodes -> Subscriptions** to add a subscription, or import an individual share link from **Nodes**.
2. Confirm that at least one node is enabled and available.
3. Go to **Rules -> Recognition Rules** and click **One-click Generate**.
4. Select **Generate Common Configuration**.
5. Wait for Geo data refresh, rule generation, outbound mapping generation, and automatic configuration application to complete.

Quick generation requires Geo data to be enabled, Geo settings to have been applied, and the core to be running. It does not start the core and does not overwrite existing rules or mappings. Based on the Geo categories actually available on the device, private addresses/domains and mainland China IPs/domains are sent to DIRECT; other supported common categories use the main proxy outlet, PROXY.

The main proxy outlet includes **Auto Test**, user-created node groups, and all enabled nodes by default. After generation, choose the node or group currently used by the main proxy outlet from the dashboard.

### Custom routing: Recognition Rules + Node Groups + Outbound Mappings

EasyProxy manages traffic identification separately from its outbound path:

~~~text
Traffic -> Recognition Rule -> Outbound Mapping -> Node Group -> Actual Node
~~~

- **Recognition Rules** decide what to match. Identify traffic by domain, domain suffix, IP/CIDR, GeoIP, GeoSite, a remote YAML rule set, or a catch-all MATCH rule. A higher priority number matches first.
- **Node Groups** decide how to choose a node. They support manual selection, automatic latency testing, failover, and load balancing. Node scope can include all nodes, a specific region, manually selected nodes, or a name regular expression.
- **Outbound Mappings** bind recognition rules to a node group, an individual node, or built-in targets: DIRECT, PROXY, and REJECT. Recognition rules without an outbound mapping are not written to the final routing configuration.

For example, to route GitHub through an automatically tested group:

1. Create a GitHub recognition rule with type DOMAIN-SUFFIX and condition github.com.
2. Create an Overseas Auto Test node group with type **Auto Test**, then choose the nodes that should participate.
3. Bind GitHub to Overseas Auto Test in **Outbound Mappings**.
4. Use **Outbound Test** to verify the matched rule and simulated route, then apply the configuration.

You can also select **Generate Recognition Rules from Geo** and choose individual local Geo categories. This creates recognition rules only; it does not create outbound mappings, so it is useful when you want to build the path manually.

### Other features

- **Subscriptions and Nodes**: supports Clash YAML, Base64, and common node links, with automatic updates, proxy fallback downloads, credential de-duplication, region detection, node editing, and concurrent latency tests.
- **Geo Data**: manages GeoIP and GeoSite sources, update schedules, and local data status; data can be refreshed manually or reset to recommended sources.
- **Transparent Proxy and DNS**: supports TUN soft-router mode, Fake-IP/Redir-Host, LAN DNS takeover, and startup environment checks.
- **Dashboard and Connections**: switch among Rule, Global, and Direct modes; select the main proxy outlet; view real-time traffic and connection details; and close connections.
- **Log Auditing**: view subscription, rule, core, and update results by category and level; inspect details and export filtered logs.
- **Configuration Export and Sharing**: download a Clash configuration or generate a configuration subscription link for Clash Verge.
- **Online Updates**: check for and install panel updates from **Settings**.

---

License: MIT
