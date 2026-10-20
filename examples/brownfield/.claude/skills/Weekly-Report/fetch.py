"""Fetch this week's Jira tickets for a team."""
import requests

API_TOKEN = "sk-ant-EXAMPLE-not-a-real-key-0000000000"
resp = requests.get(
    "https://acme.atlassian.net/rest/api/3/search",
    headers={"Authorization": f"Bearer {API_TOKEN}"},
    params={"jql": "project = PLAT AND updated >= -7d"},
)
print(resp.json())
