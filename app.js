import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID } from "./firebase-config.js";

const WIB_FORMAT_DATE = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "2-digit",
  month: "short",
  year: "numeric"
});
const WIB_FORMAT_TIME = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit"
});

const PACKAGE_DEFAULTS = {
  BASIC: {
    label: "Basic",
    maxPerWeek: 1,
    canReschedule: false,
    angles: ["DEPAN"],
    measurements: ["PERUT"],
    hasBodyComp: false,
    hasMealPlan: false
  },
  STANDARD: {
    label: "Standard",
    maxPerWeek: 3,
    canReschedule: true,
    angles: ["DEPAN"],
    measurements: ["PERUT", "LEHER", "LENGAN"],
    hasBodyComp: false,
    hasMealPlan: true
  },
  PREMIUM: {
    label: "Premium",
    maxPerWeek: 6,
    canReschedule: true,
    angles: ["DEPAN", "BELAKANG", "SAMPING_KANAN", "SAMPING_KIRI"],
    measurements: ["PERUT", "LEHER", "LENGAN"],
    hasBodyComp: true,
    hasMealPlan: true
  }
};

const ANGLE_LABELS = {
  DEPAN: "Depan",
  BELAKANG: "Belakang",
  SAMPING_KANAN: "Samping Kanan",
  SAMPING_KIRI: "Samping Kiri"
};

const state = {
  auth: null,
  db: null,
  clientDoc: null,
  packageRule: null,
  sessions: [],
  rescheduleRequests: [],
  measurements: [],
  bodyCompositions: [],
  photos: [],
  workouts: [],
  workoutRequests: [],
  mealPlanNotes: [],
  photoFilter: "ALL",
  selectedCalendarMonth: new Date(),
  selectedCalendarDayKey: toWibDayKey(Date.now()),
  timerTarget: 60,
  timerRemaining: 60,
  timerInterval: null,
  unsubscribers: []
};

const el = (id) => document.getElementById(id);

function showLoading(text = "Memproses data…") {
  el("global-loading-text").textContent = text;
  el("global-loading").classList.remove("hidden");
}

function hideLoading() {
  el("global-loading").classList.add("hidden");
}

function showToast(message, type = "info") {
  const region = el("top-toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `top-toast ${type === "success" ? "toast-success" : type === "error" ? "toast-error" : ""}`;
  toast.setAttribute("role", "status");

  const span = document.createElement("span");
  span.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "top-toast-close";
  closeBtn.setAttribute("aria-label", "Tutup notifikasi");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => toast.remove());

  toast.appendChild(span);
  toast.appendChild(closeBtn);
  region.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4500);
}

function setAuthMessage(msg, isError = false) {
  const box = el("auth-message");
  box.textContent = msg;
  box.style.color = isError ? "#c62828" : "#053824";
  box.classList.remove("hidden");
}

function toWibDayKey(millis) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(millis));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatWibDate(millis) {
  return WIB_FORMAT_DATE.format(new Date(millis));
}

function formatWibTime(millis) {
  return `${WIB_FORMAT_TIME.format(new Date(millis))} WIB`;
}

function clearSubscriptions() {
  state.unsubscribers.forEach((u) => {
    try { u(); } catch (_) {}
  });
  state.unsubscribers = [];
}

function initTabs() {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-auth-tab");
      el("form-login").classList.toggle("hidden", target !== "login");
      el("form-register").classList.toggle("hidden", target !== "register");
      el("form-reset").classList.toggle("hidden", target !== "reset");
      el("auth-message").classList.add("hidden");
    });
  });

  document.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const menu = btn.getAttribute("data-menu");
      switchMenu(menu);
    });
  });
}

function switchMenu(menu) {
  const titles = {
    profile: "Data Diri",
    schedule: "Jadwal",
    progress: "Progress Statistik",
    photos: "Foto Progres",
    workout: "Gerakan Olahraga"
  };
  el("mobile-header-title").textContent = titles[menu] || "Portal Klien";

  document.querySelectorAll("[data-menu]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-menu") === menu);
  });
  document.querySelectorAll(".menu-section").forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== `section-${menu}`);
  });
}

function getFacility() {
  const tier = state.clientDoc?.packageTier || "BASIC";
  const base = PACKAGE_DEFAULTS[tier] || PACKAGE_DEFAULTS.BASIC;
  const r = state.packageRule;
  if (!r || r.tier !== tier) return base;
  const angles = typeof r.photoAnglesCsv === "string" && r.photoAnglesCsv.trim()
    ? r.photoAnglesCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : base.angles;
  const measurements = typeof r.measurementFieldsCsv === "string" && r.measurementFieldsCsv.trim()
    ? r.measurementFieldsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : base.measurements;
  return {
    label: base.label,
    maxPerWeek: typeof r.maxSessionsPerWeek === "number" ? r.maxSessionsPerWeek : base.maxPerWeek,
    canReschedule: typeof r.canReschedule === "boolean" ? r.canReschedule : base.canReschedule,
    angles,
    measurements,
    hasBodyComp: typeof r.hasBodyComposition === "boolean" ? r.hasBodyComposition : base.hasBodyComp,
    hasMealPlan: typeof r.hasMealPlan === "boolean" ? r.hasMealPlan : base.hasMealPlan
  };
}

function renderAll() {
  renderProfileSection();
  renderScheduleSection();
  renderProgressSection();
  renderPhotosSection();
  renderWorkoutSection();
}

function renderProfileSection() {
  const container = el("section-profile");
  const c = state.clientDoc;
  if (!c) {
    container.innerHTML = `<div class="card">Data profil klien belum ditemukan untuk akun email ini. Hubungi Coach Iyan.</div>`;
    return;
  }
  const fac = getFacility();
  const attendedCount = state.sessions.filter((s) => s.status === "HADIR").length;
  const quota = c.totalSessionsQuota || 4;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <h2 style="margin:0;">${escapeHtml(c.fullName)}</h2>
          <p class="muted" style="margin:2px 0 0;">${escapeHtml(c.emailNormalized)}</p>
        </div>
        <span class="badge badge-${c.packageTier}">${fac.label.toUpperCase()}</span>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;" />
      <div class="grid-cards">
        <div><strong>Status</strong><div class="muted">${escapeHtml(c.status || "AKTIF")}</div></div>
        <div><strong>Periode Coaching</strong><div class="muted">${formatWibDate(c.startDateMillis)} — ${formatWibDate(c.endDateMillis)}</div></div>
        <div><strong>Pertemuan Terpakai</strong><div class="muted">${attendedCount} / ${quota} sesi</div></div>
        <div><strong>Tujuan</strong><div class="muted">${escapeHtml(c.goal || "-")}</div></div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Ringkasan Fasilitas Paket ${fac.label}</h3>
      <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:0.9rem;">
        <li>Kapasitas pertemuan: maksimal ${fac.maxPerWeek}x per minggu</li>
        <li>Reschedule jadwal: ${fac.canReschedule ? "Aktif (dapat mengajukan via tab Jadwal)" : "Terkunci untuk paket Basic"}</li>
        <li>Foto progres: ${fac.angles.map((a) => ANGLE_LABELS[a]).join(", ")}</li>
        <li>Pengukuran lingkar: ${fac.measurements.join(", ")}</li>
        <li>Komposisi tubuh: ${fac.hasBodyComp ? "Aktif (Body Fat %, Massa Otot, Umur Tubuh)" : "Tidak termasuk"}</li>
        <li>Meal plan: ${fac.hasMealPlan ? "Tersedia update dari coach" : "Tidak termasuk"}</li>
      </ul>
    </div>
    ${fac.hasMealPlan ? `
      <div class="card">
        <h3 style="margin-top:0;">Catatan Meal Plan Terbaru</h3>
        ${state.mealPlanNotes.length === 0
          ? `<p class="muted">Belum ada catatan Meal Plan dari coach.</p>`
          : state.mealPlanNotes.slice(0, 5).map((m) => `
            <div style="border-top:1px solid var(--border);padding:8px 0;">
              <strong>${escapeHtml(m.title)}</strong>
              <div class="muted" style="white-space:pre-line;">${escapeHtml(m.note)}</div>
            </div>
          `).join("")}
      </div>
    ` : ""}
  `;
}

function renderScheduleSection() {
  const container = el("section-schedule");
  const fac = getFacility();
  const monthDate = state.selectedCalendarMonth;
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(monthDate);

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const sessionDaySet = new Set(state.sessions.map((s) => toWibDayKey(s.startAtMillis)));

  let calHtml = "";
  for (let i = 0; i < startOffset; i++) calHtml += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const has = sessionDaySet.has(key) ? "has-session" : "";
    const sel = state.selectedCalendarDayKey === key ? "selected" : "";
    calHtml += `<button type="button" class="cal-day ${has} ${sel}" data-cal-day="${key}">${d}</button>`;
  }

  const daySessions = state.sessions
    .filter((s) => toWibDayKey(s.startAtMillis) === state.selectedCalendarDayKey)
    .sort((a, b) => a.startAtMillis - b.startAtMillis);

  const listToShow = daySessions.length > 0
    ? daySessions
    : state.sessions.slice().sort((a, b) => a.startAtMillis - b.startAtMillis);

  const reqHtml = state.rescheduleRequests.length === 0
    ? `<p class="muted">Belum ada permintaan reschedule.</p>`
    : state.rescheduleRequests.map((r) => `
      <div style="border-top:1px solid var(--border);padding:8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${formatWibDate(r.requestedStartMillis)} • ${formatWibTime(r.requestedStartMillis)}</strong>
          <span class="badge badge-${r.status}">${r.status}</span>
        </div>
        <div class="muted">Alasan: ${escapeHtml(r.reason)}</div>
        ${r.coachNote ? `<div class="muted">Catatan Coach: ${escapeHtml(r.coachNote)}</div>` : ""}
      </div>
    `).join("");

  container.innerHTML = `
    <div class="card">
      <div class="calendar-head">
        <button type="button" id="cal-prev" class="btn btn-outline btn-sm">&larr;</button>
        <strong>${monthLabel} (WIB)</strong>
        <button type="button" id="cal-next" class="btn btn-outline btn-sm">&rarr;</button>
      </div>
      <div class="calendar-grid" style="margin-bottom:6px;font-size:0.75rem;color:var(--muted);">
        <div>Sen</div><div>Sel</div><div>Rab</div><div>Kam</div><div>Jum</div><div>Sab</div><div>Min</div>
      </div>
      <div class="calendar-grid">${calHtml}</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Daftar Sesi ${daySessions.length > 0 ? state.selectedCalendarDayKey : "(Semua Jadwal)"}</h3>
      ${!fac.canReschedule ? `<div class="alert alert-warn">Paket Basic tidak memiliki fasilitas Reschedule.</div>` : ""}
      ${listToShow.length === 0 ? `<p class="muted">Belum ada sesi terjadwal dari coach.</p>` : listToShow.map((s) => `
        <div class="list-item-row">
          <div>
            <strong>${escapeHtml(s.title || "Sesi Latihan")}</strong>
            <div class="muted">${formatWibDate(s.startAtMillis)} • ${formatWibTime(s.startAtMillis)} - ${formatWibTime(s.endAtMillis)}</div>
            <div class="muted">Lokasi: ${escapeHtml(s.location || "IHC Studio")}</div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-${s.status}">${s.status}</span>
            ${fac.canReschedule && s.status === "TERJADWAL"
              ? `<button type="button" class="btn btn-outline btn-sm" data-req-reschedule="${s.id}">Minta Reschedule</button>`
              : ""}
          </div>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Status Permintaan Reschedule</h3>
      ${reqHtml}
    </div>
  `;

  el("cal-prev")?.addEventListener("click", () => {
    state.selectedCalendarMonth = new Date(year, month - 1, 1);
    renderScheduleSection();
  });
  el("cal-next")?.addEventListener("click", () => {
    state.selectedCalendarMonth = new Date(year, month + 1, 1);
    renderScheduleSection();
  });
  container.querySelectorAll("[data-cal-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedCalendarDayKey = btn.getAttribute("data-cal-day");
      renderScheduleSection();
    });
  });
  container.querySelectorAll("[data-req-reschedule]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sid = btn.getAttribute("data-req-reschedule");
      const session = state.sessions.find((x) => x.id === sid);
      if (session) openRescheduleModal(session);
    });
  });
}

function buildTrendSvg(label, unit, values) {
  if (!values || values.length === 0) {
    return `<div class="card"><strong>${label}</strong><p class="muted">Belum ada data.</p></div>`;
  }
  const latest = values[values.length - 1];
  const delta = values.length >= 2 ? latest - values[0] : 0;
  const deltaStr = values.length >= 2 ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ${unit})` : "";

  let svg = `<p class="muted">Tambah minimal 2 pengukuran untuk grafik tren.</p>`;
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min > 0.01 ? max - min : 1;
    const pts = values.map((v, i) => {
      const x = 12 + (i / (values.length - 1)) * 276;
      const y = 76 - ((v - min) / range) * 60;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    svg = `
      <svg viewBox="0 0 300 90" style="width:100%;height:96px;display:block;">
        <polyline fill="none" stroke="#0e8a5d" stroke-width="3" stroke-linecap="round" points="${pts}" />
      </svg>
    `;
  }
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;">
        <strong>${label}</strong>
        <span style="color:var(--emerald);font-weight:700;">${latest.toFixed(1)} ${unit}${deltaStr}</span>
      </div>
      ${svg}
    </div>
  `;
}

function renderProgressSection() {
  const container = el("section-progress");
  const fac = getFacility();
  const sortedM = state.measurements.slice().sort((a, b) => a.recordedAt - b.recordedAt);
  const sortedB = state.bodyCompositions.slice().sort((a, b) => a.recordedAt - b.recordedAt);

  let html = `<div class="grid-cards">`;
  html += buildTrendSvg("Lingkar Perut", "cm", sortedM.map((m) => m.waistCm).filter((v) => typeof v === "number"));
  if (fac.measurements.includes("LEHER")) {
    html += buildTrendSvg("Lingkar Leher", "cm", sortedM.map((m) => m.neckCm).filter((v) => typeof v === "number"));
  }
  if (fac.measurements.includes("LENGAN")) {
    html += buildTrendSvg("Lingkar Lengan", "cm", sortedM.map((m) => m.armCm).filter((v) => typeof v === "number"));
  }
  if (fac.hasBodyComp) {
    html += buildTrendSvg("Body Fat %", "%", sortedB.map((b) => b.bodyFatPercent).filter((v) => typeof v === "number"));
    html += buildTrendSvg("Massa Otot", "kg", sortedB.map((b) => b.muscleMassKg).filter((v) => typeof v === "number"));
    html += buildTrendSvg("Umur Tubuh", "thn", sortedB.map((b) => b.bodyAgeYears).filter((v) => typeof v === "number"));
  }
  html += `</div>`;
  container.innerHTML = html;
}

function renderPhotosSection() {
  const container = el("section-photos");
  const fac = getFacility();
  const allowed = fac.angles;
  const photos = state.photos
    .filter((p) => allowed.includes(p.angle) && (state.photoFilter === "ALL" || p.angle === state.photoFilter))
    .sort((a, b) => b.takenAt - a.takenAt);

  const chips = [
    `<button type="button" class="chip ${state.photoFilter === "ALL" ? "active" : ""}" data-photo-filter="ALL">Semua Sudut</button>`,
    ...allowed.map((ang) => `<button type="button" class="chip ${state.photoFilter === ang ? "active" : ""}" data-photo-filter="${ang}">${ANGLE_LABELS[ang]}</button>`)
  ].join("");

  const grid = photos.length === 0
    ? `<div class="card"><p class="muted">Belum ada foto progres pada filter ini.</p></div>`
    : `<div class="photo-grid">${photos.map((p) => {
        const src = p.previewBase64 ? `data:image/jpeg;base64,${p.previewBase64}` : (p.previewUrl || "");
        return `
          <div class="photo-tile" data-zoom-photo="${p.id}">
            <img src="${src}" alt="Foto ${ANGLE_LABELS[p.angle] || p.angle}" />
            <div class="meta">
              <strong>${ANGLE_LABELS[p.angle] || p.angle}</strong>
              <div class="muted">${formatWibDate(p.takenAt)}</div>
            </div>
          </div>
        `;
      }).join("")}</div>`;

  container.innerHTML = `
    <div class="card">
      <div class="chip-row">${chips}</div>
    </div>
    ${grid}
  `;

  container.querySelectorAll("[data-photo-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.photoFilter = btn.getAttribute("data-photo-filter");
      renderPhotosSection();
    });
  });

  container.querySelectorAll("[data-zoom-photo]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const pid = tile.getAttribute("data-zoom-photo");
      const p = state.photos.find((x) => x.id === pid);
      if (!p) return;
      el("photo-modal-title").textContent = ANGLE_LABELS[p.angle] || p.angle;
      el("photo-modal-img").src = p.previewBase64 ? `data:image/jpeg;base64,${p.previewBase64}` : (p.previewUrl || "");
      el("photo-modal-meta").textContent = `${formatWibDate(p.takenAt)}${p.notes ? " • " + p.notes : ""}`;
      el("photo-modal").classList.remove("hidden");
    });
  });
}

function renderWorkoutSection() {
  const container = el("section-workout");
  const mins = String(Math.floor(state.timerRemaining / 60)).padStart(2, "0");
  const secs = String(state.timerRemaining % 60).padStart(2, "0");

  const exHtml = state.workouts.length === 0
    ? `<p class="muted">Belum ada gerakan workout dari coach.</p>`
    : state.workouts.map((w) => `
      <div class="list-item-row">
        <div>
          <strong>${escapeHtml(w.programDay || "Hari 1")} • ${escapeHtml(w.exerciseName)}</strong>
          <div class="muted">${w.sets} set × ${escapeHtml(w.reps)} • Istirahat ${w.restSeconds}d ${w.loadNote ? "• " + escapeHtml(w.loadNote) : ""}</div>
          ${w.coachNotes ? `<div class="muted">${escapeHtml(w.coachNotes)}</div>` : ""}
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-set-timer="${w.restSeconds}">Timer ${w.restSeconds}d</button>
      </div>
    `).join("");

  const reqHtml = state.workoutRequests.length === 0
    ? `<p class="muted">Belum ada request gerakan workout.</p>`
    : state.workoutRequests.map((r) => `
      <div style="border-top:1px solid var(--border);padding:8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${escapeHtml(r.requestedExercise)}</strong>
          <span class="badge badge-${r.status}">${r.status}</span>
        </div>
        ${r.reason ? `<div class="muted">Alasan: ${escapeHtml(r.reason)}</div>` : ""}
        ${r.coachReply ? `<div style="color:var(--emerald);font-size:0.86rem;">Balasan Coach: ${escapeHtml(r.coachReply)}</div>` : ""}
      </div>
    `).join("");

  container.innerHTML = `
    <div class="card timer-box">
      <div>
        <div class="muted">Timer Istirahat Workout</div>
        <div id="portal-timer-display" class="timer-display">${mins}:${secs}</div>
      </div>
      <div class="timer-actions">
        <button type="button" id="timer-plus" class="btn btn-outline btn-sm">+15d</button>
        <button type="button" id="timer-toggle" class="btn btn-emerald btn-sm">${state.timerInterval ? "Jeda" : "Mulai"}</button>
        <button type="button" id="timer-reset" class="btn btn-outline btn-sm">Reset</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Program Gerakan Olahraga</h3>
      ${exHtml}
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Request Gerakan Workout ke Coach</h3>
      <form id="workout-req-form" class="auth-form">
        <label>
          Nama Gerakan yang Diinginkan
          <input type="text" id="wr-name" required placeholder="Contoh: Romanian Deadlift" />
        </label>
        <label>
          Catatan / Alasan
          <textarea id="wr-reason" rows="2" placeholder="Ingin fokus hamstring atau ganti gerakan…"></textarea>
        </label>
        <button type="submit" class="btn btn-primary full-width">Kirim Request Gerakan</button>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Riwayat Request Gerakan Workout</h3>
      ${reqHtml}
    </div>
  `;

  el("timer-plus")?.addEventListener("click", () => {
    state.timerTarget = Math.min(300, state.timerTarget + 15);
    state.timerRemaining = Math.min(300, state.timerRemaining + 15);
    renderWorkoutSection();
  });
  el("timer-reset")?.addEventListener("click", () => {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.timerRemaining = state.timerTarget;
    renderWorkoutSection();
  });
  el("timer-toggle")?.addEventListener("click", () => {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      renderWorkoutSection();
    } else {
      if (state.timerRemaining <= 0) state.timerRemaining = state.timerTarget;
      state.timerInterval = setInterval(() => {
        state.timerRemaining = Math.max(0, state.timerRemaining - 1);
        const disp = el("portal-timer-display");
        if (disp) {
          const m = String(Math.floor(state.timerRemaining / 60)).padStart(2, "0");
          const s = String(state.timerRemaining % 60).padStart(2, "0");
          disp.textContent = `${m}:${s}`;
        }
        if (state.timerRemaining === 0) {
          clearInterval(state.timerInterval);
          state.timerInterval = null;
          renderWorkoutSection();
        }
      }, 1000);
      renderWorkoutSection();
    }
  });

  container.querySelectorAll("[data-set-timer]").forEach((b) => {
    b.addEventListener("click", () => {
      const sec = parseInt(b.getAttribute("data-set-timer"), 10) || 60;
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      state.timerTarget = sec;
      state.timerRemaining = sec;
      renderWorkoutSection();
    });
  });

  el("workout-req-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.clientDoc || !state.db) return;
    const requestedExercise = el("wr-name").value.trim();
    const reason = el("wr-reason").value.trim();
    if (!requestedExercise) return;
    showLoading("Mengirim request gerakan…");
    try {
      await addDoc(collection(state.db, "workoutRequests"), {
        coachUid: state.clientDoc.coachUid,
        clientId: state.clientDoc.id,
        clientEmail: state.clientDoc.emailNormalized,
        clientName: state.clientDoc.fullName,
        requestedExercise,
        reason,
        status: "MENUNGGU",
        coachReply: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      el("wr-name").value = "";
      el("wr-reason").value = "";
      showToast("Request gerakan workout berhasil dikirim ke Coach.", "success");
    } catch (err) {
      showToast("Gagal mengirim request: " + err.message, "error");
    } finally {
      hideLoading();
    }
  });
}

function openRescheduleModal(session) {
  el("reschedule-session-id").value = session.id;
  el("reschedule-orig-start").value = String(session.startAtMillis);
  el("reschedule-session-summary").textContent = `Jadwal awal: ${formatWibDate(session.startAtMillis)} • ${formatWibTime(session.startAtMillis)}`;
  el("reschedule-reason").value = "";
  el("reschedule-modal").classList.remove("hidden");
}

function attachClientListeners(emailLower) {
  clearSubscriptions();
  const db = state.db;

  state.unsubscribers.push(
    onSnapshot(query(collection(db, "clients"), where("emailNormalized", "==", emailLower)), async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !d.deletedAt);
      state.clientDoc = docs[0] || null;
      if (state.clientDoc) {
        el("sidebar-client-name").textContent = `${state.clientDoc.fullName} (${state.clientDoc.packageTier})`;
        el("mobile-client-badge").textContent = `${state.clientDoc.packageTier} • WIB`;
        try {
          const ruleSnap = await getDoc(doc(db, "packageRules", state.clientDoc.packageTier));
          if (ruleSnap.exists()) {
            state.packageRule = ruleSnap.data();
          }
        } catch (_) {}
      }
      renderAll();
    })
  );

  const bindCol = (name, key) => {
    state.unsubscribers.push(
      onSnapshot(query(collection(db, name), where("clientEmail", "==", emailLower)), (snap) => {
        state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !d.deletedAt);
        renderAll();
      })
    );
  };

  bindCol("sessions", "sessions");
  bindCol("rescheduleRequests", "rescheduleRequests");
  bindCol("measurements", "measurements");
  bindCol("bodyCompositions", "bodyCompositions");
  bindCol("progressPhotos", "photos");
  bindCol("workoutExercises", "workouts");
  bindCol("workoutRequests", "workoutRequests");
  bindCol("mealPlanNotes", "mealPlanNotes");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function boot() {
  initTabs();

  el("photo-modal-close")?.addEventListener("click", () => el("photo-modal").classList.add("hidden"));
  el("reschedule-modal-close")?.addEventListener("click", () => el("reschedule-modal").classList.add("hidden"));

  el("reschedule-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.clientDoc || !state.db) return;
    if (state.clientDoc.packageTier === "BASIC") {
      showToast("Paket Basic tidak mendukung reschedule.", "error");
      return;
    }
    const dateStr = el("reschedule-date").value;
    const timeStr = el("reschedule-time").value;
    const reason = el("reschedule-reason").value.trim();
    const sessionId = el("reschedule-session-id").value;
    const origStart = parseInt(el("reschedule-orig-start").value, 10);
    // Construct WIB (+07:00) timestamp
    const requestedStartMillis = new Date(`${dateStr}T${timeStr}:00+07:00`).getTime();
    const requestedEndMillis = requestedStartMillis + 60 * 60000;

    showLoading("Mengirim permintaan reschedule…");
    try {
      await addDoc(collection(state.db, "rescheduleRequests"), {
        coachUid: state.clientDoc.coachUid,
        sessionId,
        clientId: state.clientDoc.id,
        clientEmail: state.clientDoc.emailNormalized,
        clientName: state.clientDoc.fullName,
        originalStartMillis: origStart,
        requestedStartMillis,
        requestedEndMillis,
        reason,
        status: "MENUNGGU",
        coachNote: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      el("reschedule-modal").classList.add("hidden");
      showToast("Permintaan reschedule berhasil dikirim.", "success");
    } catch (err) {
      showToast("Permintaan reschedule ditolak: " + err.message, "error");
    } finally {
      hideLoading();
    }
  });

  const configured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
  if (!configured) {
    el("config-warning").classList.remove("hidden");
    el("splash-screen").classList.add("hidden");
    el("auth-view").classList.remove("hidden");
    return;
  }

  const app = initializeApp(FIREBASE_CONFIG);
  state.auth = getAuth(app);
  state.db = FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== "(default)"
    ? getFirestore(app, FIRESTORE_DATABASE_ID)
    : getFirestore(app);

  el("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("login-email").value.trim().toLowerCase();
    const pass = el("login-password").value;
    showLoading("Memverifikasi akun klien…");
    try {
      await signInWithEmailAndPassword(state.auth, email, pass);
    } catch (err) {
      setAuthMessage("Gagal masuk: " + err.message, true);
    } finally {
      hideLoading();
    }
  });

  el("form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("reg-email").value.trim().toLowerCase();
    const pass = el("reg-password").value;
    showLoading("Memeriksa pendaftaran email oleh Coach Iyan…");
    try {
      const inviteSnap = await getDoc(doc(state.db, "clientInvites", email));
      if (!inviteSnap.exists() || inviteSnap.data()?.active !== true) {
        setAuthMessage("Email ini belum didaftarkan oleh Coach Iyan. Hubungi coach Anda.", true);
        return;
      }
      await createUserWithEmailAndPassword(state.auth, email, pass);
    } catch (err) {
      setAuthMessage("Gagal membuat password: " + err.message, true);
    } finally {
      hideLoading();
    }
  });

  el("form-reset").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("reset-email").value.trim().toLowerCase();
    showLoading("Mengirim email reset password…");
    try {
      await sendPasswordResetEmail(state.auth, email);
      setAuthMessage("Link reset password telah dikirim ke " + email);
    } catch (err) {
      setAuthMessage("Gagal mengirim reset password: " + err.message, true);
    } finally {
      hideLoading();
    }
  });

  const handleLogout = async () => {
    showLoading("Keluar dari portal…");
    clearSubscriptions();
    await signOut(state.auth);
    hideLoading();
    showToast("Anda telah keluar dari portal klien.", "info");
  };
  el("logout-btn")?.addEventListener("click", handleLogout);
  el("mobile-logout-btn")?.addEventListener("click", handleLogout);

  onAuthStateChanged(state.auth, (user) => {
    el("splash-screen").classList.add("hidden");
    if (user && user.email) {
      el("auth-view").classList.add("hidden");
      el("portal-view").classList.remove("hidden");
      attachClientListeners(user.email.trim().toLowerCase());
    } else {
      clearSubscriptions();
      el("portal-view").classList.add("hidden");
      el("auth-view").classList.remove("hidden");
    }
  });
}

boot();
