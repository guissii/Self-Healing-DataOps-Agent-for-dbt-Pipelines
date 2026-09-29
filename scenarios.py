import psycopg2

SCENARIOS = {
    "rename_amount": {
        "id": "rename_amount",
        "title": "Renommage simple : order_amount ➔ total_amount",
        "level": "Facile",
        "level_color": "#10b981", # green
        "description": "L'équipe amont a renommé la colonne 'order_amount' en 'total_amount'.",
        "expected_fix": "Mapper total_amount AS order_amount",
        "sql": "ALTER TABLE raw_orders RENAME COLUMN order_amount TO total_amount;"
    },
    "rename_dob": {
        "id": "rename_dob",
        "title": "Renommage simple : user_dob ➔ date_of_birth",
        "level": "Facile",
        "level_color": "#10b981", # green
        "description": "La colonne date de naissance 'user_dob' a été renommée en 'date_of_birth'.",
        "expected_fix": "Mapper date_of_birth AS user_dob",
        "sql": "ALTER TABLE raw_orders RENAME COLUMN user_dob TO date_of_birth;"
    },
    "double_rename": {
        "id": "double_rename",
        "title": "Double dérive simultanée : user_dob ➔ birth_date & user_id ➔ customer_id",
        "level": "Intermédiaire",
        "level_color": "#f59e0b", # amber
        "description": "Deux colonnes ont été renommées en même temps par une refonte du schéma applicatif.",
        "expected_fix": "Mapper birth_date AS user_dob ET customer_id AS user_id",
        "sql": "ALTER TABLE raw_orders RENAME COLUMN user_dob TO birth_date; ALTER TABLE raw_orders RENAME COLUMN user_id TO customer_id;"
    },
    "type_change": {
        "id": "type_change",
        "title": "Changement de type : order_amount NUMERIC ➔ TEXT",
        "level": "Avancé",
        "level_color": "#ef4444", # red
        "description": "Le montant est maintenant envoyé sous forme de chaîne de caractères TEXT dans la base brute.",
        "expected_fix": "Caster la colonne en NUMERIC (order_amount::numeric AS order_amount)",
        "sql": "ALTER TABLE raw_orders ALTER COLUMN order_amount TYPE TEXT USING order_amount::TEXT;"
    }
}

import os

def reset_raw_orders_clean():
    """Restores raw_orders table to clean schema and reloads fake data."""
    conn = psycopg2.connect(
        host="localhost",
        database="my_db",
        user="admin",
        password="password123",
        port="5432"
    )
    conn.autocommit = True
    cursor = conn.cursor()
    cursor.execute("DROP VIEW IF EXISTS stg_orders CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS mart_revenue CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS raw_orders CASCADE;")
    
    init_sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "init", "init.sql")
    with open(init_sql_path, "r") as f:
        cursor.execute(f.read())
    cursor.close()
    conn.close()

    # Re-insert fake data
    from src.data_generator import generate_and_load_data
    generate_and_load_data()

    # Reset stg_orders.sql to clean state
    clean_sql = """-- This model cleans the raw data
SELECT 
    order_id,
    user_id,
    order_amount,
    user_dob,
    created_at
FROM raw_orders
"""
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dbt_project", "models", "staging", "stg_orders.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(clean_sql)

def execute_sabotage(scenario_id: str):
    if scenario_id not in SCENARIOS:
        raise ValueError(f"Scénario inconnu: {scenario_id}")
    
    # 1. First ensure table and SQL are in clean original state
    reset_raw_orders_clean()
    
    # 2. Apply sabotage
    scenario = SCENARIOS[scenario_id]
    conn = psycopg2.connect(
        host="localhost",
        database="my_db",
        user="admin",
        password="password123",
        port="5432"
    )
    conn.autocommit = True
    cursor = conn.cursor()
    
    cursor.execute("DROP VIEW IF EXISTS stg_orders CASCADE;")
    cursor.execute(scenario["sql"])
    
    cursor.close()
    conn.close()
    return scenario
