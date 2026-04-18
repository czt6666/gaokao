"""
导入行业薪酬基准数据（Michael Page 2026）
==========================================
将 Michael Page 薪酬报告的490条行业×职位薪资数据
写入 industry_salary_benchmark 表，供推荐算法使用。

用途：
1. 冷门专业的 B-type gem 评分：专业对口行业薪资越高，B型冷门价值越大
2. 报告中展示"该专业对口行业薪资水平"
3. 不再依赖虚假的官方就业率，而是用行业真实薪资做参考

运行：
  python3 scrapers/import_industry_salary.py
"""
from __future__ import annotations

import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal, engine
from sqlalchemy import text, Column, Integer, String, Float
from sqlalchemy.orm import Session

# ── 1. 建表 ─────────────────────────────────────────────────
def ensure_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS industry_salary_benchmark (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                industry TEXT NOT NULL,
                position TEXT NOT NULL,
                salary_low_annual_k REAL,
                salary_high_annual_k REAL,
                salary_mid_annual_k REAL,
                data_source TEXT DEFAULT '行业薪酬基准(2026)',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS industry_summary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                industry TEXT UNIQUE NOT NULL,
                position_count INTEGER,
                salary_p25_annual_k REAL,
                salary_median_annual_k REAL,
                salary_p75_annual_k REAL,
                salary_max_annual_k REAL,
                grad_monthly_estimate INTEGER,
                data_source TEXT DEFAULT '行业薪酬基准(2026)',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()
    print("✅ 表 industry_salary_benchmark / industry_summary 已就绪")


# ── 2. 导入明细 ──────────────────────────────────────────────
def import_details():
    data_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                             "data", "michael_page_salary_2026.json")
    with open(data_path) as f:
        records = json.load(f)

    db = SessionLocal()
    # 清空旧数据
    db.execute(text("DELETE FROM industry_salary_benchmark"))

    for r in records:
        db.execute(text("""
            INSERT INTO industry_salary_benchmark
            (industry, position, salary_low_annual_k, salary_high_annual_k, salary_mid_annual_k, data_source)
            VALUES (:ind, :pos, :low, :high, :mid, :src)
        """), {
            "ind": r["industry"],
            "pos": r["position"],
            "low": r["salary_low_k"],
            "high": r["salary_high_k"],
            "mid": r["salary_mid_k"],
            "src": "行业薪酬基准(2026)",
        })

    db.commit()
    print(f"✅ 导入 {len(records)} 条行业×职位薪资记录")
    db.close()


# ── 3. 生成行业汇总 ──────────────────────────────────────────
def build_summary():
    db = SessionLocal()
    db.execute(text("DELETE FROM industry_summary"))

    rows = db.execute(text("""
        SELECT industry,
               COUNT(*) as cnt,
               salary_low_annual_k,
               salary_mid_annual_k,
               salary_high_annual_k
        FROM industry_salary_benchmark
        GROUP BY industry
    """)).fetchall()

    # Need to compute percentiles per industry
    industries = db.execute(text("SELECT DISTINCT industry FROM industry_salary_benchmark")).fetchall()

    for (ind,) in industries:
        salaries = db.execute(text("""
            SELECT salary_low_annual_k, salary_mid_annual_k, salary_high_annual_k
            FROM industry_salary_benchmark
            WHERE industry = :ind
            ORDER BY salary_mid_annual_k
        """), {"ind": ind}).fetchall()

        n = len(salaries)
        mids = sorted([s[1] for s in salaries])
        lows = sorted([s[0] for s in salaries])

        p25 = mids[n // 4]
        median = mids[n // 2]
        p75 = mids[3 * n // 4]
        max_sal = max(s[2] for s in salaries)

        # 应届生月薪估算（已用上市公司真实招聘数据校准）
        # 优先用上市公司数据直接映射，兜底用 Michael Page P25 × 0.45
        _REAL_GRAD = {
            "科技": 11500, "半导体": 11500, "银行与金融服务": 7500,
            "工程与制造": 8500, "医疗与生命科学": 8500, "财务与会计": 6500,
            "市场营销与电商": 8000, "法务": 7750, "人力资源与行政助理": 7000,
            "销售与零售": 8500, "采购与供应链": 7000,
        }
        grad_monthly = _REAL_GRAD.get(ind, int(lows[n // 4] * 1000 / 12 * 0.45))
        # 下限保护
        grad_monthly = max(grad_monthly, 4500)

        db.execute(text("""
            INSERT INTO industry_summary
            (industry, position_count, salary_p25_annual_k, salary_median_annual_k,
             salary_p75_annual_k, salary_max_annual_k, grad_monthly_estimate, data_source)
            VALUES (:ind, :cnt, :p25, :med, :p75, :max, :grad, :src)
        """), {
            "ind": ind, "cnt": n, "p25": p25, "med": median,
            "p75": p75, "max": max_sal, "grad": grad_monthly,
            "src": "行业薪酬基准(2026)",
        })

        print(f"  {ind}: {n}职位, P25={p25}k, 中位={median}k, P75={p75}k, 应届估≈¥{grad_monthly:,}/月")

    db.commit()
    db.close()
    print("✅ 行业汇总已生成")


# ── 4. 专业→行业映射表 ───────────────────────────────────────
def build_major_mapping():
    """建立专业关键词→行业的映射表"""
    db = SessionLocal()

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS major_industry_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            industry TEXT NOT NULL,
            priority INTEGER DEFAULT 0
        )
    """))
    db.execute(text("DELETE FROM major_industry_map"))

    mappings = [
        # 科技
        ("计算机", "科技", 10), ("软件", "科技", 10), ("信息工程", "科技", 10),
        ("数据科学", "科技", 10), ("人工智能", "科技", 10), ("网络工程", "科技", 10),
        ("物联网", "科技", 10), ("自动化", "科技", 8), ("智能", "科技", 8),
        ("通信", "科技", 9), ("电子信息", "科技", 9), ("网络安全", "科技", 10),
        ("大数据", "科技", 10), ("机器人", "科技", 9), ("云计算", "科技", 10),
        # 半导体
        ("微电子", "半导体", 10), ("集成电路", "半导体", 10), ("半导体", "半导体", 10),
        ("芯片", "半导体", 10), ("光电", "半导体", 8),
        # 工程与制造
        ("机械", "工程与制造", 10), ("材料", "工程与制造", 8), ("土木", "工程与制造", 10),
        ("建筑", "工程与制造", 9), ("制造", "工程与制造", 10), ("车辆", "工程与制造", 9),
        ("航空", "工程与制造", 9), ("船舶", "工程与制造", 9), ("能源", "工程与制造", 8),
        ("化工", "工程与制造", 9), ("冶金", "工程与制造", 9), ("矿业", "工程与制造", 9),
        ("水利", "工程与制造", 9), ("环境工程", "工程与制造", 8), ("交通", "工程与制造", 8),
        ("电气", "工程与制造", 9),
        # 银行与金融服务
        ("金融", "银行与金融服务", 10), ("经济", "银行与金融服务", 8),
        ("投资", "银行与金融服务", 10), ("保险", "银行与金融服务", 10),
        ("精算", "银行与金融服务", 10),
        # 财务与会计
        ("会计", "财务与会计", 10), ("财务", "财务与会计", 10),
        ("审计", "财务与会计", 10), ("税务", "财务与会计", 10),
        # 医疗与生命科学
        ("临床", "医疗与生命科学", 10), ("医学", "医疗与生命科学", 9),
        ("药学", "医疗与生命科学", 10), ("护理", "医疗与生命科学", 9),
        ("口腔", "医疗与生命科学", 10), ("中医", "医疗与生命科学", 9),
        ("公共卫生", "医疗与生命科学", 9), ("生物", "医疗与生命科学", 7),
        ("康复", "医疗与生命科学", 9), ("检验", "医疗与生命科学", 9),
        # 法务
        ("法学", "法务", 10), ("法律", "法务", 10), ("知识产权", "法务", 10),
        # 市场营销与电商
        ("市场营销", "市场营销与电商", 10), ("电子商务", "市场营销与电商", 10),
        ("广告", "市场营销与电商", 9), ("传播", "市场营销与电商", 8),
        ("新闻", "市场营销与电商", 7), ("传媒", "市场营销与电商", 8),
        # 人力资源与行政助理
        ("人力资源", "人力资源与行政助理", 10), ("行政管理", "人力资源与行政助理", 9),
        ("公共管理", "人力资源与行政助理", 8),
        # 采购与供应链
        ("物流", "采购与供应链", 10), ("供应链", "采购与供应链", 10),
        ("国际贸易", "采购与供应链", 8),
        # 销售与零售
        ("工商管理", "销售与零售", 7), ("商务", "销售与零售", 8),
    ]

    for kw, ind, pri in mappings:
        db.execute(text("""
            INSERT INTO major_industry_map (keyword, industry, priority)
            VALUES (:kw, :ind, :pri)
        """), {"kw": kw, "ind": ind, "pri": pri})

    db.commit()
    db.close()
    print(f"✅ 专业→行业映射 {len(mappings)} 条已写入")


if __name__ == "__main__":
    ensure_table()
    import_details()
    build_summary()
    build_major_mapping()
    print("\n🎉 全部完成！")
