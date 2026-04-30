import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";

import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import AccountsPage from "@/pages/accounts";
import AccountDetailPage from "@/pages/account-detail";
import TransactionsPage from "@/pages/transactions";
import ImportPage from "@/pages/import";
import BillsPage from "@/pages/bills";
import BusinessesPage from "@/pages/businesses";
import CategoriesPage from "@/pages/categories";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function ProtectedRouter() {
  const { authed, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && authed === false && location !== "/login") {
      setLocation("/login");
    }
    if (!loading && authed === true && location === "/login") {
      setLocation("/");
    }
  }, [authed, loading, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (location === "/login") {
    return <LoginPage />;
  }

  if (!authed) return null;

  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/accounts" component={AccountsPage} />
        <Route path="/accounts/:id" component={AccountDetailPage} />
        <Route path="/transactions" component={TransactionsPage} />
        <Route path="/import" component={ImportPage} />
        <Route path="/bills" component={BillsPage} />
        <Route path="/businesses" component={BusinessesPage} />
        <Route path="/categories" component={CategoriesPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <ProtectedRouter />
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
