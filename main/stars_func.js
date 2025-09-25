// 動的な動きとゲームロジックを実現します。
// 依存: グローバルに `scene`, `camera`, `renderer`, `layers`, `RADIUS`, `STARS_DATA_WITH_INDEX` が存在すること
// main.html で定義されたUI要素 (mode-selection-panel, create-mode-panel, explore-mode-panel など) に依存

(function(){
  // ---- 必要なグローバルがあるかチェック ----
  if (typeof scene === 'undefined' || typeof camera === 'undefined' || typeof renderer === 'undefined' || typeof layers === 'undefined' || typeof STARS_DATA_WITH_INDEX === 'undefined') {
    console.error('stars_func.js: 必要なグローバル変数が見つかりません。スクリプトの読み込み順を確認してください。');
    return;
  }

  // ---- 設定 ----
  const HIT_RADIUS_PX = 12;         // クリック判定半径（ピクセル）
  const MARKER_PIXEL_SIZE = 14;     // マーカーの見た目サイズ（ピクセル）
  const LINE_WIDTH = 3;             // 線の太さ
  const GLOW_ANIM_DURATION = 1500;  // 発光アニメーションの期間 (ms)
  const DELETE_CONFIRM_TEXT = "Are you sure you want to delete this constellation?";

  // ---- 内部管理 ----
  let currentMode = 'explore'; // 'explore' or 'create'
  let selectedStars = [];    // { originalIndex: number, pos: THREE.Vector3, data: any }
  let currentPolyline = null; // 作成中の星座の線
  let currentMarkers = [];    // 作成中の星座のマーカー { sprite: THREE.Sprite, pos: THREE.Vector3, color: THREE.Color, originalIndex: number }
  let selectedConstellationColor = null; // 現在作成中の星座の色
  let markerTextureCache = {}; // 色ごとのマーカーテクスチャキャッシュ

  let glowingPolyline = null; // 発光アニメーション用のポリライン
  let animationStartTime = null; // アニメーション開始時刻
  let animationFrameId = null;
  let animatingConstellationId = null; // 現在アニメーション中の星座のID

  // ---- UI要素の参照 ----
  const modeSelectionPanel = document.getElementById('mode-selection-panel');
  const exploreModeBtn = document.getElementById('explore-mode-btn');
  const createModeBtn = document.getElementById('create-mode-btn');
  const createModePanel = document.getElementById('create-mode-panel');
  const exploreModePanel = document.getElementById('explore-mode-panel');
  const constellationNameInput = document.getElementById('constellation-name-input');
  const starCountDisplay = document.getElementById('star-count');
  const saveConstellationBtn = document.getElementById('save-constellation-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const myConstellationsList = document.getElementById('my-constellations-list');

  // ---- ヘルパ: 円形テクスチャ作成 ----
  function makeCircleTexture(colorHex) {
      const size = 64; // テクスチャサイズ
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 * 0.8, 0, Math.PI * 2, false);
      context.fillStyle = colorHex;
      context.fill();
      return new THREE.CanvasTexture(canvas);
  }

  // ---- テクスチャキャッシュを管理するヘルパー関数 ----
  function getMarkerTexture(colorHex) {
    if (!markerTextureCache[colorHex]) {
      markerTextureCache[colorHex] = makeCircleTexture(colorHex);
    }
    return markerTextureCache[colorHex];
  }

  // ---- ヘルパ: ピクセルサイズ → ワールドスケール ----
  function pixelToWorldScale(pixelSize, worldPos) {
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const distance = camPos.distanceTo(worldPos);
    const vFOV = (camera.fov * Math.PI) / 180;
    const worldHeight = 2 * Math.tan(vFOV / 2) * distance;
    const worldPerPixel = worldHeight / renderer.domElement.clientHeight;
    return worldPerPixel * pixelSize;
  }

  // ---- Three.jsオブジェクトをクリアする汎用関数 ----
  function clearThreeObject(obj) {
    if (!obj) return;
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
        } else {
            obj.material.dispose();
        }
    }
  }

  // ---- 全てのマーカーとラインをクリア ----
  function resetCurrentDrawing() {
    currentMarkers.forEach(m => clearThreeObject(m.sprite)); // 全てのマーカースプライトをクリア
    currentMarkers.length = 0; // 配列を空にする
    selectedStars.length = 0;
    clearThreeObject(currentPolyline);
    currentPolyline = null;
    selectedConstellationColor = null; // 色もリセット
    updateStarCountDisplay();
    updateSaveButtonState();
  }

  // ---- マーカー追加/削除ロジック ----
  function toggleStarSelection(starOriginalIndex, worldPos, starData) {
    const existingIndex = selectedStars.findIndex(s => s.originalIndex === starOriginalIndex);

    if (!selectedConstellationColor) {
      selectedConstellationColor = new THREE.Color(Math.random() * 0xffffff);
    }
    const colorHex = '#' + selectedConstellationColor.getHexString();
    const markerTexture = getMarkerTexture(colorHex);

    if (existingIndex === -1) {
      // 星を選択: マーカーを追加
      selectedStars.push({ originalIndex: starOriginalIndex, pos: worldPos.clone(), data: starData });

      const mat = new THREE.SpriteMaterial({
        map: markerTexture,
        color: selectedConstellationColor,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending // 発光感
      });
      const sprite = new THREE.Sprite(mat);
      const scale = pixelToWorldScale(MARKER_PIXEL_SIZE, worldPos);
      sprite.scale.set(scale, scale, 1);
      sprite.position.copy(worldPos);
      scene.add(sprite);
      currentMarkers.push({ sprite, pos: worldPos.clone(), color: selectedConstellationColor.clone(), originalIndex: starOriginalIndex });

      // ★ マーカー追加時の短い発光演出
      // TWEEN.js が main.html で読み込まれていることを前提
      if (window.TWEEN) {
        const initialScale = sprite.scale.x;
        new TWEEN.Tween({ scale: initialScale * 1.5, opacity: 0.0 })
            .to({ scale: initialScale, opacity: 1.0 }, 200)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(function() {
                sprite.scale.set(this.scale, this.scale, 1);
                mat.opacity = this.opacity;
            })
            .start();
      }

    } else {
      // 星の選択解除: マーカーを削除
      const removedStar = selectedStars.splice(existingIndex, 1)[0];
      const markerToRemoveIndex = currentMarkers.findIndex(m => m.originalIndex === removedStar.originalIndex);
      if (markerToRemoveIndex !== -1) {
        const markerSprite = currentMarkers[markerToRemoveIndex].sprite;
        currentMarkers.splice(markerToRemoveIndex, 1);
        clearThreeObject(markerSprite);
      }
      // もし選択された星がなくなったら、色もリセット
      if (selectedStars.length === 0) {
        selectedConstellationColor = null;
      }
    }
    updatePolyline();
    updateStarCountDisplay();
    updateSaveButtonState();
  }

  // ---- ポリライン更新 ----
  function updatePolyline() {
    clearThreeObject(currentPolyline);
    if (selectedStars.length < 2) return;

    const pts = selectedStars.map(s => s.pos);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: selectedConstellationColor, linewidth: LINE_WIDTH, depthWrite: false });
    currentPolyline = new THREE.Line(geom, mat);
    scene.add(currentPolyline);
  }

  // ---- 星数表示の更新 ----
  function updateStarCountDisplay() {
    starCountDisplay.textContent = `Stars selected: ${selectedStars.length}`;
  }

  // ---- 保存ボタンの有効/無効状態の更新 ----
  function updateSaveButtonState() {
    saveConstellationBtn.disabled = selectedStars.length < 2 || constellationNameInput.value.trim() === '';
  }

  // ---- Constellationデータ構造 ----
  // { id: string, name: string, starIndices: number[], color: string }
  let savedConstellations = [];

  // ---- ローカルストレージから星座を読み込む ----
  function loadSavedConstellations() {
    const saved = localStorage.getItem('myConstellations');
    savedConstellations = saved ? JSON.parse(saved) : [];
    renderConstellationsList();
  }

  // ---- ローカルストレージに星座を保存する ----
  function saveConstellationsToLocalStorage() {
    localStorage.setItem('myConstellations', JSON.stringify(savedConstellations));
  }

  // ---- 自分の星座リストをHTMLにレンダリング ----
  function renderConstellationsList() {
    myConstellationsList.innerHTML = ''; // クリア

    if (savedConstellations.length === 0) {
      myConstellationsList.innerHTML = '<p style="color: #A0A0A0; font-size: 0.9em; text-align: center; margin-top: 20px;">No constellations saved yet.</p>';
      return;
    }

    savedConstellations.forEach(con => {
      const item = document.createElement('div');
      item.className = 'constellation-item';
      item.setAttribute('data-id', con.id);
      item.innerHTML = `<span>${con.name} (${con.starIndices.length} stars)</span><button class="delete-btn">Delete</button>`;
      
      item.onclick = (e) => {
        if (!e.target.classList.contains('delete-btn')) {
          displayConstellation(con.id);
          // リスト内の選択状態を更新
          Array.from(myConstellationsList.children).forEach(child => {
            child.classList.remove('selected');
          });
          item.classList.add('selected');
        }
      };

      item.querySelector('.delete-btn').onclick = (e) => {
        e.stopPropagation(); // 親要素のクリックイベントが発火しないようにする
        if (confirm(DELETE_CONFIRM_TEXT)) {
          deleteConstellation(con.id);
        }
      };
      myConstellationsList.appendChild(item);
    });
  }

  // ---- 星座保存処理 ----
  function saveCurrentConstellation() {
    const name = constellationNameInput.value.trim();
    if (selectedStars.length < 2 || name === '') {
      alert('Please select at least 2 stars and enter a constellation name.');
      return;
    }

    // 重複チェック
    if (savedConstellations.some(con => con.name.toLowerCase() === name.toLowerCase())) {
        alert('A constellation with this name already exists. Please choose a different name.');
        return;
    }

    const newConstellation = {
      id: `con_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`, // ユニークID
      name: name,
      starIndices: selectedStars.map(s => s.originalIndex),
      color: '#' + selectedConstellationColor.getHexString() // 色を保存
    };
    savedConstellations.push(newConstellation);
    saveConstellationsToLocalStorage();
    renderConstellationsList();

    // 成功フィードバック
    showTemporaryMessage(`'${name}' saved successfully! ✨`, 'success');
    
    // UIをリセット
    constellationNameInput.value = '';
    resetCurrentDrawing(); // 描画をクリア
    switchMode('explore'); // 保存後、Exploreモードに自動的に切り替え
    displayConstellation(newConstellation.id); // 保存した星座を自動表示
  }

  // ---- 星座削除処理 ----
  function deleteConstellation(id) {
    savedConstellations = savedConstellations.filter(con => con.id !== id);
    saveConstellationsToLocalStorage();
    renderConstellationsList();
    if (animatingConstellationId === id) { // 削除した星座が表示中ならクリア
      clearThreeObject(glowingPolyline);
      glowingPolyline = null;
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      animatingConstellationId = null;
      resetCurrentDrawing(); // 表示中のマーカーも消去
    }
  }

  // ---- 特定の星座を表示（発光アニメーション付き） ----
  function displayConstellation(id) {
    if (isAnimationInProgress()) {
        clearThreeObject(glowingPolyline);
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        animatingConstellationId = null;
    }

    const con = savedConstellations.find(c => c.id === id);
    if (!con) {
      console.warn('Constellation not found:', id);
      return;
    }

    // Explore Modeの場合、作成中の描画をクリア
    if (currentMode === 'explore') {
        resetCurrentDrawing(); // 以前表示されていた星座のマーカーと線もクリア
    }

    const conStars = con.starIndices.map(idx => {
      const starObj = STARS_DATA_WITH_INDEX[idx];
      if (!starObj) { console.warn("Star data not found for index:", idx); return null; }
      const ra  = (Number(starObj.ra)  || 0) * Math.PI/180;
      const dec = (Number(starObj.dec) || 0) * Math.PI/180;
      const x = RADIUS * Math.cos(dec) * Math.cos(ra);
      const y = RADIUS * Math.sin(dec);
      const z = RADIUS * Math.cos(dec) * Math.sin(ra);
      return { pos: new THREE.Vector3(x, y, z), originalIndex: idx, data: starObj };
    }).filter(Boolean); // nullを除去

    if (conStars.length < 2) {
      showTemporaryMessage(`Constellation '${con.name}' needs at least 2 stars to display a line.`, 'warning');
      return;
    }

    // まず全てのマーカーを生成
    conStars.forEach(s => {
      const color = new THREE.Color(con.color);
      const colorHex = con.color;
      const markerTexture = getMarkerTexture(colorHex);

      const mat = new THREE.SpriteMaterial({
        map: markerTexture,
        color: color,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending // 発光感
      });
      const sprite = new THREE.Sprite(mat);
      const scale = pixelToWorldScale(MARKER_PIXEL_SIZE, s.pos);
      sprite.scale.set(scale, scale, 1);
      sprite.position.copy(s.pos);
      scene.add(sprite);
      currentMarkers.push({ sprite, pos: s.pos.clone(), color: color.clone(), originalIndex: s.originalIndex });
    });

    // 発光アニメーション開始
    animationStartTime = performance.now();
    animatingConstellationId = id;
    animateGlowingLine(conStars, new THREE.Color(con.color));
    showTemporaryMessage(`Displaying '${con.name}' `, 'info');

    // リストの選択状態を更新
    Array.from(myConstellationsList.children).forEach(child => {
        if (child.getAttribute('data-id') === id) {
            child.classList.add('selected');
        } else {
            child.classList.remove('selected');
        }
    });
  }

  // ---- マーカーとラインの発光アニメーション (再利用) ----
  function animateGlowingLine(starsToAnimate, color) {
    if (starsToAnimate.length < 2) return;

    const totalLength = calculatePolylineLength(starsToAnimate);
    const segmentLengths = [];
    for (let i = 0; i < starsToAnimate.length - 1; i++) {
        segmentLengths.push(starsToAnimate[i].pos.distanceTo(starsToAnimate[i+1].pos));
    }

    const animate = (currentTime) => {
        if (!animationStartTime) animationStartTime = currentTime;
        const elapsed = currentTime - animationStartTime;
        const progress = Math.min(1, elapsed / GLOW_ANIM_DURATION);

        // 発光と消滅を組み合わせたプログレス
        // 例: progress 0 -> 1 で発光が移動し、progress 0.5 -> 1.5 で消滅するようなイメージ
        const glowStartFactor = progress * 1.5; // 移動速度
        const glowEndFactor = progress * 1.5 - 0.2; // 発光の長さ調整

        clearThreeObject(glowingPolyline); // 前のフレームの線をクリア

        const pts = [];
        let currentPathLengthRatio = 0;

        for (let i = 0; i < starsToAnimate.length - 1; i++) {
            const startStar = starsToAnimate[i];
            const endStar = starsToAnimate[i+1];
            const segmentLength = segmentLengths[i];
            const segmentRatio = segmentLength / totalLength;

            const segmentStartRatio = currentPathLengthRatio;
            const segmentEndRatio = currentPathLengthRatio + segmentRatio;

            // 現在のセグメントの発光開始/終了比率を計算
            const currentSegmentGlowStart = Math.max(0, (glowEndFactor - segmentStartRatio) / segmentRatio);
            const currentSegmentGlowEnd = Math.min(1, (glowStartFactor - segmentStartRatio) / segmentRatio);

            if (currentSegmentGlowStart < currentSegmentGlowEnd) {
                const p1 = new THREE.Vector3().lerpVectors(startStar.pos, endStar.pos, currentSegmentGlowStart);
                const p2 = new THREE.Vector3().lerpVectors(startStar.pos, endStar.pos, currentSegmentGlowEnd);
                pts.push(p1, p2);
            }
            currentPathLengthRatio += segmentRatio;
        }

        if (pts.length > 0) {
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({
                color: color,
                linewidth: LINE_WIDTH * 2,
                transparent: true,
                opacity: Math.max(0, 1 - progress * 0.8), // 徐々に透明になる
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            glowingPolyline = new THREE.LineSegments(geom, mat);
            scene.add(glowingPolyline);
        }

        // 全てのアニメーションが終了したら
        if (progress >= 1.0) {
            clearThreeObject(glowingPolyline);
            glowingPolyline = null;
            animatingConstellationId = null;
            // アニメーション完了時にExplore Modeで描画されたマーカーも消去
            if (currentMode === 'explore') {
                resetCurrentDrawing();
            }
        } else {
            animationFrameId = requestAnimationFrame(animate);
        }
    };
    animationFrameId = requestAnimationFrame(animate);
  }

  function calculatePolylineLength(stars) {
      let totalLength = 0;
      for (let i = 0; i < stars.length - 1; i++) {
          totalLength += stars[i].pos.distanceTo(stars[i+1].pos);
      }
      return totalLength;
  }

  function isAnimationInProgress() {
      return animationFrameId !== null;
  }

  // ---- 一時メッセージ表示関数 (成功/警告/情報) ----
  function showTemporaryMessage(message, type = 'info') {
      const existingMsg = document.getElementById('temp-message');
      if (existingMsg) existingMsg.remove();

      const msgDiv = document.createElement('div');
      msgDiv.id = 'temp-message';
      msgDiv.textContent = message;
      msgDiv.style.position = 'fixed';
      msgDiv.style.top = '50%';
      msgDiv.style.left = '50%';
      msgDiv.style.transform = 'translate(-50%, -50%)';
      msgDiv.style.padding = '15px 30px';
      msgDiv.style.borderRadius = '10px';
      msgDiv.style.fontWeight = 'bold';
      msgDiv.style.fontSize = '1.3em';
      msgDiv.style.zIndex = 10001;
      msgDiv.style.pointerEvents = 'none'; // クリックが透過するように
      msgDiv.style.opacity = 0; // 初期透明
      msgDiv.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      msgDiv.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4)';
      
      switch (type) {
          case 'success':
              msgDiv.style.backgroundColor = 'rgba(40, 180, 99, 0.85)'; // 緑
              msgDiv.style.color = '#E0F8E0';
              break;
          case 'warning':
              msgDiv.style.backgroundColor = 'rgba(255, 165, 0, 0.85)'; // オレンジ
              msgDiv.style.color = '#FFF8E0';
              break;
          case 'info':
          default:
              msgDiv.style.backgroundColor = 'rgba(60, 140, 255, 0.85)'; // 青
              msgDiv.style.color = '#E0F0FF';
              break;
      }

      document.body.appendChild(msgDiv);

      // フェードイン
      setTimeout(() => {
          msgDiv.style.opacity = 1;
          msgDiv.style.transform = 'translate(-50%, -50%) scale(1.05)';
      }, 50);

      // フェードアウト
      setTimeout(() => {
          msgDiv.style.opacity = 0;
          msgDiv.style.transform = 'translate(-50%, -50%) scale(0.95)';
          msgDiv.addEventListener('transitionend', () => msgDiv.remove(), { once: true });
      }, 2000); // 2秒後に消え始める
  }


  // ---- モード切り替え関数 ----
  function switchMode(mode) {
    if (currentMode === mode) return; // 同じモードなら何もしない

    currentMode = mode;

    // UIパネルの表示切り替え
    exploreModePanel.style.display = (mode === 'explore') ? 'block' : 'none';
    createModePanel.style.display = (mode === 'create') ? 'block' : 'none';

    // ボタンのアクティブ状態切り替え
    exploreModeBtn.classList.toggle('active-mode', mode === 'explore');
    createModeBtn.classList.toggle('active-mode', mode === 'create');

    // 作成中の描画をクリア
    if (mode === 'explore') {
        resetCurrentDrawing();
        clearThreeObject(glowingPolyline); // アニメーション中のものもクリア
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        animatingConstellationId = null;
        renderConstellationsList(); // Exploreモードでは保存済み星座リストを再レンダリング
    } else if (mode === 'create') {
        clearThreeObject(glowingPolyline); // アニメーション中のものもクリア
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        animatingConstellationId = null;
        // Createモードではリストの選択を解除
        Array.from(myConstellationsList.children).forEach(child => {
            child.classList.remove('selected');
        });
    }
  }

  // ---- イベントリスナー ----
  renderer.domElement.addEventListener('click', (ev) => {
    // UIパネル上のクリックはThree.jsのイベントを処理しない
    if (ev.target.closest('.ui-panel') || ev.target.closest('.back-button')) {
        return;
    }
    // アニメーション中はクリックを無視
    if (isAnimationInProgress()) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;

    let best = { dist2: Infinity, starData: null };

    for (const layer of layers) {
      const posArr = layer.positions;
      const dataArr = layer.data || [];
      if (!posArr || posArr.length === 0) continue;

      let idx = 0;
      for (let i = 0; i < posArr.length; i += 3, idx++) {
        const vx = posArr[i], vy = posArr[i+1], vz = posArr[i+2];
        const v = new THREE.Vector3(vx, vy, vz);
        v.project(camera);
        const sx = (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
        const sy = (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
        const dx = sx - mx, dy = sy - my;
        const d2 = dx*dx + dy*dy;
        if (d2 < best.dist2) {
          best.dist2 = d2;
          // FIX: ここで v.unproject(camera) ではなく、元の世界座標 (vx, vy, vz) を使用する
          best.starData = {
              originalIndex: dataArr[idx].originalIndex,
              worldPos: new THREE.Vector3(vx, vy, vz), // オリジナルの世界座標を渡す
              data: dataArr[idx]
          };
        }
      }
    }

    if (Math.sqrt(best.dist2) <= HIT_RADIUS_PX && best.starData && currentMode === 'create') {
      // Createモードでのみ星の選択・解除を処理
      toggleStarSelection(best.starData.originalIndex, best.starData.worldPos, best.starData.data);
    } else if (currentMode === 'explore') {
        // Exploreモードでは星のクリックで何かをしない（UIから星座を選ぶ）
        resetCurrentDrawing(); // 何もないところをクリックしたら表示中の星座をクリア
    }
  }, false);

  renderer.domElement.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (currentMode === 'create') {
        resetCurrentDrawing();
    } else if (currentMode === 'explore') {
        clearThreeObject(glowingPolyline);
        glowingPolyline = null;
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        animatingConstellationId = null;
        resetCurrentDrawing(); // 表示中のマーカーも消去
        // リストの選択を解除
        Array.from(myConstellationsList.children).forEach(child => {
            child.classList.remove('selected');
        });
    }
    return false;
  });

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && currentMode === 'create') {
        resetCurrentDrawing();
    }
  });

  // UIボタンのイベントリスナー
  exploreModeBtn.addEventListener('click', () => switchMode('explore'));
  createModeBtn.addEventListener('click', () => switchMode('create'));
  saveConstellationBtn.addEventListener('click', saveCurrentConstellation);
  clearAllBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to clear all selected stars?")) {
        resetCurrentDrawing();
    }
  });
  constellationNameInput.addEventListener('input', updateSaveButtonState);


  // ---- グローバル関数として公開: main.htmlのtickループから呼び出される ----
  window.updateMarkerScales = function() {
    if (currentMarkers.length > 0) {
      for (const m of currentMarkers) {
        const s = pixelToWorldScale(MARKER_PIXEL_SIZE, m.pos);
        m.sprite.scale.set(s, s, 1);
      }
    }
  };

  // Find & Collect モード関連のグローバル関数は削除

  // ---- 初期化処理 ----
  loadSavedConstellations();
  // 初期モードをExploreに設定
  switchMode('explore');

  console.log('stars_func.js loaded: Constellation Creator ready!');
  if (window.TWEEN) {
    function animateTween(time) {
        TWEEN.update(time);
        requestAnimationFrame(animateTween);
    }
    animateTween();
  } else {
    console.warn("TWEEN.js not found. Marker animations will not work.");
  }
  
})();