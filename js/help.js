(function () {
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
    openModal("feedbackModal");
  });
  document.getElementById("feedbackModalClose")?.addEventListener("click", () => closeModal("feedbackModal"));
  document.getElementById("feedbackModal")?.addEventListener("click", (e) => {
    if (e.target.id === "feedbackModal") closeModal("feedbackModal");
  });

  document.getElementById("feedbackSubmit")?.addEventListener("click", () => {
    const category = document.getElementById("feedbackCategory")?.value ?? "other";
    const text = (document.getElementById("feedbackText")?.value ?? "").trim();

    const labels = {
      bug: "バグ報告",
      enhancement: "機能要望",
      ux: "使いにくい点",
      other: "その他・質問",
    };
    const labelName = labels[category] ?? labels.other;
    const title = encodeURIComponent(`[${labelName}] `);
    const bodyLines = [text, "", "---", "_Backlog Quick Add フィードバックフォームより_"];
    const body = encodeURIComponent(bodyLines.join("\n"));
    const label = encodeURIComponent(category);

    chrome.tabs.create({
      url: `https://github.com/itreat-wakamatsu/backlog-task/issues/new?title=${title}&body=${body}&labels=${label}`,
    });
  });
})();
