# 房贷利率计算器

中国大陆房贷计算与方案对比工具。

功能：

- 商业贷款 / 公积金贷款 / 组合贷款
- 等额本息 / 等额本金对比
- 主要一二线城市静态利率快照
- LPR ± BP 可编辑
- 最终执行利率可手工覆盖
- 组合贷可分别设置期限
- 提前还款
- 关键年份分析
- 年度汇总
- 贷款期间逐月还款明细
- LocalStorage 本地保存方案
- 手机 / PC 响应式

产品需求见 [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)。

## 利率数据

静态数据文件：`data/mortgage-rates.json`

页面运行时不会抓取外部利率。维护时人工更新该文件后重新提交即可。

## 发布

仓库通过 GitHub Actions 发布到 GitHub Pages：

https://v0v0.github.io/mortgage-calculator/

## 本地运行

由于页面通过 `fetch()` 读取 JSON，请用任意静态 HTTP Server 打开，例如：

```bash
python -m http.server 8080
```

然后访问 `http://localhost:8080/`。
