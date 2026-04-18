"""
解析115所高校官方就业质量年报PDF，导入到 school_employment 表。
运行: python3 import_employment_pdfs.py
"""
import os, re, sqlite3, json, glob, sys, time

try:
    import pdfplumber
except ImportError:
    os.system(f"{sys.executable} -m pip install pdfplumber -q")
    import pdfplumber

PDF_DIR = "/Users/Admin/Desktop/高考程序素材/00、志愿填报必备资料/6、全国各高校毕业生就业报告"
DB_PATH = os.path.join(os.path.dirname(__file__), "gaokao.db")

# ─────────────────────────────────────────────
# 解析函数
# ─────────────────────────────────────────────

def extract_float(pattern, text, default=None):
    m = re.search(pattern, text)
    if m:
        try:
            return float(m.group(1).replace(',', '').replace('，', ''))
        except:
            pass
    return default

def extract_year(text):
    """从全文中提取报告年份"""
    m = re.search(r'20(\d\d)[届年]', text)
    if m:
        return 2000 + int(m.group(1))
    return None

def extract_postgrad_rate(text):
    """提取本科生深造率（国内升学+出境）"""
    # "本科毕业生深造率为 XX.XX%"
    v = extract_float(r'深造率为?\s*(\d+\.?\d*)\s*%', text)
    if v: return round(v / 100, 4)
    # "整体升学率 XX%"
    v = extract_float(r'升学率[为是]?\s*(\d+\.?\d*)\s*%', text)
    if v: return round(v / 100, 4)
    return None

def extract_employment_rate(text):
    """提取就业率（协议就业 + 灵活就业）"""
    # "就业率为 XX.XX%" 或 "就业率 XX%"
    v = extract_float(r'就业率[为是]?\s*(\d+\.?\d*)\s*%', text)
    if v and v > 0: return round(v / 100, 4)
    # "总体就业率" / "毕业去向落实率"
    v = extract_float(r'去向落实率[为是]?\s*(\d+\.?\d*)\s*%', text)
    if v and v > 0: return round(v / 100, 4)
    return None

def extract_avg_salary(text):
    """提取平均薪资（元/月）"""
    # "平均月薪 XXXX 元" / "月均收入约 XXXX 元"
    v = extract_float(r'[平均月]+薪[约为是]?\s*[约]?\s*(\d[\d,，]+)\s*元', text)
    if v and v > 1000: return int(v)
    # "月收入 XXXX 元"
    v = extract_float(r'月收入[约为]?\s*(\d[\d,，]+)\s*元', text)
    if v and v > 1000: return int(v)
    # "薪酬[中位数/均值] XXXX"
    v = extract_float(r'薪酬[中位数均值为约是]?\s*[约]?\s*(\d[\d,.]+)', text)
    if v and v > 1000: return int(v)
    return None

def extract_satisfaction(text):
    """提取用人单位满意度（0-5标准化）"""
    # "总体满意度为 92.52%"
    v = extract_float(r'总体满意度为?\s*(\d+\.?\d*)\s*%', text)
    if v: return round(v / 100 * 5, 2)
    # "满意度 4.X/5"
    v = extract_float(r'满意度\s*(\d+\.?\d*)\s*/\s*5', text)
    if v: return round(float(v), 2)
    return None

def extract_top_employers(text):
    """提取顶级雇主列表（最多10家）"""
    employers = []
    # 匹配 "华为 414" / "华为，414人" 格式
    patterns = [
        r'([\u4e00-\u9fa5A-Za-z（）\(\)·]+?)\s+(\d+)\s*人',
        r'([\u4e00-\u9fa5A-Za-z（）\(\)·]{2,20})\s*[，,]\s*(\d+)\s*人',
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            name = m.group(1).strip()
            count = int(m.group(2))
            if count > 5 and len(name) >= 2 and '数据' not in name and '单位' not in name:
                employers.append({"name": name, "count": count})
    # 去重+排序
    seen = set()
    result = []
    for e in sorted(employers, key=lambda x: -x["count"]):
        if e["name"] not in seen:
            seen.add(e["name"])
            result.append(e["name"])
            if len(result) >= 10:
                break
    return result if result else None

def extract_top_industries(text):
    """提取主要就业行业（含占比）"""
    industries = []
    # "信息传输、软件和信息技术服务业 23.8%"
    for m in re.finditer(r'([\u4e00-\u9fa5、，和与]+业)\s+(\d+\.?\d*)\s*%', text):
        ind = m.group(1).strip()
        pct = float(m.group(2))
        if 2 <= pct <= 60 and len(ind) >= 3:
            industries.append({"name": ind, "pct": pct})
    if industries:
        industries.sort(key=lambda x: -x["pct"])
        return [x["name"] for x in industries[:5]]
    return None

def extract_top_cities(text):
    """提取主要就业城市"""
    cities = []
    # 常见城市名匹配
    CITIES = ["北京","上海","广州","深圳","杭州","南京","成都","武汉","西安","天津",
              "重庆","苏州","宁波","厦门","济南","长沙","郑州","青岛","无锡","合肥"]
    for city in CITIES:
        if city in text:
            cities.append(city)
    return cities[:5] if cities else None

def determine_employer_tier(employers_text):
    """判断雇主层级"""
    top_tier = ["华为","腾讯","阿里","字节","百度","美团","小米","京东","网易",
                "国家电网","中国移动","中国联通","中国电信","中石油","中石化",
                "中国银行","工商银行","建设银行","农业银行","招商银行"]
    if not employers_text:
        return "一般"
    for t in top_tier:
        if t in employers_text:
            return "头部"
    return "中等"

def parse_pdf(pdf_path):
    """解析单个PDF，返回就业数据字典"""
    school_name = os.path.splitext(os.path.basename(pdf_path))[0]
    result = {"school_name": school_name, "data_source": "官方就业质量报告"}

    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        return None, f"PDF读取失败: {e}"

    if len(full_text) < 100:
        return None, "文本提取失败（可能是扫描版）"

    # 提取各字段
    result["report_year"] = extract_year(full_text)
    result["postgrad_rate"] = extract_postgrad_rate(full_text)
    result["employment_rate"] = extract_employment_rate(full_text)
    result["avg_salary"] = extract_avg_salary(full_text)
    result["satisfaction"] = extract_satisfaction(full_text)
    result["top_employers"] = extract_top_employers(full_text)
    result["top_industries"] = extract_top_industries(full_text)
    result["top_cities"] = extract_top_cities(full_text)
    result["employer_tier"] = determine_employer_tier(full_text)

    return result, None

# ─────────────────────────────────────────────
# 主程序：导入到数据库
# ─────────────────────────────────────────────

def match_school(name, db_schools):
    """模糊匹配学校名（处理括号变体等）"""
    if name in db_schools:
        return name
    # 去括号变体：中国石油大学（北京）→ 中国石油大学
    bare = re.sub(r'[（(][^）)]+[）)]', '', name).strip()
    if bare in db_schools:
        return bare
    # 前向匹配
    for s in db_schools:
        if name in s or s in name:
            return s
    return None

def main():
    print(f"🔍 扫描PDF目录: {PDF_DIR}")
    pdfs = sorted(glob.glob(os.path.join(PDF_DIR, "*.pdf")))
    print(f"   找到 {len(pdfs)} 个PDF文件")

    conn = sqlite3.connect(DB_PATH, timeout=30)
    cur = conn.cursor()

    # 获取数据库中的学校名
    cur.execute("SELECT name FROM schools")
    db_schools = set(r[0] for r in cur.fetchall())
    print(f"   数据库学校数: {len(db_schools)}")

    # 检查 school_employment 表结构
    cur.execute("PRAGMA table_info(school_employment)")
    cols = {r[1] for r in cur.fetchall()}
    print(f"   employment表字段: {cols}")

    success, skipped, failed = 0, 0, 0
    results_log = []

    for pdf_path in pdfs:
        school_display = os.path.splitext(os.path.basename(pdf_path))[0]
        data, err = parse_pdf(pdf_path)

        if err:
            print(f"  ⚠️  {school_display}: {err}")
            failed += 1
            continue

        matched = match_school(data["school_name"], db_schools)
        if not matched:
            print(f"  ❓ {school_display}: 数据库中未找到")
            skipped += 1
            continue

        # 构建INSERT
        year = data.get("report_year") or 2023
        top_emp_json = json.dumps(data.get("top_employers") or [], ensure_ascii=False)
        top_ind_json = json.dumps(data.get("top_industries") or [], ensure_ascii=False)
        top_cities_json = json.dumps(data.get("top_cities") or [], ensure_ascii=False)

        # 删除旧的同校同年数据，插入新数据
        cur.execute("DELETE FROM school_employment WHERE school_name=? AND year=?", (matched, year))
        cur.execute("""INSERT INTO school_employment
            (school_name, year, avg_salary, employment_rate, top_employers, top_industries,
             top_cities, postgrad_rate, overseas_rate, top_employer_tier, data_source)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                matched,
                year,
                data.get("avg_salary"),
                data.get("employment_rate"),
                top_emp_json,
                top_ind_json,
                top_cities_json,
                data.get("postgrad_rate"),
                None,  # overseas_rate 单独字段，暂不提取
                data.get("employer_tier", "中等"),
                f"官方就业质量报告({year}届)",
            )
        )
        success += 1
        log = f"  ✅ {matched} ({year}届)"
        fields = []
        if data.get("avg_salary"): fields.append(f"月薪{data['avg_salary']}元")
        if data.get("employment_rate"): fields.append(f"就业率{data['employment_rate']*100:.1f}%")
        if data.get("postgrad_rate"): fields.append(f"深造率{data['postgrad_rate']*100:.1f}%")
        if data.get("top_employers"): fields.append(f"{len(data['top_employers'])}家雇主")
        if fields:
            log += f" → {', '.join(fields)}"
        print(log)
        results_log.append(log)

    conn.commit()
    conn.close()

    print(f"\n📊 结果汇总:")
    print(f"  成功导入: {success} 所")
    print(f"  未匹配:   {skipped} 所")
    print(f"  解析失败: {failed} 所")

    # 写结果日志
    with open("/tmp/pdf_import_log.txt", "w") as f:
        f.write("\n".join(results_log))
    print(f"\n📄 详细日志: /tmp/pdf_import_log.txt")

if __name__ == "__main__":
    main()
