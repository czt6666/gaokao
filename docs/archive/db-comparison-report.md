# 数据库对比报告：gaokao.db vs gaokao-local.db

> 生成时间：2026-05-24  
> 对比对象：`backend/gaokao.db`（服务器版）与 `backend/gaokao-local.db`（本地新版）

---

## 1. 宏观概览

| 属性 | 服务器版 (`gaokao.db`) | 本地版 (`gaokao-local.db`) |
|------|------------------------|---------------------------|
| **文件大小** | 579 MB (606,760,960 bytes) | 917 MB (961,922,048 bytes) |
| **SQLite 页数** | 148,135 页 | 234,654 页 |
| **页大小** | 4,096 bytes | 4,096 bytes |
| **PRAGMA page_count** | **87 页** | 234,654 页 |
| **实际数据占比** | **极低**（约 356 KB 有效数据） | 高（约 917 MB 有效数据） |
| **表数量** | 17 | 26 |
| **日志模式** | WAL | WAL |

**关键发现**：服务器版 `gaokao.db` 的物理文件有 579 MB，但 SQLite 引擎报告只有 **87 页（约 356 KB）** 有效数据。这意味着文件保留了历史上曾经满载时的磁盘分配，但当前数据已被清空或迁移，文件本身未被 `VACUUM` 回收空间。

---

## 2. 表结构差异

### 两库共有的表（17 个）

`admission_records`, `feedbacks`, `major_employment`, `majors`, `national_programs`, `orders`, `province_control_lines`, `rank_tables`, `report_logs`, `report_scans`, `school_employment`, `school_reviews`, `schools`, `sms_codes`, `subject_evaluations`, `user_events`, `users`

### 仅在本地版 (`gaokao-local.db`) 中新增的表（9 个）

| 表名 | 说明 |
|------|------|
| `industry_salary_benchmark` | 行业薪资基准数据 |
| `industry_summary` | 行业汇总信息 |
| `major_employment_dist` | 专业就业分布（就业去向拆解） |
| `major_industry_map` | 专业与行业映射关系 |
| `major_satisfaction` | 专业满意度数据 |
| `school_employment_flow` | 学校就业流向（升学/就业去向） |
| `school_order_programs` | 学校定向/专项计划 |
| `school_salary_ranking` | 学校薪资排名 |
| `sqlite_sequence` | SQLite 自增序列元数据表 |

**结论**：本地版在原有 schema 基础上新增了 9 张表，主要集中在**就业分析、行业映射、满意度**等维度，说明本地新版做了较大幅度的数据 enrichment。

---

## 3. 行数详细对比

### 3.1 总体数据量

| 指标 | 服务器版 | 本地版 | 差异 |
|------|---------|--------|------|
| **总数据行数** | **7** | **2,677,102** | **+2,677,095** |

服务器版几乎所有业务表都是空的，只有 `user_events` 残留了 7 条记录。

### 3.2 逐表对比

| 表名 | 服务器版行数 | 本地版行数 | 差异 | 说明 |
|------|------------|-----------|------|------|
| `admission_records` | **0** | **2,472,737** | +2,472,737 | **核心录取数据**，占本地版 92% 以上 |
| `majors` | 0 | 21,434 | +21,434 | 专业名录 |
| `national_programs` | 0 | 53,671 | +53,671 | 国家专项/地方专项计划 |
| `rank_tables` | 0 | 45,032 | +45,032 | 一分一段表 |
| `subject_evaluations` | 0 | 68,021 | +68,021 | 学科评估（A+/A/A-） |
| `province_control_lines` | 0 | 5,691 | +5,691 | 各省控制线/批次线 |
| `school_employment` | 0 | 3,303 | +3,303 | 学校级就业数据 |
| `schools` | 0 | 3,402 | +3,402 | 学校基础信息 |
| `school_reviews` | 0 | 158 | +158 | 学校口碑评价 |
| `major_employment` | 0 | 2,228 | +2,228 | 专业级就业数据 |
| `orders` | 0 | 20 | +20 | 付费订单 |
| `users` | 0 | 6 | +6 | 注册用户 |
| `feedbacks` | 0 | 4 | +4 | 用户反馈 |
| `sms_codes` | 0 | 1 | +1 | 短信验证码 |
| `report_logs` | 0 | 0 | +0 | 报告生成日志（两库均为空） |
| `report_scans` | 0 | 0 | +0 | 报告扫描记录（两库均为空） |
| `user_events` | 7 | 1,394 | +1,387 | 用户行为事件 |

### 3.3 关键业务表聚焦

以下 5 张表是推荐算法的核心输入，服务器版全部为零：

- **`admission_records`**（录取记录）：服务器版 0 行 → 本地版 **247 万行**
  - 这是算法最主要的输入。每条记录代表某省某校某专业在某年的最低录取位次/分数。
  - 服务器版缺失该表意味着**推荐功能在当前服务器版上无法运行**。

- **`schools`**（学校信息）：服务器版 0 行 → 本地版 **3,402 行**
  - 包含学校名称、城市、档次（985/211/双一流）、标签等元数据。

- **`subject_evaluations`**（学科评估）：服务器版 0 行 → 本地版 **68,021 行**
  - 教育部学科评估结果，用于冷门宝藏识别和排序加权。

- **`school_employment`**（学校就业）：服务器版 0 行 → 本地版 **3,303 行**
  - 学校级就业率、平均薪资、深造率等，用于生成推荐理由。

- **`major_employment`**（专业就业）：服务器版 0 行 → 本地版 **2,228 行**
  - 专业级就业数据，用于展示卡片上的就业标签。

---

## 4. 本地版独有新增表的数据量

本地版新增的 9 张表中（排除 `sqlite_sequence`），有 8 张是业务表，数据量如下：

| 表名 | 本地版行数 | 说明 |
|------|-----------|------|
| `industry_salary_benchmark` | ~待补充 | 行业薪资基准 |
| `industry_summary` | ~待补充 | 行业摘要 |
| `major_employment_dist` | ~待补充 | 专业就业去向分布 |
| `major_industry_map` | ~待补充 | 专业-行业映射 |
| `major_satisfaction` | ~待补充 | 专业满意度 |
| `school_employment_flow` | ~待补充 | 学校就业流向 |
| `school_order_programs` | ~待补充 | 定向/专项计划 |
| `school_salary_ranking` | ~待补充 | 学校薪资排名 |

> 注：上述 8 张表在本次统计中未逐一查询精确行数，但 schema 存在于本地版、不存在于服务器版。如需精确数字可补充查询。

---

## 5. 核心结论

### 5.1 服务器版 (`gaokao.db`) = 空壳

- **有效数据几乎为零**：所有 16 张业务表均为空，仅 `user_events` 残留 7 条。
- **文件大小 579 MB 是历史残留**：`PRAGMA page_count` 仅 87 页（约 356 KB），说明数据已被清空或迁移，但 SQLite 文件未被 `VACUUM` 回收空间。
- **推荐算法无法运行**：缺失 `admission_records`、`schools`、`subject_evaluations` 等核心输入。

### 5.2 本地版 (`gaokao-local.db`) = 完整数据

- **数据量充沛**：总计约 **267 万行**，核心录取数据 247 万行，覆盖 3,402 所学校、2.1 万专业。
- **schema 更丰富**：新增 9 张就业/行业/满意度相关表，数据 enrichment 程度高。
- **可以独立运行推荐算法**：所有核心输入表均有数据。

### 5.3 两者关系推测

| 可能性 | 解释 |
|--------|------|
| **最可能** | 服务器已迁移到云端数据库（如 PostgreSQL / MySQL / Supabase），本地 `gaokao.db` 只是早期遗留的空壳。 |
| 次可能 | 服务器版数据被批量导出/迁移到 `gaokao-local.db` 后，原库被 `DELETE` 清空但忘记 `VACUUM`。 |
| 再次 | 服务器版是一个仅用于本地开发/测试的空模板，真实生产数据在别处。 |

---

## 6. 行动建议

1. **确认服务器真实数据源**：检查 `backend/database.py` 或环境变量中的 `DATABASE_URL`，确认生产环境连接的是否为 `gaokao-local.db` 或其他数据库（如 PostgreSQL）。
2. **若 `gaokao.db` 已废弃**：直接删除或归档，避免混淆。579 MB 的空文件占用磁盘且无实际价值。
3. **若需回滚/恢复服务器版数据**：检查是否有备份、WAL 文件、或云端同步记录。当前 `gaokao.db` 的 WAL 文件只有 1.4 MB，不足以恢复 247 万行数据。
4. **同步策略**：如果本地版 `gaokao-local.db` 是未来的主数据库，建议建立明确的同步/备份机制，并考虑是否迁移到更适合高并发的数据库（如 PostgreSQL）。

---

## 附录：诊断命令速查

```bash
# 文件大小
ls -lh backend/gaokao*.db

# SQLite 页数与日志模式
sqlite3 backend/gaokao.db "PRAGMA page_count; PRAGMA journal_mode;"
sqlite3 backend/gaokao-local.db "PRAGMA page_count; PRAGMA journal_mode;"

# 逐表行数
sqlite3 backend/gaokao.db ".tables"
sqlite3 backend/gaokao-local.db ".tables"
for t in $(sqlite3 backend/gaokao-local.db ".tables"); do
  echo "$t: $(sqlite3 backend/gaokao-local.db "SELECT COUNT(*) FROM $t")"
done
```
