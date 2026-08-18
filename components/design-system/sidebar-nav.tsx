"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/new-content", label: "New Content" },
  { href: "/business-profiles", label: "Business Profiles" },
  { href: "/brand-voice", label: "Brand Voice" },
  { href: "/settings", label: "Settings" },
];

/**
 * Design V1's frozen sidebar nav (5 items). Routes that aren't built
 * yet still navigate to a real "coming soon" page rather than being
 * disabled — Design V1 never specified a disabled-nav-item treatment.
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "rounded-[8px] px-2.5 py-2.5 font-sans text-[13.5px] transition-colors " +
              (active
                ? "bg-secondary font-medium text-text-primary"
                : "text-text-secondary hover:bg-secondary")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
