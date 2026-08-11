import { requireSupabase } from '../../shared/lib/supabase';
import { normalizeDisplayName } from './userValidation';
import type { CreateManagedUserInput, ManagedUser, UpdateManagedUserInput } from './types';

type FunctionFailure = { error?: unknown };

function hasJsonBody(value: unknown): value is { clone: () => { json: () => Promise<unknown> } } {
  return !!value && typeof value === 'object'
    && 'clone' in value
    && typeof (value as { clone?: unknown }).clone === 'function';
}

async function functionErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: unknown }).context;
  if (!hasJsonBody(context)) return null;
  try {
    const payload = await context.clone().json() as FunctionFailure;
    return typeof payload.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
}

async function invokeAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('admin-users', { body });
  if (error) {
    const message = await functionErrorMessage(error);
    if (message) throw new Error(message);
    throw error;
  }
  return data as T;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const result = await invokeAdminUsers<{ users: ManagedUser[] }>({ action: 'list' });
  return result.users;
}

export async function createManagedUser(input: CreateManagedUserInput): Promise<ManagedUser> {
  const result = await invokeAdminUsers<{ user: ManagedUser }>({
    action: 'create',
    email: input.email.trim().toLocaleLowerCase(),
    display_name: normalizeDisplayName(input.displayName),
    password: input.password,
    role: input.role,
  });
  return result.user;
}

export async function updateManagedUser(input: UpdateManagedUserInput): Promise<ManagedUser> {
  const result = await invokeAdminUsers<{ user: ManagedUser }>({
    action: 'update',
    user_id: input.userId,
    display_name: normalizeDisplayName(input.displayName),
    role: input.role,
    active: input.active,
  });
  return result.user;
}

export async function resetManagedUserPassword(userId: string, password: string): Promise<void> {
  await invokeAdminUsers<{ ok: true }>({ action: 'reset_password', user_id: userId, password });
}
