"""
动态冷门评分引擎 v1.0
=====================
基于本地录取数据库动态计算每个专业的"被低估程度"。

替代思路：不依赖外部API，完全用本地已有数据推导：
  - 用"平均录取位次"反映市场报考热度（位次低=无人报=认知冷）
  - 用"平均薪资/就业率"反映真实价值
  - 两者差距越大 → 冷门程度越高

四维公式：
  ColdScore = 认知差距×0.30 + 薪资错配×0.25 + 产业动能×0.25 + 供需比×0.20

用法：
  from algorithms.cold_score_engine import get_cold_scores, get_major_cold_score
  scores = get_cold_scores(db)        # 全量计算（带缓存）
  s = get_major_cold_score("核工程与核技术", db)  # 单专业查询
"""
import math
import json
import os
import time
import logging
from typing import Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, text

log = logging.getLogger(__name__)

CACHE_FILE = os.path.join(os.path.dirname(__file__), ".cold_scores_cache.json")
CACHE_TTL  = 86400 * 3   # 3天有效期

# ── 产业动能表（2026届→2030年毕业）────────────────────────────
# ⚠️ 数据来源说明（2026-04-07更新）：
# 1. A股上市公司2021→2024年真实招聘量变化率（2100万条招聘数据）
# 2. 2025年Q1最新岗位薪资水平（AI中位¥16k / 自动驾驶¥21.5k）
# 3. 国家政策文件（十四五/十五五重点产业）
# 4. 3篇顶刊论文结论（《管理世界》《经济研究》《中国管理科学》）
#
# 评分逻辑：
# - 基础分 = 行业招聘量变化率映射（暴跌→低，扩张→高）
# - 调节因子 = 政策支持力度 + 2025年薪资水平 + 硕士溢价大小
# 专业关键词 → 动能分（0-100）
INDUSTRY_MOMENTUM_2030: Dict[str, int] = {
    # ── 国家战略级（90-100）── 政策强支持 + 供给极稀缺
    "低空经济": 95, "无人机": 95, "eVTOL": 95,
    "核工程": 92, "核技术": 92, "核能": 92, "核电": 92,
    "飞行器": 90, "航空宇航": 90, "航空发动机": 90,
    "海洋工程": 88, "深海": 88, "水下机器人": 88,
    "集成电路": 88, "微电子": 88, "芯片": 88,  # 上市公司数据：应届中位¥11,500，硕士溢价+65%
    # ── 双碳/新能源（82-90）── 招聘量虽收缩26%但仍是招聘主力+薪资高
    "新能源材料": 88, "储能": 86, "碳中和": 84,
    "新能源": 85, "光伏": 83, "氢能": 85,   # 上市公司数据：2025年新能源岗中位¥15,000
    "锂电": 84, "固态电池": 86,
    "材料科学": 80, "先进材料": 82,
    # ── 生物医疗（78-85）── 招聘量收缩36%但硕士溢价高达67%
    "生物医学工程": 83, "医疗器械": 82,
    "基因": 85, "合成生物": 86, "生物制药": 83,  # 上市公司：创新药岗41%要求硕博
    "预防医学": 80, "公共卫生": 79,
    "放射医学": 82, "核医学": 81,
    # ── AI/数字（75-85）── 2025年AI岗中位¥16k，但软件业招聘量暴跌86%需分化
    "自动驾驶": 88,  # 上市公司数据：2025年中位¥21,500
    "人工智能": 82, "机器学习": 82, "深度学习": 82,  # 技能溢价+94%
    "遥感": 82, "地理信息": 80, "空间信息": 80,
    "智能制造": 80, "工业互联网": 78,
    "机器人": 80,  # 上市公司数据：2025年机器人岗中位¥13,500
    "光电": 79, "激光": 78, "量子": 82,
    "大数据": 75, "数据科学": 75,  # 上市公司数据：中位¥12,500但供给增长快
    # ── 传统但稳健（60-75）── 有真实需求，薪资中等
    "统计学": 72, "应用统计": 72, "精算": 74,
    "信息管理": 68, "工程管理": 67,
    "地球物理": 74, "资源勘查": 73, "石油工程": 72,
    "电气": 73, "自动化": 72,  # 上市公司：电气/自动化中位¥9,750，硕士溢价+67%
    "机械": 68,  # 上市公司：机械中位¥9,000，稳健但不突出
    "水利": 68, "水文": 67,
    "化工": 65, "化学": 65,  # 上市公司：化工中位¥8,500
    "哲学": 62, "汉语言": 60, "历史": 58,
    "农业资源": 70, "林学": 72, "碳汇": 78,
    "农业机械": 74, "智慧农业": 76,
    "航海": 75, "船舶": 72,
    "工业设计": 65, "工程力学": 68,
    "知识产权": 73,
    "环境工程": 63, "环保": 63,  # 上市公司：环保/安全中位¥7,500
    # ── 供给过剩/收缩（25-55）── 上市公司招聘量数据实证
    "软件工程": 48, "计算机科学": 46,   # 软件业招聘2021→2024暴跌86%，内卷严重
    "电子商务": 42, "市场营销": 40,
    "土木工程": 30, "建筑学": 33,  # 房地产业招聘暴跌82%
    "房地产": 15, "工程造价": 25,
    "金融学": 42, "证券": 40, "投资学": 42,  # 上市公司数据：应届金融中位仅¥7,500
    "会计": 38, "财务": 38,  # 上市公司数据：中位¥6,500，供严重过剩
    "法学": 50,   # 上市公司：法务中位¥7,750，但公务员赛道仍有优势
    "新闻": 38, "广播电视": 35,
    "旅游管理": 35, "酒店管理": 32,
    "零售": 30,  # 零售业招聘暴跌71%
}

DEFAULT_MOMENTUM = 55   # 未匹配专业的默认产业动能分


def _sigmoid(x: float) -> float:
    """标准Sigmoid，输出0-1"""
    x = max(-10.0, min(10.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def _percentile_rank(values: list, target: float) -> float:
    """计算target在values列表中的百分位排名（0-1，越高越靠前）"""
    if not values:
        return 0.5
    sorted_v = sorted(values)
    pos = sum(1 for v in sorted_v if v <= target)
    return pos / len(sorted_v)


def _industry_momentum(major_name: str) -> int:
    """按专业名匹配产业动能分"""
    for keyword, score in INDUSTRY_MOMENTUM_2030.items():
        if keyword in major_name:
            return score
    return DEFAULT_MOMENTUM


def compute_major_cold_scores(db: Session) -> Dict[str, dict]:
    """
    计算所有专业的冷门评分。
    返回：{专业名: {score, components, rank_in_all}}
    """
    log.info("开始计算动态冷门评分...")

    # ── 1. 从录取数据拉取各专业的平均录取位次（代理报考热度）────
    sql_rank = text("""
        SELECT major_name,
               AVG(min_rank)    AS avg_rank,
               COUNT(*)         AS data_count,
               AVG(admit_count) AS avg_plan
        FROM admission_records
        WHERE min_rank > 0 AND year >= 2022
        GROUP BY major_name
        HAVING COUNT(*) >= 3
    """)
    rank_rows = db.execute(sql_rank).fetchall()
    major_ranks = {r.major_name: (r.avg_rank, r.data_count, r.avg_plan or 0)
                   for r in rank_rows}

    # ── 2. 从就业数据拉取各专业薪资 ──────────────────────────────
    sql_sal = text("""
        SELECT major_name,
               AVG(avg_salary)    AS avg_sal,
               AVG(satisfaction)  AS avg_sat,
               AVG(employment_rate) AS avg_emp
        FROM major_employment
        WHERE avg_salary > 0
        GROUP BY major_name
    """)
    sal_rows = db.execute(sql_sal).fetchall()
    major_salaries = {r.major_name: (r.avg_sal or 0, r.avg_sat or 0, r.avg_emp or 0)
                      for r in sal_rows}

    if not major_ranks:
        log.warning("录取数据为空，无法计算冷门分")
        return {}

    # ── 3. 计算百分位分布 ─────────────────────────────────────────
    all_ranks   = [v[0] for v in major_ranks.values()]
    all_salaries = [v[0] for v in major_salaries.values() if v[0] > 0]

    results = {}
    for major_name, (avg_rank, data_cnt, avg_plan) in major_ranks.items():
        # ① 认知差距分（recognition_gap）
        # 录取位次高（数字大）= 报考热度低（因为越容易进）
        # 位次百分位（低位次=热门）
        rank_pct = _percentile_rank(all_ranks, avg_rank)  # 越高=位次越大=越冷门

        sal, sat, emp = major_salaries.get(major_name, (0, 0, 0))
        if sal > 0 and all_salaries:
            sal_pct = _percentile_rank(all_salaries, sal)  # 薪资百分位（越高越好）
        else:
            sal_pct = 0.4  # 无薪资数据时给中等

        # 认知差距 = 薪资好 但 位次低（位次大=便宜=冷）
        gap = sal_pct - (1.0 - rank_pct)   # 正值=被低估，负值=过热
        recognition_gap_score = min(100, max(0, (gap + 0.5) * 100))

        # ② 薪资错配分（salary_mismatch）
        # 在所有专业中，薪资排名 vs 录取难度排名的差异
        if sal > 0:
            sal_rank_among_all = _percentile_rank(all_salaries, sal)
            admit_rank_pct = 1.0 - rank_pct  # 反转：位次小=难进=热门 → pct高
            mismatch = sal_rank_among_all - admit_rank_pct
            salary_mismatch_score = min(100, max(0, (_sigmoid(mismatch * 8) * 100)))
        else:
            salary_mismatch_score = 40.0  # 无数据给中偏低分

        # ③ 产业动能分
        momentum = _industry_momentum(major_name)

        # ④ 供需比分（用招生计划量反推供给规模）
        # 计划人数少的专业，全国毕业生少，供给端稀缺
        if avg_plan > 0:
            # 对数压缩：计划越少得分越高（供给稀缺）
            # 5人=90, 15人=75, 30人=60, 100人=40
            supply_score = max(20, min(95, 95 - math.log(avg_plan + 1) * 15))
        else:
            supply_score = 55.0

        # 综合加权
        cold_score = (
            recognition_gap_score  * 0.30 +
            salary_mismatch_score  * 0.25 +
            momentum               * 0.25 +
            supply_score           * 0.20
        )

        results[major_name] = {
            "score":  round(cold_score, 1),
            "components": {
                "recognition_gap":    round(recognition_gap_score, 1),
                "salary_mismatch":    round(salary_mismatch_score, 1),
                "industry_momentum":  momentum,
                "supply_scarcity":    round(supply_score, 1),
            },
            "data_points": {
                "avg_rank":   round(avg_rank),
                "avg_salary": round(sal),
                "data_count": data_cnt,
            }
        }

    # 添加全局排名
    sorted_majors = sorted(results.items(), key=lambda x: -x[1]["score"])
    total = len(sorted_majors)
    for rank_i, (mname, mdata) in enumerate(sorted_majors):
        mdata["rank_in_all"]   = rank_i + 1
        mdata["total_majors"]  = total
        mdata["top_pct"] = round((rank_i + 1) / total * 100, 1)

    log.info(f"冷门评分完成，共 {total} 个专业")
    return results


def _load_cache() -> Optional[Dict]:
    """读取缓存"""
    if not os.path.exists(CACHE_FILE):
        return None
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if time.time() - data.get("_ts", 0) < CACHE_TTL:
            return data.get("scores", {})
    except Exception:
        pass
    return None


def _save_cache(scores: Dict):
    """保存缓存"""
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"_ts": time.time(), "scores": scores}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning(f"缓存写入失败: {e}")


# 全局内存缓存（进程内）
_MEM_CACHE: Optional[Dict] = None
_MEM_CACHE_TS: float = 0.0


def get_cold_scores(db: Session, force_recompute: bool = False) -> Dict[str, dict]:
    """
    获取全量冷门评分（带三级缓存：内存→文件→实时计算）
    """
    global _MEM_CACHE, _MEM_CACHE_TS

    if not force_recompute:
        # 内存缓存（最快）
        if _MEM_CACHE and time.time() - _MEM_CACHE_TS < CACHE_TTL:
            return _MEM_CACHE
        # 文件缓存
        cached = _load_cache()
        if cached:
            _MEM_CACHE = cached
            _MEM_CACHE_TS = time.time()
            return _MEM_CACHE

    # 重新计算
    scores = compute_major_cold_scores(db)
    _save_cache(scores)
    _MEM_CACHE = scores
    _MEM_CACHE_TS = time.time()
    return scores


def get_major_cold_score(major_name: str, db: Session) -> Optional[dict]:
    """
    获取单个专业的冷门评分。
    返回 None 表示该专业数据不足，无法评分。
    """
    scores = get_cold_scores(db)
    # 精确匹配
    if major_name in scores:
        return scores[major_name]
    # 模糊匹配（专业名包含关系）
    for name, data in scores.items():
        if major_name in name or name in major_name:
            return data
    return None


def get_top_cold_majors(db: Session, top_n: int = 30) -> list:
    """返回冷门程度最高的前N个专业（用于展示/调试）"""
    scores = get_cold_scores(db)
    sorted_list = sorted(scores.items(), key=lambda x: -x[1]["score"])
    return [(name, data) for name, data in sorted_list[:top_n]]


# ── CLI调试入口 ───────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from database import SessionLocal
    import argparse

    parser = argparse.ArgumentParser(description="动态冷门评分引擎")
    parser.add_argument("--top", type=int, default=30, help="显示前N个冷门专业")
    parser.add_argument("--major", type=str, default="", help="查询单个专业")
    parser.add_argument("--rebuild", action="store_true", help="强制重新计算")
    args = parser.parse_args()

    db = SessionLocal()
    if args.major:
        result = get_major_cold_score(args.major, db)
        if result:
            print(f"\n【{args.major}】冷门评分：{result['score']}/100")
            print(f"全国排名：第 {result['rank_in_all']}/{result['total_majors']} （前{result['top_pct']}%）")
            c = result["components"]
            print(f"  认知差距分：{c['recognition_gap']}")
            print(f"  薪资错配分：{c['salary_mismatch']}")
            print(f"  产业动能分：{c['industry_momentum']}")
            print(f"  供给稀缺分：{c['supply_scarcity']}")
            d = result["data_points"]
            print(f"  平均录取位次：{d['avg_rank']:,}")
            print(f"  平均薪资：{d['avg_salary']:,}元/月")
        else:
            print(f"未找到专业：{args.major}（数据不足）")
    else:
        top = get_top_cold_majors(db, top_n=args.top)
        print(f"\n{'='*65}")
        print(f"{'排名':<5} {'专业名':<18} {'冷门分':<8} {'认知差距':<8} {'薪资错配':<8} {'产业动能':<8}")
        print(f"{'='*65}")
        for i, (name, data) in enumerate(top):
            c = data["components"]
            print(f"{i+1:<5} {name:<18} {data['score']:<8.1f} "
                  f"{c['recognition_gap']:<8.1f} {c['salary_mismatch']:<8.1f} {c['industry_momentum']:<8}")
    db.close()
