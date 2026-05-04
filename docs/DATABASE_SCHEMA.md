# 数据库结构文档

> 数据库文件：`backend/gaokao.db`（SQLite）
> 生成时间：2026-05-01

---

## 目录

- [一、院校与专业基础数据](#一院校与专业基础数据)
- [二、录取与分数核心数据](#二录取与分数核心数据)
- [三、就业与口碑数据](#三就业与口碑数据)
- [四、用户与商业化数据](#四用户与商业化数据)

---

## 一、院校与专业基础数据

### 1. `schools` — 院校基础信息

存储全国高校的基本档案。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | Integer | 主键 |
| `code` | String | 院校代码 |
| `name` | String | 院校名称 |
| `province` / `city` | String | 所在省市 |
| `tier` | String | 档次：985 / 211 / 双一流 / 普通本科 / 专科等 |
| `school_type` | String | 综合 / 理工 / 医药 / 财经 等 |
| `is_985` / `is_211` / `is_shuangyiliu` | String | 是否（是/否）|
| `nature` | String | 公办 / 民办 |
| `postgrad_rate` | String | 保研率/深造率文本 |
| `male_ratio` / `female_ratio` | String | 男女比例 |
| `tags` | Text | 标签，如 "985 / 211 / 双一流 / 国重点" |
| `website` / `intro` | String/Text | 官网 / 院校简介 |
| `rank_2025` / `rank_2024` | Integer | 软科排名 |
| `rank_type` | String | 综合 / 理工 / 文法等 |
| `city_level` | String | 一线 / 新一线 / 二线 / 三线 |
| `admin_dept` | String | 主管部门，如教育部、省政府 |
| `flagship_majors` | Text | 王牌专业 |
| `employment_quality` | Text | 就业流向摘要或链接 |
| `satisfaction_score` | Float | 院校综合满意度（0-5）|
| `admission_website` | String | 招生网址 |
| `founded_year` | Integer | 建校年份 |
| `postgrad_recommend_rate` | String | 推免率 |

**示例数据：**

```json
{
  "id": 1,
  "name": "北京大学",
  "province": "北京",
  "city": "北京",
  "tier": "985",
  "school_type": "综合",
  "is_985": "是",
  "is_211": "是",
  "nature": "公办",
  "rank_2025": 2,
  "satisfaction_score": 4.7,
  "founded_year": 1898
}
```

---

### 2. `subject_evaluations` — 第四轮学科评估

教育部学科评估结果。

| 字段 | 说明 |
|------|------|
| `school_name` / `school_code` | 学校名称/代码 |
| `subject_code` / `subject_name` | 学科代码/名称，如 0101 / 哲学 |
| `grade` | A+ / A / A- / B+ / B / B- / C+ / C / C- |
| `category` | 门类，如哲学 |
| `major_category` | 专业大类，如哲学类 |

**示例数据：**

```json
{
  "school_name": "北京大学",
  "subject_code": "0101",
  "subject_name": "哲学",
  "grade": "A+",
  "category": "哲学",
  "major_category": "哲学类"
}
```

---

### 3. `majors` — 院校专业招生信息（含选科要求）

某校某专业在特定省份的招生计划。

| 字段 | 说明 |
|------|------|
| `school_code` / `school_name` | 院校代码/名称 |
| `major_name` | 专业名称 |
| `major_group` | 专业组编号 |
| `subject_req` | 选科要求，如 "物理,化学" |
| `plan_count` | 招生人数 |
| `tuition` | 学费（元/年）|
| `duration` | 学制，如 "4" 或 "5" |
| `province` / `city` | 招生省份 / 院校城市 |
| `year` | 招生年份 |
| `batch` | 批次，如本科批、专科批 |

**示例数据：**

```json
{
  "school_name": "首都医科大学",
  "major_name": "临床医学",
  "subject_req": "物理,化学",
  "plan_count": 3,
  "tuition": 5500,
  "duration": "5",
  "year": 2025,
  "province": "北京",
  "batch": "本科批"
}
```

---

### 4. `national_programs` — 全国院校开设专业目录

全国各高校实际开设的本科专业清单，用于判断某校是否有某专业。

| 字段 | 说明 |
|------|------|
| `school_name` / `province` / `city` | 学校及所在地 |
| `major_name` | 专业名称 |
| `major_category` | 专业大类，如 "经济学类(本)" |

**示例数据：**

```json
{
  "school_name": "南京工业大学",
  "province": "江苏",
  "city": "南京市",
  "major_name": "经济统计学",
  "major_category": "经济学类(本)"
}
```

---

## 二、录取与分数核心数据

### 5. `admission_records` — 历年专业录取记录（核心）

最核心的业务数据，用于志愿推荐算法。

| 字段 | 说明 |
|------|------|
| `school_code` / `school_name` | 院校代码/名称 |
| `major_name` / `major_group` | 专业名称/组 |
| `province` | 招生省份 |
| `year` | 年份 |
| `batch` | 批次 |
| `subject_req` | 选科要求 |
| `min_score` | 最低录取分 |
| `min_rank` | 最低录取位次 |
| `admit_count` | 录取人数 |
| `school_province` / `school_nature` | 院校所在省 / 性质 |
| `is_985` / `is_211` | 是否 |

**示例数据：**

```json
{
  "school_name": "四川城市职业学院",
  "major_name": "新能源汽车技术",
  "province": "四川",
  "year": 2025,
  "batch": "专科批",
  "subject_req": "物理",
  "min_score": 120,
  "min_rank": 8232,
  "school_nature": "民办"
}
```

---

### 6. `rank_tables` — 一分一段表

各省历年高考成绩分布表，用于分数转位次。

| 字段 | 说明 |
|------|------|
| `province` / `year` | 省份 / 年份 |
| `category` | 科类，如综合、物理类、历史类 |
| `batch` | 批次 |
| `score` | 分数 |
| `count_this` | 本段人数 |
| `count_cum` | 累计人数（即位次）|
| `rank_min` / `rank_max` | 排名区间 |

**示例数据：**

```json
{
  "province": "山东",
  "year": 2022,
  "category": "综合",
  "batch": "本科批",
  "score": 700,
  "count_this": 106,
  "count_cum": 106,
  "rank_min": 1,
  "rank_max": 106
}
```

---

### 7. `province_control_lines` — 各省批次控制线

各省历年各批次的最低控制分数线。

| 字段 | 说明 |
|------|------|
| `province` / `year` | 省份 / 年份 |
| `batch` | 批次名称，如 "普通类一段" |
| `subject_type` | 首选历史 / 首选物理 / 理科 / 文科 |
| `score` | 分数线 |

**示例数据：**

```json
{
  "province": "山东",
  "year": 2024,
  "batch": "普通类一段",
  "subject_type": "首选历史",
  "score": 506
}
```

---

## 三、就业与口碑数据

### 8. `major_employment` — 专业就业信息

各本科专业的就业画像。

| 字段 | 说明 |
|------|------|
| `major_name` | 专业名称 |
| `edu_level` | 本科 / 专科 |
| `category_1` / `category_2` | 一级学科 / 二级学科 |
| `avg_salary` | 平均月薪 |
| `employment_rank` | 就业排名描述文本 |
| `top_city` / `top_industry` | 主要去向城市/行业 |
| `job_directions` / `common_jobs` | 就业方向 / 常见岗位 |
| `salary_by_exp` | 各经验段薪资 JSON 数组 |
| `satisfaction` | 综合满意度（0-5）|
| `employment_rate` | 就业率 |
| `intro` / `training_goal` / `career_direction` | 简介/培养目标/就业方向 |
| `industry_dist` / `city_dist` | 行业/城市分布 JSON |
| `salary_trend` | 历年薪资趋势 JSON |
| `gender_male` / `gender_female` | 性别比例 |
| `major_code` | 国标专业代码 |

**示例数据：**

```json
{
  "major_name": "通信工程",
  "avg_salary": 14560,
  "satisfaction": 4.06,
  "top_city": "深圳、上海、北京",
  "top_industry": "通信/电信/网络设备...",
  "salary_trend": {"2010": 2996, "2020": 14560},
  "gender_male": "60%",
  "gender_female": "40%"
}
```

---

### 9. `school_employment` — 学校级就业数据

来自各校就业质量报告或第三方平台。

| 字段 | 说明 |
|------|------|
| `school_name` / `year` | 学校/报告年份 |
| `employment_rate` | 总就业率（0~1）|
| `avg_salary` | 平均月薪（元）|
| `top_employers` | 主要雇主 JSON 数组 |
| `top_industries` / `top_cities` | 行业/城市分布 JSON |
| `postgrad_rate` / `overseas_rate` | 国内深造率 / 出国率 |
| `postgrad_schools` | 深造去向摘要 |
| `top_employer_tier` | 雇主综合评级：头部/中等/一般 |
| `data_source` | 数据来源 |

**示例数据：**

```json
{
  "school_name": "北京大学",
  "year": 2024,
  "employment_rate": 0.9608,
  "avg_salary": 12902,
  "top_industries": {"信息技术/IT": 0.2, "金融/银行": 0.18},
  "postgrad_rate": 0.641,
  "overseas_rate": 0.1772,
  "top_employer_tier": "头部"
}
```

---

### 10. `school_reviews` — 学生口碑数据

从贴吧、搜狗微信、知乎等抓取的舆情分析结果。

| 字段 | 说明 |
|------|------|
| `school_name` | 学校 |
| `source` | 来源：贴吧 / 搜狗微信 |
| `positive_count` / `negative_count` | 正/负向信号命中次数 |
| `review_count` | 采样帖子数 |
| `sentiment_score` | 情感得分（0~1，0.5 为中性）|
| `sentiment_delta` | 相对同层次学校的偏差 |
| `top_positive` / `top_negative` | 高频正负词 JSON |
| `sample_quotes` | 代表性原文摘要 JSON |

---

### 11. `school_employment_flow` — 毕业生就业流向明细

某校毕业生的具体去向详情。

| 字段 | 说明 |
|------|------|
| `school_name` / `province` / `city` | 学校及所在地 |
| `region_flow` | 地域分布文本 |
| `employer_type` | 单位性质分布文本 |
| `top_employers` | 主要签约单位及人数 |
| `employer_details` | 签约详情文本 |

**示例数据：**

```json
{
  "school_name": "西安工业大学",
  "region_flow": "陕西省内:8.78%, 北京:1.08%, ...",
  "employer_type": "国有企业:35.21%, 民营企业:14.00%, ...",
  "top_employers": "中国航空工业... 34人；中国航天科技... 27人；..."
}
```

---

### 12. `school_salary_ranking` — 院校薪资排名

各高校毕业生起薪排名及历年薪资数据。

| 字段 | 说明 |
|------|------|
| `school_name` | 学校名称 |
| `salary_rank` | 薪资排名 |
| `avg_salary_2023` / `avg_salary_2021` / `avg_salary_2019` | 各届平均月薪 |
| `school_type` / `location` | 类型 / 所在地 |
| `is_985` / `is_211` | 是否 |

**示例数据：**

```json
{
  "school_name": "清华大学",
  "salary_rank": 1,
  "avg_salary_2023": 13221,
  "avg_salary_2021": 18324,
  "avg_salary_2019": 24339
}
```

---

### 13. `school_order_programs` — 订单班/校企合作专业

记录有订单培养、校企合作的专业信息。

| 字段 | 说明 |
|------|------|
| `school_name` / `province` | 学校 / 省份 |
| `industry` | 所属行业 |
| `partner_company` | 合作企业 |
| `program_name` | 项目名称 |
| `program_details` | 项目详情 |
| `employment_guarantee` | 就业保障描述 |
| `data_source` | 数据来源 |

**示例数据：**

```json
{
  "school_name": "石家庄邮电职业技术学院",
  "industry": "邮电通信",
  "partner_company": "中国邮政储蓄",
  "program_name": "金融类（订单班）",
  "employment_guarantee": "包就业"
}
```

---

### 14. `industry_salary_benchmark` — 行业岗位薪资基准

各行业的具体岗位薪资范围（单位：千元/年）。

| 字段 | 说明 |
|------|------|
| `industry` | 行业名称 |
| `position` | 岗位名称 |
| `salary_low_annual_k` / `salary_high_annual_k` / `salary_mid_annual_k` | 低位/高位/中位年薪 |
| `data_source` | 数据来源 |

**示例数据：**

```json
{
  "industry": "证券/期货/投资服务",
  "position": "客户关系经理",
  "salary_low_annual_k": 300,
  "salary_high_annual_k": 500,
  "salary_mid_annual_k": 400
}
```

---

### 15. `industry_summary` — 行业薪资汇总

按行业聚合的薪资统计。

| 字段 | 说明 |
|------|------|
| `industry` | 行业名称 |
| `position_count` | 岗位数量 |
| `salary_p25_annual_k` / `salary_median_annual_k` / `salary_p75_annual_k` | P25/P50/P75 年薪 |
| `salary_max_annual_k` | 最高年薪 |
| `grad_monthly_estimate` | 应届生月薪估算 |

**示例数据：**

```json
{
  "industry": "互联网/电子商务",
  "position_count": 80,
  "salary_median_annual_k": 725,
  "grad_monthly_estimate": 7500
}
```

---

### 16. `major_employment_dist` — 专业就业分布明细

某专业毕业生的行业/城市/单位性质等分布明细。

| 字段 | 说明 |
|------|------|
| `major_code` / `major_name` | 专业代码/名称 |
| `dist_type` | 分布类型：industry / city / employer_type |
| `item_name` / `item_detail` | 项目名 / 详情 |
| `percentage` | 占比（%）|

**示例数据：**

```json
{
  "major_name": "哲学",
  "dist_type": "industry",
  "item_name": "教育/培训/院校",
  "percentage": 28.0
}
```

---

### 17. `major_industry_map` — 专业关键词到行业映射

用于将专业名称/关键词映射到所属行业。

| 字段 | 说明 |
|------|------|
| `keyword` | 关键词，如 "计算机" |
| `industry` | 映射行业，如 "科技" |
| `priority` | 优先级 |

---

### 18. `major_satisfaction` — 专业满意度评分

阳光高考平台等专业满意度数据。

| 字段 | 说明 |
|------|------|
| `school_name` / `edu_level` / `major_name` | 学校/层次/专业 |
| `overall_score` / `overall_votes` | 综合评分 / 投票数 |
| `employment_score` / `employment_votes` | 就业评分 / 投票数 |
| `teaching_score` / `teaching_votes` | 教学评分 / 投票数 |
| `facility_score` / `facility_votes` | 条件评分 / 投票数 |

**示例数据：**

```json
{
  "school_name": "北京大学",
  "major_name": "国际政治",
  "overall_score": 4.8,
  "employment_score": 4.5,
  "teaching_score": 4.8,
  "facility_score": 4.6
}
```

---

## 四、用户与商业化数据

### 19. `users` — 用户表

注册用户的基本信息，支持多种登录方式。

| 字段 | 说明 |
|------|------|
| `phone` | 手机号 |
| `wechat_openid` / `wechat_mini_openid` / `wechat_unionid` | 微信各端标识 |
| `nickname` / `province` | 昵称 / 所在省份 |
| `referral_code` | 邀请码（8位）|
| `referred_by` | 邀请人 user_id |
| `is_paid` | 0=未付费，1=已付费 |
| `subscription_type` | single_report / monthly_sub / quarterly_sub / trial_report |
| `subscription_end_at` | 订阅到期时间（单次为 null）|
| `created_at` / `last_active_at` | 注册时间 / 最后活跃时间 |

**示例数据：**

```json
{
  "id": 1,
  "phone": "13521670204",
  "referral_code": "YI1ILDI9",
  "is_paid": 1,
  "subscription_type": "trial_report"
}
```

---

### 20. `orders` — 订单表

用户购买记录，含查询条件快照用于分析。

| 字段 | 说明 |
|------|------|
| `order_no` | 唯一订单号，前缀 GK |
| `user_id` | 关联用户 |
| `amount` | 金额，单位：分（1990 = ¥19.9）|
| `product_type` | report_export / single_report 等 |
| `status` | pending / paid / refunded |
| `pay_method` | wechat / alipay |
| `transaction_id` | 支付渠道流水号 |
| `pay_time` | 支付时间 |
| `rank_input` | 用户查询位次 |
| `province` / `subject` | 省份 / 选科 |
| `ref_code` | 邀请码（支付时传入）|
| `c_major` / `c_city` / `c_nature` / `c_tier` | 用户筛选条件快照 |

**示例数据：**

```json
{
  "order_no": "GK1777094706148361",
  "amount": 199,
  "product_type": "single_report",
  "status": "pending",
  "pay_method": "wechat",
  "rank_input": 49343,
  "province": "山东",
  "subject": "物理+化学+地理"
}
```

---

### 21. `user_events` — 用户行为事件表

埋点数据，记录页面访问、按钮点击等行为。

| 字段 | 说明 |
|------|------|
| `user_id` / `session_id` | 用户ID / 会话ID |
| `event_type` | 事件类型：page_view / button_click 等 |
| `event_data` | JSON 扩展数据 |
| `page` | 页面路径，如 /results |
| `province` / `rank_input` | 用户当前的省份/位次 |
| `ip` / `user_agent` | IP / UA |
| `created_at` | 时间 |

**示例数据：**

```json
{
  "session_id": "opf8fjpjinimo47oibk",
  "event_type": "page_view",
  "page": "/results",
  "province": "山东",
  "rank_input": 35136
}
```

---

### 22. `feedbacks` — 用户意见反馈表

| 字段 | 说明 |
|------|------|
| `content` | 反馈内容 |
| `contact` | 联系方式 |
| `ip` | 提交IP |
| `created_at` | 时间 |

---

### 23. `sms_codes` — 短信验证码表

替代内存存储，服务重启不丢失。

| 字段 | 说明 |
|------|------|
| `phone` | 手机号 |
| `code` | 6位验证码 |
| `expires_at` | 过期时间（Unix timestamp）|
| `created_at` | 发送时间（Unix timestamp，用于频率限制）|
| `ip` | 发送方IP |

---

### 24. `report_logs` — 报告生成记录

每次生成 PDF 志愿报告时写入一条。

| 字段 | 说明 |
|------|------|
| `report_id` | 唯一短ID（16位）|
| `province` / `rank` | 省份 / 位次 |
| `user_id` | 用户ID |
| `scan_count` | 二维码被扫次数 |
| `created_at` | 生成时间 |

---

### 25. `report_scans` — 报告二维码扫描记录

每次扫描报告上的二维码时写入一条。

| 字段 | 说明 |
|------|------|
| `report_id` | 关联报告ID |
| `scanned_at` | 扫描时间 |
| `ip` / `user_agent` | 扫描者信息 |
| `referer` | 从哪个平台扫过来 |

---

## 附录：表数量统计

| 类别 | 表数量 |
|------|--------|
| 院校与专业基础数据 | 4 |
| 录取与分数核心数据 | 3 |
| 就业与口碑数据 | 11 |
| 用户与商业化数据 | 7 |
| **合计** | **25** |
