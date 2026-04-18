import Link from "next/link";

export default function ShuchuPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0d0d0d",
        color: "#e2e2e2",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid #2c2c2c",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#999", marginBottom: 4 }}>SHUCHU WORKBENCH</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>输出</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid #2c2c2c",
              color: "#e2e2e2",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            返回首页
          </Link>
          <a
            href="/shuchu/index.html"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "#7c6af7",
              color: "#fff",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            新窗口打开
          </a>
        </div>
      </header>

      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #1e1e1e",
          fontSize: 12,
          color: "#999",
          lineHeight: 1.7,
        }}
      >
        这个页面嵌入的是 `SHUCHU` 原始前端。
        它会请求 `http://localhost:8000`。
        如果你看到“无法连接后端”，说明还需要把 `SHUCHU/backend` 启起来。
      </div>

      <div style={{ flex: 1, padding: 12 }}>
        <iframe
          src="/shuchu/index.html"
          title="SHUCHU"
          style={{
            width: "100%",
            height: "calc(100vh - 122px)",
            border: "1px solid #2c2c2c",
            borderRadius: 16,
            background: "#0d0d0d",
          }}
        />
      </div>
    </main>
  );
}
