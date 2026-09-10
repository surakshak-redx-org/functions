import * as admin from 'firebase-admin';

// Initialize the Admin SDK exactly once. In the Cloud Functions runtime
// `initializeApp()` picks up the project's default credentials automatically.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const messaging = admin.messaging();
export const auth = admin.auth();

// Re-exported so call sites can build sentinel values without importing
// `firebase-admin` directly.
export const FieldValue = admin.firestore.FieldValue;
