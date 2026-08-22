#!/bin/sh
set -e
DATA="${EASYPROXY_DATA:-/data}"
mkdir -p "$DATA"
exec /app/easyproxy "$@"
