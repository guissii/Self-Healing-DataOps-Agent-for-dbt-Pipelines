import os
import sys
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from agent_tools import inspect_schema, read_dbt_file, write_dbt_file, run_dbt_tests, commit_and_push_fix

load_dotenv()

# Initialize the LLM using the OpenAI wrapper, but point it to ZAI's base URL
# (Replace the base_url with the actual ZAI endpoint if it's different)
llm = ChatOpenAI(
    model="openai/gpt-oss-120b",  # <--- CHANGE THIS
    temperature=0,
    openai_api_key=os.getenv("GROQ_API_KEY"),
    openai_api_base="https://api.groq.com/openai/v1"
)

# The list of tools the agent is allowed to use
tools = [
    inspect_schema,
    read_dbt_file,
    write_dbt_file,
    run_dbt_tests,
    commit_and_push_fix
]


# The system prompt gives the AI its persona and strict rules
SYSTEM_PROMPT = """You are an elite Data Engineer AI agent. 
A dbt pipeline has broken because the upstream database schema changed.
Your job is to:
1. Inspect the live database to see the current column names.
2. Read the broken dbt SQL file to see what it expects.
3. Rewrite the dbt SQL file so the column names match the live database.
4. Run the dbt tests to verify your fix works.

Rules:
- ALWAYS inspect the database first with inspect_schema.
- DO NOT drop or delete columns. If a column is renamed or missing, map it or cast it (e.g. new_name AS expected_name).
- If the tests fail, read the new error, inspect the schema again, and try to fix the SQL again.
- MANDATORY FINAL STEP: As soon as dbt tests pass, you MUST execute the `commit_and_push_fix` tool call with model_name and fix_description. DO NOT write bash markdown blocks; YOU MUST ACTUALLY CALL the tool `commit_and_push_fix`.
"""
# Create the ReAct (Reasoning + Acting) Agent
# create_react_agent handles the cyclical loop automatically. 
# It will call a tool, read the output, and decide if it needs to call another tool.
agent_executor = create_react_agent(llm, tools, messages_modifier=SYSTEM_PROMPT)

def run_agent():
    import sys
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    print("Agent starting up...")
    
    # The initial trigger/prompt for the agent
    error_log = "Database Error in model stg_orders: column 'order_amount' does not exist."
    initial_input = f"The dbt pipeline failed with this error: {error_log}. Please fix it."
    
    print("Agent is thinking & executing ReAct loop...\n")
    final_response = None
    for chunk in agent_executor.stream(
        {"messages": [("user", initial_input)]},
        {"recursion_limit": 50}
    ):
        if "agent" in chunk:
            msg = chunk["agent"]["messages"][-1]
            if msg.content:
                print(f"[Agent Reasoning]\n{msg.content}\n")
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    print(f"👉 [Calling Tool]: {tc['name']}({tc['args']})")
            final_response = msg
        elif "tools" in chunk:
            for msg in chunk["tools"]["messages"]:
                print(f"📥 [Tool Output]:\n{msg.content}\n")
    
    print("\n--- AGENT FINISHED ---")
    if final_response:
        print(final_response.content)

if __name__ == "__main__":
    run_agent()
