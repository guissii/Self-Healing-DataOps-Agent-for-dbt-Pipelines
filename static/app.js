let selectedScenarioId = null;
let currentErrorLog = "";
let eventSource = null;

// DOM Elements
const statusBadge = document.getElementById("pipeline-status-badge");
const branchText = document.getElementById("current-branch-text");
const columnsContainer = document.getElementById("columns-container");
const scenariosList = document.getElementById("scenarios-list");
const btnResetEnv = document.getElementById("btn-reset-env");
const btnTriggerSabotage = document.getElementById("btn-trigger-sabotage");
const errorCard = document.getElementById("error-card");
const errorLogContent = document.getElementById("error-log-content");
const btnStartAgent = document.getElementById("btn-start-agent");
const terminalFeed = document.getElementById("terminal-feed");
const agentSpinner = document.getElementById("agent-spinner");
const hitlGate = document.getElementById("hitl-gate");
const hitlBranchName = document.getElementById("hitl-branch-name");
const diffContent = document.getElementById("diff-content");
const btnApproveMerge = document.getElementById("btn-approve-merge");
const btnRejectFix = document.getElementById("btn-reject-fix");

// Helper: Set Pipeline Status Badge
function setStatus(type, text) {
  statusBadge.className = `status-badge status-${type}`;
  statusBadge.querySelector(".status-text").textContent = text;
}

// Fetch and render initial status
async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    
    branchText.textContent = data.branch;
    renderColumns(data.columns);

    if (data.is_fix_pending) {
      setStatus("review", "Validation Humaine Requise");
      showHitlGate(data.branch, data.diff);
    } else {
      setStatus("healthy", "Pipeline Opérationnel");
      hitlGate.classList.add("hidden");
    }
  } catch (err) {
    console.error("Failed to load status:", err);
  }
}

// Render DB columns chips
function renderColumns(columns) {
  columnsContainer.innerHTML = "";
  if (!columns || columns.length === 0) {
    columnsContainer.innerHTML = '<span class="column-chip">Aucune colonne détectée</span>';
    return;
  }
  columns.forEach(col => {
    const chip = document.createElement("span");
    chip.className = "column-chip";
    chip.innerHTML = `${col.name} <small>${col.type}</small>`;
    columnsContainer.appendChild(chip);
  });
}

// Fetch and render Scenarios
async function loadScenarios() {
  try {
    const res = await fetch("/api/scenarios");
    const scenarios = await res.json();
    
    scenariosList.innerHTML = "";
    scenarios.forEach((sc, index) => {
      const item = document.createElement("div");
      item.className = `scenario-item ${index === 0 ? "selected" : ""}`;
      item.dataset.id = sc.id;
      item.innerHTML = `
        <div class="scenario-top">
          <span class="scenario-name">${sc.title}</span>
          <span class="scenario-level" style="background:${sc.level_color}22; color:${sc.level_color}; border: 1px solid ${sc.level_color}44">${sc.level}</span>
        </div>
        <p class="scenario-desc">${sc.description}</p>
      `;

      item.addEventListener("click", () => {
        document.querySelectorAll(".scenario-item").forEach(el => el.classList.remove("selected"));
        item.classList.add("selected");
        selectedScenarioId = sc.id;
      });

      scenariosList.appendChild(item);
    });

    if (scenarios.length > 0) {
      selectedScenarioId = scenarios[0].id;
    }
  } catch (err) {
    console.error("Failed to load scenarios:", err);
  }
}

// Reset Environment
btnResetEnv.addEventListener("click", async () => {
  btnResetEnv.disabled = true;
  btnResetEnv.innerHTML = `<span class="spin"></span> Resetting...`;
  
  try {
    const res = await fetch("/api/reset", { method: "POST" });
    const data = await res.json();
    
    errorCard.classList.add("hidden");
    hitlGate.classList.add("hidden");
    setStatus("healthy", "Pipeline Opérationnel");
    
    terminalFeed.innerHTML = `
      <div class="feed-item feed-done">
        ✓ <strong>Environnement réinitialisé avec succès :</strong><br>
        Base PostgreSQL restaurée, 5 commandes générées, tests dbt 100% PASS.
      </div>
    `;
    await loadStatus();
  } catch (err) {
    alert("Erreur lors de la réinitialisation : " + err.message);
  } finally {
    btnResetEnv.disabled = false;
    btnResetEnv.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      Reset Baseline
    `;
  }
});

// Trigger Sabotage
btnTriggerSabotage.addEventListener("click", async () => {
  if (!selectedScenarioId) return;

  btnTriggerSabotage.disabled = true;
  btnTriggerSabotage.innerHTML = `<span class="spin"></span> Sabotage en cours...`;

  try {
    const res = await fetch(`/api/sabotage/${selectedScenarioId}`, { method: "POST" });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errData.detail || "Erreur serveur lors du sabotage");
    }
    const data = await res.json();

    setStatus("broken", "Pipeline Crashé (Schema Drift)");
    renderColumns(data.columns);

    currentErrorLog = data.error_log;
    errorLogContent.textContent = data.error_log;
    errorCard.classList.remove("hidden");
    hitlGate.classList.add("hidden");

    terminalFeed.innerHTML += `
      <div class="feed-item" style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; color: #fca5a5;">
        💥 <strong>Panne déclenchée :</strong> ${data.scenario.title}<br>
        <small style="font-family: var(--font-mono); color: #f87171;">${data.scenario.sql}</small>
      </div>
    `;
    terminalFeed.scrollTop = terminalFeed.scrollHeight;

  } catch (err) {
    alert("Erreur lors du sabotage : " + err.message);
  } finally {
    btnTriggerSabotage.disabled = false;
    btnTriggerSabotage.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      Déclencher la Panne
    `;
  }
});

// Start AI Agent (SSE Stream)
btnStartAgent.addEventListener("click", () => {
  if (eventSource) {
    eventSource.close();
  }

  btnStartAgent.disabled = true;
  agentSpinner.classList.remove("hidden");
  setStatus("healing", "IA en cours de réparation...");

  terminalFeed.innerHTML = "";
  
  const encodedError = encodeURIComponent(currentErrorLog || "Schema Drift Error");
  eventSource = new EventSource(`/api/stream-agent?error_msg=${encodedError}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleAgentEvent(data);
    } catch (err) {
      console.error("Error parsing SSE event:", err);
    }
  };

  eventSource.onerror = (err) => {
    console.error("EventSource error:", err);
    agentSpinner.classList.add("hidden");
    btnStartAgent.disabled = false;
    if (eventSource) eventSource.close();
  };
});

// Handle incoming ReAct agent events
function handleAgentEvent(data) {
  const item = document.createElement("div");

  if (data.type === "start") {
    item.className = "feed-item";
    item.style.color = "#94a3b8";
    item.innerHTML = `🤖 <em>${data.message}</em>`;
  } else if (data.type === "reasoning") {
    item.className = "feed-item feed-reasoning";
    item.innerHTML = `<strong>🧠 Raisonnement de l'agent :</strong><br>${escapeHtml(data.content)}`;
  } else if (data.type === "tool_call") {
    item.className = "feed-item feed-tool-call";
    item.innerHTML = `<strong>👉 Appel d'outil :</strong> <code>${data.name}</code><br><small style="color: #67e8f9;">Paramètres: ${escapeHtml(JSON.stringify(data.args))}</small>`;
  } else if (data.type === "tool_output") {
    item.className = "feed-item feed-tool-output";
    item.innerHTML = `<strong>📥 Résultat d'exécution :</strong><pre style="margin-top: 4px; white-space: pre-wrap;">${escapeHtml(data.content)}</pre>`;
  } else if (data.type === "done") {
    item.className = "feed-item feed-done";
    item.innerHTML = `🎉 <strong>${data.message}</strong> Branche créée : <code>${data.branch}</code>`;
    
    agentSpinner.classList.add("hidden");
    btnStartAgent.disabled = false;
    setStatus("review", "Validation Humaine Requise");
    showHitlGate(data.branch, data.diff);
    
    if (eventSource) eventSource.close();
    loadStatus();
  } else if (data.type === "error") {
    item.className = "feed-item";
    item.style.color = "#ef4444";
    item.innerHTML = `❌ Erreur : ${escapeHtml(data.message)}`;
    agentSpinner.classList.add("hidden");
    btnStartAgent.disabled = false;
    if (eventSource) eventSource.close();
  }

  terminalFeed.appendChild(item);
  terminalFeed.scrollTop = terminalFeed.scrollHeight;
}

// Show HITL Decision Gate with formatted Diff
function showHitlGate(branch, diff) {
  hitlBranchName.textContent = branch;
  renderDiff(diff);
  hitlGate.classList.remove("hidden");
  hitlGate.scrollIntoView({ behavior: "smooth" });
}

// Render syntax highlighted Diff
function renderDiff(diffText) {
  if (!diffText || diffText.trim() === "") {
    diffContent.innerHTML = "<em>Aucune différence détectée (fichiers identiques)</em>";
    return;
  }
  const lines = diffText.split("\n");
  const formatted = lines.map(line => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return `<span class="diff-line-add">${escapeHtml(line)}</span>`;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      return `<span class="diff-line-del">${escapeHtml(line)}</span>`;
    } else {
      return `<span>${escapeHtml(line)}</span>`;
    }
  }).join("\n");

  diffContent.innerHTML = formatted;
}

// DOM Elements for Orchestration
const orchestrationCard = document.getElementById("orchestration-card");
const orchestrationStepsList = document.getElementById("orchestration-steps-list");
const prodCommitHash = document.getElementById("prod-commit-hash");
const btnDoneOrchestration = document.getElementById("btn-done-orchestration");

// Human Decision: Approve & Merge PR
btnApproveMerge.addEventListener("click", async () => {
  btnApproveMerge.disabled = true;
  btnApproveMerge.innerHTML = `<span class="spin"></span> Déploiement & Synchronisation...`;

  try {
    const res = await fetch("/api/approve-merge", { method: "POST" });
    const data = await res.json();

    setStatus("healthy", "Pipeline Opérationnel (Merge & Deploy Réussi)");
    hitlGate.classList.add("hidden");
    errorCard.classList.add("hidden");

    // Render Orchestration Steps
    orchestrationStepsList.innerHTML = "";
    if (data.steps && data.steps.length > 0) {
      data.steps.forEach((st, idx) => {
        const row = document.createElement("div");
        row.className = "step-item";
        row.innerHTML = `
          <div class="step-num">${idx + 1}</div>
          <div class="step-details">
            <div class="step-name">${escapeHtml(st.name)}</div>
            <div class="step-desc">${escapeHtml(st.detail)}</div>
          </div>
          <span class="step-status-tag">✓ SUCCÈS</span>
        `;
        orchestrationStepsList.appendChild(row);
      });
    }

    prodCommitHash.textContent = data.commit_hash || "main";
    orchestrationCard.classList.remove("hidden");
    orchestrationCard.scrollIntoView({ behavior: "smooth" });

    await loadStatus();
  } catch (err) {
    alert("Erreur lors de la fusion : " + err.message);
  } finally {
    btnApproveMerge.disabled = false;
    btnApproveMerge.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Approuver et Fusionner sur Main (Merge PR)
    `;
  }
});

btnDoneOrchestration.addEventListener("click", () => {
  orchestrationCard.classList.add("hidden");
});

// Human Decision: Reject Fix
btnRejectFix.addEventListener("click", async () => {
  if (!confirm("Êtes-vous sûr de vouloir rejeter ce correctif et abandonner cette branche ?")) {
    return;
  }

  btnRejectFix.disabled = true;
  btnRejectFix.innerHTML = `<span class="spin"></span> Rejet...`;

  try {
    const res = await fetch("/api/reject-fix", { method: "POST" });
    const data = await res.json();

    alert("❌ " + data.message);
    hitlGate.classList.add("hidden");
    await loadStatus();
  } catch (err) {
    alert("Erreur lors du rejet : " + err.message);
  } finally {
    btnRejectFix.disabled = false;
    btnRejectFix.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      Rejeter le correctif (Abandonner la branche)
    `;
  }
});

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initial Load
loadStatus();
loadScenarios();
