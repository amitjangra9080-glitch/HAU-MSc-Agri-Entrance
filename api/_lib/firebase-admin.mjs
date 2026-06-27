import { parseServiceAccountEnv } from "./firebase-credentials.mjs";

const APP_NAME = "hau-secure-auth";
let cachedServicesPromise = null;

async function initializeFirebaseAdmin() {
  // Parse first. Missing or malformed Vercel variables then fail without
  // attempting to load Firebase Admin, producing a precise safe reason.
  const serviceAccount = parseServiceAccountEnv();

  const [appModule, authModule, firestoreModule] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
    import("firebase-admin/firestore")
  ]);

  const existingApp = appModule.getApps()
    .find((candidate) => candidate.name === APP_NAME);

  const app = existingApp || appModule.initializeApp(
    {
      credential: appModule.cert(serviceAccount),
      projectId: serviceAccount.projectId
    },
    APP_NAME
  );

  return Object.freeze({
    app,
    auth: authModule.getAuth(app),
    db: firestoreModule.getFirestore(app)
  });
}

export async function getFirebaseAdmin() {
  if (!cachedServicesPromise) {
    cachedServicesPromise = initializeFirebaseAdmin().catch((error) => {
      // Do not cache failed initialization; a warm function may retry after
      // environment configuration is corrected and a new deployment is made.
      cachedServicesPromise = null;
      throw error;
    });
  }

  return cachedServicesPromise;
}
