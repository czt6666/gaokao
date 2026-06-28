"use client";
import { useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5198";

// 当前前端构建版本。发版时与后端 BACKEND_VERSION 保持一致。
export const APP_VERSION = "3.1.0";

/**
 * 版本一致性检查：拉取后端 /api/version，与前端构建版本比对。
 * 不一致 = 用户停留在旧前端 → 强制刷新一次。
 * 用 sessionStorage 按目标版本去重，确保同一新版本只刷新一次（防止死循环）。
 */
export default function VersionChecker() {
  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const res = await fetch(`${API}/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const serverVersion: string | undefined = data?.version;
        if (!serverVersion || serverVersion === APP_VERSION) return;

        // 同一目标版本只刷新一次（刷新后若前端仍是旧版本，不再重复刷新）
        const key = "version_reloaded";
        if (sessionStorage.getItem(key) === serverVersion) return;
        sessionStorage.setItem(key, serverVersion);
        location.reload();
      } catch {
        /* 网络异常忽略，下次再查 */
      }
    }

    check();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!stopped) check(); }, 5 * 60 * 1000);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  return null;
}
