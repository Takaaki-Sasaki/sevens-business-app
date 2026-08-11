import type { AppRole } from '../auth/types';

export type ManagedUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateManagedUserInput = {
  displayName: string;
  email: string;
  password: string;
  role: AppRole;
};

export type UpdateManagedUserInput = {
  userId: string;
  displayName: string;
  role: AppRole;
  active: boolean;
};
