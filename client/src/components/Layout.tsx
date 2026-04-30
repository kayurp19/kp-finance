import { Link, useLocation } from "wouter";
import { ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Wallet, ListTree, Upload, Calendar,
  Tags, BarChart3, Settings, Sun, Moon, LogOut, Building2, Plus,
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

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <Logo className="h-7 w-7 text-primary" />
          <div>
            <div className="font-semibold text-[15px] leading-none text-sidebar-foreground">KP Finance</div>
            <div className="text-[11px] text-muted-foreground mt-1 tracking-wide">Personal money tracker</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {NAV.map((item) => {
            const active = item.exact ? location === item.href : location === item.href || location.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors hover-elevate ${
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
        <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
          <button
            onClick={toggle}
            data-testid="button-theme-toggle"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-sidebar-foreground/80 hover-elevate"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={() => logout()}
            data-testid="button-logout"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-sidebar-foreground/80 hover-elevate"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 relative">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar">
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
