# 部署前检查清单

## 1. 调试模式关闭
- [ ] `GAOKAO_DEBUG=0`（控制 recommend_core.py 和 auth.py 的调试日志）
- [ ] `SIMULATE_PAY=0`（payment.py 中跳过真实支付的开关）
- [ ] 后端 Uvicorn 未使用 `--reload` 参数（检查 systemd 服务文件）
- [ ] 前端 Next.js 使用 `next build` 生产构建，非 `next dev`

## 2. 代码检查
- [ ] 没有硬编码的测试数据或敏感信息

## 3. 前端构建
- [ ] 本地执行 `npm run build` 或 `next build` 成功
- [ ] `.next/` 目录已生成

## 4. 数据库操作
- [ ] **已备份当前生产数据库**（复制 `gaokao.db` + `gaokao.db-wal` + `gaokao.db-shm`）

## 5. 验证
- [ ] `/api/recommend` 正常响应
- [ ] 支付下单接口正常（测试一笔真实支付或检查日志）
- [ ] Admin 后台可正常查看订单列表（含筛选条件列）
- [ ] Dashboard 历史订单的「查看报告」链接包含筛选参数
