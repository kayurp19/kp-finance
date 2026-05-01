import { Link, useLocation } from "wouter";
import { ReactNode, useState, useEffect } from "react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Wallet, ListTree, Upload, Calendar,
  Tags, BarChart3, Settings, Sun, Moon, LogOut, Building2, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { QuickAddButton } from "@/components/QuickAddDialog";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ListTree },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/bills", label: "Bills", icon: Calendar },
  { href: "/businesses", label: "Reimbursements", icon: Building2 },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile nav whenever the route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  const NavList = (
    <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
      {NAV.map((item) => {
        const active = item.exact ? location === item.href : location === item.href || location.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <a
              data-testid={`nav-${item.label.toLowerCase()}`}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[13px] font-medium transition-colors hover-elevate ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80"
              }`}
            >
              <Icon className="h-[15px] w-[15px]" />
              {item.label}
            </a>
          </Link>
        );
      })}
    </nav>
  );

  const NavFooter = (
    <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
      <button
        onClick={toggle}
        data-testid="button-theme-toggle"
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[13px] text-sidebar-foreground/80 hover-elevate"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
      <button
        onClick={() => logout()}
        data-testid="button-logout"
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[13px] text-sidebar-foreground/80 hover-elevate"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <Logo className="h-7 w-7 text-primary" />
          <div>
            <div className="font-semibold text-[15px] leading-none text-sidebar-foreground">KP Finance</div>
            <div className="text-[11px] text-muted-foreground mt-1 tracking-wide">Personal money tracker</div>
          </div>
        </div>
        {NavList}
        {NavFooter}
      </aside>

      {/* Mobile slide-out drawer */}
      {mobileNavOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            data-testid="mobile-nav-backdrop"
          />
          <aside
            className="md:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-sidebar border-r border-sidebar-border shadow-xl"
            data-testid="mobile-nav-drawer"
          >
            <div className="px-5 pt-5 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Logo className="h-7 w-7 text-primary" />
                <div>
                  <div className="font-semibold text-[15px] leading-none text-sidebar-foreground">KP Finance</div>
                  <div className="text-[11px] text-muted-foreground mt-1 tracking-wide">Personal money tracker</div>
                </div>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="text-sidebar-foreground/80"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {NavList}
            {NavFooter}
          </aside>
        </>
      )}

      <main className="flex-1 min-w-0 relative">
        {/* Mobile top bar with hamburger */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 -ml-1.5 rounded-md hover-elevate"
            data-testid="button-mobile-menu"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-primary" />
            <span className="font-semibold">KP Finance</span>
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} data-testid="button-theme-toggle-mobile">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
        {children}
        <QuickAddButton />
      </main>
    </div>
  );
}
