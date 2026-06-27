import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  ServerInitializationError,
  parseServiceAccountEnv
} from "./firebase-credentials.mjs";

const APP_NAME = "hau-secure-auth";
let cachedServicesPromise = null;

function runStage(code, message, operation) {
  try {
    return operation();
  } catch (error) {
    throw new ServerInitializationError(code, message, error);
  }
}

async function initializeFirebaseAdmin() {
  const serviceAccount = parseServiceAccountEnv();

  const app = runStage(
    "firebase_app_initialization_failed",
    "Firebase Admin app initialization failed.",
    () => {
      const existingApp = getApps().find((candidate) => candidate.name === APP_NAME);
      return existingApp || initializeApp(
        {
          credential: cert(serviceAccount),
          projectId: serviceAccount.projectId
        },
        APP_NAME
      );
    }
  );

  const auth = runStage(
    "firebase_auth_initialization_failed",
    "Firebase Admin Auth initialization failed.",
    () => getAuth(app)
  );

  const db = runStage(
    "firebase_firestore_initialization_failed",
    "Firebase Admin Firestore initialization failed.",
    () => getFirestore(app)
  );

  // Do not create a custom token in the health path. Token creation is a
  // separate business operation and must not make basic backend readiness fail.
  return Object.freeze({ app, auth, db });
}

export async function getFirebaseAdmin() {
  if (!cachedServicesPromise) {
    cachedServicesPromise = initializeFirebaseAdmin().catch((error) => {
      cachedServicesPromise = null;
      throw error;
    });
  }
  return cachedServicesPromise;
}
