"""专家版数据通用导入包。

模块:
  field_registry  —— 规范字段定义（字段名/别名/类型/中文备注/归属表）。
  column_mapper   —— 读单个 xlsx，自动识别表头行，产出「列号 ↔ 规范字段」对应关系。
  expert_import   —— 用对应关系把数据写入 admission_2026 / 回填 admission_records。
"""
