// @ts-nocheck
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { db, auth, googleProvider } from "./firebase";
import {
  collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp,
  doc, getDoc, setDoc, updateDoc, increment,
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithPopup, signOut,
} from "firebase/auth";

// ─────────────────────────────────────────────────────────────
// EduVision — AI-Powered Educational Question Generator
// ─────────────────────────────────────────────────────────────

const SUBJECTS = [
  { id: "math", label: "Mathematics", icon: "∑", color: "#E8553A", bg: "#FEF0ED", strategy: "numerical problems, measurements, calculations, geometry, patterns, statistics, ratios" },
  { id: "english", label: "English", icon: "Aa", color: "#2B7A5F", bg: "#EDF7F3", strategy: "creative writing prompts, descriptive exercises, vocabulary, grammar in context, narrative techniques" },
  { id: "science", label: "Science", icon: "⚛", color: "#3A6BE8", bg: "#EDF2FE", strategy: "hypothesis formation, observation-based questions, scientific principles, cause and effect, classification" },
  { id: "history", label: "History", icon: "⏳", color: "#9B5DE5", bg: "#F4EDFB", strategy: "contextual analysis, timeline questions, cultural significance, historical parallels, primary source analysis" },
  { id: "art", label: "Art & Design", icon: "◐", color: "#D4851F", bg: "#FDF4EA", strategy: "composition analysis, color theory, artistic techniques, design principles, aesthetic interpretation" },
];

const DIFFICULTY_LEVELS = [
  { id: "elementary", label: "Elementary", ages: "Ages 6–10" },
  { id: "middle", label: "Middle School", ages: "Ages 11–14" },
  { id: "high", label: "High School", ages: "Ages 15–18" },
];

const TABS = [
  { id: "create", label: "Create", icon: "✦" },
  { id: "explore", label: "Explore Nearby", icon: "◎" },
  { id: "my", label: "My Questions", icon: "✎" },
];

// ─── Rarity system ───
const RARITIES = [
  { id: "common",    label: "Common",    points: 10,  color: "#667085", bg: "#F4F5F7", border: "#D0D5DD", glow: "none",                              weight: 50, icon: "○" },
  { id: "uncommon",  label: "Uncommon",  points: 25,  color: "#2B7A5F", bg: "#ECFDF3", border: "#6CE9A6", glow: "none",                              weight: 30, icon: "◆" },
  { id: "rare",      label: "Rare",      points: 50,  color: "#3A6BE8", bg: "#EDF2FE", border: "#93B4FD", glow: "0 0 8px rgba(58,107,232,0.3)",       weight: 13, icon: "★" },
  { id: "epic",      label: "Epic",      points: 100, color: "#9B5DE5", bg: "#F4EDFB", border: "#C4A1F0", glow: "0 0 12px rgba(155,93,229,0.4)",      weight: 5,  icon: "◈" },
  { id: "legendary", label: "Legendary", points: 250, color: "#D4851F", bg: "#FFF7ED", border: "#F6C270", glow: "0 0 16px rgba(212,133,31,0.5)",      weight: 2,  icon: "✦" },
];

function rollRarity() {
  const totalWeight = RARITIES.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const r of RARITIES) {
    roll -= r.weight;
    if (roll <= 0) return r.id;
  }
  return "common";
}

function getRarity(id) {
  return RARITIES.find((r) => r.id === id) || RARITIES[0];
}

// ─── Map icons ───
function createSubjectIcon(color, icon) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="${color}" stroke="#fff" stroke-width="2"/>
    <circle cx="18" cy="16" r="10" fill="#fff" opacity="0.9"/>
    <text x="18" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="${color}" font-family="sans-serif">${icon}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [36, 46], iconAnchor: [18, 46], popupAnchor: [0, -40] });
}

function createUserIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="#3A6BE8" stroke="#fff" stroke-width="3"/>
    <circle cx="12" cy="12" r="4" fill="#fff"/>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [24, 24], iconAnchor: [12, 12] });
}

function RecenterMap({ lat, lng, zoom }) {
  const map = useMap();
  useEffect(() => { if (lat && lng) map.setView([lat, lng], zoom || map.getZoom()); }, [lat, lng, zoom]);
  return null;
}

// ─── Utilities ───
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
  if (m < 100) return `${Math.round(m)}m away`;
  if (m < 1000) return `${Math.round(m / 10) * 10}m away`;
  if (m < 10000) return `${(m / 1000).toFixed(1)}km away`;
  return `${Math.round(m / 1000)}km away`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function radiusToZoom(r) {
  if (r <= 1000) return 15;
  if (r <= 5000) return 13;
  if (r <= 25000) return 11;
  return 9;
}

// ─── Prompts & API ───
function buildSystemPrompt(subject, difficulty) {
  const subj = SUBJECTS.find((s) => s.id === subject);
  return `You are an expert educational content creator specializing in ${subj.label}.

Your task: Analyze the provided image and generate ONE high-quality multiple-choice question (4 choices) that meaningfully incorporates specific visual elements from the image within the framework of ${subj.label}.

Subject-specific strategies: ${subj.strategy}
Difficulty: ${difficulty.label} (${difficulty.ages})

CRITICAL RULES:
1. Identify specific objects, actions, scenes, quantities, colors, patterns, spatial relationships visible in the image.
2. Map those visual elements to educational concepts in ${subj.label}.
3. The question MUST require the student to reference or think about the image.
4. If the image has no clear connection to ${subj.label}, creatively bridge the gap.
5. Make the question age-appropriate for ${difficulty.ages}.
6. Create exactly 4 answer choices (A, B, C, D). Only ONE should be correct.
7. Wrong answers should be plausible but clearly incorrect to someone who understands the concept.
8. Do NOT make the correct answer obvious by length or phrasing.

Respond in this exact JSON format (no markdown, no backticks):
{
  "image_analysis": "Brief description of key elements observed in the image",
  "question": "The multiple-choice question text",
  "choices": {
    "A": "First answer choice",
    "B": "Second answer choice",
    "C": "Third answer choice",
    "D": "Fourth answer choice"
  },
  "correct_answer": "A",
  "explanation": "Brief explanation of why the correct answer is right",
  "hint": "A helpful hint for the student (do NOT reveal the answer)",
  "learning_objective": "What concept or skill this question targets",
  "why_this_image": "How the image specifically connects to this question (1 sentence)"
}`;
}

async function generateQuestionAPI(base64Image, mediaType, subject, difficulty) {
  const diffObj = DIFFICULTY_LEVELS.find((d) => d.id === difficulty);
  const response = await fetch("/api/anthropic/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: buildSystemPrompt(subject, diffObj),
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: `Analyze this image and generate an educational ${SUBJECTS.find((s) => s.id === subject).label} question at the ${diffObj.label} level. The question must specifically reference elements visible in this image.` },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error: ${response.status}`);
  }
  const data = await response.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── File helpers ───
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: reader.result.split(",")[1], mediaType: file.type || "image/jpeg" });
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxDim = 300, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = URL.createObjectURL(file);
  });
}

// ─── Firestore helpers ───
async function publishQuestionToFirestore(questionData) {
  const docRef = await addDoc(collection(db, "questions"), {
    ...questionData,
    createdAt: serverTimestamp(),
    timestamp: Date.now(),
  });
  return docRef.id;
}

async function loadAllQuestions() {
  const q = query(collection(db, "questions"), orderBy("timestamp", "desc"), limit(200));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function loadNearbyQuestions(userLat, userLng, radiusMeters = 50000) {
  const allQuestions = await loadAllQuestions();
  return allQuestions
    .map((q) => ({ ...q, distance: haversineDistance(userLat, userLng, q.lat, q.lng) }))
    .filter((q) => q.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 30);
}

async function loadUserQuestions(uid) {
  const allQuestions = await loadAllQuestions();
  return allQuestions.filter((q) => q.uid === uid);
}

// ─── Geolocation helper (standalone, not a hook) ───
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocation not supported by your browser."));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === 1) reject(new Error("Location access denied. Please enable permissions."));
        else if (err.code === 2) reject(new Error("Location unavailable. Try again."));
        else reject(new Error("Location request timed out."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// ══════════════════════════════════════════════════════════════
// Login Screen — Google Sign-In
// ══════════════════════════════════════════════════════════════
function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user") {
        setError("Sign-in cancelled. Try again.");
      } else if (err.code === "auth/popup-blocked") {
        setError("Pop-up blocked by browser. Please allow pop-ups and try again.");
      } else {
        setError(err.message || "Sign-in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={LS.backdrop}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={LS.card}>
        <div style={LS.logoRow}>
          <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#1A1A2E" />
            <circle cx="10" cy="11" r="4" stroke="#E8553A" strokeWidth="1.5" fill="none" />
            <path d="M18 9l-2 4h5l-3 6" stroke="#3A6BE8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1 style={LS.title}>EduVision</h1>
            <p style={LS.subtitle}>AI Questions · Geo-Pinned Learning</p>
          </div>
        </div>

        <div style={LS.divider} />

        <h2 style={LS.heading}>Welcome to EduVision</h2>
        <p style={LS.desc}>Sign in to create AI-powered questions from images and pin them to real-world locations for others to discover.</p>

        <button onClick={handleGoogleSignIn} disabled={loading} style={LS.googleBtn}>
          {loading ? (
            <span style={{ display: "inline-block", width: 20, height: 20, border: "2.5px solid #ddd", borderTopColor: "#4285F4", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginRight: 10, flexShrink: 0 }}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {error && <p style={LS.error}>{error}</p>}

        <p style={LS.foot}>Your questions will be saved to your account and visible to others nearby.</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const LS = {
  backdrop: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #F8F9FB 0%, #EDF2FE 100%)", fontFamily: "'DM Sans', sans-serif", padding: 16 },
  card: { background: "#fff", borderRadius: 16, padding: "32px 24px", maxWidth: 400, width: "100%", boxShadow: "0 8px 32px rgba(26,26,46,0.08)", border: "1px solid #E8EAED" },
  logoRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  title: { fontFamily: "'DM Serif Display', serif", fontSize: 22, margin: 0, letterSpacing: "-0.02em", color: "#1A1A2E" },
  subtitle: { fontSize: 10, color: "#667085", margin: 0, marginTop: 1, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 },
  divider: { height: 1, background: "#E8EAED", margin: "0 0 24px" },
  heading: { fontFamily: "'DM Serif Display', serif", fontSize: 20, margin: "0 0 6px", color: "#1A1A2E" },
  desc: { fontSize: 13, color: "#667085", margin: "0 0 24px", lineHeight: 1.6 },
  googleBtn: { width: "100%", padding: "13px 20px", borderRadius: 10, border: "1px solid #D0D5DD", background: "#fff", color: "#344054", fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  error: { fontSize: 12, color: "#B42318", margin: "12px 0 0", textAlign: "center" },
  foot: { fontSize: 11, color: "#98A2B3", textAlign: "center", margin: "20px 0 0", lineHeight: 1.5 },
};

// ══════════════════════════════════════════════════════════════
// Root App — auth listener
// ══════════════════════════════════════════════════════════════
export default function EduVision() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return unsub;
  }, []);

  // Loading state
  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: "#F8F9FB" }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500&display=swap" rel="stylesheet" />
        <p style={{ color: "#667085", fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <MainApp user={user} />;
}

// ══════════════════════════════════════════════════════════════
// Main App
// ══════════════════════════════════════════════════════════════
function MainApp({ user }) {
  const [tab, setTab] = useState("create");
  const [image, setImage] = useState(null);
  const [subject, setSubject] = useState(null);
  const [difficulty, setDifficulty] = useState("middle");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Geo
  const [userLocation, setUserLocation] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState("");
  const [publishError, setPublishError] = useState(null);
  const [published, setPublished] = useState(false);

  // Explore
  const [nearbyQuestions, setNearbyQuestions] = useState([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [searchRadius, setSearchRadius] = useState(5000);
  const [expandedPin, setExpandedPin] = useState(null);
  const [showAnswer, setShowAnswer] = useState({});
  const [mapView, setMapView] = useState("split");
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [exploreChoices, setExploreChoices] = useState({});

  // My Questions
  const [myQuestions, setMyQuestions] = useState([]);
  const [myLoading, setMyLoading] = useState(false);

  // Points system
  const [userPoints, setUserPoints] = useState(0);
  const [answeredIds, setAnsweredIds] = useState(new Set());
  const [pointsPopup, setPointsPopup] = useState(null); // { points, rarity } for animation
  const [questionRarity, setQuestionRarity] = useState(null); // rarity rolled for current create tab question

  // User menu
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userIcon = useMemo(() => createUserIcon(), []);
  const subjectIcons = useMemo(() => {
    const icons = {};
    SUBJECTS.forEach((s) => { icons[s.id] = createSubjectIcon(s.color, s.icon); });
    return icons;
  }, []);

  // Display name helper
  const displayName = user.displayName || user.email?.split("@")[0] || "User";
  const photoURL = user.photoURL;

  // ── Load user points & answered questions on mount ──
  useEffect(() => {
    (async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          setUserPoints(userDoc.data().points || 0);
          setAnsweredIds(new Set(userDoc.data().answeredIds || []));
        } else {
          // Create user doc on first login
          await setDoc(doc(db, "users", user.uid), {
            displayName,
            photoURL: photoURL || "",
            points: 0,
            answeredIds: [],
          });
        }
      } catch (e) {
        console.warn("Failed to load user points:", e);
      }
    })();
  }, [user.uid]);

  // ── Award points for correct answer ──
  const awardPoints = useCallback(async (questionId, rarity) => {
    if (answeredIds.has(questionId)) return; // already answered
    const r = getRarity(rarity);
    const pts = r.points;
    try {
      // Update Firestore
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        points: increment(pts),
        answeredIds: [...answeredIds, questionId],
      });
      // Update local state
      setUserPoints((p) => p + pts);
      setAnsweredIds((prev) => new Set([...prev, questionId]));
      // Show popup
      setPointsPopup({ points: pts, rarity: r });
      setTimeout(() => setPointsPopup(null), 2000);
    } catch (e) {
      console.warn("Failed to award points:", e);
      // Still update locally for responsiveness
      setUserPoints((p) => p + pts);
      setAnsweredIds((prev) => new Set([...prev, questionId]));
    }
  }, [user.uid, answeredIds]);

  // ── Get location (caches in state) ──
  const getLocation = useCallback(async () => {
    if (userLocation) return userLocation;
    setGeoError(null);
    try {
      const loc = await getCurrentPosition();
      setUserLocation(loc);
      return loc;
    } catch (err) {
      setGeoError(err.message);
      throw err;
    }
  }, [userLocation]);

  // ── File handling ──
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please upload an image file.");
    if (file.size > 20 * 1024 * 1024) return setError("Image must be under 20 MB.");
    setError(null); setResult(null); setPublished(false);
    try {
      const { base64, mediaType } = await fileToBase64(file);
      setImage({ file, preview: URL.createObjectURL(file), base64, mediaType });
    } catch { setError("Failed to process image."); }
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); };

  // ── Generate ──
  const handleGenerate = async () => {
    if (!image || !subject) return;
    setLoading(true); setError(null); setResult(null); setPublished(false); setPublishError(null); setSelectedChoice(null);
    setQuestionRarity(rollRarity());
    try { setResult(await generateQuestionAPI(image.base64, image.mediaType, subject, difficulty)); }
    catch (err) { setError(err.message || "Failed to generate question."); }
    finally { setLoading(false); }
  };

  // ── Publish — with step tracking ──
  const handlePublish = async () => {
    if (!result) return;
    setPublishing(true);
    setPublishError(null);
    setPublishStep("Getting your location…");
    try {
      // 1. Get location
      let loc;
      try {
        loc = await getLocation();
      } catch (e) {
        throw new Error("Could not get your location. Please allow location access and try again.");
      }

      // 2. Compress thumbnail (very small to stay under Firestore 1MB doc limit)
      setPublishStep("Preparing image…");
      let thumbnail = "";
      try {
        thumbnail = await Promise.race([
          compressImage(image.file, 150, 0.4),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
        // Safety: if thumbnail is still too large (>500KB base64), skip it
        if (thumbnail.length > 500000) {
          console.warn("Thumbnail too large, skipping:", thumbnail.length);
          thumbnail = "";
        }
      } catch (e) {
        console.warn("Thumbnail skipped:", e);
      }

      // 3. Write to Firestore with timeout
      setPublishStep("Saving to database…");
      const docData = {
        lat: loc.lat,
        lng: loc.lng,
        subject,
        difficulty,
        rarity: questionRarity || "common",
        question: result.question,
        choices: result.choices || {},
        correct_answer: result.correct_answer || "",
        explanation: result.explanation || "",
        hint: result.hint,
        learning_objective: result.learning_objective,
        image_analysis: result.image_analysis,
        why_this_image: result.why_this_image,
        thumbnail,
        uid: user.uid,
        displayName,
        photoURL: photoURL || "",
        timestamp: Date.now(),
      };

      // addDoc can hang if Firestore rules block the write (offline persistence keeps retrying)
      // So we add a 10-second timeout
      const writeResult = await Promise.race([
        addDoc(collection(db, "questions"), docData),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(
            "Firestore write timed out. Check that:\n1. Firestore is in test mode (Rules tab)\n2. Your Firebase config is correct\n3. Firestore database has been created"
          )), 10000)
        ),
      ]);

      console.log("Published successfully! Doc ID:", writeResult.id);
      setPublished(true);
      setPublishStep("");
    } catch (err) {
      console.error("Publish failed:", err);
      setPublishError(err.message || "Failed to publish. Check browser console for details.");
      setPublishStep("");
    } finally {
      setPublishing(false);
    }
  };

  // ── Explore ──
  const loadExplore = useCallback(async (radius) => {
    setExploreLoading(true);
    setGeoError(null);
    try {
      const loc = await getLocation();
      setNearbyQuestions(await loadNearbyQuestions(loc.lat, loc.lng, radius));
    } catch (err) {
      if (err.message) setGeoError(err.message);
    } finally {
      setExploreLoading(false);
    }
  }, [getLocation]);

  useEffect(() => { if (tab === "explore") loadExplore(searchRadius); }, [tab]);

  // ── My Questions ──
  const loadMyQuestions = useCallback(async () => {
    setMyLoading(true);
    try { setMyQuestions(await loadUserQuestions(user.uid)); }
    catch {}
    finally { setMyLoading(false); }
  }, [user.uid]);

  useEffect(() => { if (tab === "my") loadMyQuestions(); }, [tab]);

  // ── Reset ──
  const handleReset = () => {
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setImage(null); setSubject(null); setResult(null); setError(null);
    setDifficulty("middle"); setPublished(false); setGeoError(null); setPublishError(null); setSelectedChoice(null); setQuestionRarity(null);
  };

  const selectedSubject = SUBJECTS.find((s) => s.id === subject);
  const canGenerate = image && subject && !loading;

  // ── Map ──
  const renderMap = (height = 360) => {
    if (!userLocation) return null;
    return (
      <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #E8EAED", height }}>
        <MapContainer center={[userLocation.lat, userLocation.lng]} zoom={radiusToZoom(searchRadius)}
          style={{ width: "100%", height: "100%" }} zoomControl={true}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <RecenterMap lat={userLocation.lat} lng={userLocation.lng} zoom={radiusToZoom(searchRadius)} />
          <Circle center={[userLocation.lat, userLocation.lng]} radius={searchRadius}
            pathOptions={{ color: "#3A6BE8", fillColor: "#3A6BE8", fillOpacity: 0.05, weight: 1.5, dashArray: "6 4" }} />
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup><div style={{ fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}><strong>You are here</strong></div></Popup>
          </Marker>
          {nearbyQuestions.map((q, i) => {
            const subj = SUBJECTS.find((s) => s.id === q.subject);
            return (
              <Marker key={q.id || i} position={[q.lat, q.lng]} icon={subjectIcons[q.subject] || subjectIcons["science"]}
                eventHandlers={{ click: () => setExpandedPin(i) }}>
                <Popup maxWidth={280}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", padding: "4px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ background: subj?.bg, color: subj?.color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                        {subj?.icon} {subj?.label}
                      </span>
                      {(() => { const r = getRarity(q.rarity || "common"); return (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: r.bg, color: r.color, border: `1px solid ${r.border}` }}>
                          {r.icon} {r.label}
                        </span>
                      ); })()}
                      <span style={{ fontSize: 11, color: "#667085" }}>{formatDistance(q.distance)}</span>
                    </div>
                    {q.thumbnail && <img src={`data:image/jpeg;base64,${q.thumbnail}`} alt=""
                      style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 6, marginBottom: 6 }} />}
                    <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", lineHeight: 1.4, color: "#1A1A2E" }}>{q.question}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      {q.photoURL ? <img src={q.photoURL} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} /> : null}
                      <span style={{ fontSize: 11, color: "#667085" }}>{q.displayName || "Anonymous"}</span>
                      <span style={{ fontSize: 11, color: "#98A2B3" }}>· {timeAgo(q.timestamp)}</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    );
  };

  // ── Author badge ──
  const AuthorBadge = ({ q }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
      {q.photoURL ? <img src={q.photoURL} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} referrerPolicy="no-referrer" /> :
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#3A6BE8", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>
          {(q.displayName || "?")[0].toUpperCase()}
        </span>}
      <span style={{ fontSize: 11, color: "#667085", fontWeight: 500 }}>{q.displayName || "Anonymous"}</span>
      <span style={{ fontSize: 11, color: "#98A2B3" }}>· {timeAgo(q.timestamp)}</span>
    </div>
  );

  // ── Rarity badge ──
  const RarityBadge = ({ rarityId, size = "sm" }) => {
    const r = getRarity(rarityId);
    const isSm = size === "sm";
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: isSm ? 4 : 6,
        padding: isSm ? "2px 8px" : "4px 12px", borderRadius: 20,
        background: r.bg, border: `1.5px solid ${r.border}`, boxShadow: r.glow,
        fontSize: isSm ? 10 : 12, fontWeight: 700, color: r.color,
        letterSpacing: "0.02em", textTransform: "uppercase",
      }}>
        {r.icon} {r.label} · {r.points}pt
      </span>
    );
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <header className="ev-header" style={S.header}>
        <div style={S.headerLeft}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#1A1A2E" />
            <circle cx="10" cy="11" r="4" stroke="#E8553A" strokeWidth="1.5" fill="none" />
            <path d="M18 9l-2 4h5l-3 6" stroke="#3A6BE8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1 style={S.title}>EduVision</h1>
            <p className="ev-subtitle" style={S.subtitle}>AI Questions · Geo-Pinned Learning</p>
          </div>
        </div>
        <div className="ev-header-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {userLocation && <div className="ev-gps-badge" style={S.locBadge}><span style={S.locDot} /> GPS</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 20, background: "#FFFBF0", border: "1px solid #F6C270", fontSize: 12, fontWeight: 700, color: "#D4851F" }}>
            ✦ {userPoints.toLocaleString()}
          </div>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowUserMenu(!showUserMenu)} style={S.userBtn}>
              {photoURL ?
                <img src={photoURL} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} referrerPolicy="no-referrer" /> :
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#3A6BE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700 }}>
                  {displayName[0].toUpperCase()}
                </span>}
              <span className="ev-user-name" style={{ fontSize: 13, fontWeight: 600, color: "#344054", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
              <span style={{ fontSize: 10, color: "#98A2B3" }}>▾</span>
            </button>
            {showUserMenu && (
              <div style={S.userMenu}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  {photoURL ?
                    <img src={photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%" }} referrerPolicy="no-referrer" /> :
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#3A6BE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 700 }}>
                      {displayName[0].toUpperCase()}
                    </span>}
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E", margin: 0 }}>{displayName}</p>
                    <p style={{ fontSize: 11, color: "#98A2B3", margin: 0 }}>{user.email}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#FFFBF0", border: "1px solid #F6C270", marginBottom: 12 }}>
                  <span style={{ fontSize: 18 }}>✦</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#D4851F" }}>{userPoints.toLocaleString()} points</p>
                    <p style={{ margin: 0, fontSize: 10, color: "#98A2B3", fontWeight: 600 }}>{answeredIds.size} questions answered</p>
                  </div>
                </div>
                <button onClick={() => { setShowUserMenu(false); signOut(auth); }}
                  style={S.logoutBtn}>Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showUserMenu && <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setShowUserMenu(false)} />}

      {/* Tabs */}
      <nav className="ev-tabbar" style={S.tabBar}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...S.tabBtn, ...(tab === t.id ? S.tabBtnActive : {}) }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      {/* ══════════ CREATE TAB ══════════ */}
      {tab === "create" && (
        <div className="ev-main-grid">
          <div style={S.controlsCol}>
            <section style={S.card}>
              <h2 style={S.sectionTitle}><span style={S.stepBadge}>1</span> Upload Image</h2>
              {!image ? (
                <div style={{ ...S.dropZone, borderColor: dragOver ? "#3A6BE8" : "#D0D5DD", background: dragOver ? "#EDF2FE" : "#FAFBFC" }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ marginBottom: 10 }}>
                    <rect x="4" y="8" width="28" height="22" rx="4" stroke="#98A2B3" strokeWidth="1.5" fill="none" />
                    <circle cx="13" cy="17" r="3" stroke="#98A2B3" strokeWidth="1.5" fill="none" />
                    <path d="M4 26l8-7 5 4 6-8 9 11" stroke="#98A2B3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                  <p style={{ fontSize: 14, color: "#344054", margin: "0 0 4px" }}><strong>Click to upload</strong> or drag & drop</p>
                  <p style={{ fontSize: 12, color: "#98A2B3", margin: 0 }}>JPEG, PNG, GIF, WebP — max 20 MB</p>
                </div>
              ) : (
                <div style={S.imgWrap}>
                  <img src={image.preview} alt="Uploaded" style={S.imgPreview} />
                  <button style={S.removeBtn} onClick={handleReset}>✕</button>
                </div>
              )}
            </section>

            <section style={S.card}>
              <h2 style={S.sectionTitle}><span style={S.stepBadge}>2</span> Choose Subject</h2>
              <div style={S.subjectGrid}>
                {SUBJECTS.map((s) => (
                  <button key={s.id} onClick={() => { setSubject(s.id); setResult(null); setPublished(false); }}
                    style={{ ...S.subjectBtn, background: subject === s.id ? s.color : s.bg, color: subject === s.id ? "#fff" : s.color, borderColor: subject === s.id ? s.color : "transparent", transform: subject === s.id ? "scale(1.03)" : "scale(1)" }}>
                    <span style={{ fontSize: 20 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{s.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section style={S.card}>
              <h2 style={S.sectionTitle}><span style={S.stepBadge}>3</span> Difficulty</h2>
              <div style={S.diffRow}>
                {DIFFICULTY_LEVELS.map((d) => (
                  <button key={d.id} onClick={() => setDifficulty(d.id)}
                    style={{ ...S.diffBtn, background: difficulty === d.id ? "#1A1A2E" : "#F4F5F7", color: difficulty === d.id ? "#fff" : "#344054" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{d.ages}</span>
                  </button>
                ))}
              </div>
            </section>

            <button onClick={handleGenerate} disabled={!canGenerate}
              style={{ ...S.genBtn, opacity: canGenerate ? 1 : 0.45, cursor: canGenerate ? "pointer" : "not-allowed", background: selectedSubject ? selectedSubject.color : "#1A1A2E" }}>
              {loading ? <span style={S.spinner} /> : <>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ marginRight: 8 }}>
                  <path d="M9 1v4M9 13v4M1 9h4M13 9h4M3.3 3.3l2.8 2.8M11.9 11.9l2.8 2.8M3.3 14.7l2.8-2.8M11.9 6.1l2.8-2.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>Generate Question</>}
            </button>

            {error && <div style={S.errorBox}><span>⚠</span> {error}</div>}
            {geoError && <div style={{ ...S.errorBox, background: "#FFF7ED", color: "#B54708" }}><span>📍</span> {geoError}</div>}
          </div>

          <div style={S.resultCol}>
            {!result && !loading && (
              <div style={S.emptyState}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 16, opacity: 0.7 }}>
                  <circle cx="24" cy="24" r="20" stroke="#D0D5DD" strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
                  <text x="24" y="29" textAnchor="middle" fill="#98A2B3" fontSize="20" fontFamily="DM Serif Display">?</text>
                </svg>
                <h3 style={S.emptyTitle}>Your question will appear here</h3>
                <p style={S.emptyText}>Upload an image, select a subject & difficulty, then hit Generate.</p>
              </div>
            )}
            {loading && (
              <div style={S.loadState}>
                <div style={S.pulse} />
                <p style={{ fontWeight: 600, fontSize: 14, color: "#344054", margin: 0 }}>Analyzing image & crafting your question…</p>
                <p style={{ fontSize: 12, color: "#98A2B3", marginTop: 4 }}>This may take a few seconds</p>
              </div>
            )}
            {result && (
              <div className="ev-res-card" style={S.resCard}>
                <div style={S.analysisBanner}>
                  <div style={S.dot} />
                  <div>
                    <p style={S.metaLabel}>Image Analysis</p>
                    <p style={S.aText}>{result.image_analysis}</p>
                  </div>
                </div>

                <div style={{ ...S.qBox, borderLeftColor: selectedSubject?.color || "#1A1A2E" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <p style={{ ...S.metaLabel, margin: 0 }}>{selectedSubject?.icon} {selectedSubject?.label} Question</p>
                    {questionRarity && <RarityBadge rarityId={questionRarity} />}
                  </div>
                  <p className="ev-q-text" style={S.qText}>{result.question}</p>
                </div>

                {/* Multiple Choice Options */}
                {result.choices && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {["A", "B", "C", "D"].map((letter) => {
                      if (!result.choices[letter]) return null;
                      const isSelected = selectedChoice === letter;
                      const isCorrect = letter === result.correct_answer;
                      const answered = selectedChoice !== null;
                      let bg = "#FAFBFC";
                      let border = "#E8EAED";
                      let textColor = "#344054";
                      if (answered && isCorrect) { bg = "#ECFDF3"; border = "#12B76A"; textColor = "#027A48"; }
                      else if (isSelected && !isCorrect) { bg = "#FEF0ED"; border = "#E8553A"; textColor = "#B42318"; }
                      else if (answered) { bg = "#F9FAFB"; border = "#E8EAED"; textColor = "#98A2B3"; }
                      return (
                        <button key={letter} onClick={() => {
                            if (!selectedChoice) {
                              setSelectedChoice(letter);
                              if (letter === result.correct_answer) {
                                // Use question text hash as temp ID for unpublished questions
                                const tempId = "create_" + result.question.slice(0, 30).replace(/\s/g, "_");
                                awardPoints(tempId, questionRarity || "common");
                              }
                            }
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                            border: `2px solid ${border}`, background: bg, cursor: answered ? "default" : "pointer",
                            transition: "all 0.2s", textAlign: "left", fontFamily: "'DM Sans', sans-serif",
                            transform: !answered ? "scale(1)" : undefined,
                          }}>
                          <span style={{
                            width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 700, flexShrink: 0,
                            background: answered && isCorrect ? "#12B76A" : isSelected && !isCorrect ? "#E8553A" : answered ? "#F4F5F7" : selectedSubject?.bg || "#EDF2FE",
                            color: answered && (isCorrect || isSelected) ? "#fff" : selectedSubject?.color || "#344054",
                          }}>
                            {answered && isCorrect ? "✓" : answered && isSelected && !isCorrect ? "✕" : letter}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: isSelected || (answered && isCorrect) ? 600 : 400, color: textColor, lineHeight: 1.4 }}>
                            {result.choices[letter]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Answer feedback */}
                {selectedChoice && (() => {
                  const correct = selectedChoice === result.correct_answer;
                  const r = getRarity(questionRarity || "common");
                  return (
                    <div style={{
                      padding: "12px 14px", borderRadius: 8,
                      background: correct ? "#ECFDF3" : "#FEF0ED",
                      border: `1px solid ${correct ? "#A6F4C5" : "#FECDCA"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: correct ? "#027A48" : "#B42318" }}>
                          {correct ? "✓ Correct!" : `✕ Incorrect — the answer is ${result.correct_answer}`}
                        </p>
                        {correct && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: r.color, animation: "fadeIn 0.3s ease" }}>
                            +{r.points} pts
                          </span>
                        )}
                      </div>
                      {result.explanation && (
                        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#344054", lineHeight: 1.5 }}>{result.explanation}</p>
                      )}
                    </div>
                  );
                })()}

                {!selectedChoice && (
                  <details style={S.hintBox}>
                    <summary style={S.hintSum}>💡 Hint</summary>
                    <p style={S.hintP}>{result.hint}</p>
                  </details>
                )}

                <div className="ev-meta-grid" style={S.metaGrid}>
                  <div style={S.metaItem}><p style={S.metaLabel}>Learning Objective</p><p style={S.metaVal}>{result.learning_objective}</p></div>
                  <div style={S.metaItem}><p style={S.metaLabel}>Image Connection</p><p style={S.metaVal}>{result.why_this_image}</p></div>
                </div>

                <div style={S.actionRow}>
                  <button onClick={handleGenerate} disabled={loading} style={S.secBtn}>↻ Regenerate</button>
                  {!published ? (
                    <button onClick={handlePublish} disabled={publishing}
                      style={{ ...S.pubBtn, opacity: publishing ? 0.6 : 1 }}>
                      {publishing ? <span style={{ ...S.spinner, width: 16, height: 16, borderWidth: 2 }} /> : <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 6 }}>
                          <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" stroke="#fff" strokeWidth="1.3" fill="none" />
                          <circle cx="8" cy="6" r="1.5" fill="#fff" />
                        </svg>Pin to My Location</>}
                    </button>
                  ) : (
                    <div style={S.pubDone}>
                      <span style={{ color: "#12B76A", fontSize: 16 }}>✓</span>
                      Published as {displayName}
                    </div>
                  )}
                </div>

                {publishing && publishStep && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "#EDF2FE", fontSize: 12, color: "#3A6BE8", fontWeight: 500 }}>
                    <span style={{ ...S.spinner, width: 14, height: 14, borderWidth: 2, borderColor: "rgba(58,107,232,0.3)", borderTopColor: "#3A6BE8" }} />
                    {publishStep}
                  </div>
                )}

                {publishError && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 8, background: "#FEF0ED", color: "#B42318", fontSize: 13 }}>
                    <span>⚠</span>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>Failed to publish</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, whiteSpace: "pre-wrap" }}>{publishError}</p>
                    </div>
                  </div>
                )}

                {published && userLocation && (
                  <div style={{ marginTop: 4 }}>
                    <p style={{ ...S.metaLabel, marginBottom: 8 }}>📍 Pinned Location</p>
                    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #E8EAED", height: 180 }}>
                      <MapContainer center={[userLocation.lat, userLocation.lng]} zoom={15}
                        style={{ width: "100%", height: "100%" }} zoomControl={false} dragging={false}
                        scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <Marker position={[userLocation.lat, userLocation.lng]}
                          icon={subjectIcons[subject] || subjectIcons["science"]} />
                      </MapContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ EXPLORE TAB ══════════ */}
      {tab === "explore" && (
        <div className="ev-explore-wrap" style={S.exploreWrap}>
          <div style={S.exploreHead}>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, margin: 0 }}>Nearby Questions</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={S.viewToggle}>
                {[{ id: "split", label: "◫" }, { id: "map", label: "▣" }, { id: "list", label: "☰" }].map((v) => (
                  <button key={v.id} onClick={() => setMapView(v.id)}
                    style={{ ...S.viewBtn, background: mapView === v.id ? "#1A1A2E" : "transparent", color: mapView === v.id ? "#fff" : "#667085" }}>
                    {v.label}
                  </button>
                ))}
              </div>
              <div style={S.radiusRow}>
                {[1000, 5000, 25000, 50000].map((r) => (
                  <button key={r} onClick={() => { setSearchRadius(r); loadExplore(r); }}
                    style={{ ...S.radBtn, background: searchRadius === r ? "#1A1A2E" : "#F4F5F7", color: searchRadius === r ? "#fff" : "#344054" }}>
                    {r < 1000 ? `${r}m` : `${r / 1000}km`}
                  </button>
                ))}
                <button onClick={() => loadExplore(searchRadius)} style={S.refBtn} title="Refresh">↻</button>
              </div>
            </div>
          </div>

          {geoError && <div style={{ ...S.errorBox, marginBottom: 16 }}><span>📍</span> {geoError}</div>}

          {exploreLoading ? (
            <div style={{ ...S.loadState, minHeight: 200 }}>
              <div style={S.pulse} />
              <p style={{ fontWeight: 600, fontSize: 14, color: "#344054", margin: 0 }}>Scanning nearby…</p>
            </div>
          ) : nearbyQuestions.length === 0 && !userLocation ? (
            <div style={S.emptyExplore}>
              <h3 style={S.emptyTitle}>No questions nearby yet</h3>
              <p style={S.emptyText}>Be the first! Create a question and pin it to your location.</p>
            </div>
          ) : (
            <div>
              {(mapView === "split" || mapView === "map") && userLocation && (
                <div style={{ marginBottom: mapView === "map" ? 0 : 16 }}>
                  {renderMap(mapView === "map" ? 520 : 320)}
                  {nearbyQuestions.length > 0 && (
                    <p style={{ fontSize: 12, color: "#98A2B3", margin: "8px 0 0", textAlign: "center" }}>
                      {nearbyQuestions.length} question{nearbyQuestions.length !== 1 ? "s" : ""} within {searchRadius < 1000 ? `${searchRadius}m` : `${searchRadius / 1000}km`}
                    </p>
                  )}
                </div>
              )}

              {nearbyQuestions.length === 0 && userLocation && mapView !== "map" && (
                <div style={{ ...S.emptyExplore, marginTop: 0 }}>
                  <h3 style={S.emptyTitle}>No questions nearby yet</h3>
                  <p style={S.emptyText}>Be the first! Create a question and pin it to your location.</p>
                </div>
              )}

              {(mapView === "split" || mapView === "list") && nearbyQuestions.length > 0 && (
                <div style={S.pinList}>
                  {nearbyQuestions.map((q, i) => {
                    const subj = SUBJECTS.find((s) => s.id === q.subject);
                    const open = expandedPin === i;
                    return (
                      <div key={q.id || i} style={{ ...S.pinCard, ...(open ? { borderColor: subj?.color || "#3A6BE8" } : {}) }}
                        onClick={() => setExpandedPin(open ? null : i)}>
                        <div style={S.pinHead}>
                          {q.thumbnail && <img src={`data:image/jpeg;base64,${q.thumbnail}`} alt="" style={S.pinThumb} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ ...S.pinMeta, flexWrap: "wrap" }}>
                              <span style={{ ...S.pinTag, background: subj?.bg, color: subj?.color }}>{subj?.icon} {subj?.label}</span>
                              <RarityBadge rarityId={q.rarity || "common"} />
                              <span style={S.pinDist}>{formatDistance(q.distance)}</span>
                            </div>
                            <p style={S.pinQ}>{q.question}</p>
                            <AuthorBadge q={q} />
                          </div>
                          <span style={{ fontSize: 18, color: "#98A2B3", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
                        </div>
                        {open && (
                          <div style={S.pinExpand} onClick={(e) => e.stopPropagation()}>
                            <div style={S.analysisBanner}>
                              <div style={S.dot} />
                              <div><p style={S.metaLabel}>What's in the image</p><p style={S.aText}>{q.image_analysis}</p></div>
                            </div>

                            {/* MCQ choices */}
                            {q.choices && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {["A", "B", "C", "D"].map((letter) => {
                                  if (!q.choices[letter]) return null;
                                  const myChoice = exploreChoices[i];
                                  const isSelected = myChoice === letter;
                                  const isCorrect = letter === q.correct_answer;
                                  const answered = myChoice != null;
                                  let bg = "#FAFBFC"; let border = "#E8EAED"; let tc = "#344054";
                                  if (answered && isCorrect) { bg = "#ECFDF3"; border = "#12B76A"; tc = "#027A48"; }
                                  else if (isSelected && !isCorrect) { bg = "#FEF0ED"; border = "#E8553A"; tc = "#B42318"; }
                                  else if (answered) { bg = "#F9FAFB"; border = "#E8EAED"; tc = "#98A2B3"; }
                                  return (
                                    <button key={letter} onClick={() => {
                                        if (!myChoice) {
                                          setExploreChoices((p) => ({ ...p, [i]: letter }));
                                          if (letter === q.correct_answer && q.id) {
                                            awardPoints(q.id, q.rarity || "common");
                                          }
                                        }
                                      }}
                                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8,
                                        border: `2px solid ${border}`, background: bg, cursor: answered ? "default" : "pointer",
                                        transition: "all 0.2s", textAlign: "left", fontFamily: "'DM Sans', sans-serif" }}>
                                      <span style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                                        background: answered && isCorrect ? "#12B76A" : isSelected && !isCorrect ? "#E8553A" : "#F4F5F7",
                                        color: answered && (isCorrect || isSelected) ? "#fff" : "#344054" }}>
                                        {answered && isCorrect ? "✓" : answered && isSelected && !isCorrect ? "✕" : letter}
                                      </span>
                                      <span style={{ fontSize: 13, fontWeight: isSelected || (answered && isCorrect) ? 600 : 400, color: tc }}>{q.choices[letter]}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {exploreChoices[i] && (() => {
                              const correct = exploreChoices[i] === q.correct_answer;
                              const r = getRarity(q.rarity || "common");
                              return (
                                <div style={{ padding: "10px 12px", borderRadius: 8,
                                  background: correct ? "#ECFDF3" : "#FEF0ED",
                                  border: `1px solid ${correct ? "#A6F4C5" : "#FECDCA"}` }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: correct ? "#027A48" : "#B42318" }}>
                                      {correct ? "✓ Correct!" : `✕ Incorrect — the answer is ${q.correct_answer}`}
                                    </p>
                                    {correct && !answeredIds.has(q.id) && (
                                      <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>+{r.points} pts</span>
                                    )}
                                  </div>
                                  {q.explanation && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#344054", lineHeight: 1.5 }}>{q.explanation}</p>}
                                </div>
                              );
                            })()}

                            {!exploreChoices[i] && (
                              <details style={S.hintBox}>
                                <summary style={S.hintSum}>💡 Need a hint?</summary>
                                <p style={S.hintP}>{q.hint}</p>
                              </details>
                            )}

                            <button onClick={(e) => { e.stopPropagation(); setShowAnswer((p) => ({ ...p, [i]: !p[i] })); }} style={S.secBtn}>
                              {showAnswer[i] ? "Hide" : "Show"} Learning Objective
                            </button>
                            {showAnswer[i] && (
                              <div style={{ ...S.metaItem, marginTop: 8 }}>
                                <p style={S.metaLabel}>Learning Objective</p>
                                <p style={S.metaVal}>{q.learning_objective}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════ MY QUESTIONS TAB ══════════ */}
      {tab === "my" && (
        <div className="ev-explore-wrap" style={S.exploreWrap}>
          <div style={{ ...S.exploreHead, marginBottom: 16 }}>
            <div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, margin: 0 }}>My Questions</h2>
              <p style={{ fontSize: 12, color: "#98A2B3", margin: "4px 0 0" }}>Questions published by {displayName}</p>
            </div>
            <button onClick={loadMyQuestions} style={S.refBtn} title="Refresh">↻</button>
          </div>

          {myLoading ? (
            <div style={{ ...S.loadState, minHeight: 200 }}>
              <div style={S.pulse} />
              <p style={{ fontWeight: 600, fontSize: 14, color: "#344054", margin: 0 }}>Loading your questions…</p>
            </div>
          ) : myQuestions.length === 0 ? (
            <div style={S.emptyExplore}>
              <h3 style={S.emptyTitle}>No questions yet</h3>
              <p style={S.emptyText}>Create and pin your first question to see it here!</p>
              <button onClick={() => setTab("create")} style={{ ...S.secBtn, marginTop: 16 }}>✦ Create a Question</button>
            </div>
          ) : (
            <div style={S.pinList}>
              {myQuestions.map((q, i) => {
                const subj = SUBJECTS.find((s) => s.id === q.subject);
                return (
                  <div key={q.id || i} style={S.pinCard}>
                    <div style={S.pinHead}>
                      {q.thumbnail && <img src={`data:image/jpeg;base64,${q.thumbnail}`} alt="" style={S.pinThumb} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...S.pinMeta, flexWrap: "wrap" }}>
                          <span style={{ ...S.pinTag, background: subj?.bg, color: subj?.color }}>{subj?.icon} {subj?.label}</span>
                          <RarityBadge rarityId={q.rarity || "common"} />
                          <span style={{ fontSize: 11, color: "#98A2B3" }}>{DIFFICULTY_LEVELS.find((d) => d.id === q.difficulty)?.label}</span>
                        </div>
                        <p style={S.pinQ}>{q.question}</p>
                        <p style={{ fontSize: 11, color: "#98A2B3", margin: "4px 0 0" }}>{timeAgo(q.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <p style={{ fontSize: 12, color: "#98A2B3", textAlign: "center", marginTop: 8 }}>
                {myQuestions.length} question{myQuestions.length !== 1 ? "s" : ""} published
              </p>
            </div>
          )}
        </div>
      )}

      {/* Floating points popup */}
      {pointsPopup && (
        <div className="ev-points-popup" style={{
          position: "fixed", top: 80, right: 24, zIndex: 999,
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px", borderRadius: 14,
          background: "#fff", border: `2px solid ${pointsPopup.rarity.border}`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.12), ${pointsPopup.rarity.glow}`,
          animation: "pointsFloat 2s ease forwards",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <span style={{ fontSize: 24 }}>{pointsPopup.rarity.icon}</span>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: pointsPopup.rarity.color }}>
              +{pointsPopup.points} pts
            </p>
            <p style={{ margin: 0, fontSize: 11, color: "#667085", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {pointsPopup.rarity.label} Question
            </p>
          </div>
        </div>
      )}

      <footer style={S.footer}>Powered by Claude Vision API — Geo-pinned learning for everyone</footer>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.2);opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pointsFloat{
          0%{opacity:0;transform:translateY(20px) scale(0.8)}
          15%{opacity:1;transform:translateY(0) scale(1.05)}
          25%{transform:translateY(0) scale(1)}
          80%{opacity:1;transform:translateY(0)}
          100%{opacity:0;transform:translateY(-10px)}
        }
        details>summary{list-style:none;cursor:pointer}
        details>summary::-webkit-details-marker{display:none}
        .leaflet-popup-content-wrapper{border-radius:10px!important;box-shadow:0 4px 16px rgba(0,0,0,0.12)!important}
        .leaflet-popup-content{margin:10px 12px!important}
        .leaflet-container{font-family:'DM Sans',sans-serif!important}

        /* ── Desktop defaults ── */
        .ev-main-grid{display:grid;grid-template-columns:380px 1fr;gap:24px;max-width:1040px;margin:24px auto;padding:0 24px;align-items:start}

        /* ── Tablet (≤900px) ── */
        @media(max-width:900px){
          .ev-main-grid{grid-template-columns:320px 1fr;gap:16px;padding:0 16px}
        }

        /* ── Mobile (≤768px) ── */
        @media(max-width:768px){
          .ev-main-grid{grid-template-columns:1fr!important;gap:16px;max-width:100%;margin:16px auto;padding:0 14px}
          .ev-header{padding:10px 14px!important}
          .ev-subtitle{display:none!important}
          .ev-tabbar{padding:6px 10px!important;gap:2px!important}
          .ev-tabbar button{padding:7px 10px!important;font-size:12px!important}
          .ev-explore-wrap{padding:0 14px!important;margin:16px auto!important}
          .ev-meta-grid{grid-template-columns:1fr!important}
          .ev-res-card{padding:16px!important}
          .ev-user-name{display:none!important}
          .ev-q-text{font-size:16px!important}
          .ev-points-popup{right:50%!important;transform:translateX(50%);top:70px!important}
        }

        /* ── Small phone (≤480px) ── */
        @media(max-width:480px){
          .ev-main-grid{padding:0 10px}
          .ev-header{padding:8px 10px!important}
          .ev-tabbar{padding:4px 6px!important;overflow-x:auto;-webkit-overflow-scrolling:touch}
          .ev-tabbar button{padding:6px 8px!important;font-size:11px!important;white-space:nowrap}
          .ev-explore-wrap{padding:0 10px!important}
          .ev-gps-badge{display:none!important}
          .ev-header-right{gap:6px!important}
        }
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Styles
// ══════════════════════════════════════════════════════════════
const S = {
  root: { fontFamily: "'DM Sans', sans-serif", background: "#F8F9FB", minHeight: "100vh", color: "#1A1A2E", padding: "0 0 40px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #E8EAED", background: "#fff" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  title: { fontFamily: "'DM Serif Display', serif", fontSize: 22, margin: 0, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 11, color: "#667085", margin: 0, marginTop: 1, letterSpacing: "0.03em", textTransform: "uppercase", fontWeight: 500 },
  locBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#12B76A", background: "#ECFDF3", padding: "4px 10px", borderRadius: 20 },
  locDot: { width: 6, height: 6, borderRadius: "50%", background: "#12B76A" },
  userBtn: { display: "flex", alignItems: "center", gap: 8, padding: "4px 10px 4px 4px", borderRadius: 24, border: "1px solid #E8EAED", background: "#fff", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" },
  userMenu: { position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", border: "1px solid #E8EAED", zIndex: 99, minWidth: 220 },
  logoutBtn: { width: "100%", padding: "8px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B42318", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" },
  tabBar: { display: "flex", gap: 4, padding: "8px 24px", background: "#fff", borderBottom: "1px solid #E8EAED" },
  tabBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "transparent", color: "#667085", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.15s" },
  tabBtnActive: { background: "#1A1A2E", color: "#fff" },
  mainGrid: { display: "grid", gridTemplateColumns: "380px 1fr", gap: 24, maxWidth: 1040, margin: "24px auto", padding: "0 24px", alignItems: "start" },
  controlsCol: { display: "flex", flexDirection: "column", gap: 14 },
  resultCol: { minHeight: 420, display: "flex", flexDirection: "column" },
  card: { background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #E8EAED" },
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 },
  stepBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: "#1A1A2E", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  dropZone: { border: "2px dashed", borderRadius: 10, padding: "32px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.2s" },
  imgWrap: { position: "relative", borderRadius: 10, overflow: "hidden" },
  imgPreview: { width: "100%", maxHeight: 220, objectFit: "cover", display: "block", borderRadius: 10 },
  removeBtn: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  subjectGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  subjectBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "14px 8px", borderRadius: 10, border: "2px solid transparent", cursor: "pointer", transition: "all 0.2s" },
  diffRow: { display: "flex", gap: 8 },
  diffBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "10px 6px", borderRadius: 8, border: "none", cursor: "pointer", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif" },
  genBtn: { width: "100%", padding: "14px 20px", borderRadius: 10, border: "none", color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" },
  spinner: { display: "inline-block", width: 20, height: 20, border: "2.5px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  errorBox: { display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 14px", borderRadius: 10, background: "#FEF0ED", color: "#B42318", fontSize: 13 },
  emptyState: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40, background: "#fff", borderRadius: 12, border: "1px solid #E8EAED" },
  emptyTitle: { fontFamily: "'DM Serif Display', serif", fontSize: 18, margin: "0 0 6px", color: "#344054" },
  emptyText: { fontSize: 13, color: "#98A2B3", margin: 0, maxWidth: 280 },
  loadState: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40, background: "#fff", borderRadius: 12, border: "1px solid #E8EAED" },
  pulse: { width: 40, height: 40, borderRadius: "50%", background: "#3A6BE8", animation: "pulse 1.4s ease-in-out infinite", marginBottom: 16 },
  resCard: { background: "#fff", borderRadius: 12, border: "1px solid #E8EAED", padding: 24, display: "flex", flexDirection: "column", gap: 16 },
  analysisBanner: { display: "flex", gap: 10, padding: "12px 14px", borderRadius: 8, background: "#F4F5F7" },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#12B76A", marginTop: 5, flexShrink: 0 },
  aText: { fontSize: 13, color: "#344054", margin: 0, lineHeight: 1.5 },
  qBox: { borderLeft: "4px solid", paddingLeft: 16 },
  qText: { fontFamily: "'DM Serif Display', serif", fontSize: 18, lineHeight: 1.45, margin: 0, color: "#1A1A2E" },
  hintBox: { background: "#FFFBF0", borderRadius: 8, padding: "12px 14px" },
  hintSum: { fontSize: 13, fontWeight: 600, color: "#D4851F" },
  hintP: { fontSize: 13, color: "#6B5A2E", margin: "8px 0 0", lineHeight: 1.5 },
  metaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  metaItem: { padding: "12px 14px", borderRadius: 8, background: "#F9FAFB", border: "1px solid #F0F1F3" },
  metaLabel: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#98A2B3", margin: "0 0 4px" },
  metaVal: { fontSize: 13, color: "#344054", margin: 0, lineHeight: 1.5 },
  actionRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  secBtn: { padding: "9px 16px", borderRadius: 8, border: "1px solid #D0D5DD", background: "#fff", color: "#344054", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" },
  pubBtn: { display: "flex", alignItems: "center", padding: "9px 16px", borderRadius: 8, border: "none", background: "#1A1A2E", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.15s" },
  pubDone: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#344054", background: "#ECFDF3", padding: "8px 14px", borderRadius: 8 },
  exploreWrap: { maxWidth: 820, margin: "24px auto", padding: "0 24px" },
  exploreHead: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 },
  radiusRow: { display: "flex", gap: 6, alignItems: "center" },
  radBtn: { padding: "6px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.15s" },
  refBtn: { width: 32, height: 32, borderRadius: 6, border: "1px solid #D0D5DD", background: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  viewToggle: { display: "flex", background: "#F4F5F7", borderRadius: 6, padding: 2 },
  viewBtn: { width: 32, height: 28, border: "none", borderRadius: 4, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif" },
  emptyExplore: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 48, background: "#fff", borderRadius: 12, border: "1px solid #E8EAED" },
  pinList: { display: "flex", flexDirection: "column", gap: 10 },
  pinCard: { background: "#fff", borderRadius: 12, border: "1px solid #E8EAED", padding: 16, cursor: "pointer", transition: "all 0.15s" },
  pinHead: { display: "flex", gap: 12, alignItems: "flex-start" },
  pinThumb: { width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 },
  pinMeta: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  pinTag: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 },
  pinDist: { fontSize: 11, color: "#667085", fontWeight: 500 },
  pinQ: { fontSize: 14, fontWeight: 600, margin: 0, lineHeight: 1.4, color: "#1A1A2E" },
  pinExpand: { marginTop: 14, paddingTop: 14, borderTop: "1px solid #F0F1F3", display: "flex", flexDirection: "column", gap: 10 },
  footer: { textAlign: "center", fontSize: 11, color: "#98A2B3", marginTop: 32 },
};
