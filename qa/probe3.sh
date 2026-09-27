#!/bin/bash
cd /tmp
pyget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
X=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/dev/null)
echo "X(2>/dev/null)=[$X] len=${#X}"
Y=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/tmp/e2.txt)
echo "Y(2>file)=[$Y]"
Z=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>/dev/null)
echo "Z(2>/dev/null again)=[$Z] len=${#Z}"
W=$(pyget "len(d['data']['groups'])" < /tmp/search_raw.json 2>&-)
echo "W(2>&- closed)=[$W] len=${#W}"
