import axios from 'axios';
import toast from 'react-hot-toast';

const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred';

    if (error.response?.status === 401) {
      // Don't toast on 401 for /auth/me (initial auth check)
      if (!error.config?.url?.includes('/auth/me')) {
        toast.error('Session expired. Please login again.');
      }
    } else if (error.response?.status !== 422) {
      // Don't toast validation errors — let the caller handle those
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

export default client;
