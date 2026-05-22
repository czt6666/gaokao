import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "定价方案 · 完整报告 ¥39起 · 水卢冷门高报引擎",
  description: "水卢冷门高报引擎定价方案：单次完整报告¥39，2026填报季会员¥99。解锁全部院校分析、历年趋势、就业数据、PDF导出。",
  keywords: "志愿填报价格,志愿报告费用,高考志愿咨询,志愿填报服务",
  openGraph: {
    title: "定价方案 · 完整报告 ¥39起",
    description: "水卢冷门高报引擎定价方案：单次完整报告¥39，2026填报季会员¥99。",
    url: "https://www.theyuanxi.cn/pricing",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/pricing",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
