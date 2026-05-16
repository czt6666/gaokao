-- 为 admission_records 表新增 major_restrictions 列
-- 用于存储专业备注中的结构化限制标签

ALTER TABLE admission_records ADD COLUMN major_restrictions VARCHAR(200) DEFAULT '';

-- 创建索引以加速按限制条件过滤查询
CREATE INDEX IF NOT EXISTS ix_adm_restrictions ON admission_records(major_restrictions);
