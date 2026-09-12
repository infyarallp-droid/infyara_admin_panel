import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokens } from './api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokens.access) {
      setLoading(false);
      return;
    }
    api
      .get('/api/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.post('/api/auth/login', { email, password });
    tokens.set(r.data.accessToken, r.data.refreshToken);
    setUser(r.data.user);
  };

  const logout = () => {
    tokens.clear();
    setUser(null);
    window.location.href = '/login';
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}
