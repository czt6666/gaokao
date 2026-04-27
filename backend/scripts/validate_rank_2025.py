"""
验证 2025 一分一段表入库质量
- 抽查各省关键分数点的位次是否与权威来源一致
- 检测数据完整性（行数、分数范围、单调性）
- 输出差异报告
"""
import sys, os, sqlite3
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

DB = os.path.join(os.path.dirname(__file__), "..", "gaokao.db")

# 权威抽查数据（来源：eol.cn 新闻报道 / 各省教育考试院公布）
# 格式: (省份, category, 分数, 期望累计人数, 来源备注)
BENCHMARKS = [
    ("北京",   "综合",   650, 2850,   "北京2025 650分约2850名"),
    ("北京",   "综合",   600, 11883,  "北京2025 600分11883名（已知）"),
    ("北京",   "综合",   430, 53994,  "北京2025 本科线430分53994人过线"),
    ("天津",   "综合",   600, 8000,   "天津2025 600分约8000名"),
    ("天津",   "综合",   476, 47173,  "天津2025 本科线476分47173人过线"),
    ("河南",   "物理类", 600, 45887,  "河南2025 物理600分45887名"),
    ("河南",   "物理类", 427, 348358, "河南2025 物理本科线427分348358人过线"),
    ("河南",   "历史类", 471, 90174,  "河南2025 历史本科线471分90174人过线"),
    ("山东",   "综合",   441, 333469, "山东2025 一段线441分333469人过线"),
    ("江苏",   "物理类", 600, 34888,  "江苏2025 物理600分34888名"),
    ("江苏",   "历史类", 600, 5796,   "江苏2025 历史600分5796名"),
    ("江苏",   "物理类", 463, 187958, "江苏2025 物理本科线463分187958人过线"),
    ("安徽",   "物理类", 461, 191416, "安徽2025 物理本科线461分191416人过线"),
    ("安徽",   "历史类", 477, 44750,  "安徽2025 历史本科线477分44750人过线"),
    ("福建",   "物理类", 441, None,   "福建2025 物理本科线441分"),
    ("湖南",   "物理类", 405, 211431, "湖南2025 物理本科线405分211431人过线"),
    ("湖南",   "历史类", 446, 53081,  "湖南2025 历史本科线446分53081人过线"),
    ("广西",   "物理类", 370, 175515, "广西2025 物理本科线370分175515人过线"),
    ("广西",   "历史类", 402, 53615,  "广西2025 历史本科线402分53615人过线"),
    ("四川",   "物理类", 438, None,   "四川2025 物理本科线438分"),
    ("四川",   "历史类", 467, None,   "四川2025 历史本科线467分"),
    ("陕西",   "物理类", 394, 128434, "陕西2025 物理本科线394分128434人过线"),
    ("陕西",   "历史类", 414, 42832,  "陕西2025 历史本科线414分42832人过线"),
    ("甘肃",   "物理类", 374, None,   "甘肃2025 物理本科线374分"),
    ("青海",   "物理类", 325, None,   "青海2025 物理本科线325分"),
    ("宁夏",   "物理类", 372, 30025,  "宁夏2025 物理本科线372分30025人过线"),
    ("宁夏",   "历史类", 404, None,   "宁夏2025 历史本科线404分"),
    ("内蒙古", "物理类", 375, 68528,  "内蒙古2025 物理本科线375分68528人过线"),
    ("内蒙古", "历史类", 418, 20570,  "内蒙古2025 历史本科线418分20570人过线"),
    ("黑龙江", "物理类", 360, 85313,  "黑龙江2025 物理本科线360分85313人过线"),
    ("黑龙江", "历史类", 405, 22977,  "黑龙江2025 历史本科线405分22977人过线"),
    ("吉林",   "物理类", 340, 69405,  "吉林2025 物理本科线340分69405人过线"),
    ("吉林",   "历史类", 384, 21618,  "吉林2025 历史本科线384分21618人过线"),
    ("海南",   "综合",   480, None,   "海南2025 本科线480分"),
]


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    print("=" * 70)
    print("2025 一分一段表 入库验证报告")
    print("=" * 70)

    # 1. 各省数据覆盖统计
    print("\n【1. 各省数据覆盖】")
    cur.execute("SELECT province, category, COUNT(*), MIN(score), MAX(score) FROM rank_tables WHERE year=2025 GROUP BY province, category ORDER BY province, category")
    rows = cur.fetchall()
    total_rows = sum(r[2] for r in rows)
    print(f"2025 年共 {len(rows)} 个 (省份,科类) 组合，总计 {total_rows} 条记录")
    print(f"{'省份':8s}{'科类':8s}{'行数':>8s}{'最低分':>8s}{'最高分':>8s}")
    print("-" * 50)
    for prov, cat, cnt, lo, hi in rows:
        print(f"{prov:8s}{cat:8s}{cnt:>8d}{lo:>8d}{hi:>8d}")

    # 2. 抽查位次
    print("\n【2. 关键分数点抽查】")
    print(f"{'省份':8s}{'科类':8s}{'分数':>6s}{'DB位次':>10s}{'期望位次':>10s}{'偏差':>10s}{'备注'}")
    print("-" * 90)
    mismatches = 0
    for prov, cat, score, expected, note in BENCHMARKS:
        cur.execute("SELECT count_cum FROM rank_tables WHERE province=? AND year=2025 AND category=? AND score=?", (prov, cat, score))
        row = cur.fetchone()
        if row is None:
            # fallback: 取 ≤ 该分数的最高档
            cur.execute("SELECT score, count_cum FROM rank_tables WHERE province=? AND year=2025 AND category=? AND score<=? ORDER BY score DESC LIMIT 1", (prov, cat, score))
            row = cur.fetchone()
            actual = row[1] if row else None
            actual_score = row[0] if row else None
            flag = "MISSING"
        else:
            actual = row[0]
            actual_score = score
            flag = "OK"

        if expected is not None and actual is not None:
            diff = actual - expected
            if abs(diff) > max(50, expected * 0.005):
                flag = f"MISMATCH({diff:+d})"
                mismatches += 1
            else:
                flag = "OK"
        elif actual is None:
            flag = "NO_DATA"
            mismatches += 1

        exp_str = str(expected) if expected is not None else "-"
        act_str = str(actual) if actual is not None else "-"
        diff_str = str(actual - expected) if (actual and expected) else "-"
        print(f"{prov:8s}{cat:8s}{score:>6d}{act_str:>10s}{exp_str:>10s}{diff_str:>10s}  {note}")

    # 3. 单调性检测
    print("\n【3. 累计人数单调性检测】")
    cur.execute("SELECT province, category, score, count_cum FROM rank_tables WHERE year=2025 ORDER BY province, category, score DESC")
    prev = (None, None, None)
    mono_issues = 0
    for prov, cat, score, cum in cur.fetchall():
        if (prov, cat) != prev[:2]:
            prev = (prov, cat, cum)
            continue
        if cum < prev[2]:
            mono_issues += 1
            if mono_issues <= 5:
                print(f"  ⚠ {prov}/{cat} 分数{score}: 累计{cum} < 上一档{prev[2]}")
        prev = (prov, cat, cum)
    if mono_issues == 0:
        print("  ✅ 全部单调递增")
    else:
        print(f"  共 {mono_issues} 处单调异常")

    # 4. 缺失省份
    print("\n【4. 2025 数据缺失省份】")
    ALL_PROVINCES = ["北京","天津","上海","重庆","河北","河南","山西","山东","江苏","浙江","安徽","福建","江西","湖北","湖南","广东","广西","海南","四川","贵州","云南","陕西","甘肃","青海","宁夏","内蒙古","黑龙江","辽宁","吉林","新疆","西藏"]
    cur.execute("SELECT DISTINCT province FROM rank_tables WHERE year=2025")
    have = {r[0] for r in cur.fetchall()}
    missing = [p for p in ALL_PROVINCES if p not in have]
    if missing:
        print(f"  缺失: {', '.join(missing)} ({len(missing)}个)")
    else:
        print("  ✅ 全部覆盖")

    print("\n" + "=" * 70)
    print(f"总结: 抽查项 {len(BENCHMARKS)}，异常 {mismatches}，单调问题 {mono_issues}，缺失省份 {len(missing)}")
    print("=" * 70)
    conn.close()


if __name__ == "__main__":
    main()
