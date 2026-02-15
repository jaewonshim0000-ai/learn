
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ─── Replace these with your Firebase project credentials ───
// Go to: https://console.firebase.google.com
// 1. Create a new project (or use existing)
// 2. Add a Web app
// 3. Copy the config object here
// 4. Enable Firestore Database (in test mode for hackathon)
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
