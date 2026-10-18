import Link from "next/link";

export function Header({ active }: { active?: "chat" | "history" | "settings" }) {
  return (
    <header className="header">
      <Link href="/" className="brand" aria-label="Vortra home">
        <span className="brand-dot" aria-hidden />
        Vortra
      </Link>
      <nav>
        <Link href="/" className={`navlink ${active === "chat" ? "active" : ""}`}>Chat</Link>
        <Link href="/history" className={`navlink ${active === "history" ? "active" : ""}`}>History</Link>
        <Link href="/settings" className={`navlink ${active === "settings" ? "active" : ""}`}>Settings</Link>
      </nav>
    </header>
  );
}
