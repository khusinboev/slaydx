"use client";

/**
 * Root layout ham yiqilgan holat uchun oxirgi chegara.
 * Bu yerda `<html>`/`<body>` ni o'zimiz chizishimiz shart.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="uz">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f7f7",
          color: "#111",
          margin: 0,
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Xizmat vaqtincha ishlamayapti</h1>
          <p style={{ color: "#666", fontSize: "0.9rem" }}>
            Birozdan keyin qayta urinib ko&apos;ring.
            {error.digest ? ` (kod: ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              height: 40,
              padding: "0 1.25rem",
              borderRadius: 999,
              border: "none",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Qayta urinish
          </button>
        </div>
      </body>
    </html>
  );
}
