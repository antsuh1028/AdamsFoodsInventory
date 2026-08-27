import axios from "axios";
import { API_BASE_URL } from "../config/api";

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

// Attach JWT token to every request automatically
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = token;
  }
  return config;
});

// Handle 401 by refreshing token
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = token;
            return axiosInstance(originalRequest);
          })
          .catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        localStorage.removeItem("token");
        window.location.href = "/";
        return Promise.reject(error);
      }

      return axiosInstance
        .post("/refresh", { refreshToken })
        .then(({ data }) => {
          const { token } = data;
          localStorage.setItem("token", token);
          axiosInstance.defaults.headers.common.Authorization = token;
          originalRequest.headers.Authorization = token;
          processQueue(null, token);
          return axiosInstance(originalRequest);
        })
        .catch((err) => {
          localStorage.removeItem("token");
          localStorage.removeItem("refreshToken");
          window.location.href = "/";
          processQueue(err, null);
          return Promise.reject(err);
        })
        .finally(() => {
          isRefreshing = false;
        });
    }

    if (error.response?.status === 403) {
      localStorage.removeItem("token");
      localStorage.removeItem("refreshToken");
      window.location.href = "/";
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
