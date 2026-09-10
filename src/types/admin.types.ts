/**
 * Admin users live in Firestore `admins/{uid}`. This collection is owned by the
 * Phase 9 admin dashboard (surakshak-redx-org/admin) — it does not exist yet.
 * Until it is populated, functions that read it simply find no recipients.
 */

export type AdminRole = 'admin' | 'super_admin';

/** Mirrors Firestore `admins/{uid}`. */
export interface AdminUser {
  uid: string;
  email: string;
  fcmToken?: string;
  role: AdminRole;
  createdAt: FirebaseFirestore.Timestamp;
}
