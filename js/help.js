(function () {
  // Google Apps Script のデプロイURL（プロキシ経由でGitHub Issueを作成）
  // 設定手順は docs/feedback-proxy-setup.md を参照
  const APPS_SCRIPT_URL = "";

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  // ヘルプ モーダル
  document.getElementById("helpBtn")?.addEventListener("click", () => openModal("helpModal"));
  document.getElementById("helpModalClose")?.addEventListener("click", () => closeModal("helpModal"));
  document.getElementById("helpModal")?.addEventListener("click", (e) => {
    if (e.target.id === "helpModal") closeModal("helpModal");
  });

  // ヘルプ内の外部リンク（data-url 属性で URL を保持）
  document.querySelectorAll(".bqa-ext-link[data-url]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: el.dataset.url });
    });
  });

  // フィードバック モーダル
  document.getElementById("feedbackLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    // フォームをリセット
    const catEl = document.getElementById("feedbackCategory");
    const txtEl = document.getElementById("feedbackText");
    if (catEl) catEl.value = "bug";
    if (txtEl) txtEl.value = "";
    setFeedbackState("idle");
    openModal("feedbackModal");
  });
  document.getElementById("feedbackModalClose")?.addEventListener("click", () => closeModal("feedbackModal"));
  document.getElementById("feedbackModal")?.addEventListener("click", (e) => {
    if (e.target.id === "feedbackModal") closeModal("feedbackModal");
  });

  function setFeedbackState(state) {
    const submitBtn = document.getElementById("feedbackSubmit");
    const statusEl = document.getElementById("feedbackStatus");
    if (!submitBtn) return;
    if (state === "sending") {
      submitBtn.disabled = true;
      submitBtn.textContent = "送信中…";
      if (statusEl) { statusEl.textContent = ""; statusEl.hidden = true; }
    } else if (state === "success") {
      submitBtn.disabled = false;
      submitBtn.textContent = "送信する";
      if (statusEl) {
        statusEl.textContent = "送信しました。ご協力ありがとうございます！";
        statusEl.dataset.ok = "1";
        statusEl.hidden = false;
      }
    } else if (state === "error") {
      submitBtn.disabled = false;
      submitBtn.textContent = "送信する";
      if (statusEl) {
        statusEl.textContent = "送信に失敗しました。もう一度お試しください。";
        statusEl.dataset.ok = "0";
        statusEl.hidden = false;
      }
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = "送信する";
      if (statusEl) { statusEl.textContent = ""; statusEl.hidden = true; }
    }
  }

  document.getElementById("feedbackSubmit")?.addEventListener("click", async () => {
    const category = document.getElementById("feedbackCategory")?.value ?? "other";
    const text = (document.getElementById("feedbackText")?.value ?? "").trim();

    const labels = {
      bug: "バグ報告",
      enhancement: "機能要望",
      ux: "使いにくい点",
      other: "その他・質問",
    };
    const labelName = labels[category] ?? labels.other;
    const titleStr = `[${labelName}] ${text.split("\n")[0].slice(0, 60)}`;
    const bodyStr = [text, "", "---", "_Backlog Quick Add フィードバックフォームより_"].join("\n");

    if (!APPS_SCRIPT_URL) {
      setFeedbackState("error");
      const statusEl = document.getElementById("feedbackStatus");
      if (statusEl) {
        statusEl.textContent = "フィードバック機能は現在設定中です。しばらくお待ちください。";
        statusEl.dataset.ok = "0";
        statusEl.hidden = false;
      }
      return;
    }

    setFeedbackState("sending");
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleStr, body: bodyStr, label: category }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setFeedbackState("success");
      } else {
        console.error("[BQA feedback] proxy error", json);
        setFeedbackState("error");
      }
    } catch (err) {
      console.error("[BQA feedback] fetch error", err);
      setFeedbackState("error");
    }
  });
})();
