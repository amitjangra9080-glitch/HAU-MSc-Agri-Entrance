window.firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

window.hasFirebaseConfig = Boolean(
  window.firebaseConfig.apiKey &&
    window.firebaseConfig.authDomain &&
    window.firebaseConfig.projectId &&
    window.firebaseConfig.appId
);
