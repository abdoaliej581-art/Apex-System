#!/bin/bash
# APEX Client Portal (§72) — E2E API test suite (single-run)
cd /tmp
B=http://localhost:3000
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  XX  $1"; }
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 (expected $2, got $3)"; fi
}
pyget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

# ---------- 0. Admin login ----------
rm -f admin.jar portal.jar p2.jar p3.jar
CSRF=$(curl -s -c admin.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b admin.jar -c admin.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=admin@apex.system&password=Apex@2026&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded"
ROLE=$(curl -s -b admin.jar $B/api/auth/session | pyget "d['user']['roleKeys'][0]")
check "admin login role" "SUPER_ADMIN" "$ROLE"

# ---------- 1. Find Nile Digital Agency ----------
CLIENT_ID=$(curl -s -b admin.jar "$B/api/clients?pageSize=100" | pyget "[c['id'] for c in d['data']['items'] if 'Nile' in c['companyName']][0]")
echo "  client: $CLIENT_ID"

# ---------- 2. Portal user management ----------
echo "--- portal user management ---"
PU_EMAIL="portal$(date +%s)@niledigital.eg"
HTTP=$(curl -s -o /tmp/pu.json -w "%{http_code}" -b admin.jar -X POST "$B/api/clients/$CLIENT_ID/portal-users" \
  -H "Content-Type: application/json" -d '{"name":"Mona Hassan","email":"'"$PU_EMAIL"'","password":"Portal@2026"}')
check "create portal user" "201" "$HTTP"
PU_ID=$(cat /tmp/pu.json | pyget "d['data']['id']")
echo "  portal user: $PU_ID"
HTTP=$(curl -s -o /tmp/pu2.json -w "%{http_code}" -b admin.jar -X POST "$B/api/clients/$CLIENT_ID/portal-users" \
  -H "Content-Type: application/json" -d '{"name":"Dup","email":"'"$PU_EMAIL"'","password":"Portal@2026"}')
check "duplicate email 409" "409" "$HTTP"
HTTP=$(curl -s -o /tmp/pu3.json -w "%{http_code}" -b admin.jar -X POST "$B/api/clients/$CLIENT_ID/portal-users" \
  -H "Content-Type: application/json" -d '{"name":"Short","email":"short@x.eg","password":"short"}')
check "weak password 400" "400" "$HTTP"
COUNT=$(curl -s -b admin.jar "$B/api/clients/$CLIENT_ID/portal-users" | pyget "len(d['data']['users']) >= 1")
check "portal users listed" "True" "$COUNT"

# ---------- 3. Portal login ----------
CSRF=$(curl -s -c portal.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b portal.jar -c portal.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=$PU_EMAIL&password=Portal@2026&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded"
PROLE=$(curl -s -b portal.jar $B/api/auth/session | pyget "d['user']['roleKeys'][0]")
PCLIENT=$(curl -s -b portal.jar $B/api/auth/session | pyget "d['user']['clientId'] is not None")
check "portal login role" "CLIENT" "$PROLE"
check "portal session has clientId" "True" "$PCLIENT"

# ---------- 4. Portal overview ----------
echo "--- portal overview ---"
HTTP=$(curl -s -o /tmp/ov.json -w "%{http_code}" -b portal.jar $B/api/portal/overview)
check "overview 200" "200" "$HTTP"
NAME=$(cat /tmp/ov.json | pyget "d['data']['client']['companyName']")
echo "  company: $NAME"
AKP=$(cat /tmp/ov.json | pyget "d['data']['kpis']['activeProjects']")
echo "  active projects: $AKP"

# ---------- 5. Portal projects ----------
echo "--- portal projects ---"
HTTP=$(curl -s -o /tmp/pp.json -w "%{http_code}" -b portal.jar "$B/api/portal/projects?pageSize=10")
check "projects list 200" "200" "$HTTP"
PROJ_COUNT=$(cat /tmp/pp.json | pyget "len(d['data']['items'])")
echo "  projects: $PROJ_COUNT"
if [ "$PROJ_COUNT" != "0" ]; then
  PID=$(cat /tmp/pp.json | pyget "d['data']['items'][0]['id']")
  HTTP=$(curl -s -o /tmp/pd.json -w "%{http_code}" -b portal.jar "$B/api/portal/projects/$PID")
  check "project detail 200" "200" "$HTTP"
  BUDGET=$(cat /tmp/pd.json | pyget "'budget' in d['data']['project']")
  check "budget not exposed" "False" "$BUDGET"
fi

# ---------- 6. Portal invoices ----------
echo "--- portal invoices ---"
HTTP=$(curl -s -o /tmp/pi.json -w "%{http_code}" -b portal.jar "$B/api/portal/invoices?pageSize=50")
check "invoices list 200" "200" "$HTTP"
HAS_DRAFT=$(cat /tmp/pi.json | pyget "any(i['status']=='DRAFT' for i in d['data']['items'])")
check "no DRAFT invoices visible" "False" "$HAS_DRAFT"
INV_COUNT=$(cat /tmp/pi.json | pyget "len(d['data']['items'])")
echo "  visible invoices: $INV_COUNT"
if [ "$INV_COUNT" != "0" ]; then
  IID=$(cat /tmp/pi.json | pyget "d['data']['items'][0]['id']")
  HTTP=$(curl -s -o /tmp/ivid.json -w "%{http_code}" -b portal.jar "$B/api/portal/invoices/$IID")
  check "invoice detail 200" "200" "$HTTP"
  ITEMS=$(cat /tmp/ivid.json | pyget "len(d['data']['invoice']['items'])")
  echo "  line items: $ITEMS"
fi

# ---------- 7. Portal tickets: full lifecycle ----------
echo "--- portal tickets lifecycle ---"
HTTP=$(curl -s -o /tmp/pt.json -w "%{http_code}" -b portal.jar -X POST "$B/api/portal/tickets" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Checkout button misaligned on Safari","category":"BUG","priority":"HIGH","description":"The checkout button overlaps the cart total on Safari 17. Steps: open cart, resize window."}')
check "create portal ticket" "201" "$HTTP"
TID=$(cat /tmp/pt.json | pyget "d['data']['id']")
TNUM=$(cat /tmp/pt.json | pyget "d['data']['ticketNumber']")
echo "  ticket: $TNUM"
HTTP=$(curl -s -o /tmp/pt2.json -w "%{http_code}" -b portal.jar -X POST "$B/api/portal/tickets" \
  -H "Content-Type: application/json" -d '{"subject":"Urgent hack attempt","priority":"URGENT"}')
check "portal cannot set URGENT 400" "400" "$HTTP"
HTTP=$(curl -s -o /tmp/ptl.json -w "%{http_code}" -b portal.jar "$B/api/portal/tickets")
check "ticket list 200" "200" "$HTTP"
HTTP=$(curl -s -o /tmp/ptd.json -w "%{http_code}" -b portal.jar "$B/api/portal/tickets/$TID")
check "ticket detail 200" "200" "$HTTP"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar -X POST "$B/api/portal/tickets/$TID" \
  -H "Content-Type: application/json" -d '{"body":"Adding more detail - the issue also appears in Chrome iOS."}')
check "client reply 201" "201" "$HTTP"
HTTP=$(curl -s -o /tmp/ptc.json -w "%{http_code}" -b portal.jar -X PATCH "$B/api/portal/tickets/$TID" \
  -H "Content-Type: application/json" -d '{"status":"CLOSED"}')
check "client closes ticket" "200" "$HTTP"
CLOSED=$(cat /tmp/ptc.json | pyget "d['data']['status']")
check "status is CLOSED" "CLOSED" "$CLOSED"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar -X POST "$B/api/portal/tickets/$TID" \
  -H "Content-Type: application/json" -d '{"body":"reply to closed"}')
check "reply to closed 400" "400" "$HTTP"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar -X PATCH "$B/api/portal/tickets/$TID" \
  -H "Content-Type: application/json" -d '{"status":"OPEN"}')
check "client reopens ticket" "200" "$HTTP"

# ---------- 8. Security: internal APIs + cross-client scoping ----------
echo "--- security ---"
for ep in leads projects invoices users settings audit tickets; do
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar "$B/api/$ep")
  check "portal blocked /api/$ep" "403" "$HTTP"
done
OTHER=$(curl -s -b admin.jar "$B/api/tickets?pageSize=50" | pyget "next((t['id'] for t in d['data']['items'] if t['client'] and t['client']['id'] != '$CLIENT_ID'), '')")
if [ -n "$OTHER" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar "$B/api/portal/tickets/$OTHER")
  check "cross-client ticket 404" "404" "$HTTP"
else
  echo "  (no cross-client ticket available to test)"
fi
OTHERINV=$(curl -s -b admin.jar "$B/api/invoices?pageSize=50" | pyget "next((i['id'] for i in d['data']['items'] if i.get('clientId') and i['clientId'] != '$CLIENT_ID'), '')")
if [ -n "$OTHERINV" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b portal.jar "$B/api/portal/invoices/$OTHERINV")
  check "cross-client invoice 404" "404" "$HTTP"
else
  echo "  (no cross-client invoice available to test)"
fi
curl -s -b portal.jar "$B/api/search?q=Nile" -o /tmp/search_raw.json
RAWSEARCH=$(cat /tmp/search_raw.json)
case "$RAWSEARCH" in
  *'"groups":[]'*) ok "search returns no groups for portal (raw: ${RAWSEARCH:0:40})";;
  *) bad "search returns no groups for portal (raw: ${RAWSEARCH:0:80})";;
esac
# notifyRole(SUPPORT) → check the SUPPORT member's notifications (support@ / Support@2026)
rm -f supcheck.jar
CSRF=$(curl -s -c supcheck.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b supcheck.jar -c supcheck.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=support@apex.system&password=Support@2026&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded"
NOTIF=$(curl -s -b supcheck.jar "$B/api/notifications?pageSize=10" | pyget "any('$TNUM' in (n['title'] or '') for n in d['data']['items'])")
check "support notified about $TNUM" "True" "$NOTIF"

# ---------- 9. Admin manages portal account ----------
echo "--- admin portal-account ops ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b admin.jar -X PATCH "$B/api/portal-users/$PU_ID" \
  -H "Content-Type: application/json" -d '{"isActive":false}')
check "deactivate portal user" "200" "$HTTP"
rm -f /tmp/p2.jar
CSRF=$(curl -s -c /tmp/p2.jar $B/api/auth/csrf | pyget "d['csrfToken']")
DEAD=$(curl -s -b /tmp/p2.jar -c /tmp/p2.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=$PU_EMAIL&password=Portal@2026&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded")
if echo "$DEAD" | grep -q "error"; then ok "deactivated login rejected"; else bad "deactivated login rejected"; fi
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b admin.jar -X PATCH "$B/api/portal-users/$PU_ID" \
  -H "Content-Type: application/json" -d '{"isActive":true}')
check "reactivate portal user" "200" "$HTTP"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b admin.jar -X PATCH "$B/api/portal-users/$PU_ID" \
  -H "Content-Type: application/json" -d '{"newPassword":"Portal@2027"}')
check "password reset" "200" "$HTTP"
rm -f /tmp/p3.jar
CSRF=$(curl -s -c /tmp/p3.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b /tmp/p3.jar -c /tmp/p3.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=$PU_EMAIL&password=Portal@2027&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded"
ROLE=$(curl -s -b /tmp/p3.jar $B/api/auth/session | pyget "d['user']['roleKeys'][0] if d.get('user') else 'NONE'")
check "login with new password" "CLIENT" "$ROLE"
STAFF=$(curl -s -b admin.jar "$B/api/users?pageSize=50" | pyget "next((u['id'] for u in d['data']['users'] if u.get('clientId') is None), '')")
if [ -n "$STAFF" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b admin.jar -X PATCH "$B/api/portal-users/$STAFF" \
    -H "Content-Type: application/json" -d '{"isActive":false}')
  check "staff via portal-users 404" "404" "$HTTP"
fi

echo ""
echo "=============================="
echo "PASS: $PASS  FAIL: $FAIL"
