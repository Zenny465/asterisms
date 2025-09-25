// sound.js — particles.js の粒子に近づいたとき優しい結晶音を鳴らす
(() => {
  // ===== 設定 =====
  const SOUND_FILES = ["s1.mp3", "s2.mp3", "s3.mp3"]; // home/ に置く
  const COOL_DOWN = 140;    // ms：鳴り過ぎ防止
  const HOVER_RADIUS = 45;  // px：これ以内に粒子があれば「触れた」とみなす

  // ===== Audio 準備 =====
  const sounds = SOUND_FILES.map(src => {
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = 0.28; // ベース音量（後でランダム微調整）
    return a;
  });

  // ブラウザ自動再生制限の解除（最初のタップ/クリックで解禁）
  let audioUnlocked = false;
  function unlockAudioOnce() {
    if (audioUnlocked) return;
    const a = new Audio(SOUND_FILES[0]);
    a.volume = 0.0;
    a.play().catch(() => {}).finally(() => { audioUnlocked = true; });
    window.removeEventListener("pointerdown", unlockAudioOnce);
  }
  window.addEventListener("pointerdown", unlockAudioOnce, { once: true });

  // ===== particles.js の初期化完了を待つ =====
  function whenParticlesReady(cb) {
    const ready = () =>
      window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS &&
      document.querySelector(".particles-js-canvas-el");
    if (ready()) return cb();
    const id = setInterval(() => {
      if (ready()) { clearInterval(id); cb(); }
    }, 50);
    setTimeout(() => clearInterval(id), 5000); // 5秒で打ち切り（保険）
  }

  // ===== 近くに粒子があるかをチェック =====
  function nearAnyParticle(mx, my) {
    const pJS = window.pJSDom?.[0]?.pJS;
    if (!pJS) return false;
    const arr = pJS.particles.array || [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < HOVER_RADIUS * HOVER_RADIUS) return true;
    }
    return false;
  }

  // ===== 再生 =====
  function playCrystalSound() {
    const base = sounds[Math.floor(Math.random() * sounds.length)];
    // 同時再生できるよう clone を使う
    const inst = base.paused ? base : base.cloneNode();
    inst.currentTime = 0;
    // ちょいランダムで耳あたりを自然に
    inst.volume = 0.20 + Math.random() * 0.15;
    inst.playbackRate = 0.92 + Math.random() * 0.18;
    inst.play().catch(() => {}); // ロック未解除などは無視
  }

  // ===== マウス/タッチ移動でチェックして鳴らす =====
  whenParticlesReady(() => {
    const canvas = document.querySelector(".particles-js-canvas-el");
    let lastPlay = 0;

    const handle = (clientX, clientY) => {
      const now = Date.now();
      if (now - lastPlay < COOL_DOWN) return;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      if (nearAnyParticle(mx, my)) {
        lastPlay = now;
        playCrystalSound();
      }
    };

    canvas.addEventListener("mousemove", (e) => handle(e.clientX, e.clientY));
    canvas.addEventListener("touchmove", (e) => {
      const t = e.touches[0]; if (!t) return;
      handle(t.clientX, t.clientY);
    }, { passive: true });
  });
})();
