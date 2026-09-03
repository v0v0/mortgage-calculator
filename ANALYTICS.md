# 访问统计部署说明

站点托管在 GitHub Pages；统计后端使用 Cloudflare Worker + D1。前端只向 Worker 发送页面访问、有效计算参数和导出事件；Worker 从 Cloudflare 请求元数据获得 IP 地理位置，但 **不会把原始 IP 写入 D1**。

## 统计口径

- **PV**：页面处于前台并累计停留满 2 秒后记录 1 次。切到后台的时间不计入 2 秒。该门槛可以过滤大量不会执行/持续运行页面 JavaScript 的简单爬虫，但不能保证排除所有搜索引擎或无头浏览器爬虫。
- **UV**：Worker 使用 `HMAC-SHA256(UV_HASH_KEY, IP + User-Agent)` 生成不可逆访客摘要；D1 只保存摘要，不保存 IP 或 User-Agent 原文。
- **日 UV**：同一摘要同一天只计 1 次；`daily_stats.uv` 保存日 UV。
- **累计 UV**：`visitor_global` 按匿名摘要去重。IP 或 User-Agent 变化会导致一定程度的高估，共享网络且 UA 相同也可能低估，因此 UV 是近似指标。
- **访问地区**：保存 Cloudflare `request.cf` 提供的 `country / region / city`，只做聚合计数。
- **计算次数**：没有“计算”按钮。只有用户真实修改贷款参数后，参数连续稳定 2 秒且有效时才记录；同一页面会话内相同参数不会重复记录。
- **贷款城市**：按用户选择的购房城市聚合，与访问者 IP 城市分开统计。
- **贷款金额分布**：按贷款总额每 10 万元一个区间聚合，例如 123 万计入 `120–130 万`。
- **导出次数**：点击保存房贷结果长图时只增加每日导出计数，不保存逐次导出明细。

## D1 表

- `visitor_global`：累计匿名 UV 去重。
- `visitor_daily`：日 / 月 UV 去重。
- `daily_stats`：每日 PV、UV、计算次数、导出次数。
- `visit_location_daily`：国家 / 省级地区 / 城市访问 PV。
- `calc_city_daily`：各购房城市计算次数。
- `calc_amount_daily`：贷款金额每 10 万元区间的计算次数。

不保存逐次访问事件、原始 IP、姓名、账号、手机号或其他直接身份信息。

## GitHub Actions Secrets

公开仓库可以安全使用 GitHub Actions Secrets。仓库文件中只出现 `${{ secrets.NAME }}` 引用，Secret 的真实值不会进入 Git 历史。Cloudflare 官方也要求 CI 中把 API Token 和 Account ID 放在 CI/CD secrets 中，不要把 API Token 写入仓库。

在仓库 **Settings → Secrets and variables → Actions → Repository secrets** 添加：

1. `CLOUDFLARE_API_TOKEN`
   - 使用 Cloudflare **API Token**，不要使用 Global API Key。
   - 权限最小化到这个 Cloudflare Account。
   - 需要 Workers Scripts 写权限以及 D1 写权限。
2. `CLOUDFLARE_ACCOUNT_ID`
   - Cloudflare Account ID；它本身不是认证密钥，但仍放 Secret，避免仓库公开账号标识。
3. `UV_HASH_KEY`
   - 至少 32 字节随机值，例如本地执行 `openssl rand -hex 32`。
4. `STATS_TOKEN`
   - 统计查询接口 `/v1/stats` 的 Bearer Token，同样建议 `openssl rand -hex 32`。

不要把以上任何真实值写入 `wrangler.jsonc`、`wrangler.toml`、README、Issue、PR、Actions 命令参数或日志。

## 一键部署

仓库提供 `.github/workflows/deploy-analytics.yml`，支持手动运行；当 `analytics-worker/**` 或部署 workflow 自身在 `main` 更新时也会自动运行。来自 fork 的 PR 不会获得这些 Secrets。

运行 **Actions → Deploy Cloudflare Analytics → Run workflow** 后会自动：

1. 用 GitHub Secrets 登录 Cloudflare。
2. 查找 `mortgage-calculator-analytics` D1；不存在则自动在 APAC 创建。
3. 写入临时 `wrangler.jsonc`，D1 ID 只存在于 Actions runner，不提交仓库。
4. 初始化 D1 聚合表。
5. 通过 Wrangler `--secrets-file` 把 `UV_HASH_KEY` 和 `STATS_TOKEN` 直接作为 Worker Secrets 部署。
6. 部署 Worker 到 `workers.dev`。
7. 调用 `/v1/health` 验证。
8. 只把 **公开的 Worker HTTPS endpoint** 写入 `data/analytics-config.json` 并提交到 `main`；随后现有 GitHub Pages workflow 自动发布站点。

Worker URL 出现在公开仓库中是正常且不可避免的：浏览器必须知道请求地址。安全边界不是隐藏 URL，而是 **Token/Secret 不进入前端或仓库**、统计查询需要 `STATS_TOKEN`、写接口限制允许的站点 Origin。

如果部分用户网络无法访问 `workers.dev`，浏览器端统计请求会失败且不会被记录。GitHub Pages 是纯静态托管，不能在 `v0v0.github.io` 下增加服务端反向代理来隐藏或中转 Worker。更可靠的方案是给 Worker 配置一个由你控制的普通自定义域名（例如 `analytics.example.com`），再把 `data/analytics-config.json` 的 endpoint 改到该域名；密钥仍然只保存在 Cloudflare/GitHub Secret 中。自定义域名可以改善 `workers.dev` 特定域名被网络策略阻断的问题，但任何公网域名都无法保证在所有网络环境中 100% 可达。

## 查询统计

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" \
  https://<worker-name>.<account-subdomain>.workers.dev/v1/stats
```

主要字段：

- `totalVisits`：累计有效 PV。
- `uniqueVisitors`：累计匿名 UV。
- `totalCalculations`：累计有效参数计算次数。
- `exportsTotal`：累计导出次数。
- `daily`：最近 90 天 PV / UV / 计算 / 导出。
- `monthly`：最近 24 个月 PV / 去重 UV / 计算 / 导出。
- `visitsByLocation`：访问 IP 所在国家 / 地区 / 城市 PV。
- `calculationsByCity`：用户选择的购房城市计算次数。
- `loanAmountDistribution`：每 10 万元贷款金额区间分布。

## 安全说明

- 浏览器端只包含公开统计 endpoint，不包含 Cloudflare API Token、`UV_HASH_KEY` 或 `STATS_TOKEN`。
- `CLOUDFLARE_API_TOKEN` 仅存在于 GitHub Actions Secret/部署进程环境，用来管理 Cloudflare 资源，不参与访客浏览器到 Worker 的请求。
- Worker 的 `UV_HASH_KEY`、`STATS_TOKEN` 以 Cloudflare Secret 形式保存，Cloudflare Dashboard / Wrangler 不会回显原值。
- 公开的 `/v1/visit`、`/v1/calc`、`/v1/export` 不应携带任何长期密钥；否则密钥必然能被浏览器开发者工具或公开前端源码读取。
- 写接口校验允许的 `Origin` 并配置按 IP Rate Limiter，可降低普通跨站滥用和刷量，但 CORS/Origin 不是强认证：脚本客户端可以伪造请求头，因此统计数据应视为近似数据，而不是安全审计数据。
- Pages workflow 不需要 Cloudflare Token。
- 建议 Cloudflare API Token 使用最小账号范围，并在不再需要自动部署时撤销或轮换。
