/**
 * Shared types for the Admin sub-pages.
 *
 * Mirrored from backend/src/auth.ts (publicUser shape and PremiumKey row).
 */

export interface AdminUser {
  id: number;
  username: string;
  is_admin: 0 | 1;
  premium_until: number | null;
  created_at: number;
  last_login_at: number | null;
}

export interface AdminKey {
  key: string;
  days: number;
  note: string | null;
  created_by: number | null;
  created_at: number;
  used_by: number | null;
  used_at: number | null;
}
