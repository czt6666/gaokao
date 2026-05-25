# 专业筛选改造方案：从「关键词」到「门类 → 大类」两级

**创建日期**：2026-05-17
**作者**：czt
**状态**：待评审，未实施
**影响范围**：前端表单（网页 + 小程序）/ 后端 `/api/recommend` / 数据库（新增字典表）/ PDF 报告参数

---

## 1. 问题陈述

当前专业筛选是「自由关键词 chip」：用户输入 `计算机`，后端 `major_name.lower()` 子串匹配。
痛点：

1. **召回噪音**：搜「计算机」会同时召回「计算机科学与技术」「计算机类」「机算机应用」等，也会漏掉「人工智能」「数据科学」这类同属计算机类却名字不含「计算机」的专业。
2. **用户不知道有什么可选**：要自己脑补关键词，对非工科家长尤其不友好。
3. **无层次感**：用户其实想表达「我要选工科里的 IT 方向」，关键词无法表达这种意图。

期望：参照志愿填报场景的标准做法，做**两级层级筛选**：
- **一级（门类）**：工学 / 理学 / 医学 / 经管 / 法学 / 文学 / 教育学 / 艺术 / 农学 / 哲学 / 历史 / 军事（教育部本科 12 门类）。
- **二级（大类）**：计算机类 / 电子信息类 / 机械类 / 临床医学类 / 中国语言文学类 ……（92 个大类）。

---

## 2. 现状盘点

| 维度 | 现状 | 文件位置 |
|---|---|---|
| 前端输入 | 单文本输入 + chip 多选 | `frontend/app/page.tsx:124` `setCMajors` |
| URL 参数 | `?c_major=计算机 软件`（空格分隔） | 同上，第 660 行 placeholder |
| 后端入参 | `c_major: str` | `backend/main.py:242` |
| 解析逻辑 | `split() → constraints["major_keywords"]` | `backend/main.py:330-331` |
| 过滤逻辑 | 对 `major_name.lower()` 做 `any(kw in text)` 子串匹配 | `backend/services/recommend_core.py:1268-1271` |
| 订单表字段 | `orders.c_major VARCHAR(50)` | `backend/database.py:243`，迁移脚本 `migrate_add_order_constraints.py:14` |
| **订单匹配规则** | **只校验 province + rank + subject，不校验 c_***（line 286） | `backend/main.py:286` |

> ⚠ 关键观察：**订单的"已付"判断与 `c_major` 等约束字段无关**，所以约束筛选方式的任何改造**不会影响旧订单的有效性**。

### 2.1 现有可复用的分类数据

`major_employment` 表已有 `category_1` / `category_2`：

```sql
-- 探查样例
SELECT category_1, COUNT(DISTINCT category_2) FROM major_employment
WHERE category_1!='' GROUP BY category_1;
```

结果（2026-05-17 主库快照）：

| 一级分类 | 二级数 | 备注 |
|---|---|---|
| 工学 | 31 | ✅ 本科 |
| 理学 | 12 | ✅ |
| 医学 | 11 | ✅ |
| 管理学 | 9 | ✅ |
| 财经商贸大类 | 8 | ❌ 专科 |
| 装备制造大类 | 7 | ❌ 专科 |
| 土建类 | 7 | ❌ 旧目录 |
| 土木建筑大类 | 7 | ❌ 专科（与上重复） |
| 法学 | 6 | ✅ |
| 艺术学 | 5 | ✅ |
| 经济学 | 4 | ✅ |
| 农学 | 7 | ✅ |
| 教育学 | 2 | ✅ |
| 历史学 | 1 | ✅ |
| 哲学 | 1 | ✅ |
| 文学 | 3 | ✅ |
| …… | …… | 还有约 30 个"XX 类 / XX 大类"专科分类 |

**问题**：
1. **本科 12 门类与专科大类混在同一字段**，且部分大类同名只是有无"大"字（土建类 vs 土木建筑大类）。
2. **覆盖率不足**：
   - `admission_records` 有 **3597** 个 distinct `major_name`
   - `major_employment` 只有 **2127** 个
   - **2135 个专业未归类**（≈ 59% admission 专业在 employment 表里查不到）

直接套用现有数据做筛选 → 至少一半的专业会被"漏掉"。**必须先做数据归一化**。

---

## 3. 改造方案

### 3.1 数据库改造

**新增字典表**（不动现有表）：

```sql
CREATE TABLE major_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  major_name  VARCHAR(80) NOT NULL UNIQUE,    -- 专业名（与 admission_records.major_name 对齐）
  category_l1 VARCHAR(20) NOT NULL,           -- 12 门类之一
  category_l2 VARCHAR(40) NOT NULL,           -- 92 大类之一
  edu_level   VARCHAR(10) DEFAULT '本科',     -- 本科 / 专科
  source      VARCHAR(20) DEFAULT 'official', -- official / heuristic / manual
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_majcat_l1_l2 ON major_categories(category_l1, category_l2);
CREATE INDEX ix_majcat_name  ON major_categories(major_name);
```

字段语义：
- `source='official'`：来自教育部《普通高等学校本科专业目录（2024）》的权威映射。
- `source='heuristic'`：用规则（专业名后缀/包含词）自动推断的兜底归类。
- `source='manual'`：管理后台人工修正过的。

### 3.2 数据来源（一次性灌库）

**Step 1：官方字典**（约 800 行）
- 教育部 2024 版《普通高等学校本科专业目录》12 门类 + 92 大类 + 800+ 专业。
- 落地为 `backend/scripts/seed_major_categories.py`，从 CSV 或硬编码字典写入 `major_categories`，`source='official'`。

**Step 2：迁移已有干净数据**
- `INSERT OR IGNORE INTO major_categories SELECT … FROM major_employment WHERE category_1 IN (本科12门类) AND category_2!=''`。
- 只接受本科门类，过滤掉"XX 大类"专科行。

**Step 3：规则兜底未归类的 ~2000 个专业**
- `backfill_major_categories.py`：扫 `admission_records.major_name`，未在字典表的项，按下面规则推断：
  - 末尾「工程」「技术」「制造」「自动化」→ 工学
  - 末尾「学」且含「医」→ 医学
  - 末尾「学」且含「经济/金融/会计/财」→ 经济学
  - 含「教育/教学」→ 教育学
  - 含「外语/中文/汉语/新闻/传播」→ 文学
  - …（共约 20 条 heuristic）
- 命中规则的写 `source='heuristic'`，并落一份 `unmapped.csv` 给运营人工补全。

**Step 4：人工兜底**
- 管理后台 `/admin/major-categories` 加一个简单 CRUD（已有 `routers/admin.py` 框架），运营每周清一次未归类列表。

### 3.3 URL / API 改造

**新参数**：

```
?c_major_l1=工学
&c_major_l2=计算机类,电子信息类     # 逗号分隔多选
&c_major=人工智能                    # 保留旧参数作为「自由关键词兜底」
```

三者关系：
- L1、L2、关键词**逻辑 AND**。即先按 L1/L2 收窄候选，再用关键词进一步过滤。
- L1 选了，L2 可省（= 选门类下所有大类）。
- L2 可选多个（同门类内）。
- 关键词模式照旧，独立可用。

**后端**：

```python
# main.py：新增入参
c_major_l1: str = Query("", description="一级门类，单选")
c_major_l2: str = Query("", description="二级大类，逗号分隔多选")
# c_major 保留不动

# constraints 构造
if c_major_l1.strip():
    constraints["major_l1"] = c_major_l1.strip()
if c_major_l2.strip():
    constraints["major_l2"] = [x.strip() for x in c_major_l2.split(",") if x.strip()]

# recommend_core.py：进程内预加载字典
_MAJOR_CAT_MAP: dict[str, tuple[str, str]] = {}  # major_name -> (l1, l2)
def _load_major_categories(db):
    rows = db.execute(text("SELECT major_name, category_l1, category_l2 FROM major_categories")).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}

# 过滤函数（O(1) 查表）
def _pass_constraint(school_name, major_name) -> bool:
    ...
    _l1 = constraints.get("major_l1")
    _l2 = set(constraints.get("major_l2", []))
    if _l1 or _l2:
        cat = _MAJOR_CAT_MAP.get(major_name)
        if not cat:
            return True       # 未归类的专业默认放过（"宁可多召回")
        if _l1 and cat[0] != _l1: return False
        if _l2 and cat[1] not in _l2: return False
    ...
```

**性能**：进程内 dict 查表 O(1)，3000 条字典内存 < 1 MB，无 DB join 开销。

### 3.4 前端改造

**网页**（`frontend/app/page.tsx`）：

- 当前的关键词 chip 输入框替换为**两级 picker 弹窗**：
  - 第一步：圆形按钮一屏展示 12 门类（带 icon），点选即跳到第二步。
  - 第二步：当前门类下 N 个二级大类的多选 checklist（带搜索框 → search-as-you-type）。
  - 顶部"已选"区显示当前 L1 + L2 chips，点 × 可清除。
- "高级筛选"区域**保留一个"按关键词搜"** TextInput 作为兜底。

**小程序**（`miniprogram/miniprogram/pages/gaokao/gaokao.wxml`）：

- 用 `picker` 或自定义 `cover-view` 半屏面板实现两级选择。
- 选择结果以同样格式存入 `globalData.gaokaoQuery.constraints.c_major_l1 / c_major_l2`。
- 跳转 results 页时拼到 URL params。

### 3.5 订单兼容性

| 场景 | 行为 |
|---|---|
| 旧订单 (`c_major='计算机'`) 再次访问报告 | `main.py:286` 只校验 province+rank+subject → **不受影响** |
| 旧订单的查询条件展示 | `orders.c_major` 字段保留，无新字段 → 展示原样 |
| 新订单付费时 | 后端 `payment.py` 写订单时除了 `c_major` 再多写两个新列 `c_major_l1 / c_major_l2`（需要一个新迁移脚本） |
| 已付费用户用新筛选条件重查 | URL 带的是 L1/L2/c_major 组合 → 后端把"是否已付"按"原订单条件 ⊆ 新查询条件"宽松判定 |

需要的额外 DB 迁移：

```sql
ALTER TABLE orders ADD COLUMN c_major_l1 VARCHAR(20) DEFAULT '';
ALTER TABLE orders ADD COLUMN c_major_l2 VARCHAR(80) DEFAULT '';
```

迁移脚本 `backend/scripts/migrate_add_order_major_levels.py`（仿照已有的 `migrate_add_order_constraints.py`）。

### 3.6 PDF 报告

`report.py` 里如果有把约束条件渲染到报告封面的逻辑，要追加：
- 已选门类
- 已选大类（逗号拼接）
- 兜底关键词（如有）

如果当前 PDF 不展示 c_major，则可暂不动。

---

## 4. 灰度策略

1. **后端先上**：新参数生效，但不返回任何 UI 提示。老客户端继续传 `c_major=`，行为零变化。
2. **数据落库**：跑一次性灌库脚本，确认未归类 < 200 条，再上前端。
3. **网页先切**：网页推 picker，观察 1 周转化（筛选使用率、付费率）。
4. **小程序跟进**：小程序 picker 上线后，老的 `c_major` 入口继续保留 ≥ 1 个版本，供回滚。
5. **下线 `c_major` 自由输入**：若两端 picker 转化率明显更好，自由输入收为"高级"选项藏到二级菜单。

---

## 5. 工作量估算

| 阶段 | 内容 | 估时 |
|---|---|---|
| 1 | 灌入官方 12+92 字典 + 写 backfill 脚本 + 人工兜底 ~500 条 | 1.5 天 |
| 2 | 后端 API 加参数 + 预加载 + 过滤逻辑 + 单测 | 0.5 天 |
| 3 | `orders` 表新增两列 + 写迁移 + payment 写入逻辑 | 0.5 天 |
| 4 | 网页 picker UI + chip 展示 | 1 天 |
| 5 | 小程序 picker UI（自定义半屏面板） | 1 天 |
| 6 | 灰度上线 + 数据校验 + 文案打磨 | 0.5 天 |
| **合计** | | **~5 天** |

---

## 6. 风险与决策点

| 风险 | 缓解 |
|---|---|
| ~41% 专业未归类时漏召回 | 未归类默认通过 L1/L2 过滤（"宁可多召回"），管理后台开任务补全 |
| 教育部目录每年微调 | 字典表加 `version` 字段，按年生效；新版本上线时跑 diff 迁移 |
| 旧订单用户重查时筛选条件不同 | 已付判定不看 c_*，所以可自由换条件，订单仍有效 |
| 两端 picker UX 不一致 | 用同一份 JSON 字典 + 同一套交互草图，前期对齐设计稿 |

**待决策**：
1. 12 门类的图标/中文别名要不要做？（影响小程序首屏视觉密度）
2. L2 多选上限要不要设？（避免用户全选反而"无筛选"）
3. 「军事学」很少有学校招，要不要默认隐藏？

---

## 7. 不做什么

- ❌ **不动现有 `c_major` 关键词字段和接口**，老订单/老 URL 完全兼容。
- ❌ **不做"专业 → 院校"的直接索引**，仍走现有 admission_records 查询路径，只在最终过滤阶段加层。
- ❌ **不做三级专业筛选**（精确到专业名），那是另一个项目（已通过 `c_major` 关键词覆盖）。

---

## 8. 落地后的 URL 示例

```
# 只选门类
/results?rank=12345&province=广东&subject=物理+化学&c_major_l1=工学

# 选门类 + 多个大类
/results?rank=12345&province=广东&subject=物理+化学
        &c_major_l1=工学&c_major_l2=计算机类,电子信息类

# 三层叠加
/results?rank=12345&province=广东&subject=物理+化学
        &c_major_l1=工学&c_major_l2=计算机类&c_major=人工智能
```

---

## 附录 A：教育部 12 本科门类参考

01 哲学 / 02 经济学 / 03 法学 / 04 教育学 / 05 文学 / 06 历史学 / 07 理学 / 08 工学 / 09 农学 / 10 医学 / 11 军事学 / 12 管理学 / 13 艺术学

合计 **13 个门类**（注：2011 年艺术学独立出来，所以严格来说是 13 门类，但用户场景里习惯说"12 门类"，把军事学合并或省略；本方案按 13 门类做，UI 上军事学可折叠）。
