#!/bin/sh
set -e
DATA="${EZPROXY_DATA:-/data}"
mkdir -p "$DATA"
exec /app/ezproxy "$@"
