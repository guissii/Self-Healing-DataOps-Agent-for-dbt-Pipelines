import subprocess
import time
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Ensure virtualenv binaries (like dbt.exe) are found on Windows
venv_scripts = os.path.join(sys.prefix, "Scripts")
if os.path.exists(venv_scripts) and venv_scripts not in os.environ.get("PATH", ""):
    os.environ["PATH"] = venv_scripts + os.pathsep + os.environ.get("PATH", "")

# The clean SQL state that we want to reset to
CLEAN_SQL = """-- This model cleans the raw data
SELECT 
    order_id,
    user_id,
    order_amount,
    user_dob,
    created_at
FROM raw_orders
"""

def run_command(command, cwd=None):
    """Helper function to run shell commands and print them."""
    print(f"\n> {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr and "Error" not in result.stderr and "error" not in result.stderr:
        # Print warnings/info but don't stop script for standard docker/dbt output
        pass
    elif result.returncode != 0 and "dbt test" not in command:
        print("Command failed, but continuing demo sequence...")
    return result

def main():
    print("STARTING ONE-CLICK DEMO SEQUENCE...")

    # 1. Reset local dbt file
    print("\n--- Resetting stg_orders.sql to clean state ---")
    sql_path = os.path.join("dbt_project", "models", "staging", "stg_orders.sql")
    with open(sql_path, "w") as f:
        f.write(CLEAN_SQL)
    print("✅ SQL file reset.")

    # 2. Reset Database (Docker if available, or native local Postgres)
    docker_ready = False
    try:
        check = subprocess.run(["docker", "info"], capture_output=True, text=True)
        if check.returncode == 0:
            docker_ready = True
    except Exception:
        pass

    if docker_ready:
        print("\n--- Wiping Docker Database ---")
        run_command(["docker", "compose", "down", "-v"])
        print("\n--- Spinning up fresh Database & Airflow ---")
        run_command(["docker", "compose", "up", "-d"])
        print("\n--- Waiting 5 seconds for Postgres to boot ---")
        time.sleep(5)
    else:
        print("\n--- Resetting PostgreSQL Database natively ---")
        run_command([sys.executable, "init_db.py"])

    # 3. Generate fake data
    print("\n--- Generating Fake Data ---")
    run_command([sys.executable, "src/data_generator.py"])

    # 4. Run dbt (should pass)
    print("\n--- Running dbt (Proving it works) ---")
    run_command(["dbt", "run", "--profiles-dir", "."], cwd="dbt_project")
    run_command(["dbt", "test", "--profiles-dir", "."], cwd="dbt_project")

    # 5. Sabotage the pipeline!
    print("\n--- SABOTEUR ACTIVATED ---")
    run_command([sys.executable, "src/schema_breaker.py"])

    # 6. Run the AI Agent to fix it!
    print("\n---  AI AGENT WAKING UP ---")
    run_command([sys.executable, "src/agent.py"])

    print("\n DEMO SEQUENCE COMPLETE. Check GitHub for the Pull Request!")

if __name__ == "__main__":
    main()
