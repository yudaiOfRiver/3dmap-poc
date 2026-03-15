export function setupShareButton(): void {
  const btn = document.getElementById("share-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const url = window.location.href;

    // Web Share API（モバイル優先）
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch {
        // ユーザーがキャンセルした場合はフォールバック
      }
    }

    // クリップボードにコピー
    try {
      await navigator.clipboard.writeText(url);
      showToast("URLをコピーしました");
    } catch {
      // clipboard API 非対応の場合
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("URLをコピーしました");
    }
  });
}

function showToast(message: string) {
  const existing = document.querySelector(".share-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "share-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener("animationend", () => toast.remove());
}
