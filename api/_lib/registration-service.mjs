export class RegistrationServiceError extends Error {
  constructor(code, message, status = 500, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = "RegistrationServiceError";
    this.code = code;
    this.status = status;
  }
}

function conflict(code, message) {
  return new RegistrationServiceError(code, message, 409);
}

function authFailure(error) {
  const code = String(error?.code || "");

  if (code === "auth/email-already-exists") {
    return conflict("email_in_use", "This email is already linked to an account. Sign in instead.");
  }
  if (code === "auth/invalid-email") {
    return new RegistrationServiceError("invalid_email", "Valid email format required.", 400, error);
  }
  if (code === "auth/invalid-password") {
    return new RegistrationServiceError("invalid_password", "Password does not meet the required format.", 400, error);
  }
  if (code === "auth/insufficient-permission") {
    return new RegistrationServiceError(
      "firebase_permission_denied",
      "Registration service is temporarily unavailable.",
      503,
      error
    );
  }

  return new RegistrationServiceError(
    "firebase_auth_create_failed",
    "Registration service is temporarily unavailable.",
    503,
    error
  );
}

function profileData(data, uid, createdAt) {
  return {
    uid,
    displayName: data.displayName,
    admissionNumber: data.admissionNumber,
    campus: data.campus,
    programme: data.programme,
    academicStatus: data.academicStatus,
    email: data.email,
    phone: data.phone,
    active: false,
    deactivated: false,
    createdAt
  };
}

async function registrationWasCommitted(db, data, uid) {
  try {
    const [userSnap, admissionSnap, phoneSnap] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("admissionNumbers").doc(data.admissionNumber).get(),
      db.collection("phones").doc(data.phone).get()
    ]);

    return Boolean(
      userSnap.exists
      && admissionSnap.exists
      && phoneSnap.exists
      && userSnap.data()?.uid === uid
      && admissionSnap.data()?.uid === uid
      && phoneSnap.data()?.uid === uid
    );
  } catch {
    return false;
  }
}

async function rollbackAuthUser(auth, uid, originalError) {
  try {
    await auth.deleteUser(uid);
  } catch (rollbackError) {
    console.error("Atomic registration rollback failed", {
      uid,
      originalCode: String(originalError?.code || "").slice(0, 120),
      rollbackCode: String(rollbackError?.code || "").slice(0, 120)
    });
    throw new RegistrationServiceError(
      "registration_rollback_failed",
      "Registration could not be completed safely. Please contact support before trying again.",
      503,
      rollbackError
    );
  }
}

export async function createAtomicRegistration(data, services, options = {}) {
  const { auth, db } = services || {};
  if (!auth || !db) {
    throw new RegistrationServiceError(
      "firebase_services_incomplete",
      "Registration service is temporarily unavailable.",
      503
    );
  }

  const now = typeof options.now === "function" ? options.now : () => new Date();
  let authUser;

  try {
    authUser = await auth.createUser({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      emailVerified: false,
      disabled: false
    });
  } catch (error) {
    throw authFailure(error);
  }

  const uid = authUser.uid;
  const userRef = db.collection("users").doc(uid);
  const admissionRef = db.collection("admissionNumbers").doc(data.admissionNumber);
  const phoneRef = db.collection("phones").doc(data.phone);

  try {
    await db.runTransaction(async (transaction) => {
      const [admissionSnap, phoneSnap, userSnap] = await transaction.getAll(
        admissionRef,
        phoneRef,
        userRef
      );

      if (admissionSnap.exists) {
        throw conflict(
          "admission_in_use",
          "An account already exists with this admission number. Sign in or reset your password."
        );
      }
      if (phoneSnap.exists) {
        throw conflict(
          "phone_in_use",
          "This phone number is already linked to an account. Sign in or recover your account."
        );
      }
      if (userSnap.exists) {
        throw new RegistrationServiceError(
          "user_profile_conflict",
          "Registration service is temporarily unavailable.",
          503
        );
      }

      const createdAt = now();
      transaction.create(userRef, profileData(data, uid, createdAt));
      transaction.create(admissionRef, {
        uid,
        email: data.email,
        createdAt
      });
      transaction.create(phoneRef, {
        uid,
        createdAt
      });
    });
  } catch (error) {
    if (await registrationWasCommitted(db, data, uid)) {
      return {
        uid,
        email: data.email,
        displayName: data.displayName,
        admissionNumber: data.admissionNumber
      };
    }

    await rollbackAuthUser(auth, uid, error);

    if (error instanceof RegistrationServiceError) throw error;
    throw new RegistrationServiceError(
      "registration_persistence_failed",
      "Registration service is temporarily unavailable.",
      503,
      error
    );
  }

  return {
    uid,
    email: data.email,
    displayName: data.displayName,
    admissionNumber: data.admissionNumber
  };
}
