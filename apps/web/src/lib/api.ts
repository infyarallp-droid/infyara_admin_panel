import axios from 'axios';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export const api = axios.create({ baseURL: API });

const ACCESS = 'moksha_access';
const REFRESH = 'moksha_refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS);
  },
  get refresh() {
    return localStorage.getItem(REFRESH);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

api.interceptors.request.use((config) => {
  const t = tokens.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && tokens.refresh) {
      original._retry = true;
      refreshing ??= axios
        .post(`${API}/api/auth/refresh`, { refreshToken: tokens.refresh })
        .then((res) => {
          tokens.set(res.data.accessToken, res.data.refreshToken);
          return res.data.accessToken as string;
        })
        .catch(() => {
          tokens.clear();
          return null;
        })
        .finally(() => {
          refreshing = null;
        });
      const newToken = await refreshing;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export { API };
