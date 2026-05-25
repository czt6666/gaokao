# 选科匹配规则文档

## 1. 数据库字段

### 1.1 admission_records 表（核心）

| 字段 | 类型 | 说明 |
|------|------|------|
| `subject_req` | VARCHAR | 原始选科要求文本（如"首选物理，再选化学/生物"） |
| `subject_must` | VARCHAR(100) | 必选科目，逗号分隔，按标准顺序排列 |
| `subject_any_of` | VARCHAR(200) | OR 组，斜杠分隔多科，任选其一 |

### 1.2 科目标准顺序

```
物理, 化学, 生物, 政治, 历史, 地理
```

`subject_must` 中的科目必须按此顺序排列，不可调整。

### 1.3 存储格式示例

| 原始文本 | subject_must | subject_any_of |
|---------|-------------|---------------|
| 不限 | "" | "" |
| 物理 | "物理" | "" |
| 首选物理，再选化学 | "物理,化学" | "" |
| 首选物理，再选化学/生物(2选1) | "物理" | "化学/生物" |
| 首选历史，再选化学、地理(2科必选) | "历史,化学,地理" | "" |
| 物理/化学/生物 | "" | "物理/化学/生物" |

### 1.4 解析来源

- **主入口**：`backend/scripts/subject_rule_map.py`
- **底层解析器**：`backend/scripts/subject_requirement_expr.py`
- **导入时机**：`import_admission_records.py` 在数据入库时自动解析并写入

---

## 2. 后端筛选规则

### 2.1 总体策略

采用**"SQL 硬过滤 + Python 结构化验证"**双层架构：

1. **SQL 层**：在 `_build_recommend_data` 查询 `admission_records` 时，直接用 `IN` 列表过滤掉不能报的专业
2. **Python 层**：`_subject_match` 闭包对 SQL 返回结果做二次校验，确保匹配正确

> **注意**：自 v7 起，已删除基于 `subject_req` 原始文本的学生池过滤、Major 表 fallback、以及原始文本 fallback 逻辑。所有选科匹配完全依赖 `subject_must` + `subject_any_of` 两个结构化字段。

### 2.2 SQL 层硬过滤（`_build_recommend_data`）

#### 2.2.1 subject_must 过滤

枚举用户选科的**所有非空子集**（按标准顺序排列），拼成 `IN` 列表：

```sql
COALESCE(subject_must,'') IN (
    '',                                    -- 无要求
    '物理',                                -- 单科目
    '化学',
    '生物',
    '物理,化学',                           -- 两科目
    '物理,生物',
    '化学,生物',
    '物理,化学,生物'                       -- 三科目（全选）
)
```

**逻辑**：如果数据库中的 `subject_must` 是用户选科的某个子集，则该用户满足必选要求。

#### 2.2.2 subject_any_of 过滤

先查询该省所有唯一的 `subject_any_of` 值，在 Python 层计算哪些匹配用户选科，再拼成 `IN` 列表：

```sql
COALESCE(subject_any_of,'') IN (
    '',            -- 无要求
    '化学/生物'    -- 匹配用户选科的组合
)
```

**匹配算法**：
- `any_of` 按 `/` 分多科
- **至少有一科**在用户选科中 → 匹配

示例：用户选科 = `物理+化学+生物`

| any_of 值 | 结果 | 说明 |
|-----------|------|------|
| "化学/生物" | **通过** | 用户选了化学 |
| "物理/化学/生物" | **通过** | 用户选了物理 |
| "政治/历史" | **不通过** | 用户两科都没选 |

### 2.3 Python 层验证（`_subject_match`）

纯结构化匹配，无原始文本 fallback。

```python
def _subject_match(school_nm: str, major_nm: str) -> bool:
    info = major_subject_cache.get((school_nm, major_nm))
    if not info:
        return True

    must   = info.get("must", "")
    any_of = info.get("any_of", "")

    # must：逗号分隔，所有科目必须在用户选科中
    if must:
        for p in must.split(","):
            if p.strip() not in user_subjects:
                return False

    # any_of：斜杠分隔多科，至少一科在用户选科中
    if any_of:
        parts = [s.strip() for s in any_of.split("/") if s.strip()]
        if not any(p in user_subjects for p in parts):
            return False

    return True
```

**科目别名归一化**：

```python
_alias = {
    "政治": "思想政治", "思政": "思想政治", "生物学": "生物",
    "理科": "物理", "文科": "历史",
    "物理类": "物理", "历史类": "历史",
}
```

---

## 3. 匹配流程图

```
用户输入选科（如"物理+化学+生物"）
    │
    ▼
[SQL 层] 查询 admission_records
    ├── 批次过滤（排除提前批/艺术等）
    ├── 位次区间过滤（gap_rate 预过滤）
    ├── subject_must IN (用户选科子集)    ← 硬条件
    └── subject_any_of IN (匹配值列表)     ← 硬条件
    │
    ▼
[Python 层] _build_recommend_data
    ├── major_subject_cache 构建
    │   └── 仅从 admission_records 取结构化字段 must / any_of
    │
    ▼
[Python 层] _subject_match（验证）
    └── must + any_of 结构化匹配
    │
    ▼
进入推荐计算（概率/位次/冷门评分）
```

---

## 4. 关键代码位置

| 功能 | 文件 | 函数/位置 |
|------|------|----------|
| 原始文本 → 结构化字段 | `backend/scripts/subject_rule_map.py` | `parse_subject_fields()` |
| 数据库字段添加 | `backend/migrations/migrate_add_import_fields.py` | `COLUMNS_TO_ADD` |
| SQL 硬过滤 | `backend/services/recommend_core.py` | `_build_recommend_data()` |
| Python 验证匹配 | `backend/services/recommend_core.py` | `_subject_match()` |
| 模型定义 | `backend/database.py` | `AdmissionRecord` class |

---

## 5. 注意事项

1. **科目顺序不可调整**：`subject_must` 必须按 `物理,化学,生物,政治,历史,地理` 标准顺序排列，子集枚举时也必须保持此顺序，否则 IN 列表匹配会失败。
2. **不再兼容旧数据原始文本**：`subject_must`/`subject_any_of` 为空的记录，在 SQL 层会被当作 `open`（不限）处理。若原始文本有要求但未被解析，该记录可能被错误放行。导入时应确保解析器覆盖所有数据。
3. **性能优化**：SQL 硬过滤减少了约 30%~60% 的数据拉取量（视省份选科要求严格程度而定），Python 层 `_subject_match` 的循环次数相应减少。
4. **院校最低分不参与先验**：`school_prior_rank`（贝叶斯平滑用）计算时跳过 `院校最低分` 条目，防止学校底线拉低专业概率。
