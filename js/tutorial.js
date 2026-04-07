// チュートリアル管理
(function () {
  const STORAGE_KEY_DISMISSED = "tutorial_dismissed";
  const STORAGE_KEY_SEEN = "tutorial_seen";

  // チュートリアル定義
  const TUTORIALS = {
    basic: {
      id: "basic",
      title: "基本的な使い方",
      steps: [
        {
          target: null,
          title: "Backlog Quick Add へようこそ！",
          body: "このチュートリアルでは、タスク登録の基本的な使い方をステップごとにご案内します。\n\n実際の画面を見ながら操作を覚えましょう。",
          position: "center",
        },
        {
          target: "#project",
          title: "Step 1: プロジェクトを選択",
          body: "まず、タスクを登録するプロジェクトを選びます。\n\nドロップダウンから該当するプロジェクトを選択してください。",
          position: "bottom",
        },
        {
          target: "#issueType",
          title: "Step 2: 種別を選択",
          body: "プロジェクトを選ぶと、種別（タスク・バグなど）が表示されます。\n\n適切な種別を選択してください。",
          position: "bottom",
        },
        {
          target: "#title",
          title: "Step 3: 件名を入力",
          body: "タスクの件名を入力します。\n\n何をするのかが一目で分かるような簡潔なタイトルをつけましょう。",
          position: "bottom",
        },
        {
          target: ".editorCard",
          title: "Step 4: 詳細を入力",
          body: "タスクの詳細を記入します。Markdown記法が使えます。\n\nWebページでテキストを選択してから拡張機能を開くと、選択テキストが自動で挿入されます。",
          position: "bottom",
        },
        {
          target: "#assignee",
          title: "Step 5: 担当者を設定",
          body: "タスクの担当者を割り当てます。\n\nプロジェクトメンバーの中から選択できます。",
          position: "bottom",
        },
        {
          target: "#startDate",
          title: "Step 6: 日程を設定",
          body: "開始日と期日を設定できます。\n\nスケジュール管理に活用してください。",
          position: "top",
        },
        {
          target: "#aiSuggestBtn",
          title: "AI自動入力",
          body: "AI自動入力を使えば、選択テキストとページ情報から件名・詳細・担当者などを自動で入力できます。\n\n設定画面でAPIキーを登録すると利用できます。",
          position: "bottom",
        },
        {
          target: "#submit",
          title: "Step 7: 送信！",
          body: "すべて入力したら「送信」ボタンでBacklogにタスクが登録されます。\n\n「クリア」ボタンでフォームをリセットできます。",
          position: "top",
        },
        {
          target: null,
          title: "基本操作はこれで完了！",
          body: "お疲れさまでした！これでタスク登録の基本操作は完了です。\n\nいつでもヘッダーの「?」アイコンからチュートリアルを見返せます。",
          position: "center",
        },
      ],
    },
    backlog: {
      id: "backlog",
      title: "Backlog連携の設定",
      steps: [
        {
          target: null,
          title: "Backlog連携の設定",
          body: "このチュートリアルでは、Backlogとの連携設定方法をご案内します。\n\nAPIキーの取得から設定、データの取り込みまでをステップごとに説明します。",
          position: "center",
        },
        {
          target: "#settingsLink",
          title: "Step 1: 設定画面を開く",
          body: "まず「設定」リンクをクリックして設定画面を開きます。\n\nBacklog連携に必要な情報はここで管理します。",
          position: "bottom",
        },
        {
          target: null,
          title: "Step 2: APIキーを取得",
          body: "Backlogにログインし、「個人設定」→「API」でAPIキーを発行します。\n\n発行したキーをコピーしておいてください。",
          position: "center",
          illustration: "api-key",
        },
        {
          target: null,
          title: "Step 3: スペースIDとドメインを確認",
          body: "BacklogのURLからスペースIDを確認します。\n\n例：https://your-space.backlog.com の場合\n・スペースID: your-space\n・ドメイン: backlog.com",
          position: "center",
          illustration: "space-id",
        },
        {
          target: null,
          title: "Step 4: APIキーを入力して保存",
          body: "設定画面の「Backlog連携」セクションで以下を入力します：\n\n1. スペースID\n2. ドメインを選択\n3. APIキーを入力\n4. 「保存」をクリック\n\n接続確認が行われ、成功するとデータが取り込まれます。",
          position: "center",
        },
        {
          target: null,
          title: "Step 5: データの取り込み",
          body: "APIキーの保存に成功すると、プロジェクト・担当者・種別などの情報が自動的に取り込まれます。\n\nデータは6時間ごとに自動更新されますが、設定画面の「プロジェクト・担当者情報の更新」ボタンで手動更新もできます。",
          position: "center",
        },
        {
          target: null,
          title: "連携設定が完了しました！",
          body: "これでBacklogとの連携は完了です。\n\nプロジェクトや担当者がフォームのドロップダウンに表示されるようになります。\n\nいつでも「?」アイコンからこのチュートリアルを見返せます。",
          position: "center",
        },
      ],
    },
  };

  let currentTutorial = null;
  let currentStep = 0;
  let overlayEl = null;

  // --- UI生成 ---
  function createOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement("div");
    overlayEl.id = "tutorialOverlay";
    overlayEl.innerHTML = `
      <div class="tutorial-backdrop"></div>
      <div class="tutorial-spotlight"></div>
      <div class="tutorial-card">
        <div class="tutorial-card-header">
          <span class="tutorial-step-indicator"></span>
          <button class="tutorial-close-btn" title="閉じる">&times;</button>
        </div>
        <h3 class="tutorial-title"></h3>
        <div class="tutorial-body"></div>
        <div class="tutorial-illustration" hidden></div>
        <div class="tutorial-footer">
          <div class="tutorial-footer-left">
            <label class="tutorial-dismiss-label">
              <input type="checkbox" class="tutorial-dismiss-check" />
              今後表示しない
            </label>
          </div>
          <div class="tutorial-footer-right">
            <button class="tutorial-btn tutorial-btn-later">後にする</button>
            <button class="tutorial-btn tutorial-btn-prev" hidden>戻る</button>
            <button class="tutorial-btn tutorial-btn-next tutorial-btn-primary">次へ</button>
          </div>
        </div>
        <div class="tutorial-progress">
          <div class="tutorial-progress-bar"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    // イベントバインド
    overlayEl.querySelector(".tutorial-close-btn").addEventListener("click", closeTutorial);
    overlayEl.querySelector(".tutorial-btn-later").addEventListener("click", closeTutorial);
    overlayEl.querySelector(".tutorial-btn-prev").addEventListener("click", prevStep);
    overlayEl.querySelector(".tutorial-btn-next").addEventListener("click", nextStep);
    overlayEl.querySelector(".tutorial-backdrop").addEventListener("click", closeTutorial);

    return overlayEl;
  }

  function showStep() {
    if (!currentTutorial) return;
    const steps = currentTutorial.steps;
    const step = steps[currentStep];
    const overlay = createOverlay();

    // カード要素
    const card = overlay.querySelector(".tutorial-card");
    const indicator = overlay.querySelector(".tutorial-step-indicator");
    const title = overlay.querySelector(".tutorial-title");
    const body = overlay.querySelector(".tutorial-body");
    const illustration = overlay.querySelector(".tutorial-illustration");
    const prevBtn = overlay.querySelector(".tutorial-btn-prev");
    const nextBtn = overlay.querySelector(".tutorial-btn-next");
    const laterBtn = overlay.querySelector(".tutorial-btn-later");
    const progressBar = overlay.querySelector(".tutorial-progress-bar");
    const spotlight = overlay.querySelector(".tutorial-spotlight");
    const dismissCheck = overlay.querySelector(".tutorial-dismiss-check");

    // ステップ情報
    indicator.textContent = `${currentStep + 1} / ${steps.length}`;
    title.textContent = step.title;
    body.textContent = "";

    // bodyを改行で分割して表示
    step.body.split("\n").forEach((line, i) => {
      if (i > 0) body.appendChild(document.createElement("br"));
      body.appendChild(document.createTextNode(line));
    });

    // イラスト
    if (step.illustration) {
      illustration.hidden = false;
      illustration.innerHTML = getIllustration(step.illustration);
    } else {
      illustration.hidden = true;
      illustration.innerHTML = "";
    }

    // ボタン制御
    prevBtn.hidden = currentStep === 0;
    laterBtn.hidden = currentStep === steps.length - 1;
    const isLast = currentStep === steps.length - 1;
    nextBtn.textContent = isLast ? "完了" : "次へ";

    // dismiss チェックボックスのリセット
    dismissCheck.checked = false;

    // プログレスバー
    const progress = ((currentStep + 1) / steps.length) * 100;
    progressBar.style.width = progress + "%";

    // スポットライト
    if (step.target) {
      const targetEl = document.querySelector(step.target);
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const pad = 8;
        spotlight.style.display = "block";
        spotlight.style.top = rect.top - pad + "px";
        spotlight.style.left = rect.left - pad + "px";
        spotlight.style.width = rect.width + pad * 2 + "px";
        spotlight.style.height = rect.height + pad * 2 + "px";

        // カード位置計算
        positionCard(card, rect, step.position);

        // 対象要素をスクロールして見えるようにする
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        spotlight.style.display = "none";
        centerCard(card);
      }
    } else {
      spotlight.style.display = "none";
      centerCard(card);
    }

    // オーバーレイ表示
    overlay.classList.add("active");
  }

  function positionCard(card, targetRect, position) {
    card.style.position = "fixed";
    card.style.margin = "0";
    card.style.transform = "none";
    card.style.top = "auto";
    card.style.bottom = "auto";
    card.style.left = "auto";
    card.style.right = "auto";

    const cardWidth = 320;
    const gap = 16;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    // 左右中央に配置、ただしはみ出ないようにする
    let left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    left = Math.max(12, Math.min(left, viewW - cardWidth - 12));
    card.style.left = left + "px";
    card.style.width = cardWidth + "px";

    if (position === "bottom") {
      const top = targetRect.bottom + gap;
      if (top + 300 > viewH) {
        card.style.bottom = viewH - targetRect.top + gap + "px";
      } else {
        card.style.top = top + "px";
      }
    } else if (position === "top") {
      const bottom = viewH - targetRect.top + gap;
      if (bottom + 300 > viewH) {
        card.style.top = targetRect.bottom + gap + "px";
      } else {
        card.style.bottom = bottom + "px";
      }
    }
  }

  function centerCard(card) {
    card.style.position = "fixed";
    card.style.top = "50%";
    card.style.left = "50%";
    card.style.transform = "translate(-50%, -50%)";
    card.style.width = "340px";
    card.style.bottom = "auto";
    card.style.right = "auto";
    card.style.margin = "0";
  }

  function getIllustration(type) {
    if (type === "api-key") {
      return `
        <div class="tutorial-illust-box">
          <div class="tutorial-illust-path">
            <span class="tutorial-illust-icon">&#9881;</span>
            <span>個人設定</span>
            <span class="tutorial-illust-arrow">→</span>
            <span>API</span>
            <span class="tutorial-illust-arrow">→</span>
            <span class="tutorial-illust-highlight">登録</span>
          </div>
        </div>`;
    }
    if (type === "space-id") {
      return `
        <div class="tutorial-illust-box">
          <div class="tutorial-illust-url">
            <span>https://</span><span class="tutorial-illust-highlight">your-space</span><span>.backlog.com</span>
          </div>
        </div>`;
    }
    return "";
  }

  // --- ナビゲーション ---
  function nextStep() {
    if (!currentTutorial) return;
    if (currentStep >= currentTutorial.steps.length - 1) {
      // 完了
      markSeen(currentTutorial.id);
      const dismissCheck = overlayEl.querySelector(".tutorial-dismiss-check");
      if (dismissCheck && dismissCheck.checked) {
        markDismissed(currentTutorial.id);
      }
      closeTutorial();
      return;
    }
    currentStep++;
    showStep();
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      showStep();
    }
  }

  function closeTutorial() {
    if (overlayEl) {
      const dismissCheck = overlayEl.querySelector(".tutorial-dismiss-check");
      if (dismissCheck && dismissCheck.checked && currentTutorial) {
        markDismissed(currentTutorial.id);
      }
      overlayEl.classList.remove("active");
    }
    currentTutorial = null;
    currentStep = 0;
  }

  // --- ストレージ ---
  function markDismissed(tutorialId) {
    try {
      const dismissed = JSON.parse(localStorage.getItem(STORAGE_KEY_DISMISSED) || "{}");
      dismissed[tutorialId] = true;
      localStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(dismissed));
    } catch (e) {}
  }

  function isDismissed(tutorialId) {
    try {
      const dismissed = JSON.parse(localStorage.getItem(STORAGE_KEY_DISMISSED) || "{}");
      return !!dismissed[tutorialId];
    } catch (e) {
      return false;
    }
  }

  function markSeen(tutorialId) {
    try {
      const seen = JSON.parse(localStorage.getItem(STORAGE_KEY_SEEN) || "{}");
      seen[tutorialId] = true;
      localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify(seen));
    } catch (e) {}
  }

  function hasSeen(tutorialId) {
    try {
      const seen = JSON.parse(localStorage.getItem(STORAGE_KEY_SEEN) || "{}");
      return !!seen[tutorialId];
    } catch (e) {
      return false;
    }
  }

  // --- 公開API ---
  function startTutorial(tutorialId) {
    const tutorial = TUTORIALS[tutorialId];
    if (!tutorial) return;
    currentTutorial = tutorial;
    currentStep = 0;
    showStep();
  }

  function showTutorialMenu() {
    // メニューがすでに存在したら削除
    const existing = document.getElementById("tutorialMenu");
    if (existing) {
      existing.remove();
      return;
    }

    const menu = document.createElement("div");
    menu.id = "tutorialMenu";
    menu.className = "tutorial-menu";
    menu.innerHTML = `
      <div class="tutorial-menu-header">チュートリアル</div>
      <button class="tutorial-menu-item" data-tutorial="basic">
        <span class="tutorial-menu-icon">&#128221;</span>
        <span class="tutorial-menu-text">
          <span class="tutorial-menu-item-title">基本的な使い方</span>
          <span class="tutorial-menu-item-desc">タスク登録の流れを学ぶ</span>
        </span>
      </button>
      <button class="tutorial-menu-item" data-tutorial="backlog">
        <span class="tutorial-menu-icon">&#128279;</span>
        <span class="tutorial-menu-text">
          <span class="tutorial-menu-item-title">Backlog連携の設定</span>
          <span class="tutorial-menu-item-desc">APIキーの設定とデータ取り込み</span>
        </span>
      </button>
    `;

    // ヘルプボタンの近くに配置
    const helpBtn = document.getElementById("tutorialHelpBtn");
    if (helpBtn) {
      helpBtn.parentElement.appendChild(menu);
    } else {
      document.body.appendChild(menu);
    }

    // メニューアイテムクリック
    menu.querySelectorAll(".tutorial-menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tutorial;
        menu.remove();
        startTutorial(id);
      });
    });

    // 外側クリックで閉じる
    setTimeout(() => {
      document.addEventListener(
        "click",
        function handler(e) {
          if (!menu.contains(e.target) && e.target.id !== "tutorialHelpBtn") {
            menu.remove();
            document.removeEventListener("click", handler);
          }
        },
      );
    }, 10);
  }

  // --- 初期化 ---
  function initTutorial() {
    // ヘルプボタンをヘッダーに追加
    const header = document.querySelector("header");
    if (header) {
      const helpBtn = document.createElement("button");
      helpBtn.id = "tutorialHelpBtn";
      helpBtn.className = "tutorial-help-btn";
      helpBtn.title = "チュートリアル";
      helpBtn.textContent = "?";
      helpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showTutorialMenu();
      });

      // ヘッダー右上に配置するためのラッパー
      const wrapper = document.createElement("div");
      wrapper.className = "tutorial-help-wrapper";
      wrapper.appendChild(helpBtn);
      header.appendChild(wrapper);
    }

    // 初回アクセス時に自動表示（basicチュートリアル）
    if (!hasSeen("basic") && !isDismissed("basic")) {
      // メインフォームが表示された後に開始
      const observer = new MutationObserver(() => {
        const mainForm = document.getElementById("mainForm");
        if (mainForm && !mainForm.hidden) {
          observer.disconnect();
          setTimeout(() => startTutorial("basic"), 600);
        }
      });
      observer.observe(document.getElementById("contentArea") || document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ["hidden"],
      });
    }
  }

  // DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTutorial);
  } else {
    initTutorial();
  }

  // グローバル公開
  window.BQATutorial = {
    start: startTutorial,
    showMenu: showTutorialMenu,
  };
})();
