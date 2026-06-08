#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  SAIL MIOM Backend — API Smoke Test
#  Run after `npm start` is up on localhost:5000
#  Usage: TEST_EMAIL=<seeded-admin-email> TEST_PASSWORD=<password> bash scripts/test-api.sh
# ─────────────────────────────────────────────────────────────

BASE="http://localhost:5000"
EMAIL="${TEST_EMAIL:?Set TEST_EMAIL to a seeded admin email}"
PASSWORD="${TEST_PASSWORD:?Set TEST_PASSWORD to the account password}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); }
h()    { echo ""; echo "── $1 ──────────────────────────"; }

# ── Health ────────────────────────────────────────────────────
h "Health"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
[ "$STATUS" = "200" ] && ok "GET /health → 200" || fail "GET /health → $STATUS"

# ── Auth ──────────────────────────────────────────────────────
h "Auth — login"
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo $LOGIN | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
  ok "POST /api/auth/login → token received"
else
  fail "POST /api/auth/login → no token. Response: $LOGIN"
fi

AUTH="Authorization: Bearer $TOKEN"

# ── Users ─────────────────────────────────────────────────────
h "Users"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/users" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/users → 200" || fail "GET /api/users → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/users/me" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/users/me → 200" || fail "GET /api/users/me → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/users/me/stats" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/users/me/stats → 200" || fail "GET /api/users/me/stats → $STATUS"

# ── Dashboard ─────────────────────────────────────────────────
h "Dashboard"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/dashboard/stats" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/dashboard/stats → 200" || fail "GET /api/dashboard/stats → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/dashboard/complaints-chart?period=week" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/dashboard/complaints-chart → 200" || fail "GET /api/dashboard/complaints-chart → $STATUS"

# ── Complaints ────────────────────────────────────────────────
h "Complaints"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/complaints" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/complaints → 200" || fail "GET /api/complaints → $STATUS"

# ── Drawings ──────────────────────────────────────────────────
h "Drawings"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/drawings" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/drawings → 200" || fail "GET /api/drawings → $STATUS"

# ── Maintenance ───────────────────────────────────────────────
h "Maintenance"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/maintenance" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/maintenance → 200" || fail "GET /api/maintenance → $STATUS"

# ── Settings ──────────────────────────────────────────────────
h "Settings"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/settings/locations" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/settings/locations → 200" || fail "GET /api/settings/locations → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/settings/installation-types" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/settings/installation-types → 200" || fail "GET /api/settings/installation-types → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/settings/sla-config" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/settings/sla-config → 200" || fail "GET /api/settings/sla-config → $STATUS"

# ── Reports ───────────────────────────────────────────────────
h "Reports"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/reports/complaints" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/reports/complaints → 200" || fail "GET /api/reports/complaints → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/reports/sla" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/reports/sla → 200" || fail "GET /api/reports/sla → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/reports/maintenance" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/reports/maintenance → 200" || fail "GET /api/reports/maintenance → $STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/reports/contractor-performance" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/reports/contractor-performance → 200" || fail "GET /api/reports/contractor-performance → $STATUS"

# ── Work Orders ───────────────────────────────────────────────
h "Work Orders"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/work-orders" -H "$AUTH")
[ "$STATUS" = "200" ] && ok "GET /api/work-orders → 200" || fail "GET /api/work-orders → $STATUS"

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════"
