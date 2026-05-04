const REFRESH_FETCH_START_AGE_MS = 10 * 60_000;
const REFRESH_RETRY_INTERVAL_MS = 60_000;
const NODE_OFFLINE_AFTER_MS = 60 * 60_000;

const state = {
  data: null,
  selectedPeriodIndex: 0,
  statusFilter: "all",
  pollTimer: null,
};

const elements = {
  statusPanel: document.querySelector(".status-panel"),
  generatedAt: document.getElementById("generatedAt"),
  refreshInterval: document.getElementById("refreshInterval"),
  lidoWithdrawalQueueEth: document.getElementById("lidoWithdrawalQueueEth"),
  lidoBufferEth: document.getElementById("lidoBufferEth"),
  predictionCards: document.getElementById("predictionCards"),
  periodTabs: document.getElementById("periodTabs"),
  selectedPeriodLabel: document.getElementById("selectedPeriodLabel"),
  validatorCount: document.getElementById("validatorCount"),
  validatorList: document.getElementById("validatorList"),
  errorMessage: document.getElementById("errorMessage"),
};

async function loadPredictions() {
  try {
    state.data = await fetchPredictions();
    state.selectedPeriodIndex = 0;
    clearError();
    render();
    startPredictionPolling();
  } catch (error) {
    showError(error.message);
  }
}

async function refreshPredictions() {
  try {
    const nextData = await fetchPredictions();

    if (nextData.generated_at === state.data?.generated_at) {
      renderStatus(state.data);
      return;
    }

    state.data = nextData;
    clampSelectedPeriod();
    clearError();
    render();
  } catch (error) {
    console.warn("Failed to refresh predictions", error);
    renderStatus(state.data);
  } finally {
    scheduleNextPredictionRefresh();
  }
}

async function fetchPredictions() {
  const response = await fetch(`data/predictions.json?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not load predictions.json (${response.status})`);
  }

  return response.json();
}

function startPredictionPolling() {
  scheduleNextPredictionRefresh();
}

function scheduleNextPredictionRefresh() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
  }

  state.pollTimer = setTimeout(refreshPredictions, getNextRefreshDelayMs(state.data));
}

function getNextRefreshDelayMs(data, now = Date.now()) {
  const generatedAtMs = Date.parse(data?.generated_at || "");

  if (Number.isNaN(generatedAtMs)) {
    return REFRESH_RETRY_INTERVAL_MS;
  }

  const snapshotAgeMs = now - generatedAtMs;

  if (snapshotAgeMs < REFRESH_FETCH_START_AGE_MS) {
    return REFRESH_FETCH_START_AGE_MS - snapshotAgeMs;
  }

  return REFRESH_RETRY_INTERVAL_MS;
}

function clampSelectedPeriod() {
  const predictions = state.data?.predictions || [];
  state.selectedPeriodIndex = Math.min(
    state.selectedPeriodIndex,
    Math.max(predictions.length - 1, 0)
  );
}

function render() {
  const data = state.data;
  const predictions = data.predictions || [];

  renderStatus(data);
  elements.lidoWithdrawalQueueEth.textContent =
    data.lido_withdrawal_queue_eth == null
      ? "-"
      : `${formatEth(data.lido_withdrawal_queue_eth)} ETH`;
  elements.lidoBufferEth.textContent =
    data.lido_buffer_eth == null ? "-" : `${formatEth(data.lido_buffer_eth)} ETH`;

  renderPredictionCards(predictions);
  renderPeriodTabs(predictions);
  renderFilterCounts(predictions[state.selectedPeriodIndex]);
  renderValidators(predictions[state.selectedPeriodIndex]);
}

function renderStatus(data, now = Date.now()) {
  const nodeOffline = isNodeOffline(data, now);

  elements.statusPanel.classList.toggle("offline", nodeOffline);
  elements.generatedAt.textContent = formatDateTime(data?.generated_at);
  elements.refreshInterval.hidden = !nodeOffline;
  elements.refreshInterval.textContent = nodeOffline
    ? "Node is offline; waiting for a fresh snapshot."
    : "";
}

function isNodeOffline(data, now = Date.now()) {
  const generatedAtMs = Date.parse(data?.generated_at || "");

  return !Number.isNaN(generatedAtMs) && now - generatedAtMs > NODE_OFFLINE_AFTER_MS;
}

function renderPredictionCards(predictions) {
  elements.predictionCards.innerHTML = predictions
    .map(
      (prediction, index) => {
        const fullWithdrawalValidators = fullWithdrawalValidatorCount(prediction);
        const queuedExitValidators = queuedExitValidatorCount(prediction);
        const exitedValidators = exitedValidatorCount(prediction);

        return `
        <article class="prediction-card ${index === state.selectedPeriodIndex ? "selected" : ""}">
          <div class="prediction-date">
            ${escapeHtml(prediction.label || "-")}
            <span>${formatDayDistance(index + 1)}</span>
          </div>
          <div class="prediction-total">${formatEth(prediction.total_eth)} ETH</div>
          <div class="card-label">Total ETH</div>
          <div class="card-rows">
            <div class="card-row">
              <span class="exit-text">Exits</span>
              <strong>${formatEth(prediction.exits_eth)} ETH</strong>
            </div>
            <div class="card-row">
              <span class="reward-text">Rewards</span>
              <strong>${formatEth(prediction.rewards_eth)} ETH</strong>
            </div>
            <div class="card-row">
              <span>Validators</span>
              <strong>${formatInteger(prediction.validators)}</strong>
            </div>
            <div class="card-row">
              <span>Full Withdrawals</span>
              <strong>${formatInteger(fullWithdrawalValidators)}</strong>
            </div>
            <div class="card-row">
              <span>Already Exited</span>
              <strong>${formatInteger(exitedValidators)}</strong>
            </div>
            <div class="card-row">
              <span>Queued Exits</span>
              <strong>${formatInteger(queuedExitValidators)}</strong>
            </div>
          </div>
          <button class="tab-button card-action ${index === state.selectedPeriodIndex ? "active" : ""}"
            type="button"
            data-period-index="${index}">
            View validators
          </button>
        </article>
      `;
      }
    )
    .join("");

  elements.predictionCards.querySelectorAll("[data-period-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPeriodIndex = Number(button.dataset.periodIndex);
      render();
    });
  });
}

function fullWithdrawalValidatorCount(prediction) {
  return prediction.full_withdrawal_validators ?? prediction.exit_validators ?? 0;
}

function queuedExitValidatorCount(prediction) {
  return prediction.queued_exit_validators ?? 0;
}

function exitedValidatorCount(prediction) {
  if (prediction.exited_validators !== undefined && prediction.exited_validators !== null) {
    return prediction.exited_validators;
  }

  return Math.max(fullWithdrawalValidatorCount(prediction) - queuedExitValidatorCount(prediction), 0);
}

function renderPeriodTabs(predictions) {
  elements.periodTabs.innerHTML = predictions
    .map(
      (prediction, index) => `
        <button class="tab-button ${index === state.selectedPeriodIndex ? "active" : ""}"
          type="button"
          role="tab"
          data-period-index="${index}">
          ${escapeHtml(prediction.label || "-")}
        </button>
      `
    )
    .join("");

  elements.periodTabs.querySelectorAll("[data-period-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPeriodIndex = Number(button.dataset.periodIndex);
      render();
    });
  });
}

function renderValidators(prediction) {
  if (!prediction) {
    elements.selectedPeriodLabel.textContent = "No prediction periods available.";
    elements.validatorCount.textContent = "";
    elements.validatorList.innerHTML = `<div class="empty-state">No data published yet.</div>`;
    return;
  }

  const validators = prediction.exiting_validators || [];
  const filteredValidators =
    state.statusFilter === "all"
      ? validators
      : validators.filter((validator) => validator.status === state.statusFilter);

  elements.selectedPeriodLabel.textContent = `${prediction.label} period ending ${formatDateTime(
    prediction.target_datetime
  )}`;
  elements.validatorCount.textContent = `Showing ${filteredValidators.length} of ${validators.length} validators`;

  if (filteredValidators.length === 0) {
    elements.validatorList.innerHTML = `<div class="empty-state">No validators match this filter.</div>`;
    return;
  }

  elements.validatorList.innerHTML = filteredValidators.map(renderValidator).join("");
}

function renderFilterCounts(prediction) {
  const validators = prediction?.exiting_validators || [];
  const counts = validators.reduce(
    (acc, validator) => {
      acc.all += 1;
      acc[validator.status] = (acc[validator.status] || 0) + 1;
      return acc;
    },
    { all: 0 }
  );

  document.querySelectorAll(".filter-button").forEach((button) => {
    const filter = button.dataset.filter;
    const label = button.dataset.label || button.textContent;
    button.textContent = `${label} ${counts[filter] || 0}`;
  });
}

function renderValidator(validator) {
  const status = validator.status || "";

  return `
    <article class="validator-card">
      <div class="validator-top">
        <a class="validator-link"
          href="https://beaconcha.in/validator/${encodeURIComponent(validator.validator_index)}"
          target="_blank"
          rel="noopener noreferrer">
          Validator #${formatInteger(validator.validator_index)}
        </a>
        <span class="badge ${escapeHtml(status)}">${formatStatus(status)}</span>
      </div>
      <div class="validator-fields">
        <div>
          <div class="field-label">Balance</div>
          <div class="field-value">${formatEth(validator.balance_eth)} ETH</div>
        </div>
        <div>
          <div class="field-label">Effective Balance</div>
          <div class="field-value">${formatEth(validator.effective_balance_eth)} ETH</div>
        </div>
        <div>
          <div class="field-label">Withdrawable Epoch</div>
          <div class="field-value">${formatInteger(validator.withdrawable_epoch)}</div>
        </div>
      </div>
    </article>
  `;
}

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.statusFilter = button.dataset.filter;
    render();
  });
});

function formatDateTime(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDayDistance(day) {
  return day === 1 ? "1 day" : `${day} days`;
}

function formatEth(value) {
  const number = Number(value || 0);
  const decimals = number > 10 ? 0 : 4;

  return number.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatInteger(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("en", { maximumFractionDigits: 0 });
}

function formatStatus(status) {
  return escapeHtml(status.replaceAll("_", " ").toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(message) {
  elements.generatedAt.textContent = "Unavailable";
  elements.errorMessage.hidden = false;
  elements.errorMessage.textContent = message;
}

function clearError() {
  elements.errorMessage.hidden = true;
  elements.errorMessage.textContent = "";
}

loadPredictions();
