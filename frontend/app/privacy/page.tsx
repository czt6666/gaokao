import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隐私政策 — 水卢冷门高报引擎",
  description: "北京水卢教育科技有限公司隐私政策",
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <nav className="apple-nav">
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" className="btn-ghost" style={{ fontSize: 14 }}>← 返回首页</Link>
          <span style={{ fontSize: 15, fontWeight: 600 }}>隐私政策</span>
          <div style={{ width: 80 }} />
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.3px" }}>隐私政策</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 6 }}>更新日期：2026年3月31日</p>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginBottom: 40 }}>数据处理者：北京水卢教育科技有限公司</p>

        {[
          {
            title: "一、总则",
            content: `北京水卢教育科技有限公司（以下简称"水卢科技"或"我们"）依据《中华人民共和国个人信息保护法》（PIPL）、《网络安全法》及相关法规制定本政策。

本政策适用于水卢冷门高报引擎（www.theyuanxi.cn）提供的全部服务。使用本服务，即表示您同意本政策的数据处理方式。`,
          },
          {
            title: "二、我们收集哪些信息",
            content: `【您主动提供的信息】
• 手机号码：用于账号注册和短信验证码登录
• 微信身份信息：通过微信授权登录时，获取您的微信昵称、头像及唯一标识（OpenID）
• 查询数据：您输入的省份、位次、选科组合，用于生成推荐结果

【服务自动收集的信息】
• 使用行为：浏览的页面、点击的学校、停留时长等匿名行为数据，用于改进产品
• 设备与网络信息：IP地址、浏览器类型、操作系统，用于安全防护和问题排查
• 订单信息：付款金额、时间、订单号（不含银行卡或支付账户信息）

【我们不收集的信息】
我们不收集您的姓名、身份证号、银行卡号、家庭住址等敏感个人信息。`,
          },
          {
            title: "三、我们如何使用信息",
            content: `收集到的信息仅用于以下明确目的（遵循最小必要原则）：

• 提供志愿推荐服务（位次、省份数据 → 生成推荐列表）
• 账号登录和会话保持（手机号/微信OpenID → JWT令牌）
• 订单处理和付款确认（订单号 → 解锁付费功能）
• 向您发送支付确认邮件及服务通知
• 产品改进和问题排查（匿名行为数据）
• 安全防护和滥用检测（IP、频率限制）
• 版权保护（订单号与报告水印的关联记录）

我们不会将您的个人信息出售、出租或交换给第三方用于商业目的。`,
          },
          {
            title: "四、第三方服务商",
            content: `为提供服务，我们使用以下第三方服务商，并与其签订数据处理协议：

• 腾讯云（数据存储、服务器托管）：数据存储于中国大陆境内北京地区服务器
• 微信支付（腾讯科技）：处理付款，我们不存储您的支付账户信息
• 腾讯云短信服务：发送手机验证码
• 微信开放平台（腾讯科技）：提供微信账号授权登录

上述第三方均受其各自隐私政策约束，请参阅其官方网站。我们要求第三方服务商仅在本服务所需范围内处理您的信息。`,
          },
          {
            title: "五、数据存储、保留与安全",
            content: `【存储地点】
所有个人信息存储于中国大陆境内（腾讯云北京地区），不进行跨境传输。

【保留期限】
• 账号信息：账号注销后30天内删除
• 手机验证码：生成后5分钟失效，验证后立即删除
• 订单记录：依《电子商务法》要求保留3年
• 行为日志（匿名）：保留12个月后自动清除
• 报告水印关联记录：用于版权保护，保留至法律追溯期届满（著作权侵权诉讼时效3年）

【安全措施】
• HTTPS加密传输
• 手机号哈希存储（不可逆）
• 付款处理由微信支付完成，我们不接触支付密码或银行卡信息
• 定期安全审查`,
          },
          {
            title: "六、Cookie 与本地存储",
            content: `我们使用浏览器本地存储（localStorage）保存：
• 您的查询历史（仅存储在您的设备，服务器不持有该数据）
• 您的志愿表数据（仅存储在您的设备）
• 登录令牌（JWT，用于保持登录状态，有效期30天）
• 支付订单号（用于恢复付费状态）

我们不使用第三方广告 Cookie，不进行跨站追踪。`,
          },
          {
            title: "七、您的权利",
            content: `依据《个人信息保护法》，您享有以下权利：

• 知情权与决定权：了解我们如何处理您的信息，并对处理方式做出选择
• 查阅权：查看我们持有的您的个人信息
• 更正权：要求更正不准确的信息
• 删除权：要求删除您的账号及相关个人信息
• 撤回同意权：撤回之前给予的授权（不影响撤回前已进行的处理）
• 可携带权：要求以结构化格式导出您的数据

行使上述权利，请发邮件至：superfy@gmail.com
我们将在15个工作日内响应。`,
          },
          {
            title: "八、未成年人保护",
            content: `本服务主要面向高考考生（通常为16-18岁）及其家长。我们不向14岁以下未成年人提供服务。若您是14岁以下用户，请在监护人陪同下使用，并由监护人代为同意本政策。

如发现我们误收了14岁以下用户信息，请立即联系我们，我们将予以删除。`,
          },
          {
            title: "九、隐私政策更新",
            content: `我们可能依据法律变化或产品调整更新本政策。重大变更时，我们将在网站首页显著位置提示，并提前不少于7日公告。继续使用本服务即视为接受更新后的政策。`,
          },
          {
            title: "十、联系我们",
            content: `数据处理者：北京水卢教育科技有限公司
隐私事务联系邮箱：superfy@gmail.com
网站：www.theyuanxi.cn
处理时限：收到请求后15个工作日内回复`,
          },
        ].map(({ title, content }) => (
          <section key={title} style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>{content}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
