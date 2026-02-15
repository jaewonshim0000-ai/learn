// @ts-nocheck
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────
// EduVision — AI-Powered Educational Question Generator
// + GeoPin: Share & discover questions by location
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

// ─── Custom map marker SVG builder ───
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

// ─── Haversine distance ───
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 100) return `${Math.round(meters)}m away`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m away`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)}km away`;
  return `${Math.round(meters / 1000)}km away`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function radiusToZoom(radius) {
  if (radius <= 1000) return 15;
  if (radius <= 5000) return 13;
  if (radius <= 25000) return 11;
  return 9;
}

// ─── System prompt builder ───
function buildSystemPrompt(subject, difficulty) {
  const subj = SUBJECTS.find((s) => s.id === subject);
  return `You are an expert educational content creator specializing in ${subj.label}.

Your task: Analyze the provided image and generate ONE high-quality educational question that meaningfully incorporates specific visual elements from the image within the framework of ${subj.label}.

Subject-specific strategies: ${subj.strategy}
Difficulty: ${difficulty.label} (${difficulty.ages})

CRITICAL RULES:
1. Identify specific objects, actions, scenes, quantities, colors, patterns, spatial relationships visible in the image.
2. Map those visual elements to educational concepts in ${subj.label}.
3. The question MUST require the student to reference or think about the image.
4. If the image has no clear connection to ${subj.label}, creatively bridge the gap.
5. Make the question age-appropriate for ${difficulty.ages}.

Respond in this exact JSON format (no markdown, no backticks):
{
  "image_analysis": "Brief description of key elements observed in the image",
  "question": "The educational question text",
  "hint": "A helpful hint for the student",
  "learning_objective": "What concept or skill this question targets",
  "why_this_image": "How the image specifically connects to this question (1 sentence)"
}`;
}

// ─── Claude Vision API call ───
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
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.src = URL.createObjectURL(file);
  });
}

// ─── Firebase Firestore helpers ───
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

async function loadUserQuestions(username) {
  const allQuestions = await loadAllQuestions();
  return allQuestions.filter((q) => q.username === username);
}

// ─── Avatar color from username ───
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["#E8553A", "#2B7A5F", "#3A6BE8", "#9B5DE5", "#D4851F", "#E84393", "#00B894", "#6C5CE7"];
  return colors[Math.abs(hash) % colors.length];
}

// ══════════════════════════════════════════════════════════════
// Login Screen
// ══════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);

  const handleSubmit = () => {
    const trimmed = username.trim();
    if (!trimmed) return setError("Please enter a username.");
    if (trimmed.length < 2) return setError("Username must be at least 2 characters.");
    if (trimmed.length > 20) return setError("Username must be 20 characters or fewer.");
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return setError("Only letters, numbers, and underscores allowed.");
    localStorage.setItem("eduvision-user", trimmed);
    onLogin(trimmed);
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

        <h2 style={LS.heading}>Welcome! Choose a username</h2>
        <p style={LS.desc}>Pick any username to get started. No password needed — this is a demo.</p>

        <div style={LS.inputWrap}>
          <span style={LS.at}>@</span>
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="your_username"
            style={LS.input}
            maxLength={20}
            autoFocus
          />
        </div>
        {error && <p style={LS.error}>{error}</p>}

        <button onClick={handleSubmit} style={LS.btn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 8 }}>
            <path d="M8 1v6m0 0v6m0-6h6m-6 0H2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Start Learning
        </button>

        <p style={LS.foot}>Your questions will be saved & visible to others nearby.</p>
      </div>
    </div>
  );
}

const LS = {
  backdrop: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #F8F9FB 0%, #EDF2FE 100%)", fontFamily: "'DM Sans', sans-serif", padding: 24 },
  card: { background: "#fff", borderRadius: 16, padding: "36px 32px", maxWidth: 400, width: "100%", boxShadow: "0 8px 32px rgba(26,26,46,0.08)", border: "1px solid #E8EAED" },
  logoRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  title: { fontFamily: "'DM Serif Display', serif", fontSize: 22, margin: 0, letterSpacing: "-0.02em", color: "#1A1A2E" },
  subtitle: { fontSize: 10, color: "#667085", margin: 0, marginTop: 1, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 },
  divider: { height: 1, background: "#E8EAED", margin: "0 0 24px" },
  heading: { fontFamily: "'DM Serif Display', serif", fontSize: 20, margin: "0 0 6px", color: "#1A1A2E" },
  desc: { fontSize: 13, color: "#667085", margin: "0 0 20px", lineHeight: 1.5 },
  inputWrap: { display: "flex", alignItems: "center", border: "2px solid #E8EAED", borderRadius: 10, overflow: "hidden", transition: "border-color 0.2s", marginBottom: 8 },
  at: { padding: "0 0 0 14px", fontSize: 15, color: "#98A2B3", fontWeight: 600 },
  input: { flex: 1, border: "none", outline: "none", padding: "12px 14px 12px 6px", fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: "#1A1A2E", background: "transparent" },
  error: { fontSize: 12, color: "#B42318", margin: "0 0 8px" },
  btn: { width: "100%", padding: "13px 20px", borderRadius: 10, border: "none", background: "#1A1A2E", color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 12, transition: "opacity 0.15s" },
  foot: { fontSize: 11, color: "#98A2B3", textAlign: "center", margin: "16px 0 0", lineHeight: 1.5 },
};

// ══════════════════════════════════════════════════════════════
// Main App
// ══════════════════════════════════════════════════════════════
export default function EduVision() {
  // ── Auth state ──
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("eduvision-user") || null);

  // If not logged in, show login screen
  if (!currentUser) {
    return <LoginScreen onLogin={(u) => setCurrentUser(u)} />;
  }

  return <MainApp currentUser={currentUser} onLogout={() => { localStorage.removeItem("eduvision-user"); setCurrentUser(null); }} />;
}

function MainApp({ currentUser, onLogout }) {
  const [tab, setTab] = useState("create");
  const [image, setImage] = useState(null);
  const [subject, setSubject] = useState(null);
  const [difficulty, setDifficulty] = useState("middle");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Geo state
  const [userLocation, setUserLocation] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Explore state
  const [nearbyQuestions, setNearbyQuestions] = useState([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [searchRadius, setSearchRadius] = useState(5000);
  const [expandedPin, setExpandedPin] = useState(null);
  const [showAnswer, setShowAnswer] = useState({});
  const [mapView, setMapView] = useState("split");

  // My Questions state
  const [myQuestions, setMyQuestions] = useState([]);
  const [myLoading, setMyLoading] = useState(false);

  // User menu
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userIcon = useMemo(() => createUserIcon(), []);
  const subjectIcons = useMemo(() => {
    const icons = {};
    SUBJECTS.forEach((s) => { icons[s.id] = createSubjectIcon(s.color, s.icon); });
    return icons;
  }, []);

  // ── Request GPS ──
  const requestLocation = useCallback(() => {
    if (userLocation) return Promise.resolve(userLocation);
    setGeoLoading(true);
    setGeoError(null);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setGeoError("Geolocation not supported by your browser.");
        setGeoLoading(false);
        return reject();
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setUserLocation(loc);
          setGeoLoading(false);
          resolve(loc);
        },
        (err) => {
          setGeoError(
            err.code === 1 ? "Location access denied. Please enable permissions." :
            err.code === 2 ? "Location unavailable. Try again." : "Location request timed out."
          );
          setGeoLoading(false);
          reject();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
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
    setLoading(true); setError(null); setResult(null); setPublished(false);
    try { setResult(await generateQuestionAPI(image.base64, image.mediaType, subject, difficulty)); }
    catch (err) { setError(err.message || "Failed to generate question."); }
    finally { setLoading(false); }
  };

  // ── Publish to Firestore ──
  const handlePublish = async () => {
    if (!result) return;
    setPublishing(true); setError(null);
    try {
      const loc = await requestLocation();
      const thumbnail = await compressImage(image.file);
      await publishQuestionToFirestore({
        lat: loc.lat, lng: loc.lng, subject, difficulty,
        question: result.question, hint: result.hint,
        learning_objective: result.learning_objective,
        image_analysis: result.image_analysis,
        why_this_image: result.why_this_image,
        thumbnail,
        username: currentUser,
      });
      setPublished(true);
    } catch (err) { setError(err?.message || "Failed to publish."); }
    finally { setPublishing(false); }
  };

  // ── Explore nearby ──
  const loadExplore = useCallback(async (radius) => {
    setExploreLoading(true);
    try {
      const loc = await requestLocation();
      setNearbyQuestions(await loadNearbyQuestions(loc.lat, loc.lng, radius));
    } catch {}
    finally { setExploreLoading(false); }
  }, [requestLocation]);

  useEffect(() => { if (tab === "explore") loadExplore(searchRadius); }, [tab]);

  // ── My Questions ──
  const loadMyQuestions = useCallback(async () => {
    setMyLoading(true);
    try { setMyQuestions(await loadUserQuestions(currentUser)); }
    catch {}
    finally { setMyLoading(false); }
  }, [currentUser]);

  useEffect(() => { if (tab === "my") loadMyQuestions(); }, [tab]);

  // ── Reset ──
  const handleReset = () => {
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setImage(null); setSubject(null); setResult(null); setError(null);
    setDifficulty("middle"); setPublished(false);
  };

  const selectedSubject = SUBJECTS.find((s) => s.id === subject);
  const canGenerate = image && subject && !loading;

  // ── Map component ──
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ background: subj?.bg, color: subj?.color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                        {subj?.icon} {subj?.label}
                      </span>
                      <span style={{ fontSize: 11, color: "#667085" }}>{formatDistance(q.distance)}</span>
                    </div>
                    {q.thumbnail && <img src={`data:image/jpeg;base64,${q.thumbnail}`} alt=""
                      style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 6, marginBottom: 6 }} />}
                    <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", lineHeight: 1.4, color: "#1A1A2E" }}>{q.question}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: avatarColor(q.username || "?"), display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>
                        {(q.username || "?")[0].toUpperCase()}
                      </span>
                      <span style={{ fontSize: 11, color: "#667085" }}>@{q.username}</span>
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

  // ── Username badge component ──
  const UserBadge = ({ name, size = "sm" }) => {
    const s = size === "sm" ? 20 : 24;
    const fs = size === "sm" ? 10 : 12;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: s, height: s, borderRadius: "50%", background: avatarColor(name), display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs, color: "#fff", fontWeight: 700, flexShrink: 0 }}>
          {name[0].toUpperCase()}
        </span>
        <span style={{ fontSize: size === "sm" ? 12 : 13, color: "#344054", fontWeight: 600 }}>@{name}</span>
      </span>
    );
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#1A1A2E" />
            <circle cx="10" cy="11" r="4" stroke="#E8553A" strokeWidth="1.5" fill="none" />
            <path d="M18 9l-2 4h5l-3 6" stroke="#3A6BE8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1 style={S.title}>EduVision</h1>
            <p style={S.subtitle}>AI Questions · Geo-Pinned Learning</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {userLocation && <div style={S.locBadge}><span style={S.locDot} /> GPS</div>}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowUserMenu(!showUserMenu)} style={S.userBtn}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: avatarColor(currentUser), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700 }}>
                {currentUser[0].toUpperCase()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#344054" }}>@{currentUser}</span>
              <span style={{ fontSize: 10, color: "#98A2B3" }}>▾</span>
            </button>
            {showUserMenu && (
              <div style={S.userMenu}>
                <p style={{ fontSize: 11, color: "#98A2B3", margin: "0 0 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Signed in as
                </p>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E", margin: "0 0 12px" }}>@{currentUser}</p>
                <button onClick={() => { setShowUserMenu(false); onLogout(); }} style={S.logoutBtn}>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Click outside to close menu */}
      {showUserMenu && <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setShowUserMenu(false)} />}

      {/* ── Tabs ── */}
      <nav style={S.tabBar}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...S.tabBtn, ...(tab === t.id ? S.tabBtnActive : {}) }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      {/* ══════════ CREATE TAB ══════════ */}
      {tab === "create" && (
        <div style={S.mainGrid}>
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
              <div style={S.resCard}>
                <div style={S.analysisBanner}>
                  <div style={S.dot} />
                  <div>
                    <p style={S.metaLabel}>Image Analysis</p>
                    <p style={S.aText}>{result.image_analysis}</p>
                  </div>
                </div>

                <div style={{ ...S.qBox, borderLeftColor: selectedSubject?.color || "#1A1A2E" }}>
                  <p style={{ ...S.metaLabel, marginBottom: 6 }}>{selectedSubject?.icon} {selectedSubject?.label} Question</p>
                  <p style={S.qText}>{result.question}</p>
                </div>

                <details style={S.hintBox}>
                  <summary style={S.hintSum}>💡 Hint</summary>
                  <p style={S.hintP}>{result.hint}</p>
                </details>

                <div style={S.metaGrid}>
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
                      Published as @{currentUser}
                    </div>
                  )}
                </div>

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

                {geoError && <p style={{ fontSize: 12, color: "#B42318", margin: "4px 0 0" }}>{geoError}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ EXPLORE TAB ══════════ */}
      {tab === "explore" && (
        <div style={S.exploreWrap}>
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

          {geoError && <div style={{ ...S.errorBox, marginBottom: 16 }}><span>⚠</span> {geoError}</div>}

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
                            <div style={S.pinMeta}>
                              <span style={{ ...S.pinTag, background: subj?.bg, color: subj?.color }}>{subj?.icon} {subj?.label}</span>
                              <span style={S.pinDist}>{formatDistance(q.distance)}</span>
                            </div>
                            <p style={S.pinQ}>{q.question}</p>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <UserBadge name={q.username || "anon"} />
                              <span style={{ fontSize: 11, color: "#98A2B3" }}>· {timeAgo(q.timestamp)}</span>
                            </div>
                          </div>
                          <span style={{ fontSize: 18, color: "#98A2B3", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
                        </div>
                        {open && (
                          <div style={S.pinExpand} onClick={(e) => e.stopPropagation()}>
                            <div style={S.analysisBanner}>
                              <div style={S.dot} />
                              <div><p style={S.metaLabel}>What's in the image</p><p style={S.aText}>{q.image_analysis}</p></div>
                            </div>
                            <details style={S.hintBox}>
                              <summary style={S.hintSum}>💡 Need a hint?</summary>
                              <p style={S.hintP}>{q.hint}</p>
                            </details>
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
        <div style={S.exploreWrap}>
          <div style={{ ...S.exploreHead, marginBottom: 16 }}>
            <div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, margin: 0 }}>My Questions</h2>
              <p style={{ fontSize: 12, color: "#98A2B3", margin: "4px 0 0" }}>Questions you've published as @{currentUser}</p>
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
                        <div style={S.pinMeta}>
                          <span style={{ ...S.pinTag, background: subj?.bg, color: subj?.color }}>{subj?.icon} {subj?.label}</span>
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

      <footer style={S.footer}>Powered by Claude Vision API — Geo-pinned learning for everyone</footer>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.2);opacity:1}}
        details>summary{list-style:none;cursor:pointer}
        details>summary::-webkit-details-marker{display:none}
        .leaflet-popup-content-wrapper{border-radius:10px!important;box-shadow:0 4px 16px rgba(0,0,0,0.12)!important}
        .leaflet-popup-content{margin:10px 12px!important}
        .leaflet-container{font-family:'DM Sans',sans-serif!important}
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
  userMenu: { position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", border: "1px solid #E8EAED", zIndex: 99, minWidth: 180 },
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
