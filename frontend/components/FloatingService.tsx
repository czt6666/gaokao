"use client";
import { useState } from "react";
import FeedbackModal from "./FeedbackModal";

export default function FloatingService() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        aria-label="意见反馈"
        style={{
          position: "fixed", bottom: 80, right: 16, zIndex: 1000,
          width: 48, height: 48, borderRadius: "50%",
          background: "#07C160", color: "#fff",
          border: "none", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(7,193,96,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, transition: "transform 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        💬
      </button>

      {showModal && <FeedbackModal onClose={() => setShowModal(false)} />}
    </>
  );
}
