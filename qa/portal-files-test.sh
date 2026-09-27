#!/bin/bash
# APEX CRON-9 — Portal file uploads + /api/org E2E test suite
cd /tmp
B=http://localhost:3000
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  XX  $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 (expected $2, got $3)"; fi }
pyget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
catstr() { case "$(cat "$1")" in *"$2"*) echo True;; *) echo False;; esac; }

# ---------- logins ----------
rm -f adm.jar por.jar
CSRF=$(curl -s -c adm.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b adm.jar -c adm.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=admin@apex.system&password=Apex@2026&redirect=false&json=true" -H "Content-Type: application/x-www-form-urlencoded"
ROLE=$(curl -s -b adm.jar $B/api/auth/session | pyget "d['user']['roleKeys'][0]")
check "admin login" "SUPER_ADMIN" "$ROLE"

CLIENT_ID=$(curl -s -b adm.jar "$B/api/clients?pageSize=100" | pyget "[c['id'] for c in d['data']['items'] if 'Nile' in c['companyName']][0]")

PU_EMAIL="fileqa$(date +%s)@niledigital.eg"
PU_ID=$(curl -s -b adm.jar -X POST "$B/api/clients/$CLIENT_ID/portal-users" \
  -H "Content-Type: application/json" -d '{"name":"Test Uploader","email":"'"$PU_EMAIL"'","password":"Portal@2026"}' | pyget "d['data']['id']")
echo "  portal user: $PU_EMAIL ($PU_ID)"

CSRF=$(curl -s -c por.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b por.jar -c por.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=$PU_EMAIL&password=Portal@2026&redirect=false&json=true" -H "Content-Type: application/x-www-form-urlencoded"
PROLE=$(curl -s -b por.jar $B/api/auth/session | pyget "d['user']['roleKeys'][0]")
check "portal login" "CLIENT" "$PROLE"

# ---------- /api/org ----------
echo "--- org endpoint ---"
ORG=$(curl -s -b por.jar "$B/api/org" | pyget "d['data']['name']")
check "org via portal session" "APEX" "$ORG"
ORG2=$(curl -s -b adm.jar "$B/api/org" | pyget "d['data']['name']")
check "org via admin session" "APEX" "$ORG2"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$B/api/org")
check "org unauthenticated 401" "401" "$HTTP"

# ---------- portal ticket + file upload ----------
echo "--- portal file upload ---"
TID=$(curl -s -b por.jar -X POST "$B/api/portal/tickets" -H "Content-Type: application/json" \
  -d '{"subject":"Dashboard chart shows wrong totals","category":"BUG","priority":"MEDIUM","description":"Screenshot attached. The monthly total double-counts refunds."}' | pyget "d['data']['id']")
echo "  ticket: $TID"

printf 'refund,broken\nrefund,duplicated\n' > /tmp/evidence.csv
HTTP=$(curl -s -o /tmp/up.json -w "%{http_code}" -b por.jar -X POST "$B/api/portal/files" \
  -F "file=@/tmp/evidence.csv" -F "entityType=TICKET" -F "entityId=$TID")
check "portal upload to own ticket" "201" "$HTTP"
FILE_ID=$(cat /tmp/up.json | pyget "d['data']['id']")

printf '\x89PNG\r\n\x1a\n' > /tmp/shot.png
HTTP=$(curl -s -o /tmp/up2.json -w "%{http_code}" -b por.jar -X POST "$B/api/portal/files" \
  -F "file=@/tmp/shot.png;type=image/png" -F "entityType=TICKET" -F "entityId=$TID")
check "portal PNG upload" "201" "$HTTP"
FILE2_ID=$(cat /tmp/up2.json | pyget "d['data']['id']")

COUNT=$(curl -s -b por.jar "$B/api/portal/files?entityType=TICKET&entityId=$TID" | pyget "len(d['data']['files'])")
check "portal lists 2 files" "2" "$COUNT"

# ---------- scoping & validation ----------
echo "--- portal file scoping ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b por.jar -X POST "$B/api/portal/files" \
  -F "file=@/tmp/evidence.csv" -F "entityType=INVOICE" -F "entityId=whatever")
check "INVOICE type rejected 400" "400" "$HTTP"
OTHER_PROJECT=$(curl -s -b adm.jar "$B/api/projects?pageSize=50" | pyget "next((p['id'] for p in d['data']['items'] if p.get('clientId') and p['clientId'] != '$CLIENT_ID'), '')")
if [ -n "$OTHER_PROJECT" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b por.jar -X POST "$B/api/portal/files" \
    -F "file=@/tmp/evidence.csv" -F "entityType=PROJECT" -F "entityId=$OTHER_PROJECT")
  check "cross-client project upload 404" "404" "$HTTP"
else
  echo "  (no cross-client project available)"
fi
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b por.jar "$B/api/files?entityType=TICKET&entityId=$TID")
check "internal files API 403 for portal" "403" "$HTTP"

# ---------- download roundtrip ----------
echo "--- download ---"
curl -s -b por.jar "$B/api/portal/files/$FILE_ID/download" -o /tmp/dl.csv
if cmp -s /tmp/evidence.csv /tmp/dl.csv; then ok "download byte-identical"; else bad "download byte-identical"; fi
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$B/api/portal/files/$FILE_ID/download")
check "download unauthenticated 401" "401" "$HTTP"

# ---------- staff visibility ----------
echo "--- staff visibility ---"
STAFF_SEES=$(curl -s -b adm.jar "$B/api/files?entityType=TICKET&entityId=$TID" | pyget "len(d['data']['files'])")
check "staff sees portal uploads" "2" "$STAFF_SEES"
UPLOADER=$(curl -s -b adm.jar "$B/api/files?entityType=TICKET&entityId=$TID" | pyget "d['data']['files'][0]['uploader']['name']")
echo "  uploader shown to staff: $UPLOADER"
rm -f supn.jar
CSRF=$(curl -s -c supn.jar $B/api/auth/csrf | pyget "d['csrfToken']")
curl -s -o /dev/null -b supn.jar -c supn.jar -X POST $B/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=support@apex.system&password=Support@2026&redirect=false&json=true" \
  -H "Content-Type: application/x-www-form-urlencoded"
NOTIF=$(curl -s -b supn.jar "$B/api/notifications?pageSize=10" | pyget "any('attached a file' in (n['title'] or '') for n in d['data']['items'])")
check "support notified of upload" "True" "$NOTIF"

# ---------- delete rules ----------
echo "--- delete rules ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b por.jar -X DELETE "$B/api/portal/files/$FILE_ID")
check "portal deletes own upload" "200" "$HTTP"
LEFT=$(curl -s -b por.jar "$B/api/portal/files?entityType=TICKET&entityId=$TID" | pyget "len(d['data']['files'])")
check "one file remains" "1" "$LEFT"

# cleanup: remove second file via portal too, then delete ticket? (keep ticket as record)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -b por.jar -X DELETE "$B/api/portal/files/$FILE2_ID")
check "cleanup second file" "200" "$HTTP"
LEFT2=$(curl -s -b por.jar "$B/api/portal/files?entityType=TICKET&entityId=$TID" | pyget "len(d['data']['files'])")
check "ticket files empty" "0" "$LEFT2"

echo ""
echo "=============================="
echo "PASS: $PASS  FAIL: $FAIL"
