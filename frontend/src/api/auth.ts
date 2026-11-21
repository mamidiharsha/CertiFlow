import client from './client';
import type { User } from '../types';

export async function login(email: string, password: string): Promise<User> {
  const { data } = await client.post('/auth/login', { email, password });
  return data.user;
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout');
}

export async function getMe(): Promise<User> {
  const { data } = await client.get('/auth/me');
  return data.user;
}

export async function switchUser(email: string): Promise<User> {
  const { data } = await client.post('/auth/switch-user', { email });
  return data.user;
}
