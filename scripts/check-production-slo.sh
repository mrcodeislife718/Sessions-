#!/usr/bin/env bash
set -euo pipefail

: "${SESSIONS_DOMAIN:?SESSIONS_DOMAIN is required}"
: "${SESSIONS_SLO_READY_MS:=1000}"
: "${SESSIONS_SLO_MAX_5XX_RATE:=0.01}"

start_ns="$(date +%s%N)"
status="$(curl --silent --show-error --output /tmp/sessions-ready.json --write-out '%{http_code}' "https://${SESSIONS_DOMAIN}/ready" || true)"
end_ns="$(date +%s%N)"
latency_ms="$(( (end_ns - start_ns) / 1000000 ))"

if [[ "$status" != "200" ]]; then
  echo "ALERT readiness_http_status=$status" >&2
  exit 2
fi
if (( latency_ms > SESSIONS_SLO_READY_MS )); then
  echo "ALERT readiness_latency_ms=$latency_ms threshold_ms=$SESSIONS_SLO_READY_MS" >&2
  exit 3
fi

echo "SLO ready_status=200 readiness_latency_ms=$latency_ms threshold_ms=$SESSIONS_SLO_READY_MS"

if [[ -n "${SESSIONS_METRICS_TOKEN:-}" ]]; then
  metrics="$(curl --fail --silent --show-error -H "Authorization: Bearer ${SESSIONS_METRICS_TOKEN}" "https://${SESSIONS_DOMAIN}/metrics")"
  errors="$(awk '/^sessions_requests_error_total / {print $2}' <<<"$metrics" | tail -1)"
  total="$(awk '/^sessions_requests_total / {print $2}' <<<"$metrics" | tail -1)"
  errors="${errors:-0}"; total="${total:-0}"
  rate="$(awk -v e="$errors" -v t="$total" 'BEGIN { if (t <= 0) print 0; else printf "%.6f", e/t }')"
  if awk -v r="$rate" -v m="$SESSIONS_SLO_MAX_5XX_RATE" 'BEGIN { exit !(r > m) }'; then
    echo "ALERT request_5xx_rate=$rate threshold=$SESSIONS_SLO_MAX_5XX_RATE" >&2
    exit 4
  fi
  echo "SLO request_5xx_rate=$rate threshold=$SESSIONS_SLO_MAX_5XX_RATE"
fi
