import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const APP_NAME = "hau-secure-auth";
let cachedServices = null;

function requiredText(value, fieldName) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Missing server credential field: ${fieldName}.`);
  }
  return text;
}

function normalizeServiceAccount(value) {
  const projectId = requiredText(value?.project_id ?? value?.projectId, "project_id");
  const clientEmail = requiredText(value?.client_email ?? value?.clientEmail, "client_email");
  const privateKey = requiredText(value?.private_key ?? value?.privateKey, "private_key")
    .replace(/\\n/g, "\n");

  return { projectId, clientEmail, privateKey };
}

export function parseServiceAccountEnv(environment = process.env) {
  const jsonCredential = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();

  if (jsonCredential) {
    let parsed;
    try {
      parsed = JSON.parse(jsonCredential);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    return normalizeServiceAccount(parsed);
  }

  return normalizeServiceAccount({
    projectId: environment.FIREBASE_PROJECT_ID,
    clientEmail: environment.FIREBASE_CLIENT_EMAIL,
    privateKey: environment.FIREBASE_PRIVATE_KEY
  });
}

export function getFirebaseAdmin() {
  if (cachedServices) return cachedServices;

  const serviceAccount = parseServiceAccountEnv();
  const existingApp = getApps().find((candidate) => candidate.name === APP_NAME);
  const app = existingApp || initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId
    },
    APP_NAME
  );

  cachedServices = Object.freeze({
    app,
    auth: getAuth(app),
    db: getFirestore(app)
  });

  return cachedServices;
}
