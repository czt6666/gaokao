import VersionPageActions from "./VersionPageActions";

const FRONTEND_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "unknown";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

async function getBackendVersion(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/version`, { cache: "no-store" });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { version?: string };
    return data.version || "unknown";
  } catch {
    return "unknown";
  }
}

export default async function VersionPage() {
  const backendVersion = await getBackendVersion();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--color-bg, #f7f8fa)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--color-card-bg, #fff)",
          border: "1px solid var(--color-border, #e9ecef)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>版本信息</h1>
        <p style={{ marginTop: 8, color: "var(--color-text-secondary, #666)" }}>
          用于快速确认前后端部署版本
        </p>
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Frontend</span>
            <strong>{FRONTEND_VERSION}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Backend</span>
            <strong>{backendVersion}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>API</span>
            <code>{API_BASE}</code>
          </div>
        </div>
        <VersionPageActions />
      </section>
    </main>
  );
}
