// src/popup/popup.ts
// Vanilla TS popup controller. No framework.
// [MULTILINGUAL] All strings via t(). No hardcoded English literals.

import { t } from "../shared/i18n.js";
import { MSG_GET_RESULT } from "../shared/types.js";
import type { SWResponse } from "../shared/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const elem = document.getElementById(id);
  if (!elem) throw new Error(`[LexLens popup] Missing element #${id}`);
  return elem as T;
}

function showOnly(viewId: string): void {
  const views = document.querySelectorAll<HTMLElement>(".view");
  views.forEach((v) => {
    v.hidden = v.id !== viewId;
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderIdle(): void {
  el("idle-message").textContent = t("popupIdle");
  showOnly("view-idle");
}

function renderLoading(): void {
  el("loading-message").textContent = t("popupLoading");
  el("spinner").setAttribute("aria-label", t("popupLoading"));
  showOnly("view-loading");
}

function renderResult(result: SWResponse["result"]): void {
  if (!result) return renderIdle();

  // Score bar: map -1..+1 to 0%..100%
  const pct = Math.round(((result.score + 1) / 2) * 100);
  el("score-indicator").style.left = `${pct}%`;

  el("score-label").textContent = t("resultScoreLabel");
  el("axis-left").textContent = t("resultScoreLeft");
  el("axis-center").textContent = t("resultScoreCenter");
  el("axis-right").textContent = t("resultScoreRight");

  // Screen-reader description includes text label, not just position.
  const direction = result.score < -0.1 ? t("resultScoreLeft")
    : result.score > 0.1 ? t("resultScoreRight")
    : t("resultScoreCenter");
  el("score-description").textContent = `${t("resultScoreLabel")}: ${direction} (${result.score.toFixed(2)})`;

  el("confidence-label").textContent = t("resultConfidenceLabel", String(result.confidence));
  el("uncertainty-label").textContent = t(
    "resultUncertaintyLabel",
    [result.uncertaintyRange[0].toFixed(2), result.uncertaintyRange[1].toFixed(2)]
  );

  // Methodology disclaimer — always visible.
  el("disclaimer-prefix").textContent = t("methodologyDisclaimerPrefix") + " ";
  const link = el<HTMLAnchorElement>("methodology-link");
  link.textContent = t("methodologyLinkText");
  link.href = result.methodologyUrl;

  showOnly("view-result");
}

function renderError(errorKey: string): void {
  el("error-message").textContent = t(errorKey);
  showOnly("view-error");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Set static i18n strings immediately.
document.getElementById("extension-title")!.textContent = t("extensionName");

// Request the current result from the service worker.
chrome.runtime.sendMessage({ type: MSG_GET_RESULT }, (response: SWResponse) => {
  if (chrome.runtime.lastError) {
    renderError("errorUnavailable");
    return;
  }

  switch (response.status) {
    case "idle":
      renderIdle();
      break;
    case "loading":
      renderLoading();
      // Listen for the result via storage change.
      listenForStorageResult();
      break;
    case "result":
      renderResult(response.result);
      break;
    case "error_network":
      renderError("errorNetwork");
      break;
    case "error_unsupported":
      renderError("errorUnsupported");
      break;
    case "error_unavailable":
    default:
      renderError("errorUnavailable");
      break;
  }
});

/**
 * When the SW returns "loading", listen to chrome.storage.onChanged
 * for the cache key (or error sentinel) to be written, then re-render.
 */
function listenForStorageResult(): void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ) => {
    if (area !== "local") return;

    // Error sentinel written by the SW when fetchAnalysis returns null.
    const errorEntry = Object.values(changes).find(
      (c) =>
        c.newValue !== undefined &&
        typeof c.newValue === "object" &&
        c.newValue !== null &&
        (c.newValue as { error?: boolean }).error === true
    );
    if (errorEntry) {
      chrome.storage.onChanged.removeListener(listener);
      const errorKey = (errorEntry.newValue as { errorKey?: string }).errorKey ?? "errorUnavailable";
      renderError(errorKey);
      return;
    }

    // Normal cached result written by the SW on success.
    const cacheEntry = Object.values(changes).find(
      (c) => c.newValue !== undefined && typeof c.newValue === "object" && "score" in c.newValue
    );
    if (!cacheEntry) return;
    chrome.storage.onChanged.removeListener(listener);
    renderResult(cacheEntry.newValue as SWResponse["result"]);
  };
  chrome.storage.onChanged.addListener(listener);
}
