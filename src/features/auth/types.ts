export type AppRole = 'admin' | 'staff';

export type Profile = {
  id: string;
  organization_id: string;
  email: string;
  display_name: string | null;
  role: AppRole;
  active: boolean;
};

