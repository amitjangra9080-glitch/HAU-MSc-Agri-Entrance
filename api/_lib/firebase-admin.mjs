import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { parseServiceAccountEnv } from "./firebase-credentials.mjs";

const APP_NAME = "hau-secure-auth";
let cachedServicesPromise = null;

async function initializeFirebaseAdmin() {
  const serviceAccount = parseServiceAccountEnv();
  const existingApp = getApps().find((candidate) => candidate.name === APP_NAME);
  const app = existingApp || initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId
    },
    APP_NAME
  );

  const auth = getAuth(app);
  const db = getFirestore(app);

  // Force local RSA signing now. This catches corrupted or mismatched PEM data
  // during the health check instead of during a later registration request.
  const token = await auth.createCustomToken("phase2-backend-health-check");
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Firebase Admin custom-token signing failed.");
  }

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
