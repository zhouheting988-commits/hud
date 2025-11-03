// == Ebbinghaus HUD (standalone) ==
// 只读 localStorage，显示 “D/R｜剩余｜预估分钟” 与 L0~L5 数量。
// 放置路径：scripts/extensions/third-party/HUD/index.js
// 与主插件零耦合；支持拖拽、折叠、长按/右键打开设置；自动记住位置与设置。

(function () {
  "use strict";

  // ---------- 可调默认值 ----------
  const DEFAULTS = {
    secPerItem: 6,       // 每题估算秒数（可在设置里改）
    refreshSec: 3,       // HUD 刷新间隔秒
    zIndex: 2147483647,  // 置顶层级
  };

  // ---------- 本插件自己的持久化 ----------
  const SETTINGS_KEY = "EbbHUD.Settings";
  const POS_KEY = "EbbHUD.Pos";

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return {
        secPerItem: Number(parsed.secPerItem) || DEFAULTS.secPerItem,
        refreshSec: Math.max(1, Number(parsed.refreshSec) || DEFAULTS.refreshSec),
        zIndex: Number(parsed.zIndex) || DEFAULTS.zIndex,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }
  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return { right: 12, bottom: 12 };
      const p = JSON.parse(raw);
      return { right: Number(p.right) || 12, bottom: Number(p.bottom) || 12 };
    } catch {
      return { right: 12, bottom: 12 };
    }
  }
  function savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
  }

  // ---------- 读训练存档 ----------
  // 首选 v3；否则自动寻找以 EbbinghausTrainerData 开头的任何 key
  function guessStorageKey() {
    const preferred = "EbbinghausTrainerData_v3";
    if (localStorage.getItem(preferred)) return preferred;
    const k = Object.keys(localStorage).find(k => /^EbbinghausTrainerData/.test(k));
    return k || preferred;
  }
  let TRAIN_KEY = guessStorageKey();

  function readTrainData() {
    try {
      const raw = localStorage.getItem(TRAIN_KEY);
      if (raw) return JSON.parse(raw);
      // 再猜一次（用户可能换了新 key）
      TRAIN_KEY = guessStorageKey();
      const raw2 = localStorage.getItem(TRAIN_KEY);
      return raw2 ? JSON.parse(raw2) : null;
    } catch {
      return null;
    }
  }

  // ---------- 计算今日状态 ----------
  function calcSnapshot(db, secPerItem) {
    if (!db) return { text: "HUD：未检测到词库", danger: false };

    const sc = db.Study_Control || {};
    const day = sc.Current_Day || 1;
    const round = sc.Current_Round || 1;
    const key = "Day_" + day;
    const b = db.Vocabulary_Mastery && db.Vocabulary_Mastery[key];

    if (!b) {
      return {
        text: `D${day}/R${round}｜未检测到今日词桶\nL4:0 L3:0 L2:0 L1:0 L0:0｜L5:0`,
        danger: false
      };
    }

    const c = {
      L0: (b.Level_0_New || []).length,
      L1: (b.Level_1 || []).length,
      L2: (b.Level_2 || []).length,
      L3: (b.Level_3 || []).length,
      L4: (b.Level_4 || []).length,
      L5: (b.Level_5_Mastered_Today || []).length,
    };
    const remaining = c.L0 + c.L1 + c.L2 + c.L3 + c.L4;
    const etaMin = Math.ceil((remaining * Math.max(1, secPerItem)) / 60);

    const line1 = `D${day}/R${round}｜剩${remaining}｜≈${etaMin}min`;
    const line2 = `L4:${c.L4} L3:${c.L3} L2:${c.L2} L1:${c.L1} L0:${c.L0}｜L5:${c.L5}`;
    return { text: `${line1}\n${line2}`, danger: etaMin > 120 };
  }

  // ---------- DOM & 交互 ----------
  let hud, timer, settings, dragging = false;

  function injectStyle(zIndex) {
    if (document.getElementById("ebb-hud-style")) return;
    const css = `
      @keyframes ebb-blink { 50% { filter: brightness(1.65); } }
      #ebb-hud {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: ${zIndex};
        background: rgba(0,0,0,.78);
        color: #fff;
        padding: 10px 12px;
        border-radius: 14px;
        font: 12px/1.45 system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial;
        box-shadow: 0 8px 22px rgba(0,0,0,.35);
        user-select: none;
        white-space: pre;
        cursor: grab;
        transition: opacity .2s ease;
      }
      #ebb-hud[data-min="1"] { opacity: .35; }
    `;
    const s = document.createElement("style");
    s.id = "ebb-hud-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function mount() {
    if (hud) return;
    settings = loadSettings();
    injectStyle(settings.zIndex);

    hud = document.createElement("div");
    hud.id = "ebb-hud";
    hud.textContent = "HUD…";
    const pos = loadPos();
    hud.style.right = pos.right + "px";
    hud.style.bottom = pos.bottom + "px";

    // 点击：折叠/展开
    hud.addEventListener("click", (e) => {
      if (dragging) return; // 拖动结束的 click 忽略
      // Alt+Click 直接开设置
      if (e.altKey) return openSettings();
      hud.dataset.min = hud.dataset.min === "1" ? "0" : "1";
    });

    // 右键：打开设置
    hud.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSettings();
    });

    // 拖拽（鼠标）
    let startX = 0, startY = 0;
    let startRight = 0, startBottom = 0;

    const onMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
      const r = Math.max(6, startRight - dx);
      const b = Math.max(6, startBottom - dy);
      hud.style.right = r + "px";
      hud.style.bottom = b + "px";
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (dragging) {
        savePos({ right: parseInt(hud.style.right, 10) || 12, bottom: parseInt(hud.style.bottom, 10) || 12 });
        setTimeout(() => (dragging = false), 50);
      }
      hud.style.cursor = "grab";
    };

    hud.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = false;
      hud.style.cursor = "grabbing";
      startX = e.clientX; startY = e.clientY;
      startRight = parseInt(hud.style.right, 10) || 12;
      startBottom = parseInt(hud.style.bottom, 10) || 12;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // 拖拽（触摸）
    let pressTimer = null, longPressed = false;
    hud.addEventListener("touchstart", (e) => {
      dragging = false; longPressed = false;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      startRight = parseInt(hud.style.right, 10) || 12;
      startBottom = parseInt(hud.style.bottom, 10) || 12;
      pressTimer = setTimeout(() => { longPressed = true; openSettings(); }, 600);
    }, { passive: true });

    hud.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        dragging = true;
        clearTimeout(pressTimer);
        const r = Math.max(6, startRight - dx);
        const b = Math.max(6, startBottom - dy);
        hud.style.right = r + "px";
        hud.style.bottom = b + "px";
      }
    }, { passive: true });

    hud.addEventListener("touchend", () => { clearTimeout(pressTimer); });

    document.body.appendChild(hud);
  }

  function openSettings() {
    const s = loadSettings();
    const sec = prompt("每题估算秒数？", String(s.secPerItem));
    if (sec !== null && sec !== "") s.secPerItem = Math.max(1, Number(sec) || s.secPerItem);
    const ref = prompt("刷新间隔秒？", String(s.refreshSec));
    if (ref !== null && ref !== "") s.refreshSec = Math.max(1, Number(ref) || s.refreshSec);
    const z = prompt("z-index（层级，数值越大越靠上）？", String(s.zIndex));
    if (z !== null && z !== "") s.zIndex = Number(z) || s.zIndex;
    saveSettings(s);
    settings = s;
    // 立即应用层级
    if (hud) hud.style.zIndex = String(settings.zIndex);
    restartTimer();
  }

  // ---------- 刷新循环 ----------
  function tick() {
    try {
      const db = readTrainData();
      const view = calcSnapshot(db, settings.secPerItem);
      if (!hud) return;
      hud.textContent = view.text;
      if (view.danger) {
        hud.style.animation = "ebb-blink .8s 2";
        setTimeout(() => (hud.style.animation = ""), 1600);
      }
    } catch {
      if (hud) hud.textContent = "HUD：解析失败";
    }
  }

  function restartTimer() {
    clearInterval(timer);
    const ms = Math.max(1, settings.refreshSec) * 1000;
    timer = setInterval(tick, ms);
  }

  function start() {
    mount();
    tick();
    restartTimer();
  }
  function stop() { clearInterval(timer); }

  // ---------- 启动 ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  // 对外（调试可用）
  window.EbbinghausHUD = {
    start, stop,
    setStorageKey: (k) => { TRAIN_KEY = k; tick(); },
    set: (opts = {}) => {
      settings = { ...settings, ...opts };
      saveSettings(settings);
      if (hud && opts.zIndex) hud.style.zIndex = String(settings.zIndex);
      restartTimer();
    }
  };
})();
