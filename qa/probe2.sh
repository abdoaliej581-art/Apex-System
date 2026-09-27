#!/bin/bash
cd /tmp
echo "file size: $(wc -c < /tmp/search_raw.json)"
echo "traps: $(trap -p | head -3)"
echo "BASH_ENV=[$BASH_ENV] functrace=$(shopt -p functrace 2>/dev/null)"
pyget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
echo "A direct func no-subshell: $(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>&1 | tail -1)"
G=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/tmp/err.txt)
echo "B cmdsub: [$G] stderr=[$(cat /tmp/err.txt)]"
G2=$(python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "len(d['data']['groups'])" < /tmp/search_raw.json 2>/tmp/err2.txt)
echo "C cmdsub no-func: [$G2] stderr=[$(cat /tmp/err2.txt)]"
echo "D exit trap check:"
G3=$( (pyget "len(d['data']['groups'])" < /tmp/search_raw.json) 2>&1 )
echo "E subshell-explicit: [$G3]"
