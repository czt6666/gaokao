#!/usr/bin/env python3
"""生成水卢冷门高报引擎产品说明书 PDF"""

from fpdf import FPDF
import os

class PDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font('NotoSans', '', 9)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, '水卢冷门高报引擎 · 产品说明书', 0, 0, 'R')
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('NotoSans', '', 9)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f'第 {self.page_no()} 页', 0, 0, 'C')

    def chapter_title(self, title, subtitle=""):
        self.set_font('NotoSans', 'B', 16)
        self.set_text_color(26, 39, 68)
        self.cell(0, 12, title, 0, 1, 'L')
        if subtitle:
            self.set_font('NotoSans', '', 10)
            self.set_text_color(110, 110, 115)
            self.cell(0, 6, subtitle, 0, 1, 'L')
        self.ln(2)

    def body_text(self, text, bold=False):
        self.set_font('NotoSans', 'B' if bold else '', 11)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 7, text)
        self.ln(2)

    def bullet(self, text, indent=True):
        self.set_font('NotoSans', '', 10.5)
        self.set_text_color(40, 40, 40)
        x = self.l_margin + (5 if indent else 0)
        self.set_x(x)
        avail = self.w - self.r_margin - x
        self.multi_cell(avail, 6.5, f"- {text}")

    def highlight_box(self, text):
        self.set_fill_color(250, 250, 248)
        self.set_draw_color(230, 230, 230)
        self.set_font('NotoSans', '', 10.5)
        self.set_text_color(26, 39, 68)
        self.multi_cell(0, 7, text, border=1, fill=True)
        self.ln(3)


pdf = PDF()

# 注册中文字体（系统常见路径）
font_paths = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
font_registered = False
for fp in font_paths:
    if os.path.exists(fp):
        pdf.add_font("NotoSans", "", fp, uni=True)
        pdf.add_font("NotoSans", "B", fp, uni=True)
        font_registered = True
        break

if not font_registered:
    # 回退：找一个任意 ttf/ttc
    import subprocess
    try:
        r = subprocess.run(["fc-list", ":lang=zh", "file"], capture_output=True, text=True)
        if r.stdout:
            first = r.stdout.strip().split(":")[0].strip()
            if os.path.exists(first):
                pdf.add_font("NotoSans", "", first, uni=True)
                pdf.add_font("NotoSans", "B", first, uni=True)
                font_registered = True
    except Exception:
        pass

if not font_registered:
    raise RuntimeError("找不到中文字体，请安装 NotoSans CJK 或 PingFang 字体")

pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()

# ========== 封面 ==========
pdf.set_font('NotoSans', 'B', 24)
pdf.set_text_color(26, 39, 68)
pdf.cell(0, 30, '', 0, 1, 'C')
pdf.cell(0, 18, '水卢冷门高报引擎', 0, 1, 'C')
pdf.set_font('NotoSans', '', 13)
pdf.set_text_color(110, 110, 115)
pdf.cell(0, 12, '高考志愿智能决策系统 · 产品说明书', 0, 1, 'C')
pdf.ln(20)

pdf.set_font('NotoSans', '', 10.5)
pdf.set_text_color(80, 80, 80)
pdf.multi_cell(0, 7, "    输入你的高考位次，我们不仅告诉你「能去哪些学校」，更重要的是发现「同样分数里，别人看不到的冷门好校」。覆盖 3,217 所高校、31 个省份、三种高考模式，融合 8 年录取数据 + 真实就业数据 + 学生口碑，让每一分都不浪费。", align='C')

pdf.ln(30)
pdf.set_font('NotoSans', '', 9)
pdf.set_text_color(150, 150, 150)
pdf.cell(0, 10, 'www.theyuanxi.cn', 0, 1, 'C')

# ========== 产品定位 ==========
pdf.add_page()
pdf.chapter_title("产品定位", "一句话说清楚我们在做什么")

pdf.body_text("传统志愿工具做的是「排队」——你考了多少分，系统按往年分数线给你排一个能去的学校列表。")
pdf.body_text("水卢做的是「套利」——在同一分数段里，用概率模型 + 真实就业数据 + 学生口碑，帮你找出被市场低估、但实际价值更高的学校和专业。")

pdf.highlight_box("核心差异：传统工具告诉你「能去哪」，水卢告诉你「去哪更值」。")

# ========== 适合谁 ==========
pdf.chapter_title("适合谁用", "不分文科理科，覆盖全部考生")

pdf.body_text("所有参加中国高考的考生和家长均可使用。系统支持三种高考模式：")
pdf.bullet("3+1+2 模式（23 省）：物理/历史首选 + 再选 2 门")
pdf.bullet("3+3 模式（6 省）：北京、天津、山东、上海、浙江、海南")
pdf.bullet("传统文理模式：新疆、西藏")
pdf.ln(2)

pdf.body_text("文科生和理科生都能获得精准推荐。系统会根据你的选科组合自动过滤，文科生不会收到仅限物理/化学的专业推荐。")

pdf.highlight_box("水卢的冷门算法词表里包含大量文科优质冷门专业：图书馆学、档案学、考古学、民族学、汉语言文学、社会学等，都是「名字听起来一般，但就业出路不差」的典型。")

# ========== 核心功能 ==========
pdf.add_page()
pdf.chapter_title("核心功能", "五大模块，从查分到填志愿一站式完成")

items = [
    ("1. 录取概率精算", "输入位次 + 省份 + 选科，系统基于 8 年历史录取数据、考生人数波动、大小年检测，给出每所学校的录取概率区间（如 63% [55%-71%]），并自动标注「冲、稳、保、冷门宝校」四类。"),
    ("2. 冷门宝校发现", "这是水卢的核心差异点。系统通过 7 种「冷门」检测逻辑（城市冷·专业强、名字冷·出路热、今年冷·明年热、学科强·排名低、口碑优·认知慢、产业上升·未来溢价、委培定向·就业确定），找出同分数段里性价比最高的隐藏选项。"),
    ("3. 我的志愿表", "拖拽式 45 个志愿格子，系统实时标注每格的「冲/稳/保」属性，自动检测梯度是否合理，并给出调整建议。"),
    ("4. AI 志愿助手", "有任何疑问可以直接问 AI：「这个学校怎么样」「这个专业的就业方向」「我这个位次去上海还是去西安划算」，AI 会结合实时数据给出建议。"),
    ("5. 深度 PDF 报告", "付费解锁后，每所推荐学校输出 500-800 字结构化分析，涵盖：录取概率、冷门价值分析、就业薪资与去向、学科实力、城市机会、历年趋势、风险提示、填报策略。"),
]

for title, desc in items:
    pdf.set_font('NotoSans', 'B', 12)
    pdf.set_text_color(26, 39, 68)
    pdf.cell(0, 9, title, 0, 1, 'L')
    pdf.set_font('NotoSans', '', 10.5)
    pdf.set_text_color(50, 50, 50)
    pdf.multi_cell(0, 6.5, desc)
    pdf.ln(3)

# ========== 技术原理（用户版） ==========
pdf.add_page()
pdf.chapter_title("冷门是怎么被发现的", "技术原理的通俗解释")

pdf.body_text("水卢的「冷门宝校」不是拍脑袋推荐的，而是基于一套可解释的算法模型。简单说，我们在找的是：")
pdf.bullet("同样分数能进，但就业、学科实力、行业前景至少有一项显著优于同分段平均水平"),
pdf.bullet("因为这些优势暂时没有被大多数考生和家长认知到，所以录取位次还没涨上去"),
pdf.bullet("一旦认知扩散，这些学校的分数线大概率会上升，你现在进去就是「提前占位」"),
pdf.ln(3)

pdf.body_text("系统会从 7 个角度交叉验证一所学校是否被低估：")
pdf.bullet("城市折扣：非热门城市里的 A 类学科强校，对本地考生有地域折扣修正。"),
pdf.bullet("名字矫正：名字听起来不热门（如「图书馆学」），但实际就业薪资和稳定性被低估。"),
pdf.bullet("小年窗口：连续 2-3 年录取位次上涨，说明今年报考人数偏少，存在捡漏机会。"),
pdf.bullet("学科溢价：学校整体排名一般，但某个学科评估是 A+/A，该学科的真实价值没反映在分数线里。"),
pdf.bullet("口碑滞后：在读学生满意度排前 20%，但录取分数还没跟上，说明市场反应慢。"),
pdf.bullet("产业趋势：所属行业处于上升期且 AI 难以替代，未来 5-10 年的职业溢价尚未被「定价」到录取线里。"),
pdf.bullet("委培定向：学校与央企/国企有定向培养关系，毕业即就业，但信息不公开传播，大众 unaware。"),
pdf.ln(3)

pdf.highlight_box("如果一所学校同时命中 3-4 种冷门类型，系统会给予额外加分，最终呈现为「冷门宝校」标签。这叫做「多信号共振」——信号越多，被低估的可能性越大。")

# ========== 数据与口碑 ==========
pdf.chapter_title("数据与口碑", "不只是官方分数线")

pdf.body_text("水卢的数据体系分为三层：")
pdf.bullet("基础层：3,217 所学校、8 年专业录取数据、各省一分一段表、第四轮学科评估结果。")
pdf.bullet("就业层：A 股上市公司 2100 万条招聘数据解析出的专业薪资中位数、就业城市流向、行业分布。")
pdf.bullet("口碑层：10 万+ 条在读学生真实评价（每周自动更新），涵盖满意度、转专业意愿、后悔度、宿舍/食堂/管理评分。"),
pdf.ln(3)

pdf.body_text("这三层数据交叉验证，确保推荐的「冷门」不是宣传话术，而是有真实数据支撑。")

# ========== 定价与配套 ==========
pdf.add_page()
pdf.chapter_title("定价与配套", "按需付费，没有强制年费")

pdf.body_text("水卢采用单次付费 + 季度会员的模式，没有强制年费：")

pdf.set_font('NotoSans', 'B', 11)
pdf.set_text_color(26, 39, 68)
pdf.cell(0, 8, "¥9.9 试看报告", 0, 1, 'L')
pdf.set_font('NotoSans', '', 10.5)
pdf.set_text_color(50, 50, 50)
pdf.multi_cell(0, 6.5, "解锁前 3 所推荐学校的完整分析，适合想先体验再做决定的用户。")
pdf.ln(1)

pdf.set_font('NotoSans', 'B', 11)
pdf.set_text_color(26, 39, 68)
pdf.cell(0, 8, "¥39 单次完整报告", 0, 1, 'L')
pdf.set_font('NotoSans', '', 10.5)
pdf.set_text_color(50, 50, 50)
pdf.multi_cell(0, 6.5, "本次查询的全部推荐学校（通常 50-80 所）的完整分析 + PDF 导出。")
pdf.ln(1)

pdf.set_font('NotoSans', 'B', 11)
pdf.set_text_color(26, 39, 68)
pdf.cell(0, 8, "¥99 2026 填报季会员", 0, 1, 'L')
pdf.set_font('NotoSans', '', 10.5)
pdf.set_text_color(50, 50, 50)
pdf.multi_cell(0, 6.5, "即日起至 2026 年 9 月 1 日，无限次查询、无限次解锁、无限次导出。适合需要反复调整志愿方案的考生家庭。")
pdf.ln(3)

pdf.body_text("配套权益：")
pdf.bullet("邀请返现：每成功邀请一位付费用户，自动获赠 7 天会员，可无限叠加。")
pdf.bullet("志愿表保存：会员期内可保存多份志愿方案，方便对比。")
pdf.bullet("学校对比：最多 3 所学校并排对比，一键看差异。")
pdf.bullet("专业风向标：查看任意专业近 5 年的录取趋势图，判断是「升温」还是「降温」。")

# ========== 结束页 ==========
pdf.add_page()
pdf.set_font('NotoSans', 'B', 18)
pdf.set_text_color(26, 39, 68)
pdf.cell(0, 60, '', 0, 1, 'C')
pdf.cell(0, 14, '让每一分都不浪费', 0, 1, 'C')
pdf.set_font('NotoSans', '', 11)
pdf.set_text_color(110, 110, 115)
pdf.cell(0, 10, '发现别人看不到的冷门好校', 0, 1, 'C')
pdf.ln(20)
pdf.set_font('NotoSans', '', 10)
pdf.set_text_color(150, 150, 150)
pdf.cell(0, 10, 'www.theyuanxi.cn', 0, 1, 'C')

# 输出
output_path = "/Users/czt/workspace/webfrontend/gaokao/水卢冷门高报引擎_产品说明书.pdf"
pdf.output(output_path)
print(f"PDF 已生成：{output_path}")
