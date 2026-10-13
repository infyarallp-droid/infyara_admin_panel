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

/** Best human-readable message for a failed request. */
export async function apiError(e: unknown, fallback = 'Something went wrong. Please try again.'): Promise<string> {
  const err = e as { response?: { data?: unknown }; code?: string };
  let data = err?.response?.data;
  // File downloads are requested as blobs, so their JSON error body arrives as a Blob too.
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      data = undefined;
    }
  }
  const message = (data as { error?: unknown } | undefined)?.error;
  if (typeof message === 'string' && message) return message;
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection and try again.';
  return fallback;
}

async function protectedBlobUrl(path: string): Promise<string> {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  return url;
}

/**
 * Open a protected file (invoice / receipt / consent PDF, signed scan) in a new
 * tab. A plain <a href> cannot send the login token, so the file is fetched
 * with it and shown from memory.
 */
export async function openProtected(path: string): Promise<void> {
  // Open the tab synchronously (inside the click) so pop-up blockers allow it.
  const tab = window.open('', '_blank');
  try {
    const url = await protectedBlobUrl(path);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Send a protected PDF straight to the browser's print dialog. */
export async function printProtected(path: string): Promise<void> {
  const url = await protectedBlobUrl(path);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 5 * 60_000);
}
