import axios, { AxiosError } from "axios";

for (const key of ["access_token", "refresh_token", "user_profile"])
  localStorage.removeItem(key);
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 15000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});
api.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError) => {
    const path = error.config?.url || "";
    if (error.response?.status === 401 && !path.includes("/auth/login"))
      window.dispatchEvent(new Event("infranexus:unauthorized"));
    return Promise.reject(error);
  },
);
