"""
冷门算法 v2.0 Harness 验证套件
运行：python test_hidden_gem_v2.py

验证策略：
  H1  Type C 逻辑修复（位次上升=降温=机会）
  H2  Type C 旧逻辑不再触发（位次下降=升温=不是C型冷门）
  H3  省际相对城市折价（哈尔滨学生去哈尔滨不折价）
  H4  绝对城市折价 fallback（无来源省份时仍工作）
  H5  Type F 产业信号（核工程触发F型）
  H6  Type F 负向不触发（会计学不触发F型）
  H7  Type G 委培检测（中国石油大学+石油工程触发G型）
  H8  Type G 无关组合不触发
  H9  复合评分 > 单一最高分（多信号叠加）
  H10 industry_signals 模块完整性（各函数可调用）
  H11 向后兼容：原有接口签名不变，旧调用方式不报错
  H12 score_overall_gem 无信号时返回 is_hidden_gem=False
  H13 Type A：广东学生+哈尔滨学校有城市折价
  H14 Type A：哈尔滨学生+哈尔滨学校无折价（相对折价=0）
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import traceback

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
results = []


def check(name: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    results.append((name, condition))
    print(f"  {status} {name}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        print(f"       → DETAIL: {detail}")


# ── 导入 ─────────────────────────────────────────────────────────
try:
    from algorithms.hidden_gem import (
        hidden_gem_type_c,
        hidden_gem_type_a,
        hidden_gem_type_f,
        hidden_gem_type_g,
        score_overall_gem,
        calc_city_discount_relative,
        calc_city_discount,
        PROVINCE_CAPITAL,
    )
    print("\n[imports] hidden_gem v2.0 导入成功")
except Exception as e:
    print(f"\n[imports] 导入失败: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    from algorithms.industry_signals import (
        get_industry_score, get_ai_complementarity,
        get_entrusted_training, KNOWN_ENTRUSTED_TRAINING,
        MAJOR_TO_INDUSTRY, INDUSTRY_SCURVE, MAJOR_AI_COMPLEMENTARITY,
    )
    print("[imports] industry_signals 导入成功\n")
    INDUSTRY_SIGNALS_OK = True
except Exception as e:
    print(f"[imports] industry_signals 导入失败: {e}")
    INDUSTRY_SIGNALS_OK = False


# ── H1: Type C 修复验证 ───────────────────────────────────────────
print("── H1/H2: Type C 逻辑修复 ─────────────────────────────────")

# 学校录取位次逐年上升（数字变大 = 门槛降低 = 降温 = 应触发C型）
cooling_records = [
    {"year": 2022, "min_rank": 10000},
    {"year": 2023, "min_rank": 12000},
    {"year": 2024, "min_rank": 15000},
]
gem_c_cooling = hidden_gem_type_c(cooling_records)
check("H1: 位次持续上升（10000→15000）应触发Type C", gem_c_cooling is not None,
      f"result={gem_c_cooling}")
if gem_c_cooling:
    check("H1b: Type C decline_rate 应为正值（50%）", gem_c_cooling.get("decline_rate", 0) > 0,
          f"decline_rate={gem_c_cooling.get('decline_rate')}")
    check("H1c: Type C gem_score 应>0", gem_c_cooling.get("gem_score", 0) > 0,
          f"gem_score={gem_c_cooling.get('gem_score')}")

# 学校录取位次逐年下降（数字变小 = 门槛升高 = 升温 = 不应触发C型）
heating_records = [
    {"year": 2022, "min_rank": 15000},
    {"year": 2023, "min_rank": 12000},
    {"year": 2024, "min_rank": 10000},
]
gem_c_heating = hidden_gem_type_c(heating_records)
check("H2: 位次持续下降（15000→10000）不应触发Type C", gem_c_heating is None,
      f"result={gem_c_heating}")


# ── H3/H4: 省际相对城市折价 ──────────────────────────────────────
print("\n── H3/H4: 省际相对城市折价 ────────────────────────────────")

# 广东学生去哈尔滨：广州热度9 > 哈尔滨热度4，差值5 → 有折价
discount_gd_hlj = calc_city_discount_relative("哈尔滨", "广东")
check("H3: 广东学生+哈尔滨学校 应有折价", discount_gd_hlj >= 0.4,
      f"discount={discount_gd_hlj}")

# 哈尔滨学生去哈尔滨：家乡=哈尔滨，delta<=1 → 无折价
discount_hlj_hlj = calc_city_discount_relative("哈尔滨", "黑龙江")
check("H14: 黑龙江学生+哈尔滨学校 折价应为0", discount_hlj_hlj == 0.0,
      f"discount={discount_hlj_hlj}")

# 无省份信息 → fallback到绝对折价
discount_no_prov = calc_city_discount_relative("哈尔滨", "")
discount_abs = calc_city_discount("哈尔滨")
check("H4: 无省份时 fallback 到绝对折价", discount_no_prov == discount_abs,
      f"relative={discount_no_prov}, absolute={discount_abs}")


# ── H13/H14: Type A 实测 ─────────────────────────────────────────
print("\n── H13/H14: Type A 省际折价实测 ───────────────────────────")

school_harbin = {
    "city": "哈尔滨", "province": "黑龙江",
    "rank_2025": 300, "tier": "985", "name": "哈尔滨工业大学"
}
majors_strong = [{"major_name": "力学", "subject_strength": "A+"}]

# 广东学生看哈工大：应触发A型（城市折价）
gem_a_gd = hidden_gem_type_a(school_harbin, majors_strong, student_province="广东")
check("H13: 广东学生+哈工大 Type A 应触发", gem_a_gd is not None,
      f"result={gem_a_gd}")

# 黑龙江学生看哈工大：不应触发（家乡=哈尔滨）
gem_a_hlj = hidden_gem_type_a(school_harbin, majors_strong, student_province="黑龙江")
check("H14: 黑龙江学生+哈工大 Type A 不应触发", gem_a_hlj is None,
      f"result={gem_a_hlj}")


# ── H5/H6: Type F 产业信号 ───────────────────────────────────────
print("\n── H5/H6: Type F 产业信号 ──────────────────────────────────")

gem_f_nuclear = hidden_gem_type_f("核工程与核技术")
check("H5: 核工程 应触发Type F（核能产业上升期）", gem_f_nuclear is not None,
      f"result={gem_f_nuclear}")
if gem_f_nuclear:
    check("H5b: Type F gem_score > 0", gem_f_nuclear.get("gem_score", 0) > 0,
          f"gem_score={gem_f_nuclear.get('gem_score')}")
    check("H5c: Type F 含有 industry_name", "industry_name" in gem_f_nuclear,
          str(gem_f_nuclear.get("industry_name")))

gem_f_robot = hidden_gem_type_f("机器人工程")
check("H5d: 机器人工程 应触发Type F（人形机器人产业）", gem_f_robot is not None,
      f"result={gem_f_robot}")

gem_f_accounting = hidden_gem_type_f("会计学")
check("H6: 会计学 不应触发Type F（AI替代风险高）", gem_f_accounting is None,
      f"result={gem_f_accounting}")

gem_f_news = hidden_gem_type_f("新闻学")
check("H6b: 新闻学 不应触发Type F（衰退产业）", gem_f_news is None,
      f"result={gem_f_news}")

gem_f_unknown = hidden_gem_type_f("服装设计")
check("H6c: 无产业映射的专业 不触发Type F", gem_f_unknown is None,
      f"result={gem_f_unknown}")


# ── H7/H8: Type G 委培检测 ───────────────────────────────────────
print("\n── H7/H8: Type G 委培检测 ──────────────────────────────────")

gem_g_oil = hidden_gem_type_g("中国石油大学", "石油工程")
check("H7: 中国石油大学+石油工程 应触发Type G", gem_g_oil is not None,
      f"result={gem_g_oil}")
if gem_g_oil:
    check("H7b: Type G employer 含三桶油", "石油" in gem_g_oil.get("employer", ""),
          f"employer={gem_g_oil.get('employer')}")
    check("H7c: Type G gem_score >= 75", gem_g_oil.get("gem_score", 0) >= 75,
          f"gem_score={gem_g_oil.get('gem_score')}")

gem_g_fuyao = hidden_gem_type_g("福耀科技大学", "机械工程")
check("H7d: 福耀科技大学+机械工程 应触发Type G", gem_g_fuyao is not None,
      f"result={gem_g_fuyao}")

gem_g_none = hidden_gem_type_g("普通工学院", "软件工程")
check("H8: 无委培关系的学校+专业 不触发Type G", gem_g_none is None,
      f"result={gem_g_none}")


# ── H9: 复合评分 ─────────────────────────────────────────────────
print("\n── H9: 复合评分验证 ────────────────────────────────────────")

# 构造一个多信号场景：认知折价B + 产业信号F + 委培G 都触发
school_dict_oil = {
    "name": "中国石油大学",
    "city": "北京", "province": "北京",
    "rank_2025": 150, "tier": "985",
}
records_flat = [{"year": 2023, "min_rank": 8000}, {"year": 2024, "min_rank": 8100}]
gem_multi = score_overall_gem(
    school_dict_oil, [], records_flat, [],
    actual_major_name="石油工程", student_province="广东"
)
if gem_multi.get("is_hidden_gem"):
    gem_count = gem_multi.get("gem_count", 0)
    gem_score = gem_multi.get("gem_score", 0)
    check("H9: 多信号场景 gem_count >= 1", gem_count >= 1, f"count={gem_count}")
    check("H9b: 复合分 >= 单一 top_gem 分",
          gem_score >= gem_multi["top_gem"].get("gem_score", 0),
          f"compound={gem_score}, top={gem_multi['top_gem'].get('gem_score')}")
else:
    check("H9: 中石大+石油工程 应识别为冷门", False,
          f"result={gem_multi}")


# ── H10: industry_signals 模块完整性 ─────────────────────────────
print("\n── H10: industry_signals 模块完整性 ───────────────────────")

if INDUSTRY_SIGNALS_OK:
    ind_score, ind_name, note = get_industry_score("核工程与核技术")
    check("H10: get_industry_score('核工程') 返回正值", ind_score > 0,
          f"score={ind_score}, industry={ind_name}")

    ai_comp = get_ai_complementarity("机器人工程")
    check("H10b: 机器人工程 AI互补性为正", ai_comp > 0, f"ai_comp={ai_comp}")

    ai_comp_acct = get_ai_complementarity("会计学")
    check("H10c: 会计学 AI互补性为负", ai_comp_acct < 0, f"ai_comp={ai_comp_acct}")

    entry = get_entrusted_training("中国石油大学", "石油工程")
    check("H10d: 委培关系可查找", entry is not None, f"entry={entry}")

    check("H10e: MAJOR_TO_INDUSTRY 至少30个专业", len(MAJOR_TO_INDUSTRY) >= 30,
          f"count={len(MAJOR_TO_INDUSTRY)}")
    check("H10f: INDUSTRY_SCURVE 至少10个产业", len(INDUSTRY_SCURVE) >= 10,
          f"count={len(INDUSTRY_SCURVE)}")
else:
    check("H10: industry_signals 导入失败", False, "跳过子测试")


# ── H11: 向后兼容 ─────────────────────────────────────────────────
print("\n── H11: 向后兼容（旧调用签名不报错）───────────────────────")

try:
    # 旧调用方式（无 student_province 参数）
    result_compat = score_overall_gem(
        {"city": "北京", "province": "北京", "rank_2025": 50, "tier": "985"},
        [],
        [{"year": 2023, "min_rank": 5000}],
        [],
        actual_major_name="计算机科学与技术"
    )
    check("H11: 旧签名调用不报错", True, f"is_hidden_gem={result_compat.get('is_hidden_gem')}")
except Exception as e:
    check("H11: 旧签名调用不报错", False, str(e))


# ── H12: 无信号时返回 is_hidden_gem=False ─────────────────────────
print("\n── H12: 无信号返回值 ───────────────────────────────────────")

result_no_gem = score_overall_gem(
    {"name": "普通大学", "city": "北京", "province": "北京", "rank_2025": 50, "tier": "985"},
    [],  # 无A类学科
    [{"year": 2023, "min_rank": 5000}, {"year": 2024, "min_rank": 4900}],  # 位次下降=升温
    [],  # 无就业数据
    actual_major_name="行政管理",  # 无B/F/G触发
    student_province="北京",  # 学校在北京，学生在北京，无A型
)
check("H12: 无信号时 is_hidden_gem=False", result_no_gem.get("is_hidden_gem") == False,
      f"result={result_no_gem}")
check("H12b: 无信号时 gem_score=0", result_no_gem.get("gem_score", -1) == 0,
      f"gem_score={result_no_gem.get('gem_score')}")


# ── 汇总 ─────────────────────────────────────────────────────────
print("\n" + "═" * 55)
passed = sum(1 for _, ok in results if ok)
total  = len(results)
rate   = passed / total * 100 if total > 0 else 0
print(f"  结果：{passed}/{total} 通过  ({rate:.0f}%)")
if passed == total:
    print("  \033[92m全部通过 ✓  v2.0 算法验证成功\033[0m")
else:
    failed = [name for name, ok in results if not ok]
    print(f"  \033[91m失败项：{', '.join(failed)}\033[0m")
print("═" * 55 + "\n")

sys.exit(0 if passed == total else 1)
