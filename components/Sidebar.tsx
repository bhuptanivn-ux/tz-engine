"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Hover-activated: collapsed to a thin strip at the left edge, expands into
// the full nav panel only while the cursor is over that strip (or the panel
// itself) -- CSS-only (.sidebar-hover-zone:hover .sidebar-panel in
// globals.css), no JS state needed.
export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="sidebar-hover-zone">
      <div className="sidebar-trigger" aria-hidden="true" />
      <nav className="sidebar-panel" aria-label="Pages">
        <div className="sidebar-title">Pages</div>
        <Link href="/" className={pathname === "/" ? "sidebar-link active" : "sidebar-link"}>
          Trading Zone
        </Link>
        <Link
          href="/entry-zone"
          className={pathname === "/entry-zone" ? "sidebar-link active" : "sidebar-link"}
          onClick={() => {
            // Same route -- Next.js won't remount the page, so tell it
            // directly to drop any Search/Year filter and show the main,
            // unfiltered Prime Trend list again.
            if (pathname === "/entry-zone") {
              window.dispatchEvent(new Event("prime-trend-filters-reset"));
            }
          }}
        >
          Prime Trend
        </Link>
      </nav>
    </div>
  );
}
