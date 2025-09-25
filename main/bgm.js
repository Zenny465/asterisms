// bgm.js — 宇宙BGM：自動再生対策＋オン/オフボタン＋フェード

(() => {
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[BGM]", ...a);

  // ===== 設定 =====
  const SRC = "bgm.mp3";   // main/ と同階層
  const BASE_VOL = 0.7;    // 通常時の音量
  const FADE_MS  = 500;    // フェード時間（ms）

  // ===== BGM 準備 =====
  const bgm = new Audio(SRC);
  bgm.loop = true;
  bgm.preload = "auto";
  bgm.volume = 0;

  // ===== 状態永続化（localStorage） =====
  const LS_KEY = "bgmEnabled";
  const enabledAtStart = (() => {
    const v = localStorage.getItem(LS_KEY);
    return v === null ? true : v === "true";
  })();

  // ===== DOM: トグルボタン作成（CSSも注入） =====
  const style = document.createElement("style");
  style.textContent = `
  .bgm-toggle {
    position: fixed; top: 12px; right: 12px; z-index: 9999;
    padding: 8px 12px; border-radius: 999px;
    background: rgba(0,0,0,0.55); color: #eaf6ff;
    border: 1px solid rgba(160,220,255,.55);
    font: 600 13px system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
    cursor: pointer; user-select: none; backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px rgba(0,0,0,.35), inset 0 0 10px rgba(120,200,255,.15);
    transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
    pointer-events: auto;
  }
  .bgm-toggle:hover { transform: translateY(-1px);
    box-shadow: 0 10px 22px rgba(0,0,0,.45), 0 0 24px rgba(120,200,255,.35);
  }
  .bgm-on  { color:#c9f1ff }
  .bgm-off { color:#ffd3d3 }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "bgm-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "BGM toggle");
  document.body.appendChild(btn);

  const setBtn = (on) => {
    btn.innerHTML = on ? "🔊 BGM: ON" : "🔇 BGM: OFF";
    btn.classList.toggle("bgm-on",  on);
    btn.classList.toggle("bgm-off", !on);
  };

  // ===== フェード処理 =====
  function fadeTo(target, ms = FADE_MS) {
    target = Math.max(0, Math.min(1, target));
    const start = bgm.volume;
    const t0 = performance.now();
    return new Promise((resolve) => {
      function step(t) {
        const k = Math.min(1, (t - t0) / ms);
        bgm.volume = start + (target - start) * k;
        if (k < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // ===== 自動再生対策：ミュート再生→アンミュート or 軽い操作で解禁 =====
  async function tryMutedAutoplay() {
    try {
      bgm.muted = true;
      await bgm.play();            // ミュートだと通る環境が多い
      log("muted autoplay OK");
      setTimeout(() => { bgm.muted = false; }, 80);
      return true;
    } catch {
      log("muted autoplay failed");
      return false;
    }
  }

  function armUserUnlock() {
    const unlock = async () => {
      try {
        bgm.muted = false;
        await bgm.play();
      } finally {
        cleanup();
      }
    };
    const opts = { once: true, passive: true };
    const events = [
      ["pointermove", opts], ["click", opts], ["keydown", { once:true }],
      ["touchstart", opts], ["wheel", opts]
    ];
    function cleanup(){ events.forEach(([e,o])=>window.removeEventListener(e, unlock, o)); }
    events.forEach(([e,o])=>window.addEventListener(e, unlock, o));
    setTimeout(cleanup, 5000);
  }

  // タブ復帰で再開（任意）
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && btn && btn.textContent.includes("ON") && bgm.paused) {
      bgm.play().catch(()=>{});
    }
  });

  // ===== トグル動作 =====
  let enabled = enabledAtStart;
  setBtn(enabled);

  async function turnOn() {
    localStorage.setItem(LS_KEY, "true");
    try { if (bgm.paused) await bgm.play(); } catch {}
    await fadeTo(BASE_VOL);
    setBtn(true);
  }

  async function turnOff() {
    localStorage.setItem(LS_KEY, "false");
    await fadeTo(0);
    try { bgm.pause(); } catch {}
    setBtn(false);
  }

  btn.addEventListener("click", () => {
    enabled = !enabled;
    if (enabled) turnOn(); else turnOff();
  });

  // ===== 起動シーケンス =====
  (async () => {
    const ok = await tryMutedAutoplay();
    if (!ok) armUserUnlock();

    if (enabled) {
      // 起動時ONならフェードイン
      try { if (bgm.paused) await bgm.play(); } catch {}
      await fadeTo(BASE_VOL, 600);
    } else {
      // 起動時OFFなら無音維持
      bgm.volume = 0;
      try { bgm.pause(); } catch {}
    }
  })();
})();
