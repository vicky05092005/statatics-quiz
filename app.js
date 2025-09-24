// app.js - main behavior (modular imports for Firebase)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// ----------------- YOUR FIREBASE CONFIG -----------------
const firebaseConfig = {
  apiKey: "AIzaSyCjz2tUwuit8amZeyb2B6YBE4qZkiy-xTA",
  authDomain: "quiz-app-572e8.firebaseapp.com",
  projectId: "quiz-app-572e8",
  storageBucket: "quiz-app-572e8.firebasestorage.app",
  messagingSenderId: "295740833345",
  appId: "1:295740833345:web:2cc7639dac6c313e9890c0",
  measurementId: "G-E1Z33LQBWY"
};

let firestoreDB = null;
let firebaseEnabled = false;
try {
  const app = initializeApp(firebaseConfig);
  firestoreDB = getFirestore(app);
  firebaseEnabled = true;
  console.log("Firestore initialized");
} catch (e) {
  console.warn("Firebase init failed", e);
  firebaseEnabled = false;
}

// ----------------- state & local fallback -----------------
let allQuestions = []; // local editable
let selectedQuestions = [];
let resultsCache = []; // local results cache
const LOCAL_Q_KEY = "quiz_questions_v1";
const LOCAL_R_KEY = "quiz_results_v1";

// admin-controlled settings stored in settings/config
const SETTINGS_DOC = { collection: "settings", id: "config" };
let questionCount = 10;       // default fallback
let durationMinutes = 30;     // default fallback (minutes)

// helper: load/save local
function loadQuestionsLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_Q_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) { allQuestions = parsed; return true; }
  } catch (e) { console.warn(e); }
  return false;
}
function saveQuestionsLocal() {
  try { localStorage.setItem(LOCAL_Q_KEY, JSON.stringify(allQuestions)); } catch (e) { console.warn(e); }
}
function loadResultsLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_R_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) { resultsCache = parsed; return true; }
  } catch (e) { console.warn(e); }
  return false;
}
function saveResultsLocal() {
  try { localStorage.setItem(LOCAL_R_KEY, JSON.stringify(resultsCache)); } catch (e) { console.warn(e); }
}

// ----------------- Math render helper -----------------
async function renderMathIn(el) {
  try { if (window.MathJax && MathJax.typesetPromise) await MathJax.typesetPromise([el]); }
  catch (e) { console.warn("MathJax:", e); }
}

// ----------------- Firestore helpers -----------------
async function loadQuestionsFromFirestore() {
  if (!firebaseEnabled) return false;
  try {
    const col = collection(firestoreDB, "questions");
    const snap = await getDocs(col);
    const arr = [];
    snap.forEach(d => {
      const data = d.data();
      if (data && data.question && Array.isArray(data.options) && data.answer) {
        arr.push({ question: data.question, options: data.options, answer: data.answer, _id: d.id });
      }
    });
    if (arr.length) { allQuestions = arr.map(a => ({ question: a.question, options: a.options, answer: a.answer, _id: a._id })); saveQuestionsLocal(); return true; }
    return false;
  } catch (e) { console.error(e); return false; }
}

async function pushAllToFirestore() {
  if (!firebaseEnabled) { alert("Firebase not available"); return; }
  try {
    const colRef = collection(firestoreDB, "questions");
    const existing = await getDocs(colRef);
    for (const d of existing.docs) {
      await deleteDoc(doc(firestoreDB, "questions", d.id));
    }
    for (const q of allQuestions) {
      await addDoc(colRef, { question: q.question, options: q.options, answer: q.answer });
    }
    alert("Pushed questions to Firestore");
    await loadQuestionsFromFirestore();
    renderAdminList();
  } catch (e) { console.error(e); alert("Push failed"); }
}

// settings: combined loader/saver
async function loadSettingsFromFirestore() {
  if (!firebaseEnabled) return false;
  try {
    const dref = doc(firestoreDB, SETTINGS_DOC.collection, SETTINGS_DOC.id);
    const snap = await getDoc(dref);
    if (snap && snap.exists()) {
      const data = snap.data();
      if (data) {
        questionCount = Number(data.questionCount) || questionCount;
        durationMinutes = Number(data.durationMinutes) || durationMinutes;
      }
    }
    updateSettingsDisplay();
    return true;
  } catch (e) { console.warn("load settings failed", e); return false; }
}

async function saveSettingsToFirestore(qCount, durMins) {
  if (!firebaseEnabled) { alert("Firebase not available"); return; }
  try {
    const dref = doc(firestoreDB, SETTINGS_DOC.collection, SETTINGS_DOC.id);
    await setDoc(dref, { questionCount: Number(qCount), durationMinutes: Number(durMins) }, { merge: true });
    // update local vars & UI
    questionCount = Number(qCount);
    durationMinutes = Number(durMins);
    updateSettingsDisplay();
    // confirm
    // small toast alternative: alert for now
    alert("Settings saved");
  } catch (e) { console.error("save settings failed", e); alert("Failed to save settings"); }
}

// real-time results listener
function watchResultsRealtime() {
  if (!firebaseEnabled) return;
  try {
    const col = collection(firestoreDB, "results");
    onSnapshot(col, snap => {
      const arr = [];
      snap.forEach(d => {
        const dt = d.data();
        arr.push({ ...dt, _id: d.id, timestamp: dt.timestamp ? (dt.timestamp.toDate ? dt.timestamp.toDate() : new Date(dt.timestamp)) : new Date() });
      });
      resultsCache = arr;
      autoArrangeResults();
      renderResultsTable();
      saveResultsLocal();
    });
  } catch (e) { console.warn(e); }
}

// save result
async function saveResultToFirestore(resultObj) {
  if (!firebaseEnabled) { resultsCache.push(resultObj); saveResultsLocal(); return; }
  try {
    await addDoc(collection(firestoreDB, "results"), { name: resultObj.name, roll: resultObj.roll, score: resultObj.score, total: resultObj.total, timestamp: serverTimestamp() });
  } catch (e) {
    console.error(e);
    resultsCache.push(resultObj);
    saveResultsLocal();
  }
}

// clear results (Firestore)
async function clearAllResults() {
  if (!confirm("Clear all saved results? This cannot be undone.")) return;
  if (!firebaseEnabled) {
    resultsCache = []; saveResultsLocal(); renderResultsTable();
    return;
  }
  try {
    const snap = await getDocs(collection(firestoreDB, "results"));
    for (const d of snap.docs) {
      await deleteDoc(doc(firestoreDB, "results", d.id));
    }
    resultsCache = []; saveResultsLocal(); renderResultsTable();
    alert("Cleared results");
  } catch (e) { console.error(e); alert("Failed to clear"); }
}

// ----------------- Quiz logic -----------------
let timer; let timeLeft = 0;
let currentQuestionIndex = 0; let score = 0;
let studentInfo = { name: "", roll: "" };
let isAdmin = false;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
  return array;
}
function selectRandomQuestions() {
  const shuffled = shuffleArray([...allQuestions]);
  const count = Math.min(questionCount, shuffled.length);
  return shuffled.slice(0, count).map(q => ({ ...q, options: shuffleArray([...q.options]) }));
}
function startTimer() {
  // Assumes timeLeft (seconds) is already set before calling
  clearInterval(timer);
  document.getElementById("timer").textContent = formatTime(timeLeft);
  timer = setInterval(() => {
    timeLeft--;
    document.getElementById("timer").textContent = formatTime(timeLeft);
    if (timeLeft <= 0) { clearInterval(timer); endQuiz(); }
  }, 1000);
}
function formatTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function endQuiz() {
  clearInterval(timer);
  document.getElementById("next-btn").disabled = true;
  document.querySelectorAll(".option").forEach(o => o.classList.add("disabled"));
  showResult();
}
function loadQuestion() {
  const q = selectedQuestions[currentQuestionIndex];
  const qEl = document.getElementById("question");
  qEl.innerHTML = q.question;
  const opts = document.getElementById("options");
  opts.innerHTML = "";
  q.options.forEach(opt => {
    const btn = document.createElement("div");
    btn.className = "option";
    btn.innerHTML = opt;
    btn.onclick = () => checkAnswer(opt, btn, q.answer);
    opts.appendChild(btn);
  });
  document.getElementById("question-count").innerText = `${currentQuestionIndex+1} of ${selectedQuestions.length} Questions`;
  renderMathIn(qEl); renderMathIn(opts);
}
function checkAnswer(selectedOpt, btn, correct) {
  document.querySelectorAll(".option").forEach(o => o.classList.add("disabled"));
  if (selectedOpt === correct) { btn.classList.add("correct"); score++; }
  else { btn.classList.add("wrong"); document.querySelectorAll(".option").forEach(o => { if ((o.innerText || o.textContent).trim() === correct.trim()) o.classList.add("correct"); }); }
  document.getElementById("score").textContent = score;
  document.getElementById("next-btn").disabled = false;
}
function startConfetti() {
  try { confetti({ particleCount: 120, spread: 70, origin: { y: 0.2 } }); } catch (e) { console.warn("confetti", e); }
}
function animateText(el, text, delay = 30) {
  el.textContent = ""; let i = 0;
  const iv = setInterval(() => { if (i < text.length) { el.textContent += text[i++]; } else clearInterval(iv); }, delay);
}
async function showResult() {
  document.getElementById("quiz-container").style.display = "none";
  const rs = document.getElementById("result-screen"); rs.style.display = "flex";
  const total = selectedQuestions.length;
  const correct = score; const wrong = total - score;
  document.getElementById("correct-count").textContent = correct;
  document.getElementById("wrong-count").textContent = wrong;
  const pct = Math.round((correct / total) * 100);
  document.getElementById("percentage-bar").style.width = "0%";
  setTimeout(()=> document.getElementById("percentage-bar").style.width = `${pct}%`, 200);
  const msg = `You scored ${correct} out of ${total}!\n\nStudent: ${studentInfo.name}\nRoll No: ${studentInfo.roll}\n\n🎉 Congratulations!`;
  animateText(document.getElementById("result-message"), msg, 25);
  startConfetti();
  // save result
  const resultObj = { name: studentInfo.name, roll: studentInfo.roll, score: correct, total: total, timestamp: new Date() };
  await saveResultToFirestore(resultObj);
}

// ----------------- Admin UI & interactions -----------------
const adminPanelEl = document.getElementById("admin-panel");
function openAdminPanel() {
  adminPanelEl.style.display = "flex"; adminPanelEl.setAttribute("aria-hidden","false");
  renderAdminList();
  // results listener
  if (firebaseEnabled) watchResultsRealtime();
  else { loadResultsLocal(); autoArrangeResults(); renderResultsTable(); }
}
document.getElementById("admin-close").addEventListener("click", ()=> { adminPanelEl.style.display="none"; adminPanelEl.setAttribute("aria-hidden","true"); document.getElementById("welcome-overlay").style.display="flex"; });

// tabs
document.querySelectorAll(".admin-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach(x => x.classList.remove("active")); t.classList.add("active");
    const tab = t.dataset.tab;
    document.getElementById("admin-questions").style.display = tab==="questions" ? "flex" : "none";
    document.getElementById("admin-results").style.display = tab==="results" ? "block" : "none";
    if (tab==="results") { if (firebaseEnabled) { /* realtime will update UI */ } else { loadResultsLocal(); autoArrangeResults(); renderResultsTable(); } }
  });
});

// add question
document.getElementById("add-question-btn").addEventListener("click", async () => {
  const q = document.getElementById("new-question").value.trim();
  const o0 = document.getElementById("new-opt-0").value.trim();
  const o1 = document.getElementById("new-opt-1").value.trim();
  const o2 = document.getElementById("new-opt-2").value.trim();
  const o3 = document.getElementById("new-opt-3").value.trim();
  const ansIdx = document.getElementById("new-answer").value;
  if (!q || !o0 || !o1 || !o2 || !o3 || ansIdx === "") { alert("Fill all fields and pick correct answer"); return; }
  const options = [o0,o1,o2,o3];
  const obj = { question: q, options, answer: options[Number(ansIdx)] };
  allQuestions.push(obj); saveQuestionsLocal(); renderAdminList();
  if (firebaseEnabled) {
    const ok = await (async ()=>{ try { await addDoc(collection(firestoreDB,"questions"), obj); return true; } catch(e){console.warn(e); return false;} })();
    if (ok) { alert("Added to Firestore"); await loadQuestionsFromFirestore(); renderAdminList(); }
    else alert("Added locally (failed to add to Firestore)");
  } else alert("Added locally");
  // clear inputs
  document.getElementById("new-question").value=""; document.getElementById("new-opt-0").value=""; document.getElementById("new-opt-1").value=""; document.getElementById("new-opt-2").value=""; document.getElementById("new-opt-3").value=""; document.getElementById("new-answer").value="";
  document.getElementById("preview-question").innerHTML="";
});

// preview new question live
["new-question","new-opt-0","new-opt-1","new-opt-2","new-opt-3"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("input", ()=> {
    const q = document.getElementById("new-question").value || "";
    const a0 = document.getElementById("new-opt-0").value || "";
    const a1 = document.getElementById("new-opt-1").value || "";
    const a2 = document.getElementById("new-opt-2").value || "";
    const a3 = document.getElementById("new-opt-3").value || "";
    const html = `<div style="font-weight:600;">${escapeHtml(q)}</div><div style="margin-top:6px">A. ${escapeHtml(a0)}</div><div>B. ${escapeHtml(a1)}</div><div>C. ${escapeHtml(a2)}</div><div>D. ${escapeHtml(a3)}</div>`;
    document.getElementById("preview-question").innerHTML = html; renderMathIn(document.getElementById("preview-question"));
  });
});

// render admin list
function renderAdminList(){
  const list = document.getElementById("admin-list"); list.innerHTML = "";
  allQuestions.forEach((q, idx) => {
    const card = document.createElement("div"); card.className="question-card";
    card.innerHTML = `
      <div class="row"><div style="font-weight:600;">Q${idx+1}</div><input class="admin-input admin-qtext" data-idx="${idx}" value="${escapeHtml(q.question)}" /></div>
      <div class="row"><input class="admin-input admin-opt" data-idx="${idx}" data-opt="0" value="${escapeHtml(q.options[0]||'')}" /><input class="admin-input admin-opt" data-idx="${idx}" data-opt="1" value="${escapeHtml(q.options[1]||'')}" /></div>
      <div class="row"><input class="admin-input admin-opt" data-idx="${idx}" data-opt="2" value="${escapeHtml(q.options[2]||'')}" /><input class="admin-input admin-opt" data-idx="${idx}" data-opt="3" value="${escapeHtml(q.options[3]||'')}" /></div>
      <div class="row">
        <select class="admin-input admin-answer" data-idx="${idx}">
          <option value="">Select correct</option>
          <option value="0">${escapeHtml(q.options[0]||'')}</option>
          <option value="1">${escapeHtml(q.options[1]||'')}</option>
          <option value="2">${escapeHtml(q.options[2]||'')}</option>
          <option value="3">${escapeHtml(q.options[3]||'')}</option>
        </select>
        <div style="flex:1"></div>
        <button class="btn btn-save" data-idx="${idx}">Save</button>
        <button class="btn" data-del="${idx}" style="background:#ffb6c1;color:#1c2526;">Delete</button>
      </div>
      <div class="small-muted">Preview:</div>
      <div class="preview-area" style="padding:8px;background:rgba(0,0,0,0.02);border-radius:8px;"></div>
    `;
    list.appendChild(card);
    const sel = card.querySelector(".admin-answer");
    const answerIndex = q.options.findIndex(o=> o === q.answer);
    if (answerIndex >=0) sel.value = String(answerIndex);
    const previewArea = card.querySelector(".preview-area");
    previewArea.innerHTML = `<div style="font-weight:600;">${escapeHtml(q.question)}</div><div>A. ${escapeHtml(q.options[0]||'')}</div><div>B. ${escapeHtml(q.options[1]||'')}</div><div>C. ${escapeHtml(q.options[2]||'')}</div><div>D. ${escapeHtml(q.options[3]||'')}</div>`;
    renderMathIn(previewArea);
  });

  // events wiring (delegated)
  list.querySelectorAll('.admin-qtext').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(e.target.dataset.idx);
      allQuestions[idx].question = e.target.value;
      saveQuestionsLocal();
      const card = e.target.closest('.question-card');
      const preview = card.querySelector('.preview-area');
      const opts = Array.from(card.querySelectorAll('.admin-opt')).map(i=>i.value);
      preview.innerHTML = `<div style="font-weight:600;">${escapeHtml(allQuestions[idx].question)}</div><div>A. ${escapeHtml(opts[0]||'')}</div><div>B. ${escapeHtml(opts[1]||'')}</div><div>C. ${escapeHtml(opts[2]||'')}</div><div>D. ${escapeHtml(opts[3]||'')}</div>`;
      renderMathIn(preview);
    });
  });
  list.querySelectorAll('.admin-opt').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(e.target.dataset.idx), o = Number(e.target.dataset.opt);
      allQuestions[idx].options[o] = e.target.value;
      saveQuestionsLocal();
      const card = e.target.closest('.question-card');
      const preview = card.querySelector('.preview-area');
      preview.innerHTML = `<div style="font-weight:600;">${escapeHtml(allQuestions[idx].question)}</div><div>A. ${escapeHtml(allQuestions[idx].options[0]||'')}</div><div>B. ${escapeHtml(allQuestions[idx].options[1]||'')}</div><div>C. ${escapeHtml(allQuestions[idx].options[2]||'')}</div><div>D. ${escapeHtml(allQuestions[idx].options[3]||'')}</div>`;
      renderMathIn(preview);
    });
  });
  list.querySelectorAll('.admin-answer').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = Number(e.target.dataset.idx), chosen = Number(e.target.value);
      if (!isNaN(chosen)) { allQuestions[idx].answer = allQuestions[idx].options[chosen] || ''; saveQuestionsLocal(); }
    });
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = Number(e.target.getAttribute('data-del'));
      if (confirm("Delete this question?")) { allQuestions.splice(idx,1); saveQuestionsLocal(); renderAdminList(); }
    });
  });
  list.querySelectorAll('.btn-save').forEach(btn => {
    btn.addEventListener('click', async e => {
      if (!firebaseEnabled) { alert("Saved locally"); return; }
      await pushAllToFirestore(); await loadQuestionsFromFirestore(); renderAdminList();
    });
  });
}

// push all
document.getElementById("admin-push-firebase").addEventListener("click", async ()=> { await pushAllToFirestore(); });

// clear local
document.getElementById("admin-clear-local").addEventListener("click", ()=> { if (confirm("Clear local questions?")) { localStorage.removeItem(LOCAL_Q_KEY); location.reload(); } });

// ---------- Settings (questionCount + duration) UI wiring ----------
const qSelect = document.getElementById("question-count-select");
const qCustom = document.getElementById("question-count-custom");
const durSelect = document.getElementById("duration-select");
const durCustom = document.getElementById("duration-custom");

qSelect.addEventListener("change", ()=> {
  if (qSelect.value === "custom") qCustom.style.display = "inline-block";
  else { qCustom.style.display = "none"; const qc = Number(qSelect.value); const dm = durationMinutes || 30; saveSettingsToFirestore(qc, dm); }
});
qCustom.addEventListener("change", ()=> {
  const v = Number(qCustom.value);
  if (Number.isFinite(v) && v > 0 && v <= 100) {
    saveSettingsToFirestore(v, durationMinutes || 30);
  } else alert("Enter valid custom (1-100)");
});

durSelect.addEventListener("change", ()=> {
  if (durSelect.value === "custom") durCustom.style.display = "inline-block";
  else { durCustom.style.display = "none"; const dm = Number(durSelect.value); const qc = questionCount || 10; saveSettingsToFirestore(qc, dm); }
});
durCustom.addEventListener("change", ()=> {
  const v = Number(durCustom.value);
  if (Number.isFinite(v) && v > 0 && v <= 240) {
    saveSettingsToFirestore(questionCount || 10, v);
  } else alert("Enter valid custom minutes (1-240)");
});

function updateSettingsDisplay() {
  document.getElementById("student-questions-count").textContent = `Admin set: ${questionCount} questions`;
  document.getElementById("student-quiz-duration").textContent = `Admin set: ${durationMinutes} minutes`;
  // reflect into question select & duration select when admin opens
  const sel = document.getElementById("question-count-select");
  const qcust = document.getElementById("question-count-custom");
  if (sel) {
    if ([10,15,20,25].includes(Number(questionCount))) { sel.value = String(questionCount); qcust.style.display = "none"; }
    else { sel.value = "custom"; qcust.style.display = "inline-block"; qcust.value = String(questionCount); }
  }
  const dsel = document.getElementById("duration-select");
  const dcust = document.getElementById("duration-custom");
  if (dsel) {
    if ([10,15,20,25,30,45,60].includes(Number(durationMinutes))) { dsel.value = String(durationMinutes); dcust.style.display = "none"; }
    else { dsel.value = "custom"; dcust.style.display = "inline-block"; dcust.value = String(durationMinutes); }
  }
  // also update top placeholder for total questions
  const totalPlaceholder = document.getElementById("total-placeholder");
  if (totalPlaceholder) totalPlaceholder.textContent = questionCount;
}

// ----------------- Results table + arrange + CSV -----------------
function parseRollNumber(roll) {
  if (!roll) return {prefix:'', num:0, original:''};
  const s = String(roll).trim();
  const m = s.match(/(\d+)(?!.*\d)/);
  const num = m ? parseInt(m[0],10) : 0;
  const prefix = s.replace(/(\d+)(?!.*\d)/,"").toLowerCase();
  return { prefix, num, original: s };
}
function autoArrangeResults() {
  resultsCache.sort((a,b)=> {
    const ra = parseRollNumber(a.roll||""), rb = parseRollNumber(b.roll||"");
    if (ra.prefix < rb.prefix) return -1; if (ra.prefix > rb.prefix) return 1;
    return (ra.num||0) - (rb.num||0);
  });
}
function renderResultsTable(filter="") {
  const tbody = document.querySelector("#results-table tbody"); tbody.innerHTML = "";
  const q = (filter||"").toLowerCase().trim();
  let shownIndex = 0;
  resultsCache.forEach((r, idx) => {
    if (q && !String(r.roll||"").toLowerCase().includes(q) && !String(r.name||"").toLowerCase().includes(q)) return;
    shownIndex++;
    const tr = document.createElement("tr");
    const dateStr = r.timestamp ? (new Date(r.timestamp)).toLocaleString() : "";
    tr.innerHTML = `<td>${shownIndex}</td><td>${escapeHtml(r.roll||"")}</td><td>${escapeHtml(r.name||"")}</td><td>${r.score||0}/${r.total||0}</td><td>${escapeHtml(dateStr)}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("results-search").addEventListener("input", e => renderResultsTable(e.target.value));
document.getElementById("btn-arrange").addEventListener("click", ()=> { autoArrangeResults(); renderResultsTable(document.getElementById("results-search").value); });
document.getElementById("btn-clear-results").addEventListener("click", async ()=> { await clearAllResults(); });
document.getElementById("btn-export-csv").addEventListener("click", ()=> {
  if (!resultsCache.length) { alert("No results to export"); return; }
  const rows = [["Roll","Name","Score","Total","Timestamp"]];
  resultsCache.forEach(r => rows.push([r.roll||"", r.name||"", r.score||"", r.total||"", r.timestamp ? new Date(r.timestamp).toISOString() : ""]));
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `quiz_results_${(new Date()).toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
});

// ----------------- Welcome, login & start quiz -----------------
document.getElementById("student-btn").addEventListener("click", ()=> { document.getElementById("student-form").style.display="block"; document.getElementById("admin-login").style.display="none"; });
document.getElementById("admin-btn").addEventListener("click", ()=> { document.getElementById("admin-login").style.display="block"; document.getElementById("student-form").style.display="none"; });
document.getElementById("student-cancel").addEventListener("click", ()=> { document.getElementById("student-form").style.display="none"; });
document.getElementById("admin-cancel").addEventListener("click", ()=> { document.getElementById("admin-login").style.display="none"; });

document.getElementById("start-quiz-btn").addEventListener("click", ()=> {
  const name = document.getElementById("student-name").value.trim();
  const roll = document.getElementById("student-roll").value.trim();
  if (!name || !roll) { alert("Please enter name and roll number."); return; }
  studentInfo = { name, roll };
  // fetch settings then start
  (async ()=> {
    if (firebaseEnabled) await loadSettingsFromFirestore();
    else updateSettingsDisplay();
    if (!allQuestions.length) {
      const hasLocal = loadQuestionsLocal();
      if (!hasLocal && firebaseEnabled) await loadQuestionsFromFirestore();
    }
    selectedQuestions = selectRandomQuestions();
    if (selectedQuestions.length < questionCount) {
      alert(`Warning: Admin requested ${questionCount} questions but only ${selectedQuestions.length} available. Quiz will start with ${selectedQuestions.length} questions.`);
    }
    score = 0; currentQuestionIndex = 0;
    document.getElementById("score").textContent = "0";
    document.getElementById("welcome-overlay").style.display = "none";
    document.getElementById("quiz-container").style.display = "block";
    document.getElementById("next-btn").disabled = true;
    document.getElementById("total-placeholder").textContent = selectedQuestions.length;
    // set timer seconds using durationMinutes
    timeLeft = (Number(durationMinutes) || 30) * 60;
    document.getElementById("timer").textContent = formatTime(timeLeft);
    loadQuestion(); startTimer();
  })();
});

document.getElementById("admin-login-btn").addEventListener("click", ()=> {
  const id = document.getElementById("admin-id").value.trim();
  const pass = document.getElementById("admin-pass").value;
  if (id === "Vicky" && pass === "Vicky2005") || (id==="MA002" && pass==="Kgm#29") {
    isAdmin = true;
    document.getElementById("welcome-overlay").style.display = "none";
    openAdminPanel();
  } else alert("Invalid admin credentials");
});

// next/restart
document.getElementById("next-btn").addEventListener("click", ()=> {
  currentQuestionIndex++;
  if (currentQuestionIndex < selectedQuestions.length) { loadQuestion(); document.getElementById("next-btn").disabled = true; }
  else endQuiz();
});
document.getElementById("restart-btn").addEventListener("click", ()=> {
  if (isAdmin) resetQuiz();
  else { document.getElementById("welcome-overlay").style.display="flex"; document.getElementById("quiz-container").style.display="none"; document.getElementById("result-screen").style.display="none"; }
});
document.getElementById("go-home").addEventListener("click", ()=> { document.getElementById("result-screen").style.display="none"; document.getElementById("welcome-overlay").style.display="flex"; });

// restart helper
function resetQuiz() {
  clearInterval(timer);
  timeLeft = (Number(durationMinutes) || 30) * 60;
  currentQuestionIndex = 0; score = 0;
  document.getElementById("score").textContent = "0";
  document.getElementById("timer").textContent = formatTime(timeLeft);
  document.getElementById("result-screen").style.display = "none";
  document.getElementById("quiz-container").style.display = "block";
  selectedQuestions = selectRandomQuestions();
  document.getElementById("total-placeholder").textContent = selectedQuestions.length;
  loadQuestion(); startTimer();
}

// ----------------- init flow -----------------
window.onload = async () => {
  const hasLocal = loadQuestionsLocal();
  loadResultsLocal();
  if (firebaseEnabled) {
    await loadSettingsFromFirestore();
    const loaded = await loadQuestionsFromFirestore();
    if (!loaded && !hasLocal) { allQuestions = []; }
    watchResultsRealtime();
  } else {
    if (!hasLocal) allQuestions = [];
    updateSettingsDisplay();
    autoArrangeResults();
    renderResultsTable();
  }
  // render admin UI list
  renderAdminList();
  // reflect initial select values if any
  updateSettingsDisplay();
};

// ----------------- helpers -----------------
function escapeHtml(str){ if (!str) return ""; return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }

