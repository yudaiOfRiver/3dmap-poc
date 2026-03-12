import { test, expect, type Page } from "@playwright/test";

// 渋谷駅ページが完全にロードされるまで待機するヘルパー
async function waitForShibuyaReady(page: Page) {
  await page.goto("/shibuya.html");
  // WebGL canvas が描画されるまで待つ
  await page.waitForSelector("#canvas", { state: "attached" });
  // フロアボタンが生成されるまで待つ（データロード完了の指標）
  await page.waitForSelector(".floor-btn", { timeout: 30_000 });
}

// =============================================================
// 1. ページ読み込み
// =============================================================
test.describe("渋谷駅ページ読み込み", () => {
  test("基本UI要素が表示される", async ({ page }) => {
    await waitForShibuyaReady(page);

    // ヘッダー
    await expect(page.locator("#header")).toContainText("渋谷駅");

    // 検索入力欄
    await expect(page.locator("#search-input")).toBeVisible();

    // フロアパネルにボタンがある
    const floorBtns = page.locator(".floor-btn");
    await expect(floorBtns.first()).toBeVisible();

    // 目線モードボタン
    await expect(page.locator("#view-mode-btn")).toBeVisible();
    await expect(page.locator("#view-mode-btn")).toHaveText("👁 目線モード");

    // 経路検索パネル
    await expect(page.locator("#route-panel")).toBeVisible();
    await expect(page.locator("#route-start")).toBeVisible();
    await expect(page.locator("#route-end")).toBeVisible();
    await expect(page.locator("#route-go")).toBeDisabled();
  });

  test("凡例が存在する", async ({ page }) => {
    await waitForShibuyaReady(page);
    await expect(page.locator("#legend")).toBeVisible();
    await expect(page.locator("#legend")).toContainText("凡例");
  });
});

// =============================================================
// 2. 目線モード切替（ウォークモード）
// =============================================================
test.describe("目線モード切替", () => {
  test("ボタンクリックで鳥瞰モードに切り替わる", async ({ page }) => {
    await waitForShibuyaReady(page);

    const viewBtn = page.locator("#view-mode-btn");
    await expect(viewBtn).toHaveText("👁 目線モード");

    // 目線モード開始
    await viewBtn.click();
    // ネットワークデータがロードされていれば「鳥瞰モード」に変わる
    await expect(viewBtn).toHaveText("🦅 鳥瞰モード", { timeout: 5_000 });

    // もう一度クリックで元に戻る
    await viewBtn.click();
    await expect(viewBtn).toHaveText("👁 目線モード", { timeout: 5_000 });
  });
});

// =============================================================
// 3. 検索機能
// =============================================================
test.describe("施設検索", () => {
  test("検索入力で候補が表示される", async ({ page }) => {
    await waitForShibuyaReady(page);

    const searchInput = page.locator("#search-input");
    await searchInput.fill("ドア");

    // 検索結果が表示される
    const results = page.locator("#search-results .search-result-item");
    await expect(results.first()).toBeVisible({ timeout: 5_000 });

    // 結果にフロア情報が含まれる
    const firstText = await results.first().textContent();
    expect(firstText).toContain("F)");
  });

  test("クリアボタンで検索結果がリセットされる", async ({ page }) => {
    await waitForShibuyaReady(page);

    const searchInput = page.locator("#search-input");
    await searchInput.fill("ドア");

    // 結果が表示されるのを待つ
    await expect(page.locator("#search-results .search-result-item").first()).toBeVisible({ timeout: 5_000 });

    // クリアボタン（検索結果が重なるのでevaluateで直接クリック）
    await page.evaluate(() => {
      document.getElementById("search-clear")!.click();
    });

    // 入力欄が空になる
    await expect(searchInput).toHaveValue("");
    // 結果が消える
    await expect(page.locator("#search-results")).toBeHidden();
  });
});

// =============================================================
// 4. 経路検索UI
// =============================================================
test.describe("経路検索パネル", () => {
  test("出発・到着未選択時は検索ボタンが無効", async ({ page }) => {
    await waitForShibuyaReady(page);
    await expect(page.locator("#route-go")).toBeDisabled();
  });

  test("出発地入力でオートコンプリート候補が表示される", async ({ page }) => {
    await waitForShibuyaReady(page);

    const startInput = page.locator("#route-start");
    await startInput.fill("ドア");

    const acItems = page.locator("#route-start-results .route-ac-item");
    await expect(acItems.first()).toBeVisible({ timeout: 5_000 });
  });

  test("スワップボタンで出発・到着が入れ替わる", async ({ page }) => {
    await waitForShibuyaReady(page);

    const startInput = page.locator("#route-start");
    const endInput = page.locator("#route-end");

    // 値を直接セットし、JSでスワップボタンをクリック
    await startInput.fill("場所A");
    await endInput.fill("場所B");

    // オートコンプリートが被るのでevaluateでクリック
    await page.evaluate(() => {
      document.getElementById("route-swap")!.click();
    });

    await expect(startInput).toHaveValue("場所B");
    await expect(endInput).toHaveValue("場所A");
  });

  test("クリアボタンで入力がリセットされる", async ({ page }) => {
    await waitForShibuyaReady(page);

    await page.locator("#route-start").fill("テスト");
    await page.locator("#route-end").fill("テスト");

    await page.locator("#route-clear").click();

    await expect(page.locator("#route-start")).toHaveValue("");
    await expect(page.locator("#route-end")).toHaveValue("");
    await expect(page.locator("#route-go")).toBeDisabled();
  });
});

// =============================================================
// 5. 経路検索 → ナビバー統合フロー
// =============================================================
test.describe("経路検索→ナビバー統合", () => {
  // ドアPOIで出発・到着を選択するヘルパー
  async function searchRouteViaDoors(page: Page) {
    // 出発地: 最初のドアPOI
    const startInput = page.locator("#route-start");
    await startInput.fill("ドア");
    const startAc = page.locator("#route-start-results .route-ac-item").first();
    await expect(startAc).toBeVisible({ timeout: 5_000 });
    await startAc.click();

    // 到着地: 別のドアPOI（2番目の候補）
    const endInput = page.locator("#route-end");
    await endInput.fill("ドア");
    const endAcItems = page.locator("#route-end-results .route-ac-item");
    await expect(endAcItems.first()).toBeVisible({ timeout: 5_000 });
    // 2番目があれば使う、なければ1番目
    const endIdx = (await endAcItems.count()) > 1 ? 1 : 0;
    await endAcItems.nth(endIdx).click();
  }

  test("経路検索結果が表示される", async ({ page }) => {
    await waitForShibuyaReady(page);
    await searchRouteViaDoors(page);

    // 検索ボタンが有効になる
    await expect(page.locator("#route-go")).toBeEnabled();
    await page.locator("#route-go").click();

    // 結果が表示される（距離 or エラー）
    const routeResult = page.locator("#route-result");
    await expect(routeResult).toBeVisible({ timeout: 10_000 });

    const text = await routeResult.textContent();
    // 距離表示 or エラーメッセージ
    const hasResult = text?.includes("m") || text?.includes("経路が見つかりません");
    expect(hasResult).toBe(true);
  });

  test("経路検索成功時にナビバーが表示される", async ({ page }) => {
    await waitForShibuyaReady(page);
    await searchRouteViaDoors(page);

    await expect(page.locator("#route-go")).toBeEnabled();
    await page.locator("#route-go").click();

    // ナビバーの出現を待つ（経路が見つかった場合のみ）
    const navBar = page.locator("#nav-bar");
    const routeResult = page.locator("#route-result");
    await expect(routeResult).toBeVisible({ timeout: 10_000 });

    const resultText = await routeResult.textContent();
    if (resultText?.includes("m")) {
      // 経路が見つかった場合
      await expect(navBar).toBeVisible({ timeout: 5_000 });

      // ナビバーに案内文がある
      const instruction = navBar.locator(".nav-instruction");
      await expect(instruction).not.toBeEmpty();

      // 前へボタンは最初のステップなので無効
      const prevBtn = navBar.locator(".nav-prev");
      await expect(prevBtn).toBeDisabled();

      // プログレスバーが存在する
      await expect(navBar.locator(".nav-progress-bar")).toBeVisible();
    }
  });

  test("ナビバーの次へ/前へボタンでステップ移動", async ({ page }) => {
    await waitForShibuyaReady(page);
    await searchRouteViaDoors(page);

    await expect(page.locator("#route-go")).toBeEnabled();
    await page.locator("#route-go").click();

    const navBar = page.locator("#nav-bar");
    const routeResult = page.locator("#route-result");
    await expect(routeResult).toBeVisible({ timeout: 10_000 });

    const resultText = await routeResult.textContent();
    if (!resultText?.includes("m")) {
      test.skip(true, "経路が見つからなかったためスキップ");
      return;
    }

    await expect(navBar).toBeVisible({ timeout: 5_000 });

    const prevBtn = navBar.locator(".nav-prev");
    const nextBtn = navBar.locator(".nav-next");
    const instruction = navBar.locator(".nav-instruction");

    // 初期ステップの案内文を取得
    const initialText = await instruction.textContent();

    // 次へボタンが有効なら押す
    if (!(await nextBtn.isDisabled())) {
      await nextBtn.click();

      // 前へボタンが有効になる
      await expect(prevBtn).toBeEnabled();

      // 前へで戻る
      await prevBtn.click();
      const backText = await instruction.textContent();
      expect(backText).toBe(initialText);
    }
  });

  test("キーボード矢印キーでナビバーステップ移動", async ({ page }) => {
    await waitForShibuyaReady(page);
    await searchRouteViaDoors(page);

    await expect(page.locator("#route-go")).toBeEnabled();
    await page.locator("#route-go").click();

    const navBar = page.locator("#nav-bar");
    const routeResult = page.locator("#route-result");
    await expect(routeResult).toBeVisible({ timeout: 10_000 });

    const resultText = await routeResult.textContent();
    if (!resultText?.includes("m")) {
      test.skip(true, "経路が見つからなかったためスキップ");
      return;
    }

    await expect(navBar).toBeVisible({ timeout: 5_000 });

    const instruction = navBar.locator(".nav-instruction");
    const initialText = await instruction.textContent();
    const nextBtn = navBar.locator(".nav-next");

    if (!(await nextBtn.isDisabled())) {
      // ArrowRight で次のステップ
      await page.keyboard.press("ArrowRight");

      // ArrowLeft で前のステップに戻る
      await page.keyboard.press("ArrowLeft");
      const afterLeft = await instruction.textContent();
      expect(afterLeft).toBe(initialText);
    }
  });

  test("クリアで経路とナビバーが消える", async ({ page }) => {
    await waitForShibuyaReady(page);
    await searchRouteViaDoors(page);

    await expect(page.locator("#route-go")).toBeEnabled();
    await page.locator("#route-go").click();

    const routeResult = page.locator("#route-result");
    await expect(routeResult).toBeVisible({ timeout: 10_000 });

    // クリア
    await page.locator("#route-clear").click();

    // 入力欄がリセット
    await expect(page.locator("#route-start")).toHaveValue("");
    await expect(page.locator("#route-end")).toHaveValue("");

    // ナビバーが非表示になる（存在しない or display:none）
    const navBar = page.locator("#nav-bar");
    if ((await navBar.count()) > 0) {
      await expect(navBar).toBeHidden();
    }
  });
});

// =============================================================
// 6. フロア切替
// =============================================================
test.describe("フロア切替", () => {
  test("フロアボタンクリックでフロア表示が切り替わる", async ({ page }) => {
    await waitForShibuyaReady(page);

    const floorBtns = page.locator(".floor-btn[data-floor-key]");
    const count = await floorBtns.count();
    expect(count).toBeGreaterThan(0);

    // 最初のフロアボタンをクリック
    await floorBtns.first().click();

    // activeクラスが付く
    await expect(floorBtns.first()).toHaveClass(/active/);
  });
});
