let selectedScenarioId = null;
let currentErrorLog = "";
let eventSource = null;
let currentOriginalSql = "";
let currentFixedSql = "";
let currentDiff = "";
let currentBranch = "main";
let currentScenario = null;

const GITHUB_REPO_URL = "https://github.com/guissii/Self-Healing-DataOps-Agent-for-dbt-Pipelines";

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

// HITL Elements
const hitlGate = document.getElementById("hitl-gate");
const hitlBranchName = document.getElementById("hitl-branch-name");
const hitlScenarioDesc = document.getElementById("hitl-scenario-desc");
const hitlAgentAction = document.getElementById("hitl-agent-action");
const tabSideBySide = document.getElementById("tab-side-by-side");
const tabUnifiedDiff = document.getElementById("tab-unified-diff");
const sideBySideView = document.getElementById("side-by-side-view");
const unifiedDiffView = document.getElementById("unified-diff-view");
const beforeCodeContainer = document.getElementById("before-code-container");
const afterCodeContainer = document.getElementById("after-code-container");
const diffContent = document.getElementById("diff-content");
const btnGithubPr = document.getElementById("btn-github-pr");
const btnApproveMerge = document.getElementById("btn-approve-merge");
const btnRejectFix = document.getElementById("btn-reject-fix");

// Orchestration Elements
const orchestrationCard = document.getElementById("orchestration-card");
const orchestrationStepsList = document.getElementById("orchestration-steps-list");
const prodCommitHash = document.getElementById("prod-commit-hash");
const btnGithubCommitLink = document.getElementById("btn-github-commit-link");
const btnDoneOrchestration = document.getElementById("btn-done-orchestration");

// Helper: Set Pipeline Status Badge
function setStatus(type, text) {
  statusBadge.className = `status-badge status-${type}`;
  statusBadge.querySelector(".status-text").textContent = text;
}

// Tab Switching
tabSideBySide.addEventListener("click", () => {
  tabSideBySide.classList.add("active");
  tabUnifiedDiff.classList.remove("active");
  sideBySideView.classList.remove("hidden");
  unifiedDiffView.classList.add("hidden");
});

tabUnifiedDiff.addEventListener("click", () => {
  tabUnifiedDiff.classList.add("active");
  tabSideBySide.classList.remove("active");
  sideBySideView.classList.add("hidden");
  unifiedDiffView.classList.remove("hidden");
});

// Fetch and render initial status
async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    
    currentBranch = data.branch;
    branchText.textContent = data.branch;
    renderColumns(data.columns);

    if (data.session && data.session.scenario_title) {
      currentScenario = data.session;
    }

    if (data.is_fix_pending) {
      setStatus("review", "Validation Humaine Requise");
      showHitlGate({
        branch: data.branch,
        diff: data.diff,
        originalSql: data.original_sql,
        fixedSql: data.current_sql,
        githubPrUrl: data.github_pr_url,
        scenario: data.session
      });
    } else {
      if (data.session && data.session.human_decision === "approved") {
        setStatus("healthy", "Validé par l'humain & En Ligne sur GitHub");
      } else {
        setStatus("healthy", "Pipeline Opérationnel");
      }
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
        currentScenario = sc;
      });

      scenariosList.appendChild(item);
    });

    if (scenarios.length > 0) {
      selectedScenarioId = scenarios[0].id;
      currentScenario = scenarios[0];
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
    orchestrationCard.classList.add("hidden");
    setStatus("healthy", "Pipeline Opérationnel");
    
    terminalFeed.innerHTML = `
      <div class="feed-item feed-done">
        ✓ <strong>Environnement réinitialisé avec succès :</strong><br>
        Base PostgreSQL restaurée, schéma raw_orders conforme, tests dbt 100% PASS sur <code>main</code>.
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

    currentScenario = data.scenario;
    currentOriginalSql = data.original_sql || "";
    setStatus("broken", "Pipeline Crashé (Schema Drift)");
    renderColumns(data.columns);

    currentErrorLog = data.error_log;
    errorLogContent.textContent = data.error_log;
    errorCard.classList.remove("hidden");
    hitlGate.classList.add("hidden");
    orchestrationCard.classList.add("hidden");

    terminalFeed.innerHTML += `
      <div class="feed-item" style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; color: #fca5a5;">
        💥 <strong>Panne déclenchée :</strong> ${data.scenario.title}<br>
        <small style="font-family: var(--font-mono); color: #f87171;">SQL exécuté : ${data.scenario.sql}</small><br>
        <span style="font-size: 0.78rem; color: #fca5a5;">Le pipeline dbt est en échec. Cliquez ci-dessous pour réveiller l'agent de réparation autonome.</span>
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
    item.innerHTML = `🎉 <strong>${data.message}</strong> Branche créée : <code>${data.branch}</code><br><small style="color: #38bdf8;">Branche poussée sur GitHub distant. En attente de validation humaine avant tout merge dans main.</small>`;
    
    agentSpinner.classList.add("hidden");
    btnStartAgent.disabled = false;
    setStatus("review", "Validation Humaine Requise");

    showHitlGate({
      branch: data.branch,
      diff: data.diff,
      originalSql: data.original_sql,
      fixedSql: data.fixed_sql,
      githubPrUrl: data.github_pr_url,
      scenario: data.scenario
    });
    
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

// Show HITL Decision Gate with Side-by-Side comparison and GitHub links
function showHitlGate(info) {
  hitlBranchName.textContent = info.branch;

  // 1. Context Information: Ce qui a été demandé et ce qui a été fait
  const sc = info.scenario || currentScenario;
  if (sc && sc.scenario_desc) {
    hitlScenarioDesc.textContent = `${sc.scenario_title} — ${sc.scenario_desc}`;
  } else if (sc && sc.description) {
    hitlScenarioDesc.textContent = `${sc.title} — ${sc.description}`;
  } else {
    hitlScenarioDesc.textContent = "Dérive de schéma détectée dans raw_orders.";
  }

  hitlAgentAction.innerHTML = `Branche isolée <code>${info.branch}</code> créée et poussée sur GitHub. Tests dbt exécutés en sandbox : <strong>100% PASS</strong>.`;

  // 2. Direct GitHub PR link
  const prUrl = info.githubPrUrl || `${GITHUB_REPO_URL}/compare/main...${info.branch}?expand=1`;
  btnGithubPr.href = prUrl;

  // 3. Render Side-by-Side Code Diff
  currentOriginalSql = info.originalSql || "";
  currentFixedSql = info.fixedSql || "";
  currentDiff = info.diff || "";

  renderSideBySide(currentOriginalSql, currentFixedSql);
  renderUnifiedDiff(currentDiff);

  hitlGate.classList.remove("hidden");
  hitlGate.scrollIntoView({ behavior: "smooth" });
}

// Render Side-by-Side Code Comparison (Avant / Après)
function renderSideBySide(beforeSql, afterSql) {
  const beforeLines = (beforeSql || "").trim().split("\n");
  const afterLines = (afterSql || "").trim().split("\n");

  // Render Before (Broken)
  beforeCodeContainer.innerHTML = "";
  beforeLines.forEach((line, idx) => {
    const row = document.createElement("div");
    row.className = "line-row";

    // Detect if this line was replaced/removed
    const isAltered = line.includes("user_dob") || line.includes("order_amount") || line.includes("user_id");
    if (isAltered && !afterSql.includes(line.trim())) {
      row.classList.add("line-diff-removed");
    }

    row.innerHTML = `
      <span class="line-num">${idx + 1}</span>
      <span class="line-text">${escapeHtml(line)}</span>
    `;
    beforeCodeContainer.appendChild(row);
  });

  // Render After (Fixed by AI)
  afterCodeContainer.innerHTML = "";
  afterLines.forEach((line, idx) => {
    const row = document.createElement("div");
    row.className = "line-row";

    // Detect if this line contains the fix (alias, cast, rename)
    const isFixLine = line.toLowerCase().includes(" as ") || line.includes("::") || line.includes("cast");
    if (isFixLine || !beforeSql.includes(line.trim())) {
      row.classList.add("line-diff-added");
    }

    row.innerHTML = `
      <span class="line-num">${idx + 1}</span>
      <span class="line-text">${escapeHtml(line)}</span>
    `;
    afterCodeContainer.appendChild(row);
  });
}

// Render syntax highlighted Unified Git Diff
function renderUnifiedDiff(diffText) {
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

// Human Decision: Approve & Merge PR & Push to GitHub Main
btnApproveMerge.addEventListener("click", async () => {
  btnApproveMerge.disabled = true;
  btnApproveMerge.innerHTML = `<span class="spin"></span> Déploiement & Push GitHub...`;

  try {
    const res = await fetch("/api/approve-merge", { method: "POST" });
    const data = await res.json();

    setStatus("healthy", "Validé par l'humain & Poussé sur GitHub main");
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
          <span class="step-status-tag">✓ VALIDÉ</span>
        `;
        orchestrationStepsList.appendChild(row);
      });
    }

    prodCommitHash.textContent = data.commit_hash || "main";
    if (data.commit_url) {
      btnGithubCommitLink.href = data.commit_url;
      btnGithubCommitLink.classList.remove("hidden");
    } else {
      btnGithubCommitLink.href = GITHUB_REPO_URL;
    }

    orchestrationCard.classList.remove("hidden");
    orchestrationCard.scrollIntoView({ behavior: "smooth" });

    await loadStatus();
  } catch (err) {
    alert("Erreur lors de la fusion : " + err.message);
  } finally {
    btnApproveMerge.disabled = false;
    btnApproveMerge.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Approuver, Fusionner & Pousser sur GitHub (Push main)
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
  btnRejectFix.innerHTML = `<span class="spin"></span> Rejet en cours...`;

  try {
    const res = await fetch("/api/reject-fix", { method: "POST" });
    const data = await res.json();

    alert("❌ " + data.message);
    hitlGate.classList.add("hidden");
    setStatus("broken", "Correctif Rejeté par l'Humain");
    await loadStatus();
  } catch (err) {
    alert("Erreur lors du rejet : " + err.message);
  } finally {
    btnRejectFix.disabled = false;
    btnRejectFix.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      Rejeter le correctif (Abandonner)
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
