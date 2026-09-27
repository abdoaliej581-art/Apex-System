#!/bin/bash
cd /tmp
pyget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
echo "test1: $(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/dev/null)"
GROUPS=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/dev/null)
echo "test2: [$GROUPS]"
echo "test3 argv check:"
pyget "repr(sys.argv[1])" < /tmp/search_raw.json
echo "test4 stdin content seen by python:"
pyget "repr(sys.stdin.read()[:50])" < /tmp/search_raw.json
