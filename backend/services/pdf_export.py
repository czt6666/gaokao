"""PDF报告生成服务 — 学术文本风格：以文字为主，数据清晰，冷门突出"""
import datetime
import io, base64, os
from typing import List, Dict, Any


def _make_qr_base64(url: str) -> str:
    """生成二维码 PNG，返回 base64 字符串；失败时返回空字符串"""
    try:
        import qrcode
        qr = qrcode.QRCode(version=2, box_size=4, border=2,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#1D1D1F", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def _rank_context(rank: int, total: int) -> tuple:
    """返回 (位次标签, 个性化说明文字)"""
    if rank <= 3000:
        return (
            "顶尖位次段",
            f"你的位次位于全省前 3,000 名。全国仅有极少数顶级院校（C9 / 顶尖 985）"
            f"能与该位次精准匹配，本报告共筛选出 {total} 所。"
            f"数量少，但每所均经过严格概率计算——建议认真研读每一所的专业细节与冷门价值分析。"
        )
    elif rank <= 15000:
        return (
            "高分位次段",
            f"你的位次属于高分段，推荐院校以 985 / 211 重点高校为主。"
            f"本报告共匹配 {total} 所，涵盖冲稳保三个层次。"
            f"建议重点关注专业排名、就业方向及冷门宝藏院校中隐藏的强势学科。"
        )
    elif rank <= 80000:
        if total >= 70:
            return ("", "")
        else:
            return (
                "中等位次段",
                f"当前位次与数据库匹配到 {total} 所院校。"
                f"建议重点关注其中标注「冷门宝藏」的院校——相同分数，往往能进入更强的学科平台。"
            )
    else:
        return (
            "普通位次段",
            f"你的位次对应大量双一流 / 211 院校，选择空间较大，共匹配 {total} 所。"
            f"建议优先关注专业就业前景与城市发展机会，而非单纯追求院校综合排名。"
        )


def _html_template(province: str, rank: int, results: List[Dict[str, Any]],
                   report_id: str = "", outlooks: Dict[str, str] = None) -> str:
    outlooks = outlooks or {}
    import html as html_lib
    today = datetime.date.today().strftime("%Y年%m月%d日")

    # ── 按学校去重 ──
    _dedup_idx: dict = {}
    results_dedup: list = []
    for r in results:
        name = r.get("school_name", "")
        mn = r.get("major_name", "")
        if name not in _dedup_idx:
            _dedup_idx[name] = len(results_dedup)
            entry = dict(r)
            entry["_matched_majors"] = [mn] if mn and mn != "[院校最低分]" else []
            results_dedup.append(entry)
        else:
            idx = _dedup_idx[name]
            existing = results_dedup[idx]
            if mn and mn != "[院校最低分]" and mn not in existing["_matched_majors"]:
                existing["_matched_majors"].append(mn)
            if (r.get("probability") or 0) > (existing.get("probability") or 0):
                for k in ("probability", "prob_low", "prob_high", "reason", "reason_sections",
                          "big_small_year", "recent_data"):
                    if r.get(k) is not None:
                        existing[k] = r[k]

    total = len(results_dedup)
    _ctx_label, _ctx_note = _rank_context(rank, total)

    site_url  = os.getenv("SITE_URL", "https://www.theyuanxi.cn")
    track_url = f"{site_url}/r/{report_id}" if report_id else site_url
    qr_b64    = _make_qr_base64(track_url)

    chong = sum(1 for r in results_dedup if r.get("tier") == "冲")
    wen   = sum(1 for r in results_dedup if r.get("tier") == "稳")
    bao   = sum(1 for r in results_dedup if r.get("tier") == "保")
    gems  = sum(1 for r in results_dedup if r.get("is_hidden_gem"))

    def _esc(s: str) -> str:
        return html_lib.escape(str(s or ""))

    # ── 分析模块渲染（文本风格） ──
    def _build_analysis_text(r: dict, is_gem: bool = False) -> str:
        """渲染分析模块：纯文本段落风格"""
        sections = r.get("reason_sections") or []
        if not sections:
            reason_text = _esc(r.get("reason") or "暂无推荐理由").replace("\n", "<br>")
            return f'<p class="analysis">{reason_text}</p>'

        parts = []
        # 冷门学校：提取冷门分析放在最前面，加大展示
        if is_gem:
            gem_secs = [s for s in sections if "冷门" in s.get("title", "") or "💎" in s.get("title", "")]
            if gem_secs:
                for sec in gem_secs:
                    title = _esc(sec.get("title", ""))
                    content = _esc(sec.get("content", "")).replace("\n", "<br>")
                    parts.append(
                        f'<div class="gem-highlight">'
                        f'<div class="gem-title">🔍 {title}</div>'
                        f'<div class="gem-content">{content}</div>'
                        f'</div>'
                    )

        for sec in sections:
            title   = _esc(sec.get("title", ""))
            content = _esc(sec.get("content", "")).replace("\n", "<br>")
            # 冷门模块已在上面突出展示过，跳过重复
            if is_gem and ("冷门" in title or "💎" in title):
                continue
            parts.append(
                f'<div class="section">'
                f'<div class="sec-title">{title}</div>'
                f'<div class="sec-body">{content}</div>'
                f'</div>'
            )
        return "\n".join(parts)

    # ── 学校页面生成 ──
    def school_pages() -> str:
        pages = []
        for i, r in enumerate(results_dedup, 1):
            prob     = r.get("probability")
            prob_str = f"{prob:.1f}%" if prob is not None else "—"
            prob_lo  = r.get("prob_low")
            prob_hi  = r.get("prob_high")
            ci_str   = f"（置信区间 {prob_lo}%–{prob_hi}%）" if prob_lo and prob_hi else ""

            emp        = r.get("employment") or {}
            salary     = emp.get("avg_salary") or 0
            salary_str = f"¥{salary // 1000}k" if salary else "—"
            emp_rate   = emp.get("school_employment_rate") or 0
            emp_str    = f"{emp_rate * 100:.0f}%" if emp_rate else "—"
            postgrad   = emp.get("school_postgrad_rate") or 0
            pg_str     = f"{postgrad * 100:.0f}%" if postgrad else "—"
            employer   = emp.get("school_employer_tier") or "—"

            bsy        = r.get("big_small_year") or {}
            bsy_status = bsy.get("status") or "平稳"
            bsy_trend  = bsy.get("heat_trend") or ""

            tier       = r.get("tier", "")
            is_gem     = r.get("is_hidden_gem", False)
            is_top     = r.get("is_top_pick", False)

            # 历年位次（文字行）
            hist = r.get("recent_data") or r.get("recent_years_data") or []
            hist_items = []
            for h in sorted(hist, key=lambda x: x.get("year", 0), reverse=True)[:4]:
                yr = h.get("year", "")
                rk = h.get("min_rank", 0)
                rk_str = f"{rk:,}" if rk else "—"
                hist_items.append(f"{yr}年{rk_str}位")
            hist_line = " | ".join(hist_items) if hist_items else "暂无历史数据"

            # A类学科
            strong_subs = r.get("strong_subjects") or []
            subs_str = "、".join(strong_subs[:6]) if strong_subs else ""

            # 推荐专业
            majors = r.get("_matched_majors") or []
            if not majors:
                mn = r.get("major_name", "")
                majors = ["院校整体录取"] if mn == "[院校最低分]" else [mn] if mn else []
            majors_str = "、".join(majors[:4])

            # 标签
            gem_mark = " ★ 冷门宝藏" if is_gem else ""
            top_mark = " ◆ 本档首选" if is_top and r.get("top_pick_rank") == 1 else (" ◇ 智能精选" if is_top else "")

            analysis_html = _build_analysis_text(r, is_gem=is_gem)

            # 冷门学校：插入「未来展望」
            outlook_html = ""
            if is_gem:
                outlook_text = outlooks.get(r.get("school_name", ""), "")
                if outlook_text:
                    outlook_html = (
                        f'<div class="gem-highlight" style="background:#F0F7FF;border-color:#BAD4F5;">'
                        f'<div class="gem-title" style="color:#1A5276;">🔮 未来展望（5-10年）</div>'
                        f'<div class="gem-content">{_esc(outlook_text)}</div>'
                        f'</div>'
                    )

            pages.append(f"""
<div class="school-page">
  <div class="school-header">
    <div class="school-name">{i}. {_esc(r.get("school_name",""))}<span class="tier-badge tier-{tier}">[{tier}]</span> {prob_str}{gem_mark}{top_mark}</div>
    <div class="school-meta">{_esc(r.get("city",""))} · {majors_str}</div>
  </div>

  <table class="data-table">
    <tr>
      <th>录取概率</th><th>历年位次</th><th>就业率</th><th>月薪</th><th>深造率</th><th>大小年</th>
    </tr>
    <tr>
      <td><strong>{prob_str}</strong>{ci_str}</td>
      <td>{hist_line}</td>
      <td>{emp_str}</td>
      <td>{salary_str}</td>
      <td>{pg_str}</td>
      <td>{_esc(bsy_status)}</td>
    </tr>
  </table>
  {f'<div class="data-note">A类学科：{_esc(subs_str)}</div>' if subs_str else ''}

  {analysis_html}
  {outlook_html}

  <div class="page-footer">{i} / {total}</div>
</div>
""")
        return "\n".join(pages)

    # ── 总览表 ──
    def summary_rows() -> str:
        rows = []
        for i, r in enumerate(results_dedup, 1):
            tier = r.get("tier", "")
            prob = r.get("probability")
            ps = f"{prob:.1f}%" if prob is not None else "—"
            emp = r.get("employment") or {}
            salary = emp.get("avg_salary") or 0
            sal = f"¥{salary // 1000}k" if salary else "—"
            gem = "★" if r.get("is_hidden_gem") else ""
            majors = r.get("_matched_majors") or []
            if not majors:
                mn = r.get("major_name", "")
                majors = ["院校整体"] if mn == "[院校最低分]" else [mn] if mn else []
            alt_cls = '' if i % 2 else ' class="alt"'
            rows.append(
                f'<tr{alt_cls}>'
                f'<td>{i}</td>'
                f'<td>{_esc(r.get("school_name",""))}</td>'
                f'<td>{", ".join(majors[:3])}</td>'
                f'<td class="tier-{tier}">{tier}</td>'
                f'<td>{ps}</td>'
                f'<td>{sal}</td>'
                f'<td>{gem}</td>'
                f'</tr>'
            )
        return "".join(rows)

    # ── QR 水印（仅封面一处） ──
    cover_qr = ""
    if qr_b64:
        cover_qr = (
            f'<div style="text-align:center;margin-top:16px">'
            f'<img src="data:image/png;base64,{qr_b64}" style="width:64px;height:64px;opacity:0.3">'
            f'<div style="font-size:8px;color:#999;margin-top:4px">扫码访问水卢冷门高报引擎</div>'
            f'</div>'
        )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "SimHei", sans-serif;
    color: #222; font-size: 11px; line-height: 1.7; background: #fff;
  }}
  h1 {{ font-size: 20px; font-weight: 700; margin-bottom: 8px; }}
  h2 {{ font-size: 14px; font-weight: 700; margin: 16px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }}

  /* 封面 */
  .cover {{ padding: 60px 40px; text-align: center; page-break-after: always; }}
  .cover .rank {{ font-size: 56px; font-weight: 700; color: #111; margin: 24px 0 8px; }}
  .cover .subtitle {{ font-size: 14px; color: #555; margin-bottom: 20px; }}
  .cover .stats {{ font-size: 13px; color: #333; margin: 12px 0; }}
  .cover .ctx {{ background: #f7f7f7; border: 1px solid #ddd; padding: 12px 16px; margin: 16px auto; max-width: 500px; text-align: left; font-size: 11px; color: #444; }}

  /* 总览表 */
  .summary {{ padding: 36px 32px; page-break-after: always; }}
  .idx-table {{ width: 100%; border-collapse: collapse; font-size: 10.5px; }}
  .idx-table th {{ background: #f0f0f0; padding: 5px 6px; text-align: left; font-weight: 600; border-bottom: 2px solid #999; }}
  .idx-table td {{ padding: 4px 6px; border-bottom: 1px solid #e0e0e0; }}
  .idx-table tr.alt {{ background: #fafafa; }}
  .tier-冲 {{ color: #c00; font-weight: 700; }}
  .tier-稳 {{ color: #25e; font-weight: 700; }}
  .tier-保 {{ color: #160; font-weight: 700; }}

  /* 学校页 */
  .school-page {{ padding: 24px 32px; page-break-after: always; }}
  .school-header {{ margin-bottom: 10px; }}
  .school-name {{ font-size: 14px; font-weight: 700; color: #111; }}
  .school-meta {{ font-size: 10px; color: #666; margin-top: 2px; }}
  .tier-badge {{ font-weight: 700; margin-left: 6px; }}

  /* 数据表 */
  .data-table {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10.5px; }}
  .data-table th {{ background: #f5f5f5; padding: 4px 6px; text-align: left; font-weight: 600; border-bottom: 1px solid #ccc; }}
  .data-table td {{ padding: 4px 6px; border-bottom: 1px solid #eee; }}
  .data-note {{ font-size: 10px; color: #555; margin-bottom: 10px; }}

  /* 冷门突出区块 */
  .gem-highlight {{ background: #fffbe6; border: 1px solid #ffe58f; padding: 10px 14px; margin-bottom: 10px; }}
  .gem-title {{ font-size: 12px; font-weight: 700; color: #8b6914; margin-bottom: 4px; }}
  .gem-content {{ font-size: 11px; color: #333; line-height: 1.8; }}

  /* 分析模块 */
  .section {{ margin-bottom: 8px; page-break-inside: avoid; }}
  .sec-title {{ font-size: 11px; font-weight: 700; color: #333; margin-bottom: 2px; }}
  .sec-body {{ font-size: 10.5px; color: #444; line-height: 1.75; }}

  .page-footer {{ font-size: 9px; color: #999; text-align: right; margin-top: 12px; padding-top: 6px; border-top: 1px solid #eee; }}

  /* 法律页 */
  .legal {{ padding: 36px 32px; font-size: 10px; color: #666; line-height: 1.8; }}
  .legal h2 {{ font-size: 12px; color: #333; }}
</style>
</head>
<body>

<!-- 封面 -->
<div class="cover">
  <div style="font-size: 11px; color: #888; letter-spacing: 2px;">水卢冷门高报引擎 · theyuanxi.cn</div>
  <div class="rank">{rank:,}</div>
  <div class="subtitle">{province} · 2026年高考志愿分析报告</div>
  <div class="stats">
    冲院校 {chong} 所 &nbsp;|&nbsp; 稳院校 {wen} 所 &nbsp;|&nbsp; 保院校 {bao} 所 &nbsp;|&nbsp; 共推荐 {total} 所
    {'&nbsp;|&nbsp; 含 ' + str(gems) + ' 所冷门宝藏院校' if gems else ''}
  </div>
  <div style="font-size:10px;color:#888">生成于 {today} · 数据截至 2025年</div>
  {f'<div class="ctx"><strong>{_ctx_label}</strong><br>{_ctx_note}</div>' if _ctx_note else ''}
  {cover_qr}
</div>

<!-- 总览表 -->
<div class="summary">
  <h1>全部推荐院校一览</h1>
  <div style="font-size:10px;color:#666;margin-bottom:12px">
    共 {total} 所 · {province} · 位次 {rank:,} · 冲{chong}所 · 稳{wen}所 · 保{bao}所 · ★=冷门宝藏
  </div>
  <table class="idx-table">
    <thead><tr>
      <th>#</th><th>院校名称</th><th>推荐专业</th><th>层次</th><th>概率</th><th>月薪</th><th>冷门</th>
    </tr></thead>
    <tbody>{summary_rows()}</tbody>
  </table>
</div>

<!-- 学校详情 -->
{school_pages()}

<!-- 法律声明 -->
<div class="legal">
  <h2>数据来源与免责声明</h2>
  <p>本报告所有录取数据来源于中华人民共和国教育部公开数据、各省教育考试院官方发布信息及高校本科招生网公示内容。
  学科评估数据来源于教育部学位与研究生教育发展中心。就业与薪资数据来源于各高校公开发布的毕业生就业质量报告。</p>
  <p>录取概率基于历史数据统计模型计算，仅供参考，不构成录取承诺。最终录取结果以各省教育考试院官方公告为准。</p>
  <h2>版权声明</h2>
  <p>本报告版权归北京水卢教育科技有限公司所有。未经授权，禁止任何形式的商业使用，
  包括但不限于转售、转发牟利、机构教学、付费咨询引用等。</p>
  <p style="color:#999;margin-top:12px">水卢冷门高报引擎 © 2026 · www.theyuanxi.cn · 北京水卢教育科技有限公司 · 京ICP备2026015008号</p>
</div>

</body>
</html>"""


def _patch_fonttools_bit123():
    """修复 fonttools 的 setUnicodeRanges 拒绝 bit 123 的 bug。
    Noto Sans CJK 字体的 OS/2 表包含保留位 123，fonttools 的
    recalcUnicodeRanges 会计算出该位，但 setUnicodeRanges 只接受 0-122，
    导致字体子集化时 ValueError。过滤掉 >122 的保留位即可。"""
    try:
        from fontTools.ttLib.tables.O_S_2f_2 import table_O_S_2f_2
        _orig = table_O_S_2f_2.setUnicodeRanges
        if getattr(_orig, '_patched_bit123', False):
            return  # 已修复
        def _safe_setUnicodeRanges(self, bits):
            _orig(self, {b for b in bits if 0 <= b <= 122})
        _safe_setUnicodeRanges._patched_bit123 = True
        table_O_S_2f_2.setUnicodeRanges = _safe_setUnicodeRanges
    except Exception:
        pass


def generate_pdf(province: str, rank: int, results: List[Dict[str, Any]],
                 report_id: str = "") -> bytes:
    """生成 PDF 并返回字节流"""
    _patch_fonttools_bit123()
    try:
        from weasyprint import HTML
    except ImportError:
        raise RuntimeError("weasyprint 未安装。请运行: pip install weasyprint")

    # 为冷门学校获取「未来展望」（仅从缓存读取，绝不调用外部 API）
    outlooks = {}
    try:
        from services.future_outlook import get_cached_outlooks
        outlooks = get_cached_outlooks(results)
    except Exception:
        pass

    html_content = _html_template(province, rank, results, report_id=report_id, outlooks=outlooks)
    pdf_bytes = HTML(string=html_content, base_url=None).write_pdf()
    return pdf_bytes
