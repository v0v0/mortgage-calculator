# 访问统计部署说明

站点本身托管在 GitHub Pages，无法直接获得访问者 IP 或 IP 地域。仓库中的 `analytics-worker/` 使用 Cloudflare Worker + D1 接收匿名统计事件，并利用 Cloudflare `request.cf` 在服务端推导国家 / 省级地区。

## 统计口径

- **访问次数（PV）**：每次页面加载记录 1 次 `visit_events`。
- **访问量 / 独立访客（UV）**：浏览器首次访问时在 LocalStorage 生成匿名 `visitor_id`，后续访问复用；服务端按 `visitor_id` 去重。
- **日 / 月 UV 与 PV**：`/v1/stats` 按天、按月返回访问次数和去重访客数。
- **地区**：只保存 `country` 和 `region`，中国访问通常可到省级；不保存原始 IP。
- **计算参数**：保存城市、总房价、贷款额、贷款比例、贷款类型、等额本息 / 等额本金、首套 / 二套、期限、利率和提前还款汇总。
- **导出次数**：点击“保存房贷结果长图”时记录 1 次导出事件，并带当前主要贷款参数。

## D1 数据

Worker 首次请求时会自动执行 `CREATE TABLE IF NOT EXISTS`，因此新版无需单独做数据库迁移。完整结构也保存在 `analytics-worker/schema.sql`。

## 部署

1. 安装 Wrangler：`npm install -g wrangler`
2. 登录：`wrangler login`
3. 创建 D1：`wrangler d1 create mortgage-calculator-analytics`
4. 将返回的 `database_id` 填入 `analytics-worker/wrangler.toml`（可从 `wrangler.toml.example` 复制）。
5. 设置统计查询 Token：`wrangler secret put STATS_TOKEN`
6. 在 `analytics-worker/` 目录执行：`npm install && npm run deploy`
7. 将 Worker 的 HTTPS 地址写入 `data/analytics-config.json`，并把 `enabled` 改为 `true`。

## 查询统计

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" \
  https://<worker-domain>/v1/stats
```

返回内容包括：

- `totalVisits`
- `uniqueVisitors`
- `daily`：最近 90 天 UV / PV
- `monthly`：最近 24 个月 UV / PV
- `visitsByLocation`
- `exportsTotal`
- `dailyExports`
- `monthlyExports`
- `calculationsByLoanType`
- `calculationsByRepaymentMethod`
- `recentCalculations`
- `recentExports`

## 隐私说明

前端不会读取或上传原始 IP；Worker 也不写入原始 IP。地域直接来自 Cloudflare 请求元数据。匿名 visitor id 只用于去重统计，不包含账号、手机号、姓名等身份信息。
