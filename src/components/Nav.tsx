"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "This month" },
  { href: "/import", label: "Import" },
  { href: "/transactions", label: "Transactions" },
  { href: "/months", label: "Months" },
  { href: "/forecast", label: "Forecast" },
  { href: "/trends", label: "Trends" },
  { href: "/accounts", label: "Accounts" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        Head<span>room</span>
      </div>
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className="navlink"
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
      <div className="foot">Local-first. Your data never leaves this machine.</div>
    </nav>
  );
}
