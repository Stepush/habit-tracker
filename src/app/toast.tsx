"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

export default function Toast({
  message,
  variant,
  setMessage,
}: {
  message: string;
  variant: "error" | "success";
  setMessage: (message: string) => void;
}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!message || paused) return;
    const timer = setTimeout(
      () => setMessage(""),
      variant === "error" ? 10000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [message, paused, variant, setMessage]);

  if (!message) return null;
  const Icon = variant === "error" ? CircleAlert : CircleCheck;

  return (
    <div
      className={`toast toast-${variant}`}
      role={variant === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={20} className="toast-icon" aria-hidden="true" />
      <span>{message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Закрыть уведомление"
        onClick={() => {
          setPaused(false);
          setMessage("");
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
