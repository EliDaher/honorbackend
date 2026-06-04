import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { env } from './env.js';

export function initFirebase() {
  if (admin.apps.length > 0) return admin.app();

  if (!env.FIREBASE_DATABASE_URL) {
    console.warn('FIREBASE_DATABASE_URL is not set. Firebase is disabled.');
    return null;
  }

  let credential: admin.credential.Credential | undefined;

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(serviceAccount);
  } else if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const raw = readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
    credential = admin.credential.cert(JSON.parse(raw));
  }

  if (!credential) {
    console.warn('Firebase credentials not found. Firebase is disabled.');
    return null;
  }

  return admin.initializeApp({
    credential,
    databaseURL: env.FIREBASE_DATABASE_URL
  });
}

export const firebaseApp = initFirebase();
export const db = firebaseApp ? admin.database() : null;
