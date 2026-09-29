import psycopg2
import os
import sys
import subprocess
from datetime import datetime 

# Ensure virtualenv binaries (like dbt.exe) are found on Windows
venv_scripts = os.path.join(sys.prefix, "Scripts")
if os.path.exists(venv_scripts) and venv_scripts not in os.environ.get("PATH", ""):
    os.environ["PATH"] = venv_scripts + os.pathsep + os.environ.get("PATH", "")

# Dynamically find the project root directory based on this file's location
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DBT_PROJECT_DIR = os.path.join(PROJECT_ROOT, "dbt_project")
STAGING_DIR = os.path.join(DBT_PROJECT_DIR, "models", "staging")
MARTS_DIR = os.path.join(DBT_PROJECT_DIR, "models", "marts")

# Tool 1: Inspect the database schema
def inspect_schema(table_name: str) -> str:
    """Connects to Postgres and returns the current column names of a table."""
    conn = psycopg2.connect(
        host="localhost",
        database="my_db",
        user="admin",
        password="password123",
        port="5432"
    )
    cursor = conn.cursor()
    cursor.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}';")
    columns = [row[0] for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return f"The current columns in table '{table_name}' are: {', '.join(columns)}"

# Tool 2: Read the broken dbt file
def read_dbt_file(model_name: str) -> str:
    """Reads the SQL code or config from a dbt model file."""
    names_to_try = [model_name]
    if not (model_name.endswith(".sql") or model_name.endswith(".yml") or model_name.endswith(".yaml")):
        names_to_try.append(f"{model_name}.sql")
    
    base_dirs = [STAGING_DIR, MARTS_DIR, DBT_PROJECT_DIR, os.path.join(DBT_PROJECT_DIR, "models")]
    for b in base_dirs:
        for name in names_to_try:
            target = os.path.join(b, name)
            if os.path.exists(target) and os.path.isfile(target):
                with open(target, 'r') as file:
                    return f"Content of {name}:\n{file.read()}"
    return f"Error: Could not find file for model {model_name}"

# Tool 3: Write the fixed dbt file
def write_dbt_file(model_name: str, new_sql: str) -> str:
    """Overwrites the SQL file with the new fixed code."""
    file_path = os.path.join(STAGING_DIR, f"{model_name}.sql")
    if not os.path.exists(file_path):
        file_path = os.path.join(MARTS_DIR, f"{model_name}.sql")
        
    with open(file_path, 'w') as file:
        file.write(new_sql)
    return f"Successfully wrote new SQL code to {model_name}.sql"

DBT_EXE = os.path.join(sys.prefix, "Scripts", "dbt.exe")
if not os.path.exists(DBT_EXE):
    DBT_EXE = "dbt"

# Tool 4: Run dbt tests to verify the fix
def run_dbt_tests() -> str:
    """Builds and runs dbt tests to verify the fix works."""
    try:
        # First run dbt run to materialize updated SQL in Postgres
        run_res = subprocess.run(
            [DBT_EXE, "run", "--profiles-dir", "."],
            cwd=DBT_PROJECT_DIR,
            capture_output=True,
            text=True
        )
        if run_res.returncode != 0:
            err = run_res.stdout[-1500:] if run_res.stdout else run_res.stderr[-1500:]
            return f"dbt run failed (model could not be created):\n{err}"

        # Then run dbt test
        test_res = subprocess.run(
            [DBT_EXE, "test", "--profiles-dir", "."], 
            cwd=DBT_PROJECT_DIR,
            capture_output=True, 
            text=True
        )
        output = test_res.stdout[-1500:] if test_res.stdout else test_res.stderr[-1500:]
        return f"dbt test output:\n{output}"
    except Exception as e:
        return f"Failed to run dbt test: {str(e)}"


# Tool 5: Commit the fix and push to GitHub
def commit_and_push_fix(model_name: str, fix_description: str) -> str:
    """Commits the fixed SQL file to a new git branch and pushes it to GitHub."""
    try:
        # Create a unique branch name
        branch_name = f"agent-fix/{model_name}-{int(datetime.now().timestamp())}"
        
        # 1. Create and checkout the new branch
        subprocess.run(["git", "checkout", "-b", branch_name], cwd=PROJECT_ROOT, check=True)
        
        # 2. Stage the fixed file
        file_path = os.path.join(STAGING_DIR, f"{model_name}.sql")
        if not os.path.exists(file_path):
            file_path = os.path.join(MARTS_DIR, f"{model_name}.sql")
            
        subprocess.run(["git", "add", file_path], cwd=PROJECT_ROOT, check=True)
        
        # 3. Commit the changes
        subprocess.run(["git", "commit", "-m", fix_description], cwd=PROJECT_ROOT, check=True)
        
        # 4. Push the branch to GitHub
        try:
            subprocess.run(["git", "push", "-u", "origin", branch_name], cwd=PROJECT_ROOT, check=True)
            return f"Success! Pushed fix to branch {branch_name}. A human reviewer can now open a Pull Request."
        except subprocess.CalledProcessError as push_err:
            return f"Success! Fix committed to local branch '{branch_name}'. Note: push to remote origin failed ({push_err}). Configure your personal GitHub remote to push online."
    except subprocess.CalledProcessError as e:
        return f"Git command failed: {str(e)}."
