(function () {
  // GitHub リポジトリ（フィードバック送信先）
  const GITHUB_REPO = "itreat-wakamatsu/backlog-task";
  // GitHub fine-grained PAT（Issues: Read and write のみ）
  // 空のままではフィードバック送信できません。管理者が設定してください。
  // js/feedback-token.js（gitignore済み）で定義。未定義時はフォールバック動作。
  const GITHUB_TOKEN = (typeof GITHUB_FEEDBACK_TOKEN !== "undefined") ? GITHUB_FEEDBACK_TOKEN : "";

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

    if (!GITHUB_TOKEN) {
      // トークン未設定時はフォールバック（GitHub ページを開く）
      const title = encodeURIComponent(titleStr);
      const body = encodeURIComponent(bodyStr);
      chrome.tabs.create({
        url: `https://github.com/${GITHUB_REPO}/issues/new?title=${title}&body=${body}&labels=${encodeURIComponent(category)}`,
      });
      return;
    }

    setFeedbackState("sending");
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: titleStr,
          body: bodyStr,
          labels: [category],
        }),
      });
      if (res.ok) {
        setFeedbackState("success");
      } else {
        console.error("[BQA feedback] GitHub API error", res.status, await res.text());
        setFeedbackState("error");
      }
    } catch (err) {
      console.error("[BQA feedback] fetch error", err);
      setFeedbackState("error");
    }
  });
})();
