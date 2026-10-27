import axios from 'axios';

const client = axios.create({ baseURL: '/api/v1', timeout: 20000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('devintel-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('devintel-token');
      window.dispatchEvent(new Event('devintel:unauthorized'));
    }
    const message = error.response?.data?.error ?? error.message ?? 'The request failed';
    return Promise.reject(new Error(message));
  }
);

export async function api(path, options = {}) {
  const response = await client.request({
    url: path,
    method: options.method ?? 'GET',
    data: options.body,
    headers: options.headers
  });
  return response.status === 204 ? null : response.data;
}
