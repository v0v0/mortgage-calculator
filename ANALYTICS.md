# 访问统计说明

站点托管在 GitHub Pages；当前前端访问统计使用 **百度统计（站长版）**，站点 ID：`67635ed0d1b5200fa4df6891bf568485`。

原 Cloudflare Worker + D1 统计后端代码暂时保留在仓库中作为历史实现/备用方案，但当前页面的 `analytics.js` **不再读取 `data/analytics-config.json`，也不再向 `workers.dev` 上报任何访问或计算事件**。

## 当前统计口径

### 有效 PV

百度统计默认会在页面打开时自动发送 PV。为了保持本站原有统计口径，`analytics.js` 会在加载 `hm.js` 前执行：

```js
_hmt.push(['_setAutoPageview', false]);
```

页面处于前台、累计可见时间达到 **2 秒** 后，才执行：

```js
_hmt.push(['_trackPageview', location.pathname + location.search]);
```

因此百度统计中的本站 PV 定义为：

- 页面在前台累计可见至少 2 秒；
- 切换到后台/隐藏标签页的时间不计入 2 秒；
- 同一次页面加载最多发送 1 次手工 PV；
- 可以过滤大量不执行或不会持续运行页面 JavaScript 的简单爬虫，但不能保证排除所有无头浏览器或搜索引擎渲染程序。

UV、地域、来源、浏览器、设备、新老访客等访问维度由百度统计基于该访问请求生成。

## 房贷业务事件

没有明确的“计算”按钮。只有用户真实操作贷款表单后，参数连续稳定 **2 秒**、且贷款城市和贷款金额有效时才记录一次计算；同一页面会话内完全相同的参数快照不会重复记录。

所有事件使用：

```text
category = mortgage
```

### 总计算次数

```text
action = calculate
label  = valid
value  = 当前贷款总额（万元，四舍五入）
```

### 购房城市分布

```text
action = calculate_city
label  = 城市名称
```

例如：

```text
mortgage / calculate_city / 北京
```

### 贷款金额分布

继续保持原有口径：每 **10 万元** 一个区间。

```text
action = loan_amount_bucket
label  = 120-130万
```

例如贷款总额 123 万计入 `120-130万`。

### 贷款类型

```text
action = loan_type
label  = commercial | provident | combined
```

### 还款方式

```text
action = repayment_method
label  = equalPayment | equalPrincipal
```

### 导出结果

用户点击“保存房贷结果长图”时：

```text
action = export
label  = 当前购房城市
value  = 当前贷款总额（万元，四舍五入）
```

百度统计的事件跟踪不会计入 PV，因此上述业务事件不会造成访问量重复。

## 百度统计后台查看

基础访问数据直接查看百度统计的访问、来源、地域、访客、页面等报告。

业务事件在事件跟踪报告中按以下 action 查看：

- `calculate`：总有效计算次数；
- `calculate_city`：购房城市分布；
- `loan_amount_bucket`：贷款金额每 10 万元区间分布；
- `loan_type`：贷款类型使用分布；
- `repayment_method`：还款方式使用分布；
- `export`：导出次数及导出城市。

百度 `_trackEvent` 的 `category / action / label` 存在多样性限制，因此不要把完整贷款参数 JSON、时间戳、随机 ID 等高基数字段放进 label。当前事件设计只使用城市、固定枚举和 10 万元金额区间，避免无意义地扩大事件维度。

## 前端实现

百度统计 SDK 地址：

```text
https://hm.baidu.com/hm.js?67635ed0d1b5200fa4df6891bf568485
```

由 `analytics.js` 动态加载。如果 SDK 网络加载失败，会在 5 秒后重新尝试；已经进入 `_hmt` 队列的 PV/事件会保留，SDK 后续成功加载后再处理。

页面源码中没有百度账号密码或其他认证密钥。百度统计站点 ID 本身就是需要公开给浏览器的客户端标识，并不具备管理百度账号的权限。

## Cloudflare 旧统计后端

以下内容目前仍保留，但网页已不使用：

- `analytics-worker/`：Cloudflare Worker + D1 实现；
- `data/analytics-config.json`：旧 Worker endpoint；
- `.github/workflows/deploy-analytics.yml`：Worker 部署流程；
- GitHub Secrets 中可能仍存在的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`UV_HASH_KEY`、`STATS_TOKEN`。

保留这些文件不会导致浏览器继续访问 Worker，因为当前 `analytics.js` 已没有读取或调用相关 endpoint 的代码。如果以后确认不再需要备用方案，可以再删除 Worker/D1 部署文件并撤销相应 Cloudflare API Token。

## 隐私说明

切换到百度统计后，访问统计数据由第三方百度统计服务处理，而不是只存储在自有 D1 中。站点正式对外提供服务时，应在隐私说明中告知使用百度统计进行访问和功能使用情况分析，并按照适用的数据保护和个人信息规则处理用户告知/同意要求。
