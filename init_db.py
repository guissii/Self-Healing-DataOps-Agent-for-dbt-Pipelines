import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

conn = psycopg2.connect(host='localhost', port=5432, user='postgres', password='admin', database='postgres')
conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
cur = conn.cursor()

# Check or create user admin
cur.execute("SELECT 1 FROM pg_roles WHERE rolname = 'admin';")
if not cur.fetchone():
    cur.execute("CREATE USER admin WITH PASSWORD 'password123' SUPERUSER CREATEDB;")
    print("User admin created!")
else:
    cur.execute("ALTER USER admin WITH PASSWORD 'password123' SUPERUSER CREATEDB;")
    print("User admin password updated!")

# Check or create database my_db
cur.execute("SELECT 1 FROM pg_database WHERE datname = 'my_db';")
if not cur.fetchone():
    cur.execute("CREATE DATABASE my_db OWNER admin;")
    print("Database my_db created!")
else:
    print("Database my_db already exists!")

cur.close()
conn.close()

# Connect to my_db as admin
conn2 = psycopg2.connect(host='localhost', port=5432, user='admin', password='password123', database='my_db')
cur2 = conn2.cursor()
cur2.execute("DROP TABLE IF EXISTS raw_orders CASCADE;")
with open('init/init.sql', 'r') as f:
    sql = f.read()
cur2.execute(sql)
conn2.commit()
cur2.close()
conn2.close()

# Reset stg_orders.sql to clean state
CLEAN_SQL = """-- This model cleans the raw data
SELECT 
    order_id,
    user_id,
    order_amount,
    user_dob,
    created_at
FROM raw_orders
"""
with open("dbt_project/models/staging/stg_orders.sql", "w") as f:
    f.write(CLEAN_SQL)

print("my_db, raw_orders table, and stg_orders.sql reset successfully!")
