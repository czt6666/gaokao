import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "录取概率分析结果 · 冲稳保志愿推荐 · 水卢冷门高报引擎",
  description: "基于多年录取数据，精确计算每所学校的录取概率。查看冲击、稳妥、保底院校推荐，发现冷门宝藏学校，获取个性化填报策略。",
  keywords: "录取概率,志愿推荐,冲稳保,高考志愿分析,冷门院校推荐",
  openGraph: {
    title: "录取概率分析结果 · 冲稳保志愿推荐",
    description: "基于多年录取数据，精确计算每所学校的录取概率。查看冲击、稳妥、保底院校推荐，发现冷门宝藏学校。",
    url: "https://www.theyuanxi.cn/results",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/results",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
