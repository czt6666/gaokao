Critical（致命 — 可能导致数据泄露、资金损失、权限绕过）

```markdown
 C1. 硬编码 JWT Secret — 付费墙完全失效

 - 文件: backend/routers/auth.py:14
 - 问题: SECRET_KEY = os.getenv("JWT_SECRET",
 "gaokao-dev-secret-change-in-prod")，若生产环境未设置环境变量，攻击者可用已知 secret 伪造 JWT，绕过所有付费验证。

 C2. 硬编码 Admin Token — 管理后台裸奔

 - 文件: backend/routers/admin.py:14
 - 问题: ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "yuanxi-admin-2026")，若未覆盖，任何人可用 X-Admin-Token:
 yuanxi-admin-2026 访问全部 admin 接口（查看订单、退款、导出用户数据）。

 C3. 支付回调竞态条件 — 重复收款/重复开通

 - 文件: backend/routers/payment.py:325-398
 - 问题: wechat_notify 用 background_tasks.add_task(_mark_paid_task, ...)
 异步处理支付，但没有分布式锁或数据库级唯一约束。微信重试通知时，可能并发执行多次
 _mark_paid，导致重复给用户加会员天数。

 C4. Admin 接口 SQL 注入风险

 - 文件: backend/routers/admin.py:798-827
 - 问题: import_admission_records 接受 delete_existing=True 参数，可直接批量删除 admission_records 数据，且仅通过单一
  admin token 鉴权，无二次确认。

 C5. 前端 XSS — 志愿表导出注入

 - 文件: frontend/app/form/page.tsx:99-149
 - 问题: exportPDF 用模板字符串拼接 HTML 后直接 document.write()，学校名、专业名等用户可控数据未做 HTML 转义。若
 localStorage 被污染或 API 返回恶意数据，可执行任意脚本。

 C6. 前端 PayModal 竞态 — 可能重复创建订单

 - 文件: frontend/components/PayModal.tsx:312-338
 - 问题: startPolling 的 interval 回调捕获了旧的 onSuccess
 prop，组件重渲染后可能持有过时的闭包。若用户快速关闭/打开弹窗，可能同时存在多个轮询 interval。

 ---
 High（高危 — 可能导致功能异常、逻辑错误、安全漏洞）

 H1. exam_mode 未定义 — portfolio 端点崩溃

 - 文件: backend/main.py:953, 1032
 - 问题: portfolio_optimize 和 portfolio_simulate 调用 _run_recommend_core(...,
 exam_mode=exam_mode)，但函数签名里没有 exam_mode 参数，运行时会抛 NameError。

 H2. OAuth state 未验证 — CSRF 攻击

 - 文件: backend/routers/auth.py:356-444
 - 问题: 微信回调（wechat_open_callback、wechat_mp_callback 等）没有验证 state 参数是否与发出时一致，攻击者可构造恶意
  OAuth 链接让用户登录到攻击者控制的会话。

 H3. 开放重定向 — 登录后跳到恶意网站

 - 文件: backend/routers/auth.py:552-553
 - 问题: redirect_to 从 state 中解析后直接用于 RedirectResponse，无白名单校验。
 - 文件: frontend/app/results/page.tsx:818-823
 - 问题: WeChat OAuth 的 redirect_uri 直接用 window.location.href 构造。

 H4. _mark_paid 无乐观锁 — 并发更新

 - 文件: backend/routers/payment.py:426-484
 - 问题: 先读 order.status != "pending" 再更新，没有 SELECT FOR UPDATE 或版本号，高并发下可能重复处理同一笔订单。

 H5. 自定义 JWT 缺乏标准安全特性

 - 文件: backend/routers/auth.py:28-48
 - 问题: 无 jti（无法吊销）、无 iss/aud、无 alg 头校验，一旦 secret 泄露无法止损。

 H6. 订单金额未校验产品目录

 - 文件: backend/routers/payment.py:73, 138, 194, 288
 - 问题: amount_fen 由客户端传 product_type 后查表获得，但无服务端校验确保该 product_type
 的价格与预期一致。若订单表被篡改，可能以错误价格成交。

 H7. Dashboard fetch 缺少 JSON 解析错误处理

 - 文件: frontend/app/dashboard/page.tsx:47-66
 - 问题: .then((r) => { ... return r.json() }) 中 r.json() 可能抛异常（如服务器返回 502 HTML），但异常未被
 catch，导致未处理的 Promise Rejection。

 H8. Toast 内存泄漏

 - 文件: frontend/app/results/page.tsx:136（多处）
 - 问题: showToast 内创建 setTimeout 更新 state，组件卸载前未清理，React 会报 "Can't perform a React state update on
 an unmounted component"。

 H9. is_paid 类型是 number 却当 boolean 用

 - 文件: frontend/components/AuthNav.tsx:10-11, 97-101
 - 问题: interface UserInfo { is_paid: number }，但 JSX 里直接 user.is_paid ? ... : ...。若后端返回 2（如"过期"），UI
  会误判为已付费。

 H10. useEffect 依赖缺失导致 stale closure

 - 文件: frontend/app/results/page.tsx:825
 - 问题: WeChat OAuth useEffect 依赖数组为 []，但内部使用了 queryOrderKey（由 province/rank/subject 派生）。用户通过
 client-side 路由切换查询条件时，effect 用的是旧值。

 ---
 Medium（中危 — 边界情况、体验问题、潜在隐患）

 M1. 省份参数无长度/格式校验

 - 文件: backend/main.py:235
 - 问题: province 默认"北京"但无长度限制，超长字符串可能影响 SQL 和 URL 构造。

 M2. 限流存储无同步

 - 文件: backend/main.py:209-228
 - 问题: _rate_limit_store 是全局 dict，多 worker/异步并发下可能绕过限流。

 M3. SMS 验证码明文存储

 - 文件: backend/routers/auth.py:158-166
 - 问题: SmsCode 表中 code 字段是明文，数据库泄露时活跃验证码可直接使用。

 M4. _verify_failures 全局字典无锁

 - 文件: backend/routers/auth.py:23, 184-217
 - 问题: 多 worker 下暴力破解计数器可能不准确。

 M5. 缓存 key 用 MD5（非安全但可接受）

 - 文件: backend/services/recommend_core.py:652-677
 - 问题: _rec_cache 用 MD5 hash constraints 作为缓存 key 的一部分。MD5 有碰撞风险，但在此场景下实际影响极小。

 M6. CORS 包含 localhost（生产风险）

 - 文件: backend/main.py:46-63
 - 问题: _ALLOW_ORIGINS 默认包含 http://localhost:3000，生产部署时应移除。

 M7. 缺少 Content-Security-Policy 头

 - 文件: backend/main.py:70-78
 - 问题: SecurityHeadersMiddleware 未设置 CSP、HSTS。

 M8. 前端 AbortController 无组件卸载清理

 - 文件: frontend/app/page.tsx:161-199
 - 问题: handleSubmit 内创建的 AbortController 和 setTimeout 在组件卸载时未清理。

 M9. Admin 页面潜在除零

 - 文件: frontend/app/admin/page.tsx:246
 - 问题: pct = Math.min(((referralCount - prev) / (next - prev)) * 100, 100)，若 next === prev 则除零。

 M10. encodeURIComponent 前无长度限制

 - 文件: frontend/app/page.tsx:125-136
 - 问题: cMajor 等输入框无长度限制，超长内容构造 URL 可能导致 414。

 M11. localStorage 数据未校验直接解析

 - 文件: frontend/app/form/page.tsx:38-43
 - 问题: JSON.parse(localStorage.getItem(STORAGE_KEY)) 后直接 setItems，数据损坏时可能崩溃。

 M12. 硬编码第三方 QR 服务

 - 文件: frontend/components/PayModal.tsx:583
 - 问题: 使用 api.qrserver.com 生成支付二维码，支付 URL 泄露给第三方，且依赖不可控外部服务。

 ---
 Low（低危 — 代码质量、体验优化、边缘情况）

 L1. 未使用导入 Fragment

 - 文件: frontend/app/results/page.tsx:2

 L2. 废弃 API document.execCommand

 - 文件: frontend/app/login/page.tsx:364

 L3. 魔法数字无命名常量

 - 文件: frontend/app/admin/page.tsx:240, 243
 - 问题: MILESTONES = [4, 8, 15] 和 referralCount * 7 无注释说明业务含义。

 L4. Console 错误静默

 - 文件: frontend/components/PayModal.tsx:271
 - 问题: catch 块只 setStatus("failed") 不打印日志，线上调试困难。

 L5. parseInt 可能返回 NaN

 - 文件: frontend/app/dashboard/page.tsx:108-113, 190
 - 问题: parseInt(savedRank).toLocaleString() 若 savedRank 非数字会显示 "NaN"。

 L6. alert() 阻断主线程

 - 文件: frontend/app/form/page.tsx, frontend/app/school/[name]/page.tsx
 - 问题: 多处使用 window.alert() 提示用户，体验差。
```



h3我接口返回的不可能是钓鱼网站呀。h5怎么修复









## 竞品功能

- 数据覆盖（提前批、国家专项、地方专项、高校专项、艺术类、体育类、专科）
- 霍兰德职业兴趣测试 + MBTI性格测试 + 学科能力评估，测评结果与专业推荐联动
- 直播答疑（QA助手）
- 学校库清晰明确
- 自然语言查询
- 数据可视化：往年同分段考生最终去了哪些学校
- 整合了百度贴吧、百度知道、百度百科的用户生成内容
- 交互门槛低





## 付费模式

- VIP卡：¥360/年（基础填报功能）
- 钻石卡：¥598/年（含专家直播、测评、志愿表审核）
- 全部免费-广告导流收入
- 学校统一采购
- 30/年





























