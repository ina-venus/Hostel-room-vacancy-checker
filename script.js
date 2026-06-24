/* =========================================================
   HOSTEL ROOM OCCUPANCY TRACKER — APP LOGIC
   Plain JS, no frameworks, no backend. Data lives in
   localStorage so it survives page refreshes.
   ========================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------
   * 1. CONFIG & STATE
   * ------------------------------------------------------- */

  // Hostel definitions. Edit this list to add/remove hostels
  // or change room counts — everything else adapts automatically.
  const HOSTEL_CONFIG = [
    { id: "A", name: "Hostel A", rooms: 30 },
    { id: "B", name: "Hostel B", rooms: 60 },
    { id: "C", name: "Hostel C", rooms: 20 },
    { id: "D", name: "Hostel D", rooms: 20 },
    { id: "E", name: "Hostel E", rooms: 20 },
  ];

  const STORAGE_KEY = "hostelTracker.data.v1";
  const ADMIN_SESSION_KEY = "hostelTracker.adminUnlocked";

  // Change this to set your own admin password.
  const ADMIN_PASSWORD = "admin123";

  // In-memory app state. `data` shape:
  // { A: { "1": { status: "vacant", updatedAt: <ts> }, ... }, B: {...}, ... }
  let data = {};
  let currentHostelId = null;     // hostel currently open in Room Grid view
  let currentFilter = "all";      // "all" | "vacant" | "occupied"
  let isAdminUnlocked = false;
  let pendingConfirmAction = null; // callback stored for the confirm modal

  /* ---------------------------------------------------------
   * 2. DATA LAYER (localStorage persistence)
   * ------------------------------------------------------- */

  function buildDefaultData() {
    const fresh = {};
    HOSTEL_CONFIG.forEach((hostel) => {
      fresh[hostel.id] = {};
      for (let i = 1; i <= hostel.rooms; i++) {
        fresh[hostel.id][i] = { status: "vacant", updatedAt: Date.now() };
      }
    });
    return fresh;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return buildDefaultData();

      const parsed = JSON.parse(raw);

      // Merge saved data with current HOSTEL_CONFIG so that
      // config changes (e.g. adding a hostel) don't break the app.
      const merged = buildDefaultData();
      HOSTEL_CONFIG.forEach((hostel) => {
        const saved = parsed[hostel.id];
        if (!saved) return;
        for (let i = 1; i <= hostel.rooms; i++) {
          if (saved[i]) merged[hostel.id][i] = saved[i];
        }
      });
      return merged;
    } catch (err) {
      console.error("Failed to load saved data, starting fresh.", err);
      return buildDefaultData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error("Failed to save data to localStorage.", err);
      showToast("Could not save changes (storage full or blocked).", "error");
    }
  }

  /* ---------------------------------------------------------
   * 3. STATS HELPERS
   * ------------------------------------------------------- */

  function getHostelStats(hostelId) {
    const rooms = data[hostelId] || {};
    const total = Object.keys(rooms).length;
    let occupied = 0;
    Object.values(rooms).forEach((r) => { if (r.status === "occupied") occupied++; });
    const vacant = total - occupied;
    const pct = total === 0 ? 0 : Math.round((occupied / total) * 100);
    return { total, vacant, occupied, pct };
  }

  function getOverallStats() {
    let total = 0, occupied = 0;
    HOSTEL_CONFIG.forEach((h) => {
      const s = getHostelStats(h.id);
      total += s.total;
      occupied += s.occupied;
    });
    const vacant = total - occupied;
    const pct = total === 0 ? 0 : Math.round((occupied / total) * 100);
    return { total, vacant, occupied, pct };
  }

  /* ---------------------------------------------------------
   * 4. RENDERING — DASHBOARD
   * ------------------------------------------------------- */

  function renderOverallStats() {
    const s = getOverallStats();
    $("#overallTotal").textContent = s.total;
    $("#overallVacant").textContent = s.vacant;
    $("#overallOccupied").textContent = s.occupied;
    $("#overallPct").textContent = s.pct + "%";
  }

  function renderDashboard() {
    const container = $("#hostelCards");
    container.innerHTML = "";

    HOSTEL_CONFIG.forEach((hostel) => {
      const s = getHostelStats(hostel.id);

      const card = document.createElement("div");
      card.className = "hostel-card";
      card.innerHTML = `
        <div class="hostel-card-header">
          <h3>${escapeHtml(hostel.name)}</h3>
          <span class="total-rooms">${s.total} rooms</span>
        </div>

        <div class="occ-bar-track">
          <div class="occ-bar-fill" style="width:${s.pct}%"></div>
        </div>

        <div class="hostel-card-stats">
          <div class="mini-stat vacant">
            <span class="mini-stat-value">${s.vacant}</span>
            <span class="mini-stat-label">Vacant</span>
          </div>
          <div class="mini-stat occupied">
            <span class="mini-stat-value">${s.occupied}</span>
            <span class="mini-stat-label">Occupied</span>
          </div>
          <div class="mini-stat">
            <span class="mini-stat-value">${s.pct}%</span>
            <span class="mini-stat-label">Occupancy</span>
          </div>
        </div>

        <button class="btn btn-primary view-rooms-btn" data-hostel="${hostel.id}">
          View Rooms
        </button>
      `;
      container.appendChild(card);
    });

    renderOverallStats();
  }

  /* ---------------------------------------------------------
   * 5. RENDERING — ROOM GRID VIEW
   * ------------------------------------------------------- */

  function openHostel(hostelId) {
    currentHostelId = hostelId;
    currentFilter = "all";
    $$(".filter-btn").forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));

    const hostel = HOSTEL_CONFIG.find((h) => h.id === hostelId);
    $("#roomViewTitle").textContent = hostel ? hostel.name : "Hostel";

    $("#dashboardView").hidden = true;
    $("#roomView").hidden = false;

    renderRoomGrid();
  }

  function closeHostel() {
    currentHostelId = null;
    $("#roomView").hidden = true;
    $("#dashboardView").hidden = false;
    renderDashboard(); // refresh stats in case anything changed
  }

  function renderHostelSubstats() {
    if (!currentHostelId) return;
    const s = getHostelStats(currentHostelId);
    $("#hostelSubstats").innerHTML = `
      <span>Total: <b>${s.total}</b></span>
      <span>Vacant: <b>${s.vacant}</b></span>
      <span>Occupied: <b>${s.occupied}</b></span>
      <span>Occupancy: <b>${s.pct}%</b></span>
    `;
  }

  function renderRoomGrid(justChangedRoom) {
    if (!currentHostelId) return;
    renderHostelSubstats();

    const grid = $("#roomGrid");
    const rooms = data[currentHostelId];
    const roomNumbers = Object.keys(rooms).map(Number).sort((a, b) => a - b);

    grid.innerHTML = "";
    roomNumbers.forEach((num) => {
      const room = rooms[num];
      const tile = document.createElement("button");
      tile.className = "room-tile " + room.status;
      tile.dataset.room = num;
      tile.setAttribute("aria-label", `Room ${num}, ${room.status}. Tap to toggle.`);
      tile.title = `Last updated: ${formatTimestamp(room.updatedAt)}`;

      const icon = room.status === "vacant" ? "🟢" : "🔴";
      tile.innerHTML = `
        <span class="room-status-icon">${icon}</span>
        <span class="room-number">${num}</span>
      `;

      if (justChangedRoom === num) tile.classList.add("just-changed");

      // Apply current filter visibility
      if (currentFilter !== "all" && room.status !== currentFilter) {
        tile.classList.add("hidden-by-filter");
      }

      tile.addEventListener("click", () => handleRoomTileClick(currentHostelId, num));
      grid.appendChild(tile);
    });
  }

  function applyFilter(filter) {
    currentFilter = filter;
    $$(".filter-btn").forEach((b) => b.classList.toggle("active", b.dataset.filter === filter));
    $$(".room-tile").forEach((tile) => {
      const room = data[currentHostelId][tile.dataset.room];
      const matches = filter === "all" || room.status === filter;
      tile.classList.toggle("hidden-by-filter", !matches);
    });
  }

  /* ---------------------------------------------------------
   * 6. ROOM STATUS CHANGES (with admin gating)
   * ------------------------------------------------------- */

  function handleRoomTileClick(hostelId, roomNum) {
    requireAdmin(() => toggleRoomStatus(hostelId, roomNum));
  }

  function toggleRoomStatus(hostelId, roomNum) {
    const room = data[hostelId][roomNum];
    room.status = room.status === "vacant" ? "occupied" : "vacant";
    room.updatedAt = Date.now();
    saveData();

    // Re-render just the grid (with a pulse animation on the changed tile)
    renderRoomGrid(roomNum);
    renderOverallStats();
    showToast(`Room ${roomNum} marked ${room.status}.`, "success");
  }

  function markAllVacant(hostelId) {
    const rooms = data[hostelId];
    Object.keys(rooms).forEach((num) => {
      rooms[num].status = "vacant";
      rooms[num].updatedAt = Date.now();
    });
    saveData();
    renderRoomGrid();
    renderOverallStats();
    showToast("All rooms in this hostel marked vacant.", "success");
  }

  function resetAllData() {
    data = buildDefaultData();
    saveData();
    renderDashboard();
    if (currentHostelId) renderRoomGrid();
    showToast("All data has been reset.", "success");
  }

  /* ---------------------------------------------------------
   * 7. ADMIN MODE
   * ------------------------------------------------------- */

  function isAdminModeOn() {
    return isAdminUnlocked;
  }

  // Wraps an action so it only runs once admin mode is unlocked.
  // If admin mode is already on, runs immediately.
  function requireAdmin(action) {
    if (isAdminUnlocked) {
      action();
      return;
    }
    pendingAdminAction = action;
    openAdminModal();
  }

  let pendingAdminAction = null;

  function openAdminModal() {
    $("#adminPasswordInput").value = "";
    $("#adminError").hidden = true;
    $("#adminModal").hidden = false;
    $("#adminPasswordInput").focus();
  }

  function closeAdminModal() {
    $("#adminModal").hidden = true;
    pendingAdminAction = null;
  }

  function submitAdminPassword() {
    const value = $("#adminPasswordInput").value;
    if (value === ADMIN_PASSWORD) {
      isAdminUnlocked = true;
      sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
      updateAdminUI();
      $("#adminModal").hidden = true;
      showToast("Admin mode unlocked.", "success");
      if (pendingAdminAction) {
        const action = pendingAdminAction;
        pendingAdminAction = null;
        action();
      }
    } else {
      $("#adminError").hidden = false;
    }
  }

  function toggleAdminMode() {
    if (isAdminUnlocked) {
      // Turning admin mode off needs no password.
      isAdminUnlocked = false;
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      updateAdminUI();
      showToast("Admin mode turned off. You can still view rooms.", "success");
    } else {
      openAdminModal();
    }
  }

  function updateAdminUI() {
    $("#adminStatusLabel").textContent = isAdminUnlocked ? "On" : "Off";
    document.body.classList.toggle("admin-on", isAdminUnlocked);
    $("#adminToggleBtn").innerHTML = isAdminUnlocked
      ? "🔓 Admin Mode: <span id=\"adminStatusLabel\">On</span>"
      : "🔒 Admin Mode: <span id=\"adminStatusLabel\">Off</span>";
  }

  /* ---------------------------------------------------------
   * 8. SEARCH
   * ------------------------------------------------------- */

  function handleSearchInput() {
    const query = $("#searchInput").value.trim();
    $("#clearSearchBtn").hidden = query.length === 0;

    if (query.length === 0) {
      $("#searchResults").hidden = true;
      $("#searchResults").innerHTML = "";
      return;
    }

    // Match rooms whose number starts with or equals the query digits.
    const queryNum = query.replace(/[^0-9]/g, "");
    const results = [];

    if (queryNum.length > 0) {
      HOSTEL_CONFIG.forEach((hostel) => {
        const rooms = data[hostel.id];
        Object.keys(rooms).forEach((num) => {
          if (num === queryNum || num.startsWith(queryNum)) {
            results.push({
              hostelId: hostel.id,
              hostelName: hostel.name,
              roomNum: num,
              status: rooms[num].status,
            });
          }
        });
      });
    }

    renderSearchResults(results, query);
  }

  function renderSearchResults(results, query) {
    const box = $("#searchResults");
    box.hidden = false;

    if (results.length === 0) {
      box.innerHTML = `<div class="search-empty">No room matching "${escapeHtml(query)}" found.</div>`;
      return;
    }

    // Cap to a reasonable number so the list doesn't explode.
    const capped = results.slice(0, 25);

    box.innerHTML = capped
      .map(
        (r) => `
        <div class="search-result-row">
          <span><span class="room-tag">Room ${r.roomNum}</span> · ${escapeHtml(r.hostelName)}</span>
          <span class="search-result-status ${r.status}">
            ${r.status === "vacant" ? "🟢 Vacant" : "🔴 Occupied"}
          </span>
        </div>`
      )
      .join("");

    // Clicking a result jumps straight to that hostel's room grid.
    $$(".search-result-row", box).forEach((row, i) => {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        openHostel(capped[i].hostelId);
        $("#searchInput").value = "";
        $("#clearSearchBtn").hidden = true;
        box.hidden = true;
        box.innerHTML = "";
      });
    });
  }

  function clearSearch() {
    $("#searchInput").value = "";
    $("#clearSearchBtn").hidden = true;
    $("#searchResults").hidden = true;
    $("#searchResults").innerHTML = "";
  }

  /* ---------------------------------------------------------
   * 9. EXPORT / IMPORT
   * ------------------------------------------------------- */

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      config: HOSTEL_CONFIG,
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hostel-occupancy-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Data exported.", "success");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.data || parsed; // allow raw data files too

        // Validate basic shape before applying.
        const merged = buildDefaultData();
        HOSTEL_CONFIG.forEach((hostel) => {
          const saved = incoming[hostel.id];
          if (!saved) return;
          for (let i = 1; i <= hostel.rooms; i++) {
            if (saved[i] && (saved[i].status === "vacant" || saved[i].status === "occupied")) {
              merged[hostel.id][i] = {
                status: saved[i].status,
                updatedAt: saved[i].updatedAt || Date.now(),
              };
            }
          }
        });

        data = merged;
        saveData();
        renderDashboard();
        if (currentHostelId) renderRoomGrid();
        showToast("Data imported successfully.", "success");
      } catch (err) {
        console.error("Import failed:", err);
        showToast("Import failed: invalid JSON file.", "error");
      }
    };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------
   * 10. CONFIRM MODAL (generic, reused by Reset / Mark All Vacant)
   * ------------------------------------------------------- */

  function openConfirm(title, message, onConfirm) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    pendingConfirmAction = onConfirm;
    $("#confirmModal").hidden = false;
  }

  function closeConfirm() {
    $("#confirmModal").hidden = true;
    pendingConfirmAction = null;
  }

  /* ---------------------------------------------------------
   * 11. TOAST NOTIFICATIONS
   * ------------------------------------------------------- */

  let toastTimer = null;
  function showToast(message, kind) {
    const el = $("#toast");
    el.textContent = message;
    el.className = "toast show" + (kind ? " toast-" + kind : "");
    el.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 200);
    }, 2400);
  }

  /* ---------------------------------------------------------
   * 12. UTILITIES
   * ------------------------------------------------------- */

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.from((scope || document).querySelectorAll(selector)); }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTimestamp(ts) {
    if (!ts) return "unknown";
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  /* ---------------------------------------------------------
   * 13. EVENT WIRING
   * ------------------------------------------------------- */

  function wireEvents() {
    // Dashboard: "View Rooms" buttons (delegated)
    $("#hostelCards").addEventListener("click", (e) => {
      const btn = e.target.closest(".view-rooms-btn");
      if (btn) openHostel(btn.dataset.hostel);
    });

    // Back to dashboard
    $("#backBtn").addEventListener("click", closeHostel);

    // Filters
    $$(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyFilter(btn.dataset.filter));
    });

    // Mark all vacant (admin-gated + confirmation)
    $("#markAllVacantBtn").addEventListener("click", () => {
      requireAdmin(() => {
        openConfirm(
          "Mark all rooms vacant?",
          `This will set every room in ${HOSTEL_CONFIG.find(h => h.id === currentHostelId).name} to vacant. This cannot be undone.`,
          () => markAllVacant(currentHostelId)
        );
      });
    });

    // Reset all data (admin-gated + confirmation)
    $("#resetBtn").addEventListener("click", () => {
      requireAdmin(() => {
        openConfirm(
          "Reset all data?",
          "This will set every room across all hostels back to vacant and cannot be undone.",
          resetAllData
        );
      });
    });

    // Confirm modal buttons
    $("#confirmOkBtn").addEventListener("click", () => {
      const action = pendingConfirmAction;
      closeConfirm();
      if (action) action();
    });
    $("#confirmCancelBtn").addEventListener("click", closeConfirm);

    // Export / Import
    $("#exportBtn").addEventListener("click", exportData);
    $("#importInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importData(file);
      e.target.value = ""; // allow re-importing the same file later
    });

    // Search
    $("#searchInput").addEventListener("input", handleSearchInput);
    $("#clearSearchBtn").addEventListener("click", clearSearch);

    // Admin mode
    $("#adminToggleBtn").addEventListener("click", toggleAdminMode);
    $("#adminSubmitBtn").addEventListener("click", submitAdminPassword);
    $("#adminCancelBtn").addEventListener("click", closeAdminModal);
    $("#adminPasswordInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAdminPassword();
    });

    // Close modals when clicking the dark overlay (but not the box itself)
    $("#confirmModal").addEventListener("click", (e) => {
      if (e.target.id === "confirmModal") closeConfirm();
    });
    $("#adminModal").addEventListener("click", (e) => {
      if (e.target.id === "adminModal") closeAdminModal();
    });
  }

  /* ---------------------------------------------------------
   * 14. INIT
   * ------------------------------------------------------- */

  function init() {
    data = loadData();
    isAdminUnlocked = sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
    updateAdminUI();
    wireEvents();
    renderDashboard();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
