import type { MetadataRoute } from "next";

const BASE_URL = "https://www.theyuanxi.cn";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 公开页面（允许搜索引擎收录）
const staticRoutes: MetadataRoute.Sitemap = [
  { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
  { url: `${BASE_URL}/form`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  { url: `${BASE_URL}/search`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
  { url: `${BASE_URL}/ai-predict`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  { url: `${BASE_URL}/career-predict`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  { url: `${BASE_URL}/compare`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
  { url: `${BASE_URL}/major-trend`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  { url: `${BASE_URL}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
  { url: `${BASE_URL}/shuchu`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  { url: `${BASE_URL}/version`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  { url: `${BASE_URL}/crisis-pr`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
];

async function fetchSchoolRoutes(): Promise<MetadataRoute.Sitemap> {
  try {
    const res = await fetch(`${API}/api/schools/search?limit=9999`, {
      next: { revalidate: 86400 }, // 每天缓存一次
    });
    if (!res.ok) return [];
    const data = await res.json();
    const schools: { name: string }[] = data.schools || [];
    return schools.map((s) => ({
      url: `${BASE_URL}/school/${encodeURIComponent(s.name)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const schoolRoutes = await fetchSchoolRoutes();
  return [...staticRoutes, ...schoolRoutes];
}
