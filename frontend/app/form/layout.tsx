import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "我的志愿表 · 智能志愿填报管理 · 水卢冷门高报引擎",
  description: "管理你的高考志愿表，记录冲稳保梯度配置。智能推荐最优志愿组合，导出PDF志愿表，让填报更有条理。",
  keywords: "志愿表,志愿填报,高考志愿管理,志愿组合,冲稳保",
  openGraph: {
    title: "我的志愿表 · 智能志愿填报管理",
    description: "管理你的高考志愿表，记录冲稳保梯度配置。智能推荐最优志愿组合，导出PDF志愿表。",
    url: "https://www.theyuanxi.cn/form",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/form",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function FormLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
