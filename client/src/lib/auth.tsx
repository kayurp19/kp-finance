import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiRequest } from "./queryClient";

const AuthContext = createContext<{
  authed: boolean | null;
  loading: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}>({
  authed: null,
  loading: true,
  login: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await apiRequest("GET", "/api/me");
      const data = await res.json();
      setAuthed(!!data.authed);
    } catch {
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const login = async (password: string) => {
    try {
      await apiRequest("POST", "/api/login", { password });
      setAuthed(true);
      return true;
    } catch {
      return false;
    }
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/logout");
    } catch {}
    setAuthed(false);
    window.location.hash = "#/login";
  };

  return (
    <AuthContext.Provider value={{ authed, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
