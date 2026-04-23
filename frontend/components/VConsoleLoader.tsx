"use client";
import { useEffect } from "react";

/**
 * vConsole 调试器加载器（仅在显式开启时加载）
 *
 * 开启：访问任意页面追加 ?vc=1，本会话内（sessionStorage）持续显示
 * 关闭：访问任意页面追加 ?vc=0，下次刷新生效（vConsole 实例无法热销毁）
 *
 * 仅供联调使用，上线稳定后建议从 layout.tsx 移除。
 */
export default function VConsoleLoader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const vc = url.searchParams.get("vc");

    if (vc === "1") {
      try { sessionStorage.setItem("vconsole", "1"); } catch {}
      url.searchParams.delete("vc");
      window.history.replaceState({}, "", url.toString());
    } else if (vc === "0") {
      try { sessionStorage.removeItem("vconsole"); } catch {}
      url.searchParams.delete("vc");
      window.history.replaceState({}, "", url.toString());
      return;
    }

    let enabled = false;
    try { enabled = sessionStorage.getItem("vconsole") === "1"; } catch {}
    if (!enabled) return;
    if ((window as any).__vConsoleInited) return;

    const s = document.createElement("script");
    s.src = "https://unpkg.com/vconsole@latest/dist/vconsole.min.js";
    s.async = true;
    s.onload = () => {
      try {
        new (window as any).VConsole();
        (window as any).__vConsoleInited = true;
      } catch {}
    };
    document.body.appendChild(s);
  }, []);

  return null;
}
