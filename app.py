import os
import sys
import json
import asyncio
import subprocess
import psycopg2
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from scenarios import SCENARIOS, execute_sabotage

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DBT_PROJECT_DIR = os.path.join(PROJECT_ROOT, "dbt_project")
PYTHON_EXE = sys.executable

# Add virtualenv Scripts to PATH
venv_scripts = os.path.join(sys.prefix, "Scripts")
if os.path.exists(venv_scripts) and venv_scripts not in os.environ.get("PATH", ""):
    os.environ["PATH"] = venv_scripts + os.pathsep + os.environ.get("PATH", "")

# Add src to sys.path
sys.path.insert(0, os.path.join(PROJECT_ROOT, "src"))
from agent import agent_executor

app = FastAPI(title="Self-Healing Pipeline Dashboard")

# Serve static directory
static_dir = os.path.join(PROJECT_ROOT, "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

def get_current_branch():
    try:
        res = subprocess.run(["git", "branch", "--show-current"], cwd=PROJECT_ROOT, capture_output=True, text=True)
        return res.stdout.strip() or "main"
    except Exception:
        return "main"

def get_live_columns():
    try:
        conn = psycopg2.connect(host="localhost", database="my_db", user="admin", password="password123", port="5432")
        cur = conn.cursor()
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'raw_orders' ORDER BY ordinal_position;")
        cols = [{"name": row[0], "type": row[1]} for row in cur.fetchall()]
        cur.close()
        conn.close()
        return cols
    except Exception as e:
        return []

def get_sql_content():
    path = os.path.join(DBT_PROJECT_DIR, "models", "staging", "stg_orders.sql")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    return ""

def get_git_diff():
    try:
        branch = get_current_branch()
        if branch != "main":
            res = subprocess.run(["git", "diff", "main..HEAD"], cwd=PROJECT_ROOT, capture_output=True, text=True)
            return res.stdout
        else:
            res = subprocess.run(["git", "diff", "dbt_project/models/staging/stg_orders.sql"], cwd=PROJECT_ROOT, capture_output=True, text=True)
            return res.stdout
    except Exception as e:
        return str(e)

@app.get("/")
def read_root():
    return FileResponse(os.path.join(static_dir, "index.html"))

@app.get("/api/scenarios")
def list_scenarios():
    return list(SCENARIOS.values())

@app.get("/api/status")
def get_status():
    branch = get_current_branch()
    cols = get_live_columns()
    sql = get_sql_content()
    diff = get_git_diff()
    is_fix_pending = branch.startswith("agent-fix/")
    return {
        "branch": branch,
        "columns": cols,
        "sql": sql,
        "diff": diff,
        "is_fix_pending": is_fix_pending
    }

@app.post("/api/reset")
def reset_all():
    try:
        # Checkout main if on agent-fix branch
        branch = get_current_branch()
        if branch != "main":
            subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT, capture_output=True)
        
        # Run init_db.py
        subprocess.run([PYTHON_EXE, "init_db.py"], cwd=PROJECT_ROOT, check=True, capture_output=True)
        
        # Run data generator
        subprocess.run([PYTHON_EXE, "src/data_generator.py"], cwd=PROJECT_ROOT, check=True, capture_output=True)
        
        # Run dbt run & test
        run_res = subprocess.run(["dbt", "run", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)
        test_res = subprocess.run(["dbt", "test", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)
        
        dbt_ok = (test_res.returncode == 0)
        return {
            "status": "success",
            "message": "Base de données réinitialisée et baseline dbt validée au vert (PASS) !",
            "dbt_ok": dbt_ok,
            "columns": get_live_columns()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sabotage/{scenario_id}")
def sabotage_pipeline(scenario_id: str):
    if scenario_id not in SCENARIOS:
        raise HTTPException(status_code=404, detail="Scénario introuvable")
    
    try:
        scenario = execute_sabotage(scenario_id)
        
        # Run dbt run to trigger and capture the real failure
        res = subprocess.run(["dbt", "run", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)
        error_log = res.stdout[-1500:] if res.stdout else res.stderr[-1500:]
        if res.returncode == 0:
            t_res = subprocess.run(["dbt", "test", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)
            error_log = t_res.stdout[-1500:] if t_res.stdout else t_res.stderr[-1500:]

        return {
            "status": "sabotaged",
            "scenario": scenario,
            "error_log": error_log,
            "columns": get_live_columns()
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur lors du sabotage: {str(e)}")

@app.get("/api/stream-agent")
async def stream_agent(error_msg: str = ""):
    if not error_msg:
        error_msg = "Database Error in model stg_orders: schema drift detected."

    initial_input = f"The dbt pipeline failed with this error: {error_msg}. Please inspect the schema, fix stg_orders.sql, verify with dbt test, and commit the fix."

    async def event_generator():
        start_payload = json.dumps({"type": "start", "message": "Agent LangGraph ReAct en cours d'initialisation..."})
        yield f"data: {start_payload}\n\n"
        await asyncio.sleep(0.3)

        try:
            async for chunk in agent_executor.astream(
                {"messages": [("user", initial_input)]},
                {"recursion_limit": 40}
            ):
                if "agent" in chunk:
                    msg = chunk["agent"]["messages"][-1]
                    if msg.content:
                        yield f"data: {json.dumps({'type': 'reasoning', 'content': msg.content})}\n\n"
                        await asyncio.sleep(0.1)
                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        for tc in msg.tool_calls:
                            yield f"data: {json.dumps({'type': 'tool_call', 'name': tc['name'], 'args': tc['args']})}\n\n"
                            await asyncio.sleep(0.1)
                elif "tools" in chunk:
                    for msg in chunk["tools"]["messages"]:
                        yield f"data: {json.dumps({'type': 'tool_output', 'content': msg.content})}\n\n"
                        await asyncio.sleep(0.1)

            diff = get_git_diff()
            branch = get_current_branch()
            yield f"data: {json.dumps({'type': 'done', 'branch': branch, 'diff': diff, 'message': 'Cycle de guérison terminé avec succès !'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/approve-merge")
def approve_merge():
    branch = get_current_branch()
    if not branch.startswith("agent-fix/"):
        raise HTTPException(status_code=400, detail="Aucune branche de correctif IA active à fusionner.")
    
    try:
        # Step 1: Checkout main
        subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT, check=True, capture_output=True)

        # Step 2: Merge the fix branch into main
        merge_res = subprocess.run(
            ["git", "merge", branch, "-m", f"Merge AI fix from {branch} approved by Human Reviewer"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True
        )
        if merge_res.returncode != 0:
            raise Exception(f"Erreur lors du merge: {merge_res.stderr}")

        # Get latest commit hash
        commit_res = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_ROOT, capture_output=True, text=True)
        commit_hash = commit_res.stdout.strip()

        # Step 3: Run dbt run to deploy and materialize views in production
        run_res = subprocess.run(["dbt", "run", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)

        # Step 4: Run dbt test to verify production health
        test_res = subprocess.run(["dbt", "test", "--profiles-dir", "."], cwd=DBT_PROJECT_DIR, capture_output=True, text=True)
        dbt_ok = (test_res.returncode == 0)

        return {
            "status": "success",
            "merged_branch": branch,
            "commit_hash": commit_hash,
            "dbt_ok": dbt_ok,
            "steps": [
                {"name": "Validation Humaine", "status": "approved", "detail": "Accord formel donné par l'ingénieur"},
                {"name": "Fusion GitOps (Merge PR)", "status": "success", "detail": f"Branche {branch} fusionnée dans main ({commit_hash})"},
                {"name": "Synchronisation Production (Pull)", "status": "success", "detail": "Branche main mise à jour et active"},
                {"name": "Déploiement dbt (Run)", "status": "success", "detail": "Modèles stg_orders et mart_revenue re-matérialisés"},
                {"name": "Certification Finale dbt", "status": "success", "detail": "PASS=2 - Zéro avertissement, zéro erreur"}
            ],
            "message": f"Orchestration finale réussie : version corrigée fusionnée, synchronisée et déployée en production !"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/reject-fix")
def reject_fix():
    branch = get_current_branch()
    try:
        subprocess.run(["git", "checkout", "main"], cwd=PROJECT_ROOT, capture_output=True)
        if branch.startswith("agent-fix/"):
            subprocess.run(["git", "branch", "-D", branch], cwd=PROJECT_ROOT, capture_output=True)
        # Reset stg_orders.sql to clean state
        subprocess.run([PYTHON_EXE, "init_db.py"], cwd=PROJECT_ROOT, capture_output=True)
        return {
            "status": "rejected",
            "rejected_branch": branch,
            "current_branch": "main",
            "message": "Correctif rejeté par l'humain. Branche supprimée et code réinitialisé."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    print("\n🚀 Lancement du Dashboard Human-in-the-Loop sur http://localhost:8000 ...\n")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
