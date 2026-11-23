import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-maroon-700 text-white hover:bg-maroon-800 disabled:bg-gray-300",
    secondary: "bg-white text-maroon-800 border border-maroon-700 hover:bg-maroon-50 disabled:opacity-50",
    ghost: "text-maroon-800 hover:bg-maroon-50",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300",
  }[variant];
  return (
    <button
      className={`min-h-[48px] rounded-xl px-5 font-semibold transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full min-h-[48px] rounded-xl border border-gray-300 bg-white px-4 text-lg focus:border-maroon-700 focus:outline-none focus:ring-2 focus:ring-maroon-100 ${props.className ?? ""}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5 ${className}`}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function Spinner() {
  const { t } = useTranslation();
  return <p className="p-6 text-center text-gray-500">{t("common.loading")}</p>;
}

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const next = i18n.language === "hi" ? "en" : "hi";
  return (
    <button
      onClick={() => i18n.changeLanguage(next)}
      className="rounded-full border border-maroon-700 px-3 py-1 text-sm font-semibold text-maroon-800 bg-white"
      aria-label="Change language"
    >
      {i18n.language === "hi" ? "English" : "हिंदी"}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const color: Record<string, string> = {
    verified: "bg-green-100 text-green-800",
    success: "bg-green-100 text-green-800",
    received: "bg-green-100 text-green-800",
    claimed: "bg-amber-100 text-amber-800",
    awaiting_counter: "bg-amber-100 text-amber-800",
    pending: "bg-gray-100 text-gray-700",
    rejected: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color[status] ?? "bg-gray-100"}`}>
      {t(`status.${status}`)}
    </span>
  );
}
