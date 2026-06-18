const PLAYER_COUNT = 11;
const TOAST_TIMEOUT_MS = 4200;
const RECONNECT_DELAY_MS = 2500;
const DEFAULT_WS_URL = "ws://localhost:5000/api/vitals-stream";
const DEFAULT_WS_URL_FALLBACK = "ws://192.168.4.1:81";
const PYTHON_API_URL = "http://localhost:5000";
const START_MATCH_WHISTLE_SRC = "assets/soundEffects/Start Match Whistle.opus";
const END_MATCH_WHISTLE_SRC = "assets/soundEffects/End Match Whistle.opus";
const FIELD_X_MIN = 8;
const FIELD_X_MAX = 92;
const FIELD_Y_MIN = 14;
const FIELD_Y_MAX = 86;
const DEFAULT_HEADING_DEG = -90;
const MOVEMENT_SPEED_TO_PERCENT_PER_SEC = 0.35;
const RANDOM_DRIFT_INTERVAL_MS = 900;
const SPO2_CRITICAL_HOLD_MS = 60000;
const HR_RECOVERY_WINDOW_MS = 60000;
const ECG_CRITICAL_WINDOW_MS = 3000;
const WARNING_DEBOUNCE_MS = 9000;
const CRITICAL_REOPEN_DEBOUNCE_MS = 10000;
const ECG_BUFFER_SIZE = 1400;
const EMG_BUFFER_SIZE = 1400; // مساحة لويف العضلات

const SUPABASE_URL = "https://doahbvwljbrjbduhhbtb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_2ZRNKUPXJuy51hgQ2K_4-g_UOQnbDq8";
const supabaseClient =
  window.supabase &&
  typeof window.supabase.createClient === "function" &&
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

// إضافة الحدود وخصائص الجراف
const METRIC_CONFIG = [
  { key: "heartRate", label: "Heart Rate", unit: "bpm", limitText: "Safe Zone: 42 - 188 bpm", isGraph: false },
  { key: "spo2", label: "Blood Oxygen", unit: "%", limitText: "Normal: > 89%", isGraph: false },
  { key: "bodyTemp", label: "Body Temperature", unit: "degC", limitText: "Safe Limit: < 39.8 °C", isGraph: false },
  { key: "muscleFatigue", label: "Muscle Fatigue (EMG)", unit: "mV", limitText: "Optimal Activity Signal", isGraph: true },
  { key: "acceleration", label: "Acceleration", unit: "m/s2", limitText: "Normal: < 17.5 m/s²", isGraph: false },
  { key: "ecg", label: "ECG", unit: "mV", limitText: "Stable: ± 2.6 mV", isGraph: true },
];

const METRIC_CARD_BACKGROUNDS = {
  heartRate: "assets/cards/hearRateCard.png",
  spo2: "assets/cards/bloodOxygenCard.jpg",
  bodyTemp: "assets/cards/bodyTempCard.png",
  muscleFatigue: "assets/cards/emgCard.jpg",
  acceleration: "assets/cards/accelerationCard.jpg",
  ecg: "assets/cards/ecgCard.png",
};

const CRITICAL_RULES = {
  heartRate: (v) => v > 188 || v < 42,
  spo2: (v) => v < 89,
  bodyTemp: (v) => v > 39.8,
  muscleFatigue: (v) => v < 15,
  acceleration: (v) => v > 17.5,
  ecg: (v) => Math.abs(v) > 2.6,
};

const ENGLISH_PLAYER_NAMES = [
  "James Carter", "Liam Walker", "Noah Bennett", "Ethan Foster", "Mason Brooks",
  "Lucas Perry", "Oliver Reed", "Henry Collins", "Jack Turner", "Daniel Cooper",
  "Aiden Hayes", "Logan Russell", "Caleb Morris", "Ryan Griffin", "Nathan Ward",
  "Isaac Palmer", "Levi Hughes", "Owen Barnes", "Dylan Price", "Jacob Wells",
];

const aiCache = new Map();
const aiPendingRequests = new Map();
const AI_PROXY_URL = "";

let isSimulating = false;
let simulationInterval;
let simulationTick = 0;
let simulationTemp = 37.0;

const FORMATION_4_4_3 = [
  { top: "83%", left: "50%" }, { top: "67%", left: "18%" }, { top: "67%", left: "39%" },
  { top: "67%", left: "61%" }, { top: "67%", left: "82%" }, { top: "50%", left: "16%" },
  { top: "50%", left: "38%" }, { top: "50%", left: "62%" }, { top: "50%", left: "84%" },
  { top: "30%", left: "33%" }, { top: "30%", left: "67%" },
];

function pickUniqueJerseys(count, reserved) {
  const set = new Set(reserved ? [Number(reserved)] : []);
  const jerseys = [];
  while (jerseys.length < count) {
    const candidate = Math.floor(Math.random() * 99) + 1;
    if (set.has(candidate)) continue;
    set.add(candidate);
    jerseys.push(candidate);
  }
  return jerseys;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createInitialPlayers(profile) {
  const names = shuffle(ENGLISH_PLAYER_NAMES).slice(0, PLAYER_COUNT);
  const jerseys = pickUniqueJerseys(PLAYER_COUNT, profile?.jerseyNumber);

  return Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: i + 1,
    name: i === 0 && profile ? profile.name : names[i],
    jerseyNumber: i === 0 && profile ? profile.jerseyNumber : jerseys[i],
    heightCm: i === 0 && profile ? profile.heightCm : 180,
    weightKg: i === 0 && profile ? profile.weightKg : 75,
    age: i === 0 && profile ? profile.age : 24,
    online: false,
    telemetry: {
      heartRate: null, spo2: null, bodyTemp: null, muscleFatigue: null,
      acceleration: null, speed: null, gyroX: null, gyroY: null, gyroZ: null, ecg: null,
    },
    lastSeen: null,
    samplesCaptured: 0,
  }));
}

function createInitialFormationPositions() {
  return FORMATION_4_4_3.map((pos, index) => ({
    id: index + 1,
    x: Number.parseFloat(pos.left),
    y: Number.parseFloat(pos.top),
  }));
}

function parseHashRoute() {
  const hash = window.location.hash || "#/";
  if (!hash.startsWith("#/player/")) return { name: "team" };
  const idPart = hash.replace("#/player/", "");
  const id = Number(idPart);
  if (!Number.isInteger(id)) return { name: "team" };
  return { name: "player", id };
}

const state = {
  profile: { name: "Default Athlete", heightCm: 180, weightKg: 75, age: 24, jerseyNumber: 10 },
  players: [],
  activeVestPlayerId: null,
  matchState: "Idle",
  matchStartedAt: null,
  matchEndedAt: null,
  isFrozen: false,
  playerPositions: createInitialFormationPositions(),
  route: parseHashRoute(),
  summaryByPlayer: new Map(),
  toasts: new Map(),
  ws: { socket: null, reconnectTimer: null, disposed: false, connected: false },
  exportLock: false,
  movement: { headingDeg: DEFAULT_HEADING_DEG, lastUpdateTs: null, randomVectors: new Map() },
  exportInFlightByPlayer: new Set(),
  physiological: {
    perPlayer: new Map(),
    metricHighlightsByPlayer: new Map(),
    notificationHistoryByPlayer: new Map(),
    warningDebounceByPlayer: new Map(),
    criticalDebounceByPlayer: new Map(),
  },
  ui: { showRoster: false, showAlerts: false, activeModalMetricKey: null },
  alertsLog: [],
  ecgMonitor: { buffer: new Float32Array(ECG_BUFFER_SIZE), writeIndex: 0, lastValue: 0, canvas: null, context: null, gridCanvas: null, animationFrameId: null, gridKey: "", visible: false, drawLoopRunning: false },
  emgMonitor: { buffer: new Float32Array(EMG_BUFFER_SIZE), writeIndex: 0, lastValue: 0, canvas: null, context: null, gridCanvas: null, animationFrameId: null, gridKey: "", visible: false, drawLoopRunning: false },
};

state.players = createInitialPlayers(state.profile);

const dom = {
  root: document.getElementById("root"),
  toastLayer: null,
  simulateButton: document.getElementById("btn-simulate"),
};

const physiologyStateStore = new Map();

function createElement(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    });
  }
  if (options.style) {
    Object.entries(options.style).forEach(([key, value]) => { node.style.setProperty(key, value); });
  }
  if (options.on) {
    Object.entries(options.on).forEach(([eventName, handler]) => { node.addEventListener(eventName, handler); });
  }
  children.forEach((child) => {
    if (child === null || child === undefined) return;
    if (typeof child === "string") { node.appendChild(document.createTextNode(child)); return; }
    node.appendChild(child);
  });
  return node;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTelemetryPayload(rawPayload) {
  const source = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!source || typeof source !== "object") return null;

  const telemetry = {
    heartRate: toNumber(source.heartRate ?? source.hr ?? source.heart_rate),
    spo2: toNumber(source.spo2 ?? source.SpO2 ?? source.spo2_percent),
    bodyTemp: toNumber(source.bodyTemp ?? source.temp ?? source.temperature ?? source.body_temp),
    muscleFatigue: toNumber(source.muscleFatigue ?? source.emg ?? source.emg_hz),
    acceleration: toNumber(source.acceleration ?? source.accel ?? source.acceleration_ms2),
    speed: toNumber(source.speed ?? source.velocity ?? source.speed_ms),
    gyroX: toNumber(source.gyroX ?? source.gx ?? source.gyroscope_x),
    gyroY: toNumber(source.gyroY ?? source.gy ?? source.gyroscope_y),
    gyroZ: toNumber(source.gyroZ ?? source.gz ?? source.gyroscope_z),
    ecg: toNumber(source.ecg ?? source.ecg_mv ?? source.ecg_millivolts),
  };
  const hasAnyValue = Object.values(telemetry).some((value) => value !== null);
  return hasAnyValue ? telemetry : null;
}

function normalizeECGSamples(rawPayload) {
  const source = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!source || typeof source !== "object") return [];
  const rawSamples = source.ecgSamples ?? source.ecgWave ?? source.ecgArray ?? source.ecg_buffer;
  if (!Array.isArray(rawSamples)) return [];
  return rawSamples.map((sample) => toNumber(sample)).filter((sample) => sample !== null);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function movePointByHeading(position, headingDeg, distance) {
  const radians = (headingDeg * Math.PI) / 180;
  const dx = Math.cos(radians) * distance;
  const dy = Math.sin(radians) * distance;
  return { x: clamp(position.x + dx, FIELD_X_MIN, FIELD_X_MAX), y: clamp(position.y + dy, FIELD_Y_MIN, FIELD_Y_MAX) };
}

function formatMetric(value, key) {
  if (value === null || value === undefined) return "--";

  if (key === "acceleration") {
      return (Number(value) * 0.05).toFixed(2);
  }

  if (
      key === "bodyTemp" ||
      key === "ecg" ||
      key === "muscleFatigue"
  ) {
      return Number(value).toFixed(2);
  }

  return Math.round(value).toString();
}

function calculateSessionAverages(player) {
  // Calculate averages and get qualitative assessment
  if (!player || !player.telemetry) return null;
  
  const age = Number(player.age) || 24;
  const maxHR = 220 - age;
  
  const tel = player.telemetry;
  const hr = Number(tel.heartRate);
  const spo2 = Number(tel.spo2);
  const temp = Number(tel.bodyTemp);
  const accel = Number(tel.acceleration);
  const ecg = Number(tel.ecg);
  
  return {
    heartRate: { value: hr, avg: Math.round(hr || 0), status: getHRStatus(hr, maxHR) },
    spo2: { value: spo2, avg: Math.round(spo2 || 0), status: getSpo2Status(spo2) },
    bodyTemp: { value: temp, avg: Number((temp || 37).toFixed(1)), status: getTempStatus(temp) },
    ecg: { value: ecg, status: getECGStatus(ecg), description: getECGDescription(ecg) },
    acceleration: { value: accel, avg: Number((accel || 0).toFixed(2)), status: getAccelStatus(accel) },
  };
}

function getHRStatus(hr, maxHR) {
  if (!hr) return "Data unavailable";
  if (hr < 60) return "Resting";
  if (hr < maxHR * 0.6) return "Light activity";
  if (hr < maxHR * 0.85) return "Moderate effort";
  if (hr < maxHR * 1.0) return "High effort";
  return "Maximum effort zone";
}

function getSpo2Status(spo2) {
  if (!spo2) return "No data";
  if (spo2 >= 97) return "Excellent oxygenation";
  if (spo2 >= 95) return "Normal";
  if (spo2 >= 93) return "Adequate";
  if (spo2 >= 90) return "Caution zone";
  return "Critical - requires intervention";
}

function getTempStatus(temp) {
  if (!temp) return "No data";
  if (temp <= 37.5) return "Normal";
  if (temp <= 38.5) return "Elevated";
  if (temp <= 39.5) return "High fever";
  return "Critical temperature";
}

function getAccelStatus(accel) {
  if (!accel) return "No data";
  if (accel < 2) return "Low intensity";
  if (accel < 5) return "Moderate intensity";
  if (accel < 8) return "High intensity";
  if (accel < 12) return "Very high intensity";
  return "Extreme impact detected";
}

function getECGStatus(ecg) {
  if (!ecg) return "No data";
  if (Math.abs(ecg) <= 1.5) return "Low amplitude";
  if (Math.abs(ecg) <= 2.6) return "Normal rhythm";
  if (Math.abs(ecg) <= 3.5) return "Elevated amplitude";
  return "High amplitude - monitor closely";
}

function getECGDescription(ecg) {
  if (!ecg) return "No ECG data captured.";
  
  const absEcg = Math.abs(ecg);
  let desc = `ECG waveform amplitude: ${Number(ecg).toFixed(2)} mV. `;
  
  if (absEcg <= 1.0) {
    desc += "Low cardiac electrical activity. ";
  } else if (absEcg <= 2.0) {
    desc += "Normal cardiac electrical output during activity. ";
  } else if (absEcg <= 3.0) {
    desc += "Elevated cardiac response, consistent with exertion. ";
  } else if (absEcg <= 4.0) {
    desc += "High cardiac electrical output, peak exertion phase. ";
  } else {
    desc += "Very high cardiac electrical activity. Recommend monitoring. ";
  }
  
  desc += "No arrhythmia patterns detected.";
  return desc;
}

function getMuscleActivityDescription(emgValue) {
  if (!emgValue) return "No EMG data captured. Muscle activity sensors may not be active.";
  
  const absEmg = Math.abs(Number(emgValue));
  let desc = "Electromyography indicates muscle electrical activity: ";
  
  if (absEmg <= 0.5) {
    desc += "Minimal muscle activation detected. Athlete was in recovery or low-intensity phase. Muscles were relatively relaxed during monitoring period.";
  } else if (absEmg <= 1.5) {
    desc += "Low to moderate muscle activation. Athlete engaged in controlled movements with moderate muscular effort. Suitable for endurance activities.";
  } else if (absEmg <= 2.5) {
    desc += "Moderate to high muscle activation. Athlete demonstrated sustained muscular engagement consistent with mid-to-high intensity activities. Good muscle recruitment patterns observed.";
  } else if (absEmg <= 3.5) {
    desc += "High muscle activation indicating intense muscular engagement. Athlete maintained strong muscle contraction during high-intensity efforts. Signs of significant metabolic demand.";
  } else {
    desc += "Very high muscle activation detected. Athlete demonstrated maximum or near-maximum muscular effort. Indicates peak performance phase with high fatigue potential. Recovery emphasis recommended.";
  }
  
  return desc;
}

function clampNumber(value, min, max) { return Math.min(max, Math.max(min, value)); }

function generateMockTelemetry() {
  simulationTick += 1;
  const phase = simulationTick * 0.1;
  const heartRate = Math.round(80 + ((Math.sin(phase) + 1) * 100) / 2);
  const spo2 = Math.round(92 + Math.random() * 7);

  simulationTemp += 0.015;
  if (simulationTemp > 39.0) simulationTemp = 37.0;
  const bodyTemp = Number(simulationTemp.toFixed(2));

  const acceleration = simulationTick % 24 === 0 ? 9.0 : Number((1 + Math.random()).toFixed(2));

  const ecgSamples = Array.from({ length: 10 }, (_, index) => {
    const wavePhase = phase + index * 0.32;
    return Number(clampNumber(2.75 + 1.65 * Math.sin(wavePhase) + (Math.random() - 0.5) * 0.18, 1.0, 4.5).toFixed(3));
  });

  const emgSamples = Array.from({ length: 10 }, (_, index) => {
    return Number((Math.abs(Math.sin(phase * 2 + index * 0.1)) * 3.0 + Math.random()).toFixed(3));
  });



  // 🟢 إضافة محاكاة استهلاك البطاريتين هنا
  let simChestBat = 95 - (simulationTick * 0.05);
  if (simChestBat < 0) simChestBat = 100;
  let simThighBat = 88 - (simulationTick * 0.06);
  if (simThighBat < 0) simThighBat = 100;

  return {
    heartRate, spo2, bodyTemp,
    muscleFatigue: emgSamples[emgSamples.length - 1], acceleration,
    speed: Number((acceleration * 0.22).toFixed(2)), gyroZ: Number((Math.sin(phase * 0.6) * 6).toFixed(2)),
    ecg: ecgSamples[ecgSamples.length - 1], ecgSamples, emgSamples,
    // 🟢 تمريرهم هنا
    chestBattery: simChestBat, 
    thighBattery: simThighBat
  };

  return {
    heartRate, spo2, bodyTemp,
    muscleFatigue: emgSamples[emgSamples.length - 1], acceleration,
    speed: Number((acceleration * 0.22).toFixed(2)), gyroZ: Number((Math.sin(phase * 0.6) * 6).toFixed(2)),
    ecg: ecgSamples[ecgSamples.length - 1], ecgSamples, emgSamples
  };
}

function getMetricCardStyle(metricKey) {
  const backgroundImage = METRIC_CARD_BACKGROUNDS[metricKey];
  if (!backgroundImage) return {};
  return { "--metric-card-bg": `url("${backgroundImage}")` };
}

function refreshSimulationButton() {
  const button = dom.simulateButton;
  if (!button) return;
  button.classList.remove("hidden");
  button.style.display = "inline-flex";
  button.className = isSimulating
    ? "rounded-xl border border-red-400/80 bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-red-500"
    : "rounded-xl border border-blue-300/60 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-900 backdrop-blur-sm transition hover:bg-blue-500/20";
  button.textContent = isSimulating ? "Stop Simulation" : "Simulate Vest";
}

function stopSimulation(markOffline = true) {
  if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = undefined; }
  isSimulating = false;
  if (markOffline) { state.ws.connected = false; setECGVisibility(false); setEMGVisibility(false); updateActivePlayerOnline(false); }
  refreshSimulationButton();
}

function freezeDashboard() {
  if (!state.isFrozen) state.isFrozen = true;
  if (state.matchStartedAt && !state.matchEndedAt) state.matchEndedAt = Date.now();
  if (state.matchState === "Active") state.matchState = "Idle";
  setECGVisibility(false); setEMGVisibility(false); disconnectVestSocket();
}

function unfreezeDashboard() { state.isFrozen = false; state.matchEndedAt = null; }

function startSimulation() {
  if (!state.activeVestPlayerId) { pushToast("Select an active vest player before simulation.", "info"); return; }
  unfreezeDashboard(); disconnectVestSocket();
  state.ws.connected = false; isSimulating = true; refreshSimulationButton();
  simulationInterval = window.setInterval(() => {
    if (!state.activeVestPlayerId) { stopSimulation(true); render(); return; }
    handleTelemetryPacket(state.activeVestPlayerId, generateMockTelemetry());
  }, 500);
}

function toggleSimulation() {
  if (isSimulating) { stopSimulation(true); freezeDashboard(); render(); return; }
  startSimulation(); render();
}

function playWhistle(src) { new Audio(src).play().catch(() => {}); }

function ensureToastLayer() {
  if (dom.toastLayer) return dom.toastLayer;
  dom.toastLayer = createElement("div", { className: "fixed left-4 bottom-4 z-50 space-y-2 w-[min(92vw,22rem)] pointer-events-none" });
  document.body.appendChild(dom.toastLayer); return dom.toastLayer;
}

function removeToast(id) {
  const toast = state.toasts.get(id);
  if (!toast) return;
  if (toast.timer) clearTimeout(toast.timer);
  if (toast.node && toast.node.parentNode) toast.node.parentNode.removeChild(toast.node);
  state.toasts.delete(id);
}

function pushToast(message, level = "info") {
  // Toast notifications are disabled - all notifications go to alerts log only
  const now = Date.now();
  const activePlayer = state.players.find(p => p.id === state.activeVestPlayerId);
  
  state.alertsLog.unshift({ 
    time: new Date(now).toLocaleTimeString(), 
    msg: message, 
    level: level, 
    player: activePlayer?.name || "System" 
  });
  
  if (state.alertsLog.length > 50) state.alertsLog.pop();
  render();
}

function getOrCreatePhysiologyState(playerId) {
  if (!physiologyStateStore.has(playerId)) {
    physiologyStateStore.set(playerId, { spo2Below90Since: null, sprintActive: false, sprintStartedAt: null, sprintEndedAt: null, hrRecoveryDeadlineAt: null, ecgAbove4Since: null });
  }
  return physiologyStateStore.get(playerId);
}

function evaluateTelemetry(data, playerProfile) {
  const now = Date.now();
  const playerId = Number(playerProfile?.id ?? state.activeVestPlayerId ?? 0);
  if (!Number.isInteger(playerId) || playerId <= 0) return { currentTier: 1, messages: [] };

  const playerState = getOrCreatePhysiologyState(playerId);
  const age = Math.max(10, Number(playerProfile?.age) || 24);
  const maxHR = 220 - age;

  const heartRate = toNumber(data?.heartRate);
  const spo2 = toNumber(data?.spo2);
  const bodyTemp = toNumber(data?.bodyTemp);
  const muscleFatigueDrop = toNumber(data?.muscleFatigue);
  const acceleration = toNumber(data?.acceleration);
  const ecg = toNumber(data?.ecg);

  const metricTiers = { heartRate: 1, spo2: 1, bodyTemp: 1, muscleFatigue: 1, acceleration: 1, ecg: 1 };
  const warningMessages = []; const criticalMessages = [];

  const updateMetricTier = (metricKey, tier, message) => {
    metricTiers[metricKey] = Math.max(metricTiers[metricKey], tier);
    if (!message) return;
    if (tier >= 3) criticalMessages.push(message); else if (tier === 2) warningMessages.push(message);
  };

  if (acceleration !== null) {
    if (acceleration > 8.0 || acceleration < -8.0) updateMetricTier("acceleration", 3, `Critical impact spike detected (${formatMetric(acceleration, "acceleration")} m/s2).`);
    else if (acceleration < -3.0) updateMetricTier("acceleration", 2, `Warning: deceleration load is high.`);
  }

  if (heartRate !== null) {
    if (heartRate > maxHR * 1.05) updateMetricTier("heartRate", 3, `Critical: heart rate exceeded 105% of maxHR (${Math.round(heartRate)} bpm).`);
    else if (heartRate >= maxHR * 0.95) updateMetricTier("heartRate", 2, `Warning: heart rate is in overload zone.`);
  }

  if (spo2 !== null) {
    if (spo2 < 90) updateMetricTier("spo2", 3, `Critical: SpO2 is below 90% (${Math.round(spo2)}%).`);
    else if (spo2 <= 93) updateMetricTier("spo2", 2, `Warning: SpO2 is in caution zone.`);
  }

  if (bodyTemp !== null) {
    if (bodyTemp >= 40.5) updateMetricTier("bodyTemp", 3, `Critical: body temperature reached ${formatMetric(bodyTemp, "bodyTemp")} C.`);
    else if (bodyTemp >= 39.5) updateMetricTier("bodyTemp", 2, `Warning: body temp elevated.`);
  }

  if (ecg !== null) {
    if (ecg > 4.0) updateMetricTier("ecg", 3, `Critical: ECG R-wave remained above 4.0 mV.`);
    else if (ecg < 0.5) updateMetricTier("ecg", 2, `Warning: ECG R-wave is low.`);
  }

  const metricEntries = Object.entries(metricTiers);
  const criticalMetricKeys = metricEntries.filter(([, tier]) => tier >= 3).map(([key]) => key);
  const warningMetricKeys = metricEntries.filter(([, tier]) => tier === 2).map(([key]) => key);
  const currentTier = Math.max(1, ...metricEntries.map(([, tier]) => tier));

  state.physiological.metricHighlightsByPlayer.set(playerId, new Set(criticalMetricKeys));

  return { currentTier, messages: [...criticalMessages, ...warningMessages], playerId, criticalMessages, warningMessages, criticalMetricKeys, warningMetricKeys, metricTiers };
}

function handleTelemetryAlerts(evaluationResult) {
  const now = Date.now();
  const playerId = evaluationResult.playerId;
  const criticalSignature = evaluationResult.criticalMessages.join("|");

  if (evaluationResult.currentTier >= 3 && criticalSignature) {
    const previousCritical = state.physiological.criticalDebounceByPlayer.get(playerId);
    const shouldOpenCritical = !previousCritical || previousCritical.signature !== criticalSignature || now - previousCritical.at > CRITICAL_REOPEN_DEBOUNCE_MS;

    if (shouldOpenCritical) {
      const history = state.physiological.notificationHistoryByPlayer.get(playerId) || [];
      evaluationResult.criticalMessages.forEach((message) => {
        history.push(`[${new Date(now).toLocaleTimeString()}] ${message}`);
        state.alertsLog.unshift({ time: new Date(now).toLocaleTimeString(), msg: message, level: "critical", player: state.players.find(p=>p.id===playerId)?.name });
        pushToast(`ALERT: ${message}`, "critical");
      });
      state.physiological.notificationHistoryByPlayer.set(playerId, history.slice(-60));
      if (state.alertsLog.length > 50) state.alertsLog.pop();

      state.physiological.criticalDebounceByPlayer.set(playerId, { signature: criticalSignature, at: now });
      render();
    }
  }
}

function ensureGraphGridCache(width, height, dpr, monitorState) {
  const key = `${width}x${height}x${dpr}`;
  if (monitorState.gridCanvas && monitorState.gridKey === key) return monitorState.gridCanvas;

  const gridCanvas = document.createElement("canvas");
  gridCanvas.width = Math.max(1, Math.floor(width * dpr));
  gridCanvas.height = Math.max(1, Math.floor(height * dpr));
  const gridContext = gridCanvas.getContext("2d");
  if (!gridContext) return null;

  gridContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  
  // 🟢 خلفية داكنة جداً مطابقة لبرنامج البايثون
  gridContext.fillStyle = "#0a0a0a"; 
  gridContext.fillRect(0, 0, width, height);

  // 🟢 شبكة خفيفة جداً تكاد تكون مخفية (لتعطي إيحاء طبي بدون تشويش)
  gridContext.strokeStyle = "rgba(255, 255, 255, 0.04)";
  gridContext.lineWidth = 1;

  for (let x = 0; x <= width; x += 16) { gridContext.beginPath(); gridContext.moveTo(x + 0.5, 0); gridContext.lineTo(x + 0.5, height); gridContext.stroke(); }
  for (let y = 0; y <= height; y += 16) { gridContext.beginPath(); gridContext.moveTo(0, y + 0.5); gridContext.lineTo(width, y + 0.5); gridContext.stroke(); }
  
  // خط المنتصف
  gridContext.strokeStyle = "rgba(255, 255, 255, 0.08)"; 
  gridContext.beginPath(); gridContext.moveTo(0, height / 2); gridContext.lineTo(width, height / 2); gridContext.stroke();

  monitorState.gridCanvas = gridCanvas; monitorState.gridKey = key; return gridCanvas;
}

function renderECGFrame() {
  const ecgState = state.ecgMonitor;
  if (!ecgState.drawLoopRunning || !ecgState.canvas || !ecgState.visible) { ecgState.drawLoopRunning = false; ecgState.animationFrameId = null; return; }
  const context = ecgState.context || ecgState.canvas.getContext("2d");
  const width = Math.max(1, Math.floor(ecgState.canvas.clientWidth || 420));
  const height = Math.max(1, Math.floor(ecgState.canvas.clientHeight || 180));
  const dpr = window.devicePixelRatio || 1;

  if (ecgState.canvas.width !== Math.floor(width * dpr) || ecgState.canvas.height !== Math.floor(height * dpr)) {
    ecgState.canvas.width = Math.floor(width * dpr); ecgState.canvas.height = Math.floor(height * dpr); ecgState.gridCanvas = null; ecgState.gridKey = "";
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grid = ensureGraphGridCache(width, height, dpr, ecgState);
  if (grid) context.drawImage(grid, 0, 0, width, height);
  else { context.fillStyle = "#0a0a0a"; context.fillRect(0, 0, width, height); }

  // 🟢 1. نافذة زمنية ضيقة (150 نقطة) زي الريسيفر البايثون بالظبط
  const DISPLAY_SAMPLES = 150; 
  const stepX = width / (DISPLAY_SAMPLES - 1);

  context.lineWidth = 2; context.strokeStyle = "#00ff44"; context.beginPath();

  for (let i = 0; i < DISPLAY_SAMPLES; i++) {
    // 🟢 2. سحب أحدث 150 نقطة فقط من الـ Buffer
    const bufferIndex = (ecgState.writeIndex - DISPLAY_SAMPLES + i + ECG_BUFFER_SIZE) % ECG_BUFFER_SIZE;
    const val = ecgState.buffer[bufferIndex] ?? 0;

    const x = i * stepX;
    
    // 🟢 3. رسم الإشارة بمدى 3.3 فولت (والذي يعادل 0 لـ 4095 خام في البايثون)
    let y = height - ((val / 3.3) * height);
    
    // تأمين الإشارة عشان متخرجش برا الفريم مهما حصل
    y = Math.max(0, Math.min(height, y));

    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  ecgState.animationFrameId = window.requestAnimationFrame(renderECGFrame);
}
function renderEMGFrame() {
  const emgState = state.emgMonitor;
  if (!emgState.drawLoopRunning || !emgState.canvas || !emgState.visible) { emgState.drawLoopRunning = false; emgState.animationFrameId = null; return; }
  const context = emgState.context || emgState.canvas.getContext("2d");
  const width = Math.max(1, Math.floor(emgState.canvas.clientWidth || 420));
  const height = Math.max(1, Math.floor(emgState.canvas.clientHeight || 180));
  const dpr = window.devicePixelRatio || 1;

  if (emgState.canvas.width !== Math.floor(width * dpr) || emgState.canvas.height !== Math.floor(height * dpr)) {
    emgState.canvas.width = Math.floor(width * dpr); emgState.canvas.height = Math.floor(height * dpr); emgState.gridCanvas = null; emgState.gridKey = "";
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grid = ensureGraphGridCache(width, height, dpr, emgState);
  if (grid) context.drawImage(grid, 0, 0, width, height);
  else { context.fillStyle = "#0a0a0a"; context.fillRect(0, 0, width, height); }

  // 🟢 نافذة 150 نقطة
  const DISPLAY_SAMPLES = 150; 
  const stepX = width / (DISPLAY_SAMPLES - 1);

  context.lineWidth = 1.5; context.strokeStyle = "#ff6600"; context.beginPath();

  for (let i = 0; i < DISPLAY_SAMPLES; i++) {
    const bufferIndex = (emgState.writeIndex - DISPLAY_SAMPLES + i + EMG_BUFFER_SIZE) % EMG_BUFFER_SIZE;
    const val = emgState.buffer[bufferIndex] ?? 0;

    const x = i * stepX;
    
    // سكيل الإشارة (مقلوب عشان يترسم من تحت لفوق)
    let y = height - ((val / 3.3) * height);
    y = Math.max(0, Math.min(height, y));

    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  emgState.animationFrameId = window.requestAnimationFrame(renderEMGFrame);
}
function drawLiveECG(voltageArray) {
  if (!Array.isArray(voltageArray) || !voltageArray.length) return;
  voltageArray.forEach((sample) => {
    const s = toNumber(sample); if (s === null) return;
    state.ecgMonitor.buffer[state.ecgMonitor.writeIndex] = s;
    state.ecgMonitor.writeIndex = (state.ecgMonitor.writeIndex + 1) % ECG_BUFFER_SIZE;
    state.ecgMonitor.lastValue = s;
  });
  if (state.ecgMonitor.visible && !state.ecgMonitor.drawLoopRunning) { state.ecgMonitor.drawLoopRunning = true; state.ecgMonitor.animationFrameId = window.requestAnimationFrame(renderECGFrame); }
}

function drawLiveEMG(voltageArray) {
  if (!Array.isArray(voltageArray) || !voltageArray.length) return;
  voltageArray.forEach((sample) => {
    const s = toNumber(sample); if (s === null) return;
    state.emgMonitor.buffer[state.emgMonitor.writeIndex] = s;
    state.emgMonitor.writeIndex = (state.emgMonitor.writeIndex + 1) % EMG_BUFFER_SIZE;
    state.emgMonitor.lastValue = s;
  });
  if (state.emgMonitor.visible && !state.emgMonitor.drawLoopRunning) { state.emgMonitor.drawLoopRunning = true; state.emgMonitor.animationFrameId = window.requestAnimationFrame(renderEMGFrame); }
}

function setECGVisibility(isVisible) {
  state.ecgMonitor.visible = isVisible;
  if (isVisible) { if (!state.ecgMonitor.drawLoopRunning) { state.ecgMonitor.drawLoopRunning = true; state.ecgMonitor.animationFrameId = window.requestAnimationFrame(renderECGFrame); } } 
  else { state.ecgMonitor.drawLoopRunning = false; if (state.ecgMonitor.animationFrameId) { window.cancelAnimationFrame(state.ecgMonitor.animationFrameId); state.ecgMonitor.animationFrameId = null; } }
}

function setEMGVisibility(isVisible) {
  state.emgMonitor.visible = isVisible;
  if (isVisible) { if (!state.emgMonitor.drawLoopRunning) { state.emgMonitor.drawLoopRunning = true; state.emgMonitor.animationFrameId = window.requestAnimationFrame(renderEMGFrame); } } 
  else { state.emgMonitor.drawLoopRunning = false; if (state.emgMonitor.animationFrameId) { window.cancelAnimationFrame(state.emgMonitor.animationFrameId); state.emgMonitor.animationFrameId = null; } }
}

function bindCanvasesFromDOM() {
  const ecgCanvas = document.querySelector('[data-role="ecg-live-canvas"]');
  if (ecgCanvas) { state.ecgMonitor.canvas = ecgCanvas; state.ecgMonitor.context = ecgCanvas.getContext("2d"); if (state.ecgMonitor.visible && !state.ecgMonitor.drawLoopRunning) { state.ecgMonitor.drawLoopRunning = true; renderECGFrame(); } }
  
  const emgCanvas = document.querySelector('[data-role="muscleFatigue-live-canvas"]');
  if (emgCanvas) { state.emgMonitor.canvas = emgCanvas; state.emgMonitor.context = emgCanvas.getContext("2d"); if (state.emgMonitor.visible && !state.emgMonitor.drawLoopRunning) { state.emgMonitor.drawLoopRunning = true; renderEMGFrame(); } }
}

function getSelectedPlayer() {
  if (state.route.name !== "player") return null;
  return state.players.find((p) => p.id === state.route.id) || null;
}

function getSummaryTemplate(player) { return `Athlete Profile:\n- Name: ${player.name}\n- Jersey: #${player.jerseyNumber}\n- Height: ${player.heightCm || "-"} cm\n- Weight: ${player.weightKg || "-"} kg\n- Age: ${player.age || "-"}\n\nSession Duration:\n-\n\nSamples Captured:\n- ${player.samplesCaptured}\n\nTelemetry Summary:\n`; }
function getPlayerSummary(player) {
  const existing = state.summaryByPlayer.get(player.id);
  if (typeof existing === "string") return existing;
  const template = getSummaryTemplate(player); state.summaryByPlayer.set(player.id, template); return template;
}
function setPlayerSummary(playerId, summary) { state.summaryByPlayer.set(playerId, summary); }

function getSessionDurationText() {
  if (!state.matchStartedAt) return "00:00";
  const sessionEnd = state.matchEndedAt || Date.now();
  const seconds = Math.max(0, Math.floor((sessionEnd - state.matchStartedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function openPlayer(id) { window.location.hash = `#/player/${id}`; }
function backToTeam() { window.location.hash = "#/"; }

function handlePlayerClick(id) {
  if (!state.activeVestPlayerId) {
    state.activeVestPlayerId = id; state.movement.headingDeg = DEFAULT_HEADING_DEG; state.movement.lastUpdateTs = null; state.matchState = "Idle"; state.matchStartedAt = null;
    pushToast(`Vest assigned to ${state.players.find(p=>p.id===id).name}. Waiting for actual vest connection...`, "info");
    connectVestSocket(); openPlayer(id); return;
  }
  if (state.activeVestPlayerId !== id) { pushToast("Only one vest is active. Open the selected vest player.", "info"); return; }
  openPlayer(id);
}

function updateActivePlayerOnline(isConnected) {
  if (!state.activeVestPlayerId) return;
  state.players = state.players.map((player) => { if (player.id !== state.activeVestPlayerId) return player; return { ...player, online: isConnected }; });
}

function disconnectVestSocket() {
  state.ws.disposed = true;
  if (state.ws.reconnectTimer) { clearTimeout(state.ws.reconnectTimer); state.ws.reconnectTimer = null; }
  if (state.ws.socket) { state.ws.socket.close(); state.ws.socket = null; }
  stopPythonPolling();
  state.ws.connected = false; setECGVisibility(false); setEMGVisibility(false); updateActivePlayerOnline(false);
}
// ================== SECURE MQTT CLOUD CONNECTION ==================
const MQTT_BROKER = "wss:6522c1294037486684bd20328c31939a.s1.eu.hivemq.cloud:8884/mqtt"; // ⚠️ لينكك
const MQTT_USERNAME = "WearableTech"; // ⚠️ اليوزر نيم
const MQTT_PASSWORD = "Abc123@def456"; // ⚠️ الباسورد

const MQTT_TOPIC_CHEST = "gapc/gradproj/player1/chest";
const MQTT_TOPIC_THIGH = "gapc/gradproj/player1/thigh";

let mqttClient = null;

// 🟢 المصدّ (Buffer) اللي هيخزن الـ 150 رسالة في صمت
let latestHardwareVitals = {
  chest: { status: "Offline", ecgSamples: [] },
  thigh: { status: "Offline", emgSamples: [] }
};
let lastChestPacketTime = 0;
let lastThighPacketTime = 0;
let hardwareWatchdog = null;
let renderLoop = null;

function disconnectVestSocket() {
  state.ws.disposed = true;
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
  }
  // 🟢 إيقاف الحارس الأمني ومنظم المرور
  if (hardwareWatchdog) { clearInterval(hardwareWatchdog); hardwareWatchdog = null; }
  if (renderLoop) { clearInterval(renderLoop); renderLoop = null; }
  
  state.ws.connected = false;
  updateActivePlayerOnline(false);
}

function connectVestSocket() {
  disconnectVestSocket();
  if (!state.activeVestPlayerId) { render(); return; }
  state.ws.disposed = false;

  console.log("☁️ Connecting to HiveMQ Cloud...");
  
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: 'dashboard_web_' + Math.random().toString(16).substr(2, 8),
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    keepalive: 60,
    reconnectPeriod: 1000
  });

  mqttClient.on('connect', () => {
    console.log("✅ Connected to MQTT Broker!");
    state.ws.connected = true;
    updateActivePlayerOnline(true);
    
    mqttClient.subscribe(MQTT_TOPIC_CHEST);
    mqttClient.subscribe(MQTT_TOPIC_THIGH);
    
    lastChestPacketTime = Date.now();
    lastThighPacketTime = Date.now();

    // 🟢 1. الحارس الأمني (يقلب السنسور Offline لو فصل)
    hardwareWatchdog = setInterval(() => {
      const now = Date.now();
      if (now - lastChestPacketTime > 1500) latestHardwareVitals.chest.status = "Offline";
      if (now - lastThighPacketTime > 1500) latestHardwareVitals.thigh.status = "Offline";
    }, 500);

    // 🟢 2. منظم المرور للشاشة (25 تحديث في الثانية فقط)
    renderLoop = setInterval(() => {
      if (latestHardwareVitals.chest.status === "Online" || latestHardwareVitals.thigh.status === "Online") {
        handlePythonVitals(latestHardwareVitals);
        
        // تفريغ مصفوفات الإشارات السريعة بعد ما الشاشة ترسمهم
        latestHardwareVitals.chest.ecgSamples = [];
        latestHardwareVitals.thigh.emgSamples = [];
      }
    }, 40);

    render();
  });

  // 🟢 3. الاستقبال الصامت من السحابة (بيخزن في الـ Buffer من غير ما يكلم الشاشة)
  mqttClient.on('message', (topic, message) => {
    try {
      const packet = message.toString().split(',');

      if (topic === MQTT_TOPIC_CHEST) {
        lastChestPacketTime = Date.now();
        latestHardwareVitals.chest.status = "Online";
        
        if (packet[0] === "CH" && packet.length >= 7) {
          latestHardwareVitals.chest.temp = packet[2];
          latestHardwareVitals.chest.hr = packet[3];
          latestHardwareVitals.chest.spo2 = packet[4];
          latestHardwareVitals.chest.battery = packet[5];
        } else if (packet[0] === "E" && packet.length >= 2) {
          latestHardwareVitals.chest.ecgSamples.push((parseFloat(packet[1]) / 4095.0) * 3.3);
        }
      } 
      else if (topic === MQTT_TOPIC_THIGH) {
        lastThighPacketTime = Date.now();
        latestHardwareVitals.thigh.status = "Online";

        if (packet[0] === "TH" && packet.length >= 12) {
          const ax = parseFloat(packet[4]), ay = parseFloat(packet[5]), az = parseFloat(packet[6]);
          latestHardwareVitals.thigh.accel = Math.sqrt(ax*ax + ay*ay + az*az).toFixed(2);
          latestHardwareVitals.thigh.roll = packet[1];
          latestHardwareVitals.thigh.pitch = packet[2];
          latestHardwareVitals.thigh.steps = packet[7];
          latestHardwareVitals.thigh.activity = packet[8];
          latestHardwareVitals.thigh.emg = packet[9];
          latestHardwareVitals.thigh.battery = packet[10].replace("%", "");
        } else if (packet[0] === "M" && packet.length >= 3) {
          latestHardwareVitals.thigh.emgSamples.push((parseFloat(packet[1]) / 4095.0) * 3.3);
        }
      }
    } catch (err) {
      // صمت لتجنب أي تهنيج لو جت حزمة ناقصة
    }
  });

  mqttClient.on('error', () => { state.ws.connected = false; render(); });
  mqttClient.on('close', () => { state.ws.connected = false; updateActivePlayerOnline(false); render(); });
}

function disconnectVestSocket() {
  state.ws.disposed = true;
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
  }
  state.ws.connected = false;
  updateActivePlayerOnline(false);
}

function updateActivePlayerOnline(isConnected) { 
  if (!state.activeVestPlayerId) return; 
  state.players = state.players.map(p => p.id === state.activeVestPlayerId ? { ...p, online: isConnected } : p); 
}
// ===========================================================

let pythonPollingTimer = null;

function startPythonPolling() {
  if (pythonPollingTimer) return;
  console.log("📡 Starting Python API polling...");
  pythonPollingTimer = setInterval(() => {
    fetch(`${PYTHON_API_URL}/api/vitals`)
      .then(res => res.json())
      .then(vitals => {
        if (vitals) {
          state.ws.connected = true;
          updateActivePlayerOnline(true);
          handlePythonVitals(vitals);
        }
      })
      .catch(err => {
        if (!state.ws.connected) {
          state.ws.connected = false;
          updateActivePlayerOnline(false);
        }
      });
  }, 100); // Poll every 100ms
}

function stopPythonPolling() {
  if (pythonPollingTimer) {
    clearInterval(pythonPollingTimer);
    pythonPollingTimer = null;
    console.log("🛑 Python API polling stopped");
  }
}

function handlePythonVitals(vitals) {
  if (!vitals || !state.activeVestPlayerId) return;
  
  const chest = vitals.chest || {};
  const thigh = vitals.thigh || {};
  
  const ecgArr = chest.ecgSamples || [];
  const lastEcg = ecgArr.length > 0 ? ecgArr[ecgArr.length - 1] : null;
  
  const telemetryPayload = {
    heartRate: parseFloat(chest.hr) || null,
    spo2: parseFloat(chest.spo2) || null,
    bodyTemp: parseFloat(chest.temp) || null,
acceleration: Math.abs(parseFloat(thigh.pitch) || 0),
    gyroZ: parseFloat(thigh.roll) || null,
    muscleFatigue: parseFloat(thigh.emg) || null,
    ecg: lastEcg, 
    ecgSamples: ecgArr,
    emgSamples: thigh.emgSamples || [],
    chestBattery: parseFloat(chest.battery) || null,
    thighBattery: parseFloat(thigh.battery) || null,
    // 🟢 السحب المباشر للحركة والخطوات
    steps: parseInt(thigh.steps) || 0,
    activity: thigh.activity || "Still",
    distance: ((parseInt(thigh.steps) || 0) * 0.76).toFixed(1) // حساب المسافة
  };
  
  if (vitals.chest?.status === "Online" || vitals.thigh?.status === "Online") {
    handleTelemetryPacket(state.activeVestPlayerId, telemetryPayload);
  }
}

function handleTelemetryPacket(playerId, payload) {
  if (state.isFrozen) return;
  const now = Date.now();
  const ecgSamples = Array.isArray(payload.ecgSamples) ? payload.ecgSamples : [];
  const emgSamples = Array.isArray(payload.emgSamples) ? payload.emgSamples : [];
  const telemetryPayload = { ...payload }; delete telemetryPayload.ecgSamples; delete telemetryPayload.emgSamples;

  // 🟢 حركة اللاعب في الملعب باستخدام التسارع
  if (playerId === state.activeVestPlayerId) {
    const dtSeconds = state.movement.lastUpdateTs ? Math.max(0.04, Math.min(1.2, (now - state.movement.lastUpdateTs) / 1000)) : 0.2;
    state.movement.lastUpdateTs = now;
    state.movement.headingDeg += (toNumber(payload.gyroZ) ?? 0) * dtSeconds;
    const rawAccel = toNumber(telemetryPayload.acceleration);
    const validAccel = (rawAccel !== null && rawAccel > 0.5) ? rawAccel : 0;
    const speed = validAccel * 0.18; 
    const fieldDistance = speed * MOVEMENT_SPEED_TO_PERCENT_PER_SEC * dtSeconds;
    
    if (fieldDistance > 0) {
      state.playerPositions = state.playerPositions.map((entry) => { 
        if (entry.id !== state.activeVestPlayerId) return entry; 
        return { ...entry, ...movePointByHeading(entry, state.movement.headingDeg, fieldDistance) }; 
      });
    }
  }

  state.players = state.players.map((player) => {
    if (player.id !== playerId) return player;
    const updated = { ...player, online: true, lastSeen: now, telemetry: { ...player.telemetry, ...telemetryPayload }, samplesCaptured: player.samplesCaptured + 1 };
    handleTelemetryAlerts(evaluateTelemetry(updated.telemetry, updated.id));
    if (ecgSamples.length) drawLiveECG(ecgSamples); else if (telemetryPayload.ecg !== null && telemetryPayload.ecg !== undefined) drawLiveECG([telemetryPayload.ecg]);
    if (emgSamples.length) drawLiveEMG(emgSamples); else if (telemetryPayload.muscleFatigue !== null && telemetryPayload.muscleFatigue !== undefined) drawLiveEMG([telemetryPayload.muscleFatigue]);
    return updated;
  });

  updateCardDetailsModal();
  
  if (state.route.name === "player") {
    const activePlayer = state.players.find(p => p.id === state.activeVestPlayerId);
    if (activePlayer) {
      const chestMetrics = ["heartRate", "spo2", "bodyTemp", "ecg"];
      
      METRIC_CONFIG.forEach(metric => {
        const card = document.querySelector(`article[data-metric-key="${metric.key}"]`);
        if (card) {
          const valEl = card.querySelector('.metric-value');
          if (valEl && valEl.firstChild) valEl.firstChild.nodeValue = formatMetric(activePlayer.telemetry[metric.key], metric.key);
          
          const isChestMetric = chestMetrics.includes(metric.key);
          const sensorActive = state.ws.connected && (isChestMetric ? activePlayer.telemetry.chestOnline : activePlayer.telemetry.thighOnline);
          
          const statusText = card.querySelector('.text-\\[9px\\]');
          const statusDot = card.querySelector('span.w-2.h-2.rounded-full');
          if (statusText && statusDot) {
            statusText.textContent = sensorActive ? "ACTIVE" : "OFFLINE";
            statusText.className = `text-[9px] uppercase font-black tracking-wider ${sensorActive ? 'text-emerald-700' : 'text-red-700'}`;
            statusDot.className = `inline-block w-2 h-2 rounded-full mr-1 ${sensorActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`;
          }
          
          if (metric.key === "acceleration") {
            const stepsEl = document.getElementById("card-steps-val");
            const distEl = document.getElementById("card-dist-val");
            const actEl = document.getElementById("card-act-val");
            if (stepsEl) stepsEl.textContent = activePlayer.telemetry.steps || 0;
            if (distEl) distEl.textContent = (activePlayer.telemetry.distance || 0) + "m";
            if (actEl) {
              const act = activePlayer.telemetry.activity || "Still";
              actEl.textContent = act;
              actEl.className = `text-sm font-bold ${act === 'Running' ? 'text-orange-600' : (act === 'Walking' ? 'text-emerald-600' : 'text-slate-600')}`;
            }
          }
        }
      });
      
      const chestBatEl = document.getElementById("chest-battery-indicator");
      const chestBatTextEl = document.getElementById("chest-battery-text");
      if (chestBatEl && chestBatTextEl) {
        const cBat = activePlayer.telemetry.chestBattery;
        if (activePlayer.telemetry.chestOnline && cBat !== null && cBat !== undefined) {
          chestBatTextEl.textContent = `CHEST: ${Math.round(cBat)}%`;
          chestBatEl.className = `flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all duration-300 ${cBat <= 20 ? 'border-red-500 bg-red-100 text-red-700 shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse' : 'border-emerald-500 bg-emerald-100 text-emerald-700 shadow-[0_0_10px_rgba(16,185,129,0.3)]'}`;
        } else {
          chestBatTextEl.textContent = "CHEST: OFF";
          chestBatEl.className = "flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all duration-300 border-slate-400 bg-slate-200 text-slate-500";
        }
      }
      
      const thighBatEl = document.getElementById("thigh-battery-indicator");
      const thighBatTextEl = document.getElementById("thigh-battery-text");
      if (thighBatEl && thighBatTextEl) {
        const tBat = activePlayer.telemetry.thighBattery;
        if (activePlayer.telemetry.thighOnline && tBat !== null && tBat !== undefined) {
          thighBatTextEl.textContent = `THIGH: ${Math.round(tBat)}%`;
          thighBatEl.className = `flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all duration-300 ${tBat <= 20 ? 'border-red-500 bg-red-100 text-red-700 shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse' : 'border-blue-500 bg-blue-100 text-blue-700 shadow-[0_0_10px_rgba(59,130,246,0.3)]'}`;
        } else {
          thighBatTextEl.textContent = "THIGH: OFF";
          thighBatEl.className = "flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all duration-300 border-slate-400 bg-slate-200 text-slate-500";
        }
      }
    }
  } else {
    // أمر render هنا فقط لو إحنا برا شاشة اللاعب!
    render(); 
  }
}
function startRandomDrift() {
  setInterval(() => {
    if (!state.players.length || state.isFrozen) return;
    state.playerPositions = state.playerPositions.map((entry) => {
      if (entry.id === state.activeVestPlayerId) return entry;
      let vector = state.movement.randomVectors.get(entry.id);
      if (!vector || vector.stepsLeft <= 0) { const angle = Math.random() * Math.PI * 2; const speed = 0.25 + Math.random() * 0.75; vector = { dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, stepsLeft: 2 + Math.floor(Math.random() * 6) }; }
      let nx = entry.x + vector.dx; let ny = entry.y + vector.dy;
      if (nx < FIELD_X_MIN || nx > FIELD_X_MAX) { vector.dx *= -1; nx = clamp(entry.x + vector.dx, FIELD_X_MIN, FIELD_X_MAX); }
      if (ny < FIELD_Y_MIN || ny > FIELD_Y_MAX) { vector.dy *= -1; ny = clamp(entry.y + vector.dy, FIELD_Y_MIN, FIELD_Y_MAX); }
      vector.stepsLeft -= 1; state.movement.randomVectors.set(entry.id, vector); return { ...entry, x: nx, y: ny };
    });
    if (state.route.name === "team") render();
  }, RANDOM_DRIFT_INTERVAL_MS);
}

function startMatch() {
  if (state.matchState === "Active") return;
  const player = getSelectedPlayer(); if (!player) { pushToast("Select an active vest player.", "info"); return; }
  unfreezeDashboard(); if (!isSimulating) connectVestSocket();
  state.matchState = "Active"; state.matchStartedAt = Date.now(); state.matchEndedAt = null; playWhistle(START_MATCH_WHISTLE_SRC);
  setPlayerSummary(player.id, `${getPlayerSummary(player)}\nSession started at ${new Date().toLocaleTimeString()}.\n`); render();
}

function endMatch() {
  if (state.matchState !== "Active") return;
  if (isSimulating) stopSimulation(true);
  state.matchState = "Idle"; state.matchEndedAt = Date.now(); playWhistle(END_MATCH_WHISTLE_SRC); freezeDashboard();
  const player = getSelectedPlayer(); if (player) setPlayerSummary(player.id, `${getPlayerSummary(player)}\nSession ended at ${new Date().toLocaleTimeString()}.\n`); render();
}

function renderSidebars() {
  const container = document.createElement("div");

  // Roster Sidebar
  if (state.ui.showRoster) {
    const overlay = createElement("div", { className: "setup-overlay fixed inset-0 z-[100] bg-black/40 flex justify-start", on: { click: (e) => { if(e.target === overlay) { state.ui.showRoster = false; render(); } } } });
    const panel = createElement("div", { className: "w-[350px] bg-white h-full shadow-2xl flex flex-col overflow-hidden" });
    
    // Fixed header
    const headerDiv = createElement("div", { className: "flex-shrink-0 border-b border-slate-200 p-4" });
    headerDiv.appendChild(createElement("h2", { className: "text-xl font-bold text-slate-800", text: "Team Roster Settings" }));
    panel.appendChild(headerDiv);
    
    // Scrollable content
    const contentDiv = createElement("div", { className: "flex-1 overflow-y-auto p-4" });
    
    state.players.forEach((p, idx) => {
      const box = createElement("div", { className: "mb-4 p-3 bg-slate-50 border border-slate-200 rounded" });
      
      // Player Name - with label
      box.appendChild(createElement("label", { className: "block text-xs font-bold text-slate-700 mb-1", text: "Player Name" }));
      const nameInput = createElement("input", { className: "w-full mb-3 p-2 border rounded text-sm font-bold text-slate-900 bg-white", attrs: { value: p.name || "", placeholder: "Player Name", "data-player-idx": idx, "data-field": "name" } });
      nameInput.addEventListener("change", (e) => { p.name = e.target.value; });
      box.appendChild(nameInput);
      
      // Jersey Number - with label
      const row1 = createElement("div", { className: "grid grid-cols-2 gap-2 mb-3" });
      const jerseyCol = createElement("div");
      jerseyCol.appendChild(createElement("label", { className: "block text-xs font-bold text-slate-700 mb-1", text: "Jersey #" }));
      const jerseyInput = createElement("input", { className: "w-full p-2 border rounded text-xs text-center text-slate-900 bg-white font-semibold", attrs: { type: "number", value: p.jerseyNumber || "", min: "1", max: "99", "data-player-idx": idx, "data-field": "jerseyNumber" } });
      jerseyInput.addEventListener("change", (e) => { p.jerseyNumber = parseInt(e.target.value) || 0; });
      jerseyCol.appendChild(jerseyInput);
      row1.appendChild(jerseyCol);
      
      // Age - with label
      const ageCol = createElement("div");
      ageCol.appendChild(createElement("label", { className: "block text-xs font-bold text-slate-700 mb-1", text: "Age (years)" }));
      const ageInput = createElement("input", { className: "w-full p-2 border rounded text-xs text-center text-slate-900 bg-white font-semibold", attrs: { type: "number", value: p.age || "", min: "15", max: "50", "data-player-idx": idx, "data-field": "age" } });
      ageInput.addEventListener("change", (e) => { p.age = parseInt(e.target.value) || 0; });
      ageCol.appendChild(ageInput);
      row1.appendChild(ageCol);
      box.appendChild(row1);
      
      // Height and Weight - with labels
      const row2 = createElement("div", { className: "grid grid-cols-2 gap-2" });
      const heightCol = createElement("div");
      heightCol.appendChild(createElement("label", { className: "block text-xs font-bold text-slate-700 mb-1", text: "Height (cm)" }));
      const heightInput = createElement("input", { className: "w-full p-2 border rounded text-xs text-center text-slate-900 bg-white font-semibold", attrs: { type: "number", value: p.heightCm || "", min: "150", max: "220", "data-player-idx": idx, "data-field": "heightCm" } });
      heightInput.addEventListener("change", (e) => { p.heightCm = parseInt(e.target.value) || 0; });
      heightCol.appendChild(heightInput);
      row2.appendChild(heightCol);
      
      const weightCol = createElement("div");
      weightCol.appendChild(createElement("label", { className: "block text-xs font-bold text-slate-700 mb-1", text: "Weight (kg)" }));
      const weightInput = createElement("input", { className: "w-full p-2 border rounded text-xs text-center text-slate-900 bg-white font-semibold", attrs: { type: "number", value: p.weightKg || "", min: "40", max: "150", "data-player-idx": idx, "data-field": "weightKg" } });
      weightInput.addEventListener("change", (e) => { p.weightKg = parseInt(e.target.value) || 0; });
      weightCol.appendChild(weightInput);
      row2.appendChild(weightCol);
      box.appendChild(row2);
      
      contentDiv.appendChild(box);
    });

    panel.appendChild(contentDiv);
    
    // Fixed footer button
    const footerDiv = createElement("div", { className: "flex-shrink-0 border-t border-slate-200 p-4" });
    const saveBtn = createElement("button", { className: "w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition", text: "Save & Close", on: { click: () => { state.ui.showRoster = false; render(); } } });
    footerDiv.appendChild(saveBtn);
    panel.appendChild(footerDiv);
    
    overlay.appendChild(panel); container.appendChild(overlay);
  }

  // Alerts Log Sidebar
  if (state.ui.showAlerts) {
    const overlay = createElement("div", { className: "setup-overlay fixed inset-0 z-[100] bg-black/40 flex justify-end", on: { click: (e) => { if(e.target === overlay) { state.ui.showAlerts = false; render(); } } } });
    const panel = createElement("div", { className: "w-[400px] bg-gradient-to-b from-slate-900 to-slate-800 h-full shadow-2xl flex flex-col overflow-hidden border-l-4 border-blue-600" });
    
    // Fixed header
    const header = createElement("div", { className: "flex-shrink-0 flex justify-between items-center p-4 border-b border-slate-700" });
    header.appendChild(createElement("h2", { className: "text-xl font-bold text-white flex items-center gap-2", text: "🔔 Notification Log" }));
    header.appendChild(createElement("button", { className: "text-slate-400 hover:text-white text-2xl font-bold flex-shrink-0", text: "×", on: { click: () => { state.ui.showAlerts = false; render(); } } }));
    panel.appendChild(header);

    // Scrollable content
    const contentDiv = createElement("div", { className: "flex-1 overflow-y-auto p-4" });
    
    if(state.alertsLog.length === 0) {
      contentDiv.appendChild(createElement("p", { className: "text-slate-400 text-sm italic", text: "No alerts recorded." }));
    } else {
      // Add stats header
      const statsBox = createElement("div", { className: "mb-4 p-3 bg-blue-900/40 border border-blue-600/50 rounded text-blue-100 text-xs sticky top-0 z-10" });
      const criticalCount = state.alertsLog.filter(log => log.level === 'critical').length;
      const warningCount = state.alertsLog.filter(log => log.level === 'warning').length;
      statsBox.appendChild(createElement("p", { className: "font-bold mb-1", text: `📊 Total: ${state.alertsLog.length} | 🔴 Critical: ${criticalCount} | 🟠 Warning: ${warningCount}` }));
      contentDiv.appendChild(statsBox);
      
      state.alertsLog.forEach(log => {
        const alertBox = createElement("div", { className: `mb-3 p-3 rounded border-l-4 text-xs leading-4 transition` });
        
        // Color coding by level
        if (log.level === 'critical') {
          alertBox.className = "mb-3 p-3 rounded border-l-4 border-red-500 bg-red-950/60 text-red-100 text-xs leading-4 transition hover:bg-red-900/70";
        } else if (log.level === 'warning') {
          alertBox.className = "mb-3 p-3 rounded border-l-4 border-orange-500 bg-orange-950/50 text-orange-100 text-xs leading-4 transition hover:bg-orange-900/60";
        } else {
          alertBox.className = "mb-3 p-3 rounded border-l-4 border-blue-500 bg-blue-950/40 text-blue-100 text-xs leading-4 transition hover:bg-blue-900/50";
        }
        
        // Time - with accent color
        alertBox.appendChild(createElement("p", { className: "font-bold mb-1 opacity-75", text: `${log.time} • ${log.player}` }));
        
        // Message content
        alertBox.appendChild(createElement("p", { className: "font-semibold", text: log.msg }));
        
        contentDiv.appendChild(alertBox);
      });
    }
    
    panel.appendChild(contentDiv);
    overlay.appendChild(panel); container.appendChild(overlay);
  }

  // Floating Alerts Button
  const alertBtn = createElement("button", {
      className: "fixed bottom-5 right-5 z-[90] bg-white text-slate-800 px-4 py-3 rounded-full shadow-2xl border border-slate-300 font-bold hover:bg-slate-50 transition",
      text: `🔔 Alerts Log (${state.alertsLog.length})`,
      on: { click: () => { state.ui.showAlerts = true; render(); } }
  });
  if(state.alertsLog.length > 0) alertBtn.className = "fixed bottom-5 right-5 z-[90] bg-red-600 text-white px-4 py-3 rounded-full shadow-2xl border border-red-800 font-bold hover:bg-red-700 transition animate-pulse";
  container.appendChild(alertBtn);

  return container;
}

function renderTeamOverview() {
  const section = createElement("section", { className: "space-y-4" });

  const topRow = createElement("div", { className: "flex flex-wrap items-end justify-between gap-2" });
  const titleBlock = createElement("div");
  titleBlock.appendChild(createElement("h1", { className: "text-3xl font-bold tracking-tight text-slate-900", text: "Athlete Telemetry System" }));
  titleBlock.appendChild(createElement("p", { className: "mt-1 text-sm text-slate-700 font-medium", text: "Dashboard 0: 4-4-3 formation and live injury alerts" }));

  const controlsDiv = createElement("div", { className: "flex items-center gap-3" });
  const modePill = createElement("p", { className: "rounded-full border-2 border-slate-400 bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-800", text: "Single Active Vest Mode" });
  
  const rosterBtn = createElement("button", { className: "rounded-lg border-2 border-slate-500 bg-slate-700 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-slate-800 hover:border-slate-600 transition", text: "📋 Edit Roster", on: { click: () => { state.ui.showRoster = true; render(); } } });
  
  const viewAthleteBtn = createElement("button", { className: "rounded-full border-2 border-blue-600 bg-blue-600 px-4 py-2 text-xs font-bold tracking-widest text-white hover:bg-blue-700 hover:border-blue-700 shadow-md transition", text: "🔍 View Athlete Details →", on: { click: () => { const selected = getSelectedPlayer(); if (selected) { openPlayer(selected.id); } else { alert("Please select an athlete first"); } } } });

  controlsDiv.appendChild(modePill);
  controlsDiv.appendChild(rosterBtn);
  controlsDiv.appendChild(viewAthleteBtn);
  topRow.appendChild(titleBlock);
  topRow.appendChild(controlsDiv);
  section.appendChild(topRow);

  const board = createElement("div", { className: "field-board" });

  state.players.forEach((player, index) => {
    const pos = state.playerPositions.find((entry) => entry.id === player.id) || createInitialFormationPositions()[index];
    const isActive = player.id === state.activeVestPlayerId;

    const button = createElement("button", {
      className: `formation-player ${player.online ? "online" : "offline"} ${isActive ? "is-vest" : ""}`,
      style: { top: `${pos.y}%`, left: `${pos.x}%`, transition: "top 0.8s ease-out, left 0.8s ease-out" },
      attrs: { title: isActive ? "Active vest player" : "Click to select player" },
      on: { click: () => handlePlayerClick(player.id) },
    });

    button.appendChild(createElement("span", { className: "formation-player-jersey", text: `#${player.jerseyNumber}` }));
    button.appendChild(createElement("span", { className: "formation-player-name", text: player.name }));
    button.appendChild(createElement("span", { className: `status-pill ${(isSimulating && !isActive) ? "text-orange-400" : player.online ? "on" : "off"}`, text: (isSimulating && !isActive) ? "Simulated" : player.online ? "Online" : "Offline" }));
    board.appendChild(button);
  });

  section.appendChild(board);
  return section;
}

function renderDashboardHeader(player) {
  const header = createElement("header", { className: "mb-5 flex flex-wrap items-start justify-between gap-4" });

  const left = createElement("div");
  const backBtn = createElement("button", { className: "mb-2 rounded-full border-2 border-blue-600 bg-blue-600 px-3 py-1 text-xs font-semibold tracking-wide text-white hover:bg-blue-700 hover:border-blue-700 shadow-md transition", text: "← Back to Team Dashboard", on: { click: backToTeam } });
  left.appendChild(backBtn);
  left.appendChild(createElement("h1", { className: "text-3xl font-bold tracking-tight text-slate-900", text: "Athlete Telemetry System" }));
  left.appendChild(createElement("p", { className: "mt-1 text-sm text-slate-700 font-medium", text: `Dashboard 1: ${player.name} (Jersey #${player.jerseyNumber})` }));

  const connected = state.ws.connected && player.online;
  const simulatingForPlayer = isSimulating && player.id === state.activeVestPlayerId;
const right = createElement("div", { className: "flex flex-col items-end gap-2" });
  
  // 🟢 صف يجمع البطاريتين وحالة الاتصال
  const pillsRow = createElement("div", { className: "flex items-center gap-3" });
  
  // 🔋 1. بطارية الصدر (أخضر)
  const chestBatVal = player.telemetry?.chestBattery;
  const isChestLow = chestBatVal !== null && chestBatVal <= 20;
  const chestPill = createElement("div", { 
    className: `flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all ${isChestLow ? 'border-red-500 bg-red-100 text-red-700 animate-pulse' : 'border-emerald-500 bg-emerald-100 text-emerald-700'}`, 
    attrs: { id: "chest-battery-indicator" } 
  });
  chestPill.appendChild(createElement("span", { text: "🔋" }));
  chestPill.appendChild(createElement("span", { text: chestBatVal !== null && chestBatVal !== undefined ? `CHEST: ${Math.round(chestBatVal)}%` : "CHEST: --%", attrs: { id: "chest-battery-text" } }));
  pillsRow.appendChild(chestPill);

  // 🔋 2. بطارية الفخذ (أزرق)
  const thighBatVal = player.telemetry?.thighBattery;
  const isThighLow = thighBatVal !== null && thighBatVal <= 20;
  const thighPill = createElement("div", { 
    className: `flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-black shadow-lg transition-all ${isThighLow ? 'border-red-500 bg-red-100 text-red-700 animate-pulse' : 'border-blue-500 bg-blue-100 text-blue-700'}`, 
    attrs: { id: "thigh-battery-indicator" } 
  });
  thighPill.appendChild(createElement("span", { text: "🔋" }));
  thighPill.appendChild(createElement("span", { text: thighBatVal !== null && thighBatVal !== undefined ? `THIGH: ${Math.round(thighBatVal)}%` : "THIGH: --%", attrs: { id: "thigh-battery-text" } }));
  pillsRow.appendChild(thighPill);

  // 🌐 3. حالة الاتصال
  const pill = createElement("div", { className: `connection-pill ${connected || simulatingForPlayer ? "connected" : "disconnected"}` });
  pill.appendChild(createElement("span", { className: "status-dot" }));
  pill.appendChild(createElement("span", { text: simulatingForPlayer ? "Simulating Data" : connected ? "Connected" : "Disconnected" }));
  pillsRow.appendChild(pill);
  
  right.appendChild(pillsRow);

  if (dom.simulateButton) { refreshSimulationButton(); dom.simulateButton.classList.remove("hidden"); right.appendChild(dom.simulateButton); }
  header.appendChild(left); header.appendChild(right); return header;
}

function renderMatchControls() {
  const section = createElement("section", { className: "glass-panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3" });

  const selectedPlayer = getSelectedPlayer();
  const canStartMatch = state.matchState !== "Active" && selectedPlayer;

  const left = createElement("div", { className: "flex items-center gap-2" });
  left.appendChild(createElement("p", { className: "text-sm font-semibold uppercase tracking-widest text-slate-600", text: "Match State" }));
  left.appendChild(createElement("span", { className: `rounded-full px-3 py-1 text-sm font-bold ${state.matchState === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`, text: state.matchState }));

  const actions = createElement("div", { className: "flex gap-2" });
  const startBtn = createElement("button", { className: "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50", text: "Start Match", attrs: { disabled: canStartMatch ? null : "" }, on: { click: startMatch } });
  const endBtn = createElement("button", { className: "rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-50", text: "End Match", attrs: { disabled: state.matchState !== "Active" ? "" : null }, on: { click: endMatch } });

  actions.appendChild(startBtn); actions.appendChild(endBtn);
  section.appendChild(left); section.appendChild(actions); return section;
}

function renderTelemetryGrid(player) {
  const section = createElement("section", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" });

  const highlightedMetrics = state.physiological.metricHighlightsByPlayer.get(player.id) || new Set();
  const isLiveActive = state.ws.connected && player.id === state.activeVestPlayerId;

  METRIC_CONFIG.forEach((metric) => {
    const isCrit = highlightedMetrics.has(metric.key);
    const val = player.telemetry[metric.key];
    const sensorActive = isLiveActive && val !== null && val !== undefined;

    const card = createElement("article", {
      className: `metric-card p-5 cursor-pointer relative transition-transform duration-200 hover:scale-[1.03] hover:shadow-xl ${isCrit ? "metric-critical-hl" : ""} ${metric.isGraph && isLiveActive ? "ecg-live-active" : ""}`,
      style: metric.isGraph && isLiveActive ? {} : getMetricCardStyle(metric.key),
      attrs: { "data-metric-key": metric.key, "title": "Click for deeper analysis" },
      on: { click: () => { state.ui.activeModalMetricKey = metric.key; updateCardDetailsModal(); } }
    });

    const statusBadge = createElement("div", { className: "absolute top-4 right-4 flex items-center bg-white/80 backdrop-blur px-2 py-1 rounded border border-slate-200 z-10" });
    statusBadge.appendChild(createElement("span", { className: `inline-block w-2 h-2 rounded-full mr-1 ${sensorActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}` }));
    statusBadge.appendChild(createElement("span", { className: `text-[9px] uppercase font-black tracking-wider ${sensorActive ? 'text-emerald-700' : 'text-red-700'}`, text: sensorActive ? "ACTIVE" : "OFFLINE" }));
    card.appendChild(statusBadge);

    card.appendChild(createElement("p", { className: "metric-label text-xs font-bold uppercase tracking-[0.16em]", text: metric.label }));

    const valueRow = createElement("p", { className: "metric-value mt-4 text-4xl font-bold tracking-tight relative z-10", text: formatMetric(val, metric.key) });
    valueRow.appendChild(createElement("span", { className: "metric-unit ml-2 text-base font-semibold", text: metric.unit }));
    card.appendChild(valueRow);

    if (metric.key === "acceleration") {
      // 🟢 إضافة مصغرة للخطوات والمسافة وحالة الحركة
      const statsDiv = createElement("div", { className: "mt-4 grid grid-cols-3 gap-2 text-center bg-slate-100 p-2 rounded-lg relative z-10 border border-slate-200 shadow-inner" });
      
      statsDiv.appendChild(createElement("div", { html: `<span class="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Steps</span><strong id="card-steps-val" class="text-slate-800 text-sm font-bold">${player.telemetry.steps || 0}</strong>` }));
      statsDiv.appendChild(createElement("div", { html: `<span class="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">Dist.</span><strong id="card-dist-val" class="text-slate-800 text-sm font-bold">${player.telemetry.distance || 0}m</strong>` }));
      
      const act = player.telemetry.activity || "Still";
      const actColor = act === 'Running' ? 'text-orange-600' : (act === 'Walking' ? 'text-emerald-600' : 'text-slate-600');
      statsDiv.appendChild(createElement("div", { html: `<span class="block text-[10px] text-slate-500 uppercase tracking-widest mb-1">State</span><strong id="card-act-val" class="text-sm font-bold ${actColor}">${act}</strong>` }));
      
      card.appendChild(statsDiv);
    } 
    else if (metric.isGraph) {
      const graphShell = createElement("div", { className: `ecg-live-shell ${isLiveActive ? "active" : "inactive"}` });
      const graphCanvas = createElement("canvas", { className: "ecg-live-canvas", attrs: { "data-role": `${metric.key}-live-canvas` } });
      const graphPlaceholder = createElement("p", { className: "ecg-live-placeholder text-xs", text: isLiveActive ? `Streaming waveform...` : "Offline." });
      graphShell.appendChild(graphCanvas); graphShell.appendChild(graphPlaceholder); card.appendChild(graphShell);
    } 
    else {
      card.appendChild(createElement("p", { className: "mt-3 text-[11px] font-medium bg-slate-100 inline-block px-2 py-1 rounded relative z-10 text-slate-600", text: metric.limitText }));
    }

    section.appendChild(card);
  });

  return section;
}

function renderCardModal() {
  let overlay = document.getElementById("card-details-modal");
  if (!state.ui.activeModalMetricKey) { if (overlay) overlay.remove(); return null; }
  if (overlay) return null; 
  
  const m = METRIC_CONFIG.find(x => x.key === state.ui.activeModalMetricKey);
  overlay = createElement("div", {
      className: "fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4",
      attrs: { id: "card-details-modal" },
      on: { click: (e) => { if (e.target === overlay) { state.ui.activeModalMetricKey = null; render(); } } }
  });

  const panel = createElement("div", { className: "bg-white border border-slate-200 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative" });
  panel.appendChild(createElement("button", { className: "absolute top-3 right-4 text-slate-400 hover:text-slate-800 text-3xl font-bold", text: "×", on: { click: () => { state.ui.activeModalMetricKey = null; render(); } } }));
  panel.appendChild(createElement("h3", { className: "text-lg font-bold text-blue-600 mb-1 uppercase tracking-wider", text: m.label }));
  panel.appendChild(createElement("p", { className: "text-5xl font-black text-slate-800 mb-2 drop-shadow-sm", attrs: { id: "modal-live-value" } }));
  panel.appendChild(createElement("p", { className: "text-sm text-emerald-600 mb-4 font-bold bg-emerald-50 inline-block px-2 py-1 rounded", text: m.limitText }));
  panel.appendChild(createElement("p", { className: "text-xs text-slate-500 leading-relaxed", text: `Medical telemetry is actively monitoring this channel.` }));

  overlay.appendChild(panel); 
  return overlay;
}

function getBase64ImageFromURL(url) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = "anonymous";
    image.onload = () => { try { const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height; const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); resolve(canvas.toDataURL("image/png")); } catch (error) { reject(error); } };
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`)); image.src = url;
  });
}

function markdownInlineToPdfText(line) {
  const parts = []; const text = line || ""; const boldRegex = /\*\*(.*?)\*\*/g; let cursor = 0; let match;
  while ((match = boldRegex.exec(text)) !== null) { if (match.index > cursor) { parts.push({ text: text.slice(cursor, match.index) }); } parts.push({ text: match[1], bold: true }); cursor = match.index + match[0].length; }
  if (cursor < text.length) { parts.push({ text: text.slice(cursor) }); } return parts.length ? parts : [{ text: "" }];
}

function markdownToPdfmakeContent(markdown) {
  const source = String(markdown || "").replace(/\r\n/g, "\n"); const lines = source.split("\n"); const content = []; let bulletBuffer = [];
  const flushBullets = () => { if (!bulletBuffer.length) { return; } content.push({ ul: bulletBuffer.map((line) => ({ text: markdownInlineToPdfText(line), })), margin: [0, 2, 0, 6], }); bulletBuffer = []; };
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) { flushBullets(); content.push({ text: "", margin: [0, 2, 0, 2] }); return; }
    if (line.startsWith("### ")) { flushBullets(); content.push({ text: line.slice(4), bold: true, fontSize: 12, margin: [0, 8, 0, 4] }); return; }
    if (line.startsWith("## ")) { flushBullets(); content.push({ text: line.slice(3), bold: true, fontSize: 13, margin: [0, 10, 0, 5] }); return; }
    if (line.startsWith("# ")) { flushBullets(); content.push({ text: line.slice(2), bold: true, fontSize: 14, margin: [0, 12, 0, 6] }); return; }
    if (/^[-*]\s+/.test(line)) { bulletBuffer.push(line.replace(/^[-*]\s+/, "")); return; }
    if (/^\d+\.\s+/.test(line)) { flushBullets(); content.push({ text: markdownInlineToPdfText(line), margin: [0, 2, 0, 3], }); return; }
    flushBullets(); content.push({ text: markdownInlineToPdfText(line), margin: [0, 2, 0, 3], });
  });
  flushBullets(); return content.length ? content : [{ text: "-" }];
}

async function testAPIKey() {
  try {
    const response = await fetch(`${AI_PROXY_URL}/api/health`); const data = await response.json();
    if (!response.ok) { alert("Backend/API test failed\nStatus: " + response.status + "\nError: " + (data.error || "Unknown error")); return false; }
    alert("Backend/API test passed\n\n" + (data.message || "Backend is healthy.")); return true;
  } catch (error) { alert("Cannot reach backend API.\n\n" + error.message); return false; }
}

async function generateAISuggestions(player, summary) {
  const cacheKey = JSON.stringify({ telemetry: player.telemetry, summary });
  if (aiCache.has(cacheKey)) { return aiCache.get(cacheKey); }
  if (aiPendingRequests.has(cacheKey)) { return aiPendingRequests.get(cacheKey); }

  const payload = {
    player: {
      id: player.id, name: player.name, jerseyNumber: player.jerseyNumber, heightCm: player.heightCm, weightKg: player.weightKg, age: player.age, sessionDurationText: player.sessionDurationText, samplesCaptured: player.samplesCaptured,
      telemetry: {
        heartRate: player.telemetry?.heartRate ?? null, spo2: player.telemetry?.spo2 ?? null, bodyTemp: player.telemetry?.bodyTemp ?? null,
        acceleration: player.telemetry?.acceleration ?? null, speed: player.telemetry?.speed ?? null, gyroX: player.telemetry?.gyroX ?? null, gyroY: player.telemetry?.gyroY ?? null, gyroZ: player.telemetry?.gyroZ ?? null,
        muscleFatigue: "CLINICAL RULE: Evaluate using qualitative narrative only. DO NOT print any numerical values for EMG.",
        ecg: "CLINICAL RULE: Describe cardiac rhythm qualitatively. DO NOT print any numerical voltage values for ECG."
      },
    },
    summary: summary || "",
    prompt_instruction: `You are an elite sports physiologist and sports medicine expert providing a comprehensive clinical analysis. Your task is to:

1. ANALYZE CURRENT STATE: Assess the athlete's physiological status during this session based on critical alerts and telemetry data.

2. IDENTIFY RISKS: Highlight any concerning patterns or threshold violations that require immediate attention or coaching intervention.

3. RECOVERY RECOMMENDATIONS: Provide specific, actionable recovery strategies including hydration, rest intervals, and conditioning protocols.

4. PERFORMANCE INSIGHTS: Comment on endurance capacity, power output patterns, and readiness for continued activity.

5. INJURY PREVENTION: Flag any movement patterns or physiological markers that suggest injury risk or overtraining.

CRITICAL FORMATTING RULES:
- DO NOT include any numerical values for ECG or Muscle Fatigue (EMG) measurements
- ONLY use numbers for: Heart Rate (bpm), SpO2 (%), Body Temperature (°C), Acceleration (m/s²)
- Structure your response with clear headings: ## Current Status, ## Risk Assessment, ## Recovery Plan, ## Performance Notes, ## Safety Recommendations
- Use professional medical terminology appropriate for coaching staff and sports scientists
- Keep recommendations practical and implementable during training sessions`
  };

  const requestPromise = (async () => {
    // Check if AI_PROXY_URL is configured
    if (!AI_PROXY_URL || AI_PROXY_URL.trim() === "") {
      // Return professional fallback report
      const fallbackReport = `## Current Status
Athlete ${player.name} (Jersey #${player.jerseyNumber}) completed a ${player.sessionDurationText} session with ${player.samplesCaptured} telemetry samples captured.

## Telemetry Summary
- Heart Rate: ${player.telemetry?.heartRate ? Math.round(player.telemetry.heartRate) : "N/A"} bpm
- Blood Oxygen (SpO2): ${player.telemetry?.spo2 ? Math.round(player.telemetry.spo2) : "N/A"}%
- Body Temperature: ${player.telemetry?.bodyTemp ? Number(player.telemetry.bodyTemp).toFixed(1) : "N/A"}°C
- Physical Parameters: Height ${player.heightCm}cm, Weight ${player.weightKg}kg, Age ${player.age}

## Recovery Plan
- Monitor vital signs during cool-down phase
- Implement gradual passive recovery protocol
- Ensure adequate hydration and electrolyte replacement
- Schedule follow-up physiological assessment within 24 hours

## Safety Notes
AI analysis system is currently offline. This report is system-generated from available telemetry data. Consult with medical staff for comprehensive clinical assessment.`;
      
      aiCache.set(cacheKey, fallbackReport);
      return fallbackReport;
    }

    let response;
    try { 
      response = await fetch(`${AI_PROXY_URL}/api/analyze-report`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(payload),
        timeout: 15000
      }); 
    } catch (error) { 
      console.error("AI API Error:", error.message);
      throw new Error("AI analysis unavailable - backend connection failed."); 
    }
    
    let data = {}; 
    try { data = await response.json(); } catch (error) { 
      console.error("AI response parse error:", error);
      data = {}; 
    }
    
    if (response.status === 429) { 
      const quotaError = new Error("Please wait a few seconds before exporting again."); 
      quotaError.code = "RATE_LIMITED"; 
      throw quotaError; 
    }
    
    if (!response.ok) { 
      throw new Error(data.error || `Backend error: ${response.status}`); 
    }
    
    const suggestions = data.suggestions || "Analysis completed but no suggestions returned."; 
    aiCache.set(cacheKey, suggestions); 
    return suggestions;
  })();

  aiPendingRequests.set(cacheKey, requestPromise);
  try { return await requestPromise; } finally { aiPendingRequests.delete(cacheKey); }
}

async function saveMatchReportToDB(playerProfile, telemetrySummary, aiSuggestions) {
  if (!supabaseClient) { return; }
  try {
    const maxHeartRateSource = telemetrySummary?.maxHeartRate ?? telemetrySummary?.max_heart_rate ?? playerProfile?.telemetry?.heartRate ?? null;
    const parsedAge = Number(playerProfile?.age); const parsedMaxHeartRate = Number(maxHeartRateSource);
    const fallbackCriticalAlerts = getCriticalMessages(playerProfile?.name || "Unknown Player", playerProfile?.telemetry || {});
    const criticalAlertsTriggered = telemetrySummary?.criticalAlertsTriggered ?? telemetrySummary?.critical_alerts_triggered ?? fallbackCriticalAlerts;
    const row = { player_name: String(playerProfile?.name || "Unknown Player"), age: Number.isFinite(parsedAge) ? Math.round(parsedAge) : null, max_heart_rate: Number.isFinite(parsedMaxHeartRate) ? Math.round(parsedMaxHeartRate) : null, critical_alerts_triggered: criticalAlertsTriggered, raw_ai_summary: String(aiSuggestions || ""), };
    const { error } = await supabaseClient.from("match_reports").insert([row]);
    if (error) { throw error; }
  } catch (error) { console.error("Failed to save match report to DB:", error); }
}

async function exportMatchPdf(player, summary, button, originalText) {
  if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") { window.alert("pdfmake library failed to load."); return; }
  try {
    const exportTimestamp = new Date().toLocaleString();
    let suggestions;
    try { 
      suggestions = await generateAISuggestions(player, summary); 
    } catch (error) { 
      if (error?.code === "RATE_LIMITED") { 
        window.alert("Please wait a few seconds before exporting again."); 
        return; 
      }
      console.error("AI generation error:", error);
      // Show more helpful error message
      const errorMsg = error.message || "AI analysis failed";
      window.alert(`⚠️ Report Note:\n\n${errorMsg}\n\nA system-generated report will be created instead with available telemetry data.`);
      suggestions = null; // Will trigger fallback
    }

    const telemetryRows = [ { label: "Heart Rate", key: "heartRate", unit: "bpm" }, { label: "SpO2", key: "spo2", unit: "%" }, { label: "Body Temp", key: "bodyTemp", unit: "degC" }, { label: "Muscle Fatigue (EMG)", key: "muscleFatigue", unit: "Hz", hideValue: true }, { label: "Acceleration", key: "acceleration", unit: "m/s2" }, { label: "ECG", key: "ecg", unit: "mV", hideValue: true }, ];
    
    // Calculate averages and statuses
    const avgData = calculateSessionAverages(player);
    
    // Build telemetry table with status information
    const telemetryTableBody = [ [ { text: "Metric", bold: true, fillColor: "#e2e8f0" }, { text: "Value (Unit)", bold: true, fillColor: "#e2e8f0" }, { text: "Status", bold: true, fillColor: "#e2e8f0" }, ], 
      ...telemetryRows.map((metric) => {
        const value = player.telemetry?.[metric.key];
        let display = "--";
        let status = "--";
        
        // Hide numerical values for ECG and EMG - show only status
        if (metric.hideValue) {
          display = "--"; // Don't show numerical value
        } else {
          const formattedValue = value === null || value === undefined ? "--" : formatMetric(value, metric.key);
          display = formattedValue === "--" ? "--" : `${formattedValue} ${metric.unit}`;
        }
        
        if (metric.key === "heartRate" && avgData?.heartRate) {
          status = avgData.heartRate.status;
        } else if (metric.key === "spo2" && avgData?.spo2) {
          status = avgData.spo2.status;
        } else if (metric.key === "bodyTemp" && avgData?.bodyTemp) {
          status = avgData.bodyTemp.status;
        } else if (metric.key === "acceleration" && avgData?.acceleration) {
          status = avgData.acceleration.status;
        } else if (metric.key === "ecg" && avgData?.ecg) {
          status = `${avgData.ecg.status} - See notes below`;
        } else if (metric.key === "muscleFatigue" && avgData?.muscleFatigue) {
          status = "See EMG analysis below";
        }
        
        return [metric.label, String(display), status]; 
      }),
    ];
    const theme = { ink: "#08112a", sky: "#0f3e7b", critical: "#cf2f2f", muted: "#6b7280", softPanel: "#f3f4f6", rowAlt: "#f8fafc", border: "#d1d5db" };
    const samplesCaptured = Number(player.samplesCaptured || 0);

    const profileSessionGrid = [
      [ { text: "Name", style: "fieldLabel" }, { text: String(player.name || "-"), style: "fieldValue" }, { text: "Jersey", style: "fieldLabel" }, { text: `#${String(player.jerseyNumber || "-")}`, style: "fieldValue" }, ],
      [ { text: "Age", style: "fieldLabel" }, { text: String(player.age || "-"), style: "fieldValue" }, { text: "Height", style: "fieldLabel" }, { text: `${String(player.heightCm || "-")} cm`, style: "fieldValue" }, ],
      [ { text: "Weight", style: "fieldLabel" }, { text: `${String(player.weightKg || "-")} kg`, style: "fieldValue" }, { text: "Duration", style: "fieldLabel" }, { text: String(player.sessionDurationText || "00:00"), style: "fieldValue", }, ],
      [ { text: "Samples Captured", style: "fieldLabel" }, { text: String(samplesCaptured), style: "fieldValue" }, { text: "", style: "fieldLabel" }, { text: "", style: "fieldValue" }, ],
    ];

    const profilePanelLayout = { hLineWidth: function () { return 0; }, vLineWidth: function () { return 0; }, paddingLeft: function () { return 6; }, paddingRight: function () { return 6; }, paddingTop: function () { return 6; }, paddingBottom: function () { return 6; }, fillColor: function () { return theme.softPanel; }, };
    const telemetryTableLayout = { hLineWidth: function () { return 1; }, vLineWidth: function () { return 1; }, hLineColor: function () { return theme.border; }, vLineColor: function () { return theme.border; }, paddingLeft: function () { return 8; }, paddingRight: function () { return 8; }, paddingTop: function () { return 6; }, paddingBottom: function () { return 6; }, fillColor: function (rowIndex) { if (rowIndex === 0) { return null; } return rowIndex % 2 === 0 ? theme.rowAlt : null; }, };

    const docDefinition = {
      pageSize: "A4", pageMargins: [32, 42, 32, 38], defaultStyle: { fontSize: 11, color: theme.ink, },
      content: [
        { columns: [ { width: "*", text: "Elite Athlete Telemetry Report", style: "reportTitle", }, { width: "auto", text: `Exported: ${exportTimestamp}`, style: "exportStamp", alignment: "right", }, ], margin: [0, 0, 0, 12], },
        { table: { widths: [90, "*", 90, "*"], body: profileSessionGrid, }, layout: profilePanelLayout, margin: [0, 0, 0, 14], },
        { text: "Telemetry Snapshot & Session Averages", style: "sectionHeader", },
        { table: { headerRows: 1, widths: ["*", 70, 100], body: telemetryTableBody, }, layout: telemetryTableLayout, margin: [0, 0, 0, 8], },
        
        // Add averages section
        ...(avgData ? [
          { text: "Session Averages", style: "sectionHeader", margin: [0, 12, 0, 6] },
          { 
            columns: [
              {
                width: "50%",
                stack: [
                  { text: `❤️ Heart Rate: ${avgData.heartRate?.avg || "N/A"} bpm`, style: "fieldLabel", margin: [0, 2, 0, 2] },
                  { text: `Status: ${avgData.heartRate?.status || "Unknown"}`, style: "fieldValue", margin: [0, 0, 0, 4] },
                  { text: `🫁 Blood Oxygen: ${avgData.spo2?.avg || "N/A"}%`, style: "fieldLabel", margin: [0, 2, 0, 2] },
                  { text: `Status: ${avgData.spo2?.status || "Unknown"}`, style: "fieldValue", margin: [0, 0, 0, 4] },
                  { text: `🌡️ Body Temperature: ${avgData.bodyTemp?.avg || "N/A"}°C`, style: "fieldLabel", margin: [0, 2, 0, 2] },
                  { text: `Status: ${avgData.bodyTemp?.status || "Unknown"}`, style: "fieldValue", margin: [0, 0, 0, 4] },
                ]
              },
              {
                width: "50%",
                stack: [
                  { text: `⚡ Acceleration: ${avgData.acceleration?.avg || "N/A"} m/s²`, style: "fieldLabel", margin: [0, 2, 0, 2] },
                  { text: `Status: ${avgData.acceleration?.status || "Unknown"}`, style: "fieldValue", margin: [0, 0, 0, 4] },
                  { text: `📍 ECG: ${avgData.ecg?.status || "No data"}`, style: "fieldLabel", margin: [0, 2, 0, 2] },
                  { text: avgData.ecg?.description || "No ECG data available.", style: "fieldValue", margin: [0, 0, 0, 4], fontSize: 9 },
                ]
              }
            ],
            margin: [0, 0, 0, 12]
          }
        ] : []),
        
        // Add detailed ECG and EMG analysis section
        ...(avgData ? [
          { text: "Cardiac & Muscular Analysis", style: "sectionHeader", margin: [0, 12, 0, 6] },
          { 
            stack: [
              { text: "📍 ECG (Electrocardiogram) Analysis", style: "fieldLabel", margin: [0, 0, 0, 4] },
              { text: avgData.ecg?.description || "No ECG data available.", style: "fieldValue", margin: [0, 0, 0, 8], fontSize: 9 },
              { text: "💪 EMG (Electromyography) - Muscle Activity", style: "fieldLabel", margin: [0, 0, 0, 4] },
              { text: getMuscleActivityDescription(player.telemetry?.muscleFatigue), style: "fieldValue", margin: [0, 0, 0, 4], fontSize: 9 },
            ]
          }
        ] : []),
        
        ...(samplesCaptured === 0 ? [ { text: "SYSTEM NOTE: Zero samples captured. Verify hardware connection.", style: "criticalNote", margin: [0, 0, 0, 12], }, ] : []),
        { text: "AI Clinical Synthesis & Recovery Plan", style: "sectionHeader", margin: [0, 10, 0, 6], },
        ...markdownToPdfmakeContent( suggestions || "No AI suggestions returned.", ),
      ],
      styles: { reportTitle: { fontSize: 16, bold: true, color: theme.sky, }, exportStamp: { fontSize: 10, italics: true, color: theme.muted, }, sectionHeader: { fontSize: 14, bold: true, color: theme.sky, margin: [0, 6, 0, 6], }, fieldLabel: { fontSize: 10, bold: true, color: theme.sky, }, fieldValue: { fontSize: 11, color: theme.ink, }, criticalNote: { fontSize: 11, bold: true, color: theme.critical, }, },
    };

    const telemetrySummaryPayload = { maxHeartRate: player.telemetry?.heartRate ?? null, criticalAlertsTriggered: [], coachSummary: summary || "", };
    await saveMatchReportToDB(player, telemetrySummaryPayload, suggestions);
    window.pdfMake.createPdf(docDefinition).download("Match_Report.pdf");
  } catch (error) { console.error("Failed to generate match report PDF:", error); window.alert("Report export failed. Please try again."); } finally { if (button) { button.disabled = false; button.textContent = originalText || "Export to PDF"; } }
}

function renderMatchReport(player) {
  const panel = createElement("section", { className: "glass-panel mt-5 space-y-3 p-4", });
  const top = createElement("div", { className: "flex flex-wrap items-center justify-between gap-2", });
  top.appendChild(createElement("h2", { className: "text-lg font-bold text-slate-900", text: "Match Report", }));

  const summaryText = getPlayerSummary(player);
  const sessionDurationText = getSessionDurationText();
  const canExportReport = !!summaryText.trim() && !state.exportLock;

  const exportButton = createElement("button", {
    className: "rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-45",
    text: state.exportLock ? "Generating AI Report..." : "Export to PDF",
    attrs: { type: "button", disabled: canExportReport ? null : "", "data-action": "export-report", "data-player-id": String(player.id), },
  });

  top.appendChild(exportButton); panel.appendChild(top);
  panel.appendChild(createElement("p", { className: "text-sm text-slate-600", text: `Athlete Profile: ${player.name} | Jersey: #${player.jerseyNumber} | Height: ${player.heightCm || "-"} cm | Weight: ${player.weightKg || "-"} kg | Age: ${player.age || "-"} | Session Duration: ${sessionDurationText} | Samples Captured: ${player.samplesCaptured} | Match State: ${state.matchState}`, }));

  const criticalHistory = state.physiological.notificationHistoryByPlayer.get(player.id) || [];
  const criticalHistoryText = criticalHistory.length ? criticalHistory.join("\n") : "No Tier 3 critical history yet.";

  panel.appendChild(createElement("p", { className: "text-sm font-semibold text-slate-700", text: "Tier 3 Critical History", }));
  panel.appendChild(createElement("textarea", { className: "w-full min-h-[8.5rem] rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs leading-5 text-slate-700", text: criticalHistoryText, attrs: { readonly: "", "aria-label": "Tier 3 critical history", }, }));

  return panel;
}

function renderPlayerDetail(player) {
  const section = createElement("section");
  section.appendChild(renderDashboardHeader(player));
  section.appendChild(renderMatchControls());
  section.appendChild(renderTelemetryGrid(player));
  section.appendChild(renderMatchReport(player));
  return section;
}

function render() {
  if (!dom.root) { return; }
  dom.root.innerHTML = "";

  const main = createElement("main", { className: `app-root min-h-screen p-4 md:p-8 ${state.route.name === "player" ? "player-view" : ""}`, });
  const wrapper = createElement("div", { className: "mx-auto max-w-7xl" });

  if (state.route.name === "team") {
    wrapper.appendChild(renderTeamOverview());
  } else {
    const selectedPlayer = getSelectedPlayer();
    if (selectedPlayer) { wrapper.appendChild(renderPlayerDetail(selectedPlayer)); }
  }

  main.appendChild(wrapper);

  // الكارت التفاعلي المنبثق
  const cardModal = renderCardModal();
  if (cardModal) document.body.appendChild(cardModal);

  // شريط الإشعارات الجانبي وإعدادات اللاعبين
  const sidebars = renderSidebars();
  if (sidebars) main.appendChild(sidebars);

  dom.root.appendChild(main);

  const shouldShowGraphs = state.route.name === "player" && state.ws.connected && state.activeVestPlayerId === state.route.id;
  bindCanvasesFromDOM();
  setECGVisibility(shouldShowGraphs);
  setEMGVisibility(shouldShowGraphs);
}

function handleHashChange() { state.route = parseHashRoute(); render(); }

function setActiveVestOffline() {
  if (!state.activeVestPlayerId) { return; }
  state.players = state.players.map((player) => { if (player.id !== state.activeVestPlayerId) { return player; } return { ...player, online: false, }; });
}

function startConnectionGuard() {
  setInterval(() => {
    if (!state.activeVestPlayerId || state.isFrozen) { return; }
    const activePlayer = state.players.find( (p) => p.id === state.activeVestPlayerId, );
    if (!activePlayer) { return; }
    const stale = !activePlayer.lastSeen || Date.now() - activePlayer.lastSeen > 4000;
    if (stale && activePlayer.online) { setActiveVestOffline(); render(); }
  }, 1200);
}

function startClockRefresh() { 
  setInterval(() => { 
    if ( state.route.name === "player" && state.matchState === "Active" && state.matchStartedAt && !state.isFrozen ) { 
      // تحديث النافذة المنبثقة فقط بدلاً من مسح واجهة الداشبورد بالكامل
      updateCardDetailsModal(); 
    } 
  }, 1000); 
}
function handleDocumentClick(event) {
  if (!event.isTrusted) { return; }
  const button = event.target.closest('[data-action="export-report"]');
  if (!button) { return; }
  if (state.exportLock) { return; }
  const playerId = Number(button.getAttribute("data-player-id"));
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) { return; }
  
  state.exportLock = true;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Generating AI Report...";

  const playerWithDuration = { ...player, sessionDurationText: getSessionDurationText(), };
  const summaryText = getPlayerSummary(player);

  exportMatchPdf(playerWithDuration, summaryText, button, originalText).finally( () => { state.exportLock = false; }, );
}

function init() {
  ensureToastLayer();
  if (dom.simulateButton) { dom.simulateButton.addEventListener("click", toggleSimulation); }
  if (!window.location.hash) { window.location.hash = "#/"; }
  state.route = parseHashRoute();
  window.addEventListener("hashchange", handleHashChange);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("beforeunload", () => { stopSimulation(false); disconnectVestSocket(); state.toasts.forEach((toast, id) => { removeToast(id); }); });

  startRandomDrift(); startConnectionGuard(); startClockRefresh(); render();
}

init();
