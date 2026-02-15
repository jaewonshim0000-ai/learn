import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// ─── Replace these with your Firebase project credentials ───
// 1. https://console.firebase.google.com → Create project
// 2. Add a Web app → copy config here
// 3. Firestore Database → Create database (test mode)
// 4. Authentication → Sign-in method → Enable "Google"
const firebaseConfig = {
  apiKey: "AIzaSyC4lMzBNlfLiIZatf7Vl7Rp-njlL61Reok",
  authDomain: "facefusion-e40mn.firebaseapp.com",
  projectId: "facefusion-e40mn",
  storageBucket: "facefusion-e40mn.firebasestorage.app",
  messagingSenderId: "559484426873",
  appId: "1:559484426873:web:8b742ed3013e9c54a552a8"
};


const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();


