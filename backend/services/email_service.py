"""邮件发送服务 — SMTP发送PDF报告到用户邮箱"""
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import datetime

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")  # QQ邮箱授权码

EMAIL_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F5F7;font-family:'PingFang SC','Noto Sans SC',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:40px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08)">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1D1D1F,#0071E3);padding:40px;text-align:center">
    <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;margin-bottom:16px">水卢冷门高报引擎</div>
    <div style="color:#fff;font-size:26px;font-weight:700;margin-bottom:8px">您的高考志愿分析报告已就绪</div>
    <div style="color:rgba(255,255,255,0.75);font-size:13px">数据说话 · 理论透明 · 让好学校不被埋没</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:40px">
    <p style="font-size:15px;color:#1D1D1F;margin:0 0 16px">您好，</p>
    <p style="font-size:14px;color:#3D3D3F;line-height:1.8;margin:0 0 24px">
      您的 <strong>{province}省 位次{rank}</strong> 高考志愿深度分析报告已生成完毕，请查收附件中的 PDF 文件。
    </p>
    <!-- Stats card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;border-radius:12px;margin-bottom:24px">
      <tr>
        <td style="padding:20px;text-align:center;border-right:1px solid #E5E5EA">
          <div style="font-size:24px;font-weight:700;color:#FF3B30">{chong}</div>
          <div style="font-size:11px;color:#6E6E73;margin-top:4px">冲院校</div>
        </td>
        <td style="padding:20px;text-align:center;border-right:1px solid #E5E5EA">
          <div style="font-size:24px;font-weight:700;color:#0071E3">{wen}</div>
          <div style="font-size:11px;color:#6E6E73;margin-top:4px">稳院校</div>
        </td>
        <td style="padding:20px;text-align:center;border-right:1px solid #E5E5EA">
          <div style="font-size:24px;font-weight:700;color:#34C759">{bao}</div>
          <div style="font-size:11px;color:#6E6E73;margin-top:4px">保院校</div>
        </td>
        <td style="padding:20px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#FF9500">{gems}</div>
          <div style="font-size:11px;color:#6E6E73;margin-top:4px">💎 冷门宝藏</div>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:#6E6E73;line-height:1.8;margin:0 0 24px">
      报告包含每所学校的录取概率分析、大小年研判、就业数据解读、2026专项因素及填报建议，
      建议打印或保存后仔细阅读。
    </p>
    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
      <tr><td style="background:#0071E3;border-radius:980px;padding:12px 32px">
        <a href="https://www.theyuanxi.cn" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none">访问网站查看完整推荐 →</a>
      </td></tr>
    </table>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#F5F5F7;padding:24px 40px;text-align:center">
    <div style="font-size:11px;color:#AEAEB2;line-height:1.8">
      水卢冷门高报引擎 · www.theyuanxi.cn<br>
      本报告数据基于历史录取记录，仅供参考，不代表招生院校的实际承诺。<br>
      生成于 {today}
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


PAYMENT_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F5F7;font-family:'PingFang SC','Noto Sans SC',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:40px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08)">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1D1D1F,#34C759);padding:40px;text-align:center">
    <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;margin-bottom:16px">水卢冷门高报引擎</div>
    <div style="color:#fff;font-size:26px;font-weight:700;margin-bottom:8px">支付成功 ✓</div>
    <div style="color:rgba(255,255,255,0.75);font-size:13px">感谢您的信任，您的权益已解锁</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:40px">
    <p style="font-size:15px;color:#1D1D1F;margin:0 0 16px">您好，</p>
    <p style="font-size:14px;color:#3D3D3F;line-height:1.8;margin:0 0 24px">
      您的订单已支付成功，以下是本次交易详情：
    </p>
    <!-- Order card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;border-radius:12px;margin-bottom:24px">
      <tr><td style="padding:24px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#6E6E73;padding-bottom:12px">订单编号</td>
            <td style="font-size:13px;color:#1D1D1F;text-align:right;padding-bottom:12px;font-family:monospace">{order_no}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6E6E73;padding-bottom:12px">支付金额</td>
            <td style="font-size:18px;font-weight:700;color:#34C759;text-align:right;padding-bottom:12px">¥{amount_yuan}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6E6E73;padding-bottom:12px">产品</td>
            <td style="font-size:13px;color:#1D1D1F;text-align:right;padding-bottom:12px">{product_name}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6E6E73">支付时间</td>
            <td style="font-size:13px;color:#1D1D1F;text-align:right">{pay_time}</td>
          </tr>
        </table>
      </td></tr>
    </table>
    <p style="font-size:13px;color:#6E6E73;line-height:1.8;margin:0 0 24px">
      现在可以访问网站，生成您的高考志愿深度分析报告（含PDF导出）。如有疑问请联系
      <a href="mailto:superfy@gmail.com" style="color:#0071E3">superfy@gmail.com</a>。
    </p>
    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
      <tr><td style="background:#0071E3;border-radius:980px;padding:12px 32px">
        <a href="https://www.theyuanxi.cn" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none">立即生成报告 →</a>
      </td></tr>
    </table>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#F5F5F7;padding:24px 40px;text-align:center">
    <div style="font-size:11px;color:#AEAEB2;line-height:1.8">
      水卢冷门高报引擎 · www.theyuanxi.cn<br>
      北京水卢教育科技有限公司 · 京ICP备2026015008号<br>
      {today}
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

PRODUCT_NAMES = {
    "report_export":  "单次完整报告",
    "single_report":  "单次完整报告",
    "monthly_sub":    "月度订阅",
    "quarterly_sub":  "季度订阅",
}


def send_payment_notification(
    order_no: str,
    amount_fen: int,
    product_type: str,
    pay_time: str,
    to_email: str | None = None,
) -> None:
    """发送支付成功通知邮件。to_email 为空时发给管理员通知邮箱。静默失败（不抛异常）。"""
    notify_email = os.getenv("NOTIFY_EMAIL", "")
    recipient = to_email or notify_email
    if not recipient or not SMTP_USER or not SMTP_PASS:
        return  # 未配置邮箱则静默跳过

    try:
        today = datetime.date.today().strftime("%Y年%m月%d日 %H:%M")
        amount_yuan = f"{amount_fen / 100:.1f}"
        product_name = PRODUCT_NAMES.get(product_type, product_type)
        html_body = PAYMENT_HTML_TEMPLATE.format(
            order_no=order_no,
            amount_yuan=amount_yuan,
            product_name=product_name,
            pay_time=pay_time,
            today=today,
        )

        msg = MIMEMultipart("mixed")
        msg["From"] = f"水卢冷门高报引擎 <{SMTP_USER}>"
        msg["To"] = recipient
        msg["Subject"] = f"支付成功 ¥{amount_yuan} · 水卢冷门高报引擎"
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    except Exception:
        pass  # 邮件失败不影响支付流程


def send_report_email(
    to_email: str,
    pdf_bytes: bytes,
    province: str,
    rank: int,
    chong: int = 0,
    wen: int = 0,
    bao: int = 0,
    gems: int = 0,
) -> None:
    """发送带PDF附件的报告邮件。若SMTP未配置则抛出 RuntimeError。"""
    if not SMTP_USER or not SMTP_PASS:
        raise RuntimeError("邮件服务未配置（需设置 SMTP_USER 和 SMTP_PASS 环境变量）")

    today = datetime.date.today().strftime("%Y年%m月%d日")
    html_body = EMAIL_HTML_TEMPLATE.format(
        province=province, rank=f"{rank:,}",
        chong=chong, wen=wen, bao=bao, gems=gems,
        today=today,
    )

    msg = MIMEMultipart("mixed")
    msg["From"] = f"水卢冷门高报引擎 <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Subject"] = f"您的2026高考志愿分析报告 · {province}省 位次{rank:,}"

    # HTML 正文
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # PDF 附件
    part = MIMEBase("application", "octet-stream")
    part.set_payload(pdf_bytes)
    encoders.encode_base64(part)
    filename = f"高考志愿报告_{province}_{rank}.pdf"
    part.add_header(
        "Content-Disposition",
        f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}'
    )
    msg.attach(part)

    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as server:
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
