import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI 志愿填报助手 · 智能问答、志愿建议 · 水卢冷门高报引擎",
  description: "AI智能助手解答高考志愿填报问题，提供个性化志愿建议、院校推荐、专业分析。24小时在线，随时解答你的疑问。",
  keywords: "AI志愿助手,志愿填报咨询,智能问答,志愿建议,院校推荐",
  openGraph: {
    title: "AI 志愿填报助手 · 智能问答、志愿建议",
    description: "AI智能助手解答高考志愿填报问题，提供个性化志愿建议、院校推荐、专业分析。",
    url: "https://www.theyuanxi.cn/ai-chat",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/ai-chat",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AIChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
