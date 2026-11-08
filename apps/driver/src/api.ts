import * as SecureStore from 'expo-secure-store';

/**
 * Driver app API client. The session token and this device's id live in the device keystore
 * (expo-secure-store). The server binds the account to one device id (ACC-06).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'aw.session';
const DEVICE_KEY = 'aw.deviceId';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** A random id made once per install. Not a secret: it names this device to the server. */
export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  const id = `dev-${Date.now().toString(36)}-${hex()}${hex()}${hex()}${hex()}`;
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}

export async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  const token = auth ? await getToken() : null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection to Airwheels. Check your data and try again.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string | string[];
  } & T;
  if (!res.ok) {
    const msg = Array.isArray(data.message)
      ? data.message.join(', ')
      : (data.message ?? 'Something went wrong.');
    throw new ApiError(res.status, data.code ?? 'ERROR', msg);
  }
  return data;
}

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
  onDuty: boolean;
  vehicle: { plate: string; brand: string; model: string; colour: string } | null;
}
