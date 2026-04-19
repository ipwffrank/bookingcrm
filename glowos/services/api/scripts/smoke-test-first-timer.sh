#!/usr/bin/env bash
# Smoke test for the first-timer verification endpoints.
#
# Usage:
#   ./smoke-test-first-timer.sh <BASE_URL> <SLUG> <EXISTING_PHONE> <NEW_PHONE>
#
# Example (staging):
#   ./smoke-test-first-timer.sh \
#     https://bookingcrm-staging.up.railway.app \
#     glowos-demo \
#     +6591001010 \
#     +6599990001
#
# Requirements:
#   - `EXISTING_PHONE` must be a phone that has at least one completed
#     booking at the given merchant (a true returning customer).
#   - `NEW_PHONE` must be a phone with NO client record anywhere
#     (a truly new customer).
#   - `jq` on $PATH.
#
# The script prints PASS/FAIL per check and exits non-zero on first failure.

set -u

BASE_URL="${1:?BASE_URL required}"
SLUG="${2:?SLUG required}"
EXISTING_PHONE="${3:?EXISTING_PHONE required}"
NEW_PHONE="${4:?NEW_PHONE required}"

PASS="\033[32mPASS\033[0m"
FAIL="\033[31mFAIL\033[0m"

checks_run=0
checks_failed=0

assert_json_eq() {
  local label="$1"
  local body="$2"
  local jq_expr="$3"
  local expected="$4"
  checks_run=$((checks_run + 1))
  local actual
  actual=$(echo "$body" | jq -r "$jq_expr" 2>/dev/null)
  if [[ "$actual" == "$expected" ]]; then
    echo -e "$PASS  $label"
  else
    echo -e "$FAIL  $label"
    echo "       expected: $expected"
    echo "       actual:   $actual"
    echo "       body:     $body"
    checks_failed=$((checks_failed + 1))
  fi
}

assert_http_status() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  checks_run=$((checks_run + 1))
  if [[ "$actual" == "$expected" ]]; then
    echo -e "$PASS  $label"
  else
    echo -e "$FAIL  $label (http $actual, expected $expected)"
    checks_failed=$((checks_failed + 1))
  fi
}

echo "── Group 1: lookup-client + normalization ──────────────────"

# 1.1 Returning customer matches
body=$(curl -s -X POST "$BASE_URL/booking/$SLUG/lookup-client" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$EXISTING_PHONE\"}")
assert_json_eq "1.1 returning customer matches"              "$body" ".matched" "true"

# 1.2 Returning customer matches with spaces in phone (normalization)
# Insert a space after the country code
SPACED_PHONE=$(echo "$EXISTING_PHONE" | sed 's/^\(\+[0-9]\{2\}\)/\1 /')
body=$(curl -s -X POST "$BASE_URL/booking/$SLUG/lookup-client" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$SPACED_PHONE\"}")
assert_json_eq "1.2 returning customer matches (spaced $SPACED_PHONE)" "$body" ".matched" "true"

# 1.3 New customer does not match
body=$(curl -s -X POST "$BASE_URL/booking/$SLUG/lookup-client" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NEW_PHONE\"}")
assert_json_eq "1.3 new customer does not match"            "$body" ".matched" "false"

# 1.4 Invalid phone does not match
body=$(curl -s -X POST "$BASE_URL/booking/$SLUG/lookup-client" \
  -H "Content-Type: application/json" \
  -d '{"phone":"abc"}')
assert_json_eq "1.4 invalid phone does not match"           "$body" ".matched" "false"

echo
echo "── Group 2: check-first-timer ──────────────────────────────"

# 2.1 Returning customer: isFirstTimer = false
body=$(curl -s "$BASE_URL/merchant/services/check-first-timer?slug=$SLUG&phone=$EXISTING_PHONE")
assert_json_eq "2.1 returning → isFirstTimer=false"          "$body" ".isFirstTimer" "false"

# 2.2 Returning customer with reformatted phone: isFirstTimer = false (normalization)
SPACED_PHONE_URLENC=$(echo "$SPACED_PHONE" | sed 's/ /%20/g' | sed 's/+/%2B/g')
body=$(curl -s "$BASE_URL/merchant/services/check-first-timer?slug=$SLUG&phone=$SPACED_PHONE_URLENC")
assert_json_eq "2.2 reformatted returning → isFirstTimer=false" "$body" ".isFirstTimer" "false"

# 2.3 New customer: isFirstTimer = true
body=$(curl -s "$BASE_URL/merchant/services/check-first-timer?slug=$SLUG&phone=$NEW_PHONE")
assert_json_eq "2.3 new → isFirstTimer=true"                 "$body" ".isFirstTimer" "true"

# 2.4 Non-existent merchant: 404 (fix I6)
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/merchant/services/check-first-timer?slug=merchant-that-does-not-exist&phone=$NEW_PHONE")
assert_http_status "2.4 missing merchant → 404"              "$status" "404"

echo
echo "── Group 3: otp/send — happy path and guards ───────────────"

# 3.1 WhatsApp OTP send succeeds (first call after rate-limit window; depends on Twilio sandbox)
status=$(curl -s -o /tmp/otp-send-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/booking/$SLUG/otp/send" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NEW_PHONE\",\"channel\":\"whatsapp\",\"purpose\":\"first_timer_verify\"}")
body=$(cat /tmp/otp-send-body.json)
assert_http_status "3.1 otp/send whatsapp → 200"             "$status" "200"
assert_json_eq     "3.1 otp/send whatsapp sent=true"         "$body"   ".sent" "true"

# 3.2 email channel without email → 400, does NOT burn phone rate-limit (fix I2)
status=$(curl -s -o /tmp/otp-send-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/booking/$SLUG/otp/send" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NEW_PHONE\",\"channel\":\"email\",\"purpose\":\"first_timer_verify\"}")
assert_http_status "3.2 otp/send email no email → 400"       "$status" "400"

# 3.3 Invalid phone → 400
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/booking/$SLUG/otp/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"abc","channel":"whatsapp","purpose":"first_timer_verify"}')
assert_http_status "3.3 otp/send invalid phone → 400"        "$status" "400"

# 3.4 Unknown merchant slug → 404
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/booking/merchant-that-does-not-exist/otp/send" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NEW_PHONE\",\"channel\":\"whatsapp\",\"purpose\":\"first_timer_verify\"}")
assert_http_status "3.4 otp/send missing merchant → 404"     "$status" "404"

echo
echo "── Group 4: otp/verify — guards ────────────────────────────"

# 4.1 Wrong code → 401
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/booking/$SLUG/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NEW_PHONE\",\"code\":\"000000\",\"purpose\":\"first_timer_verify\"}")
assert_http_status "4.1 otp/verify wrong code → 401"         "$status" "401"

# 4.2 Verify without prior send → 410 (Gone)
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/booking/$SLUG/otp/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+6590000000","code":"123456","purpose":"login"}')
assert_http_status "4.2 otp/verify no prior send → 410"      "$status" "410"

echo
echo "── Group 5: rate limits ────────────────────────────────────"

# 5.1 Trigger 3 more sends (already sent 1 in 3.1 → 4 total) and expect the 4th to be 429.
# Note: rate-limit key is scoped to phone (+6599990001 in this example).
# If tests 3.x were re-run or the window hasn't reset, results may differ.
send_code=0
for i in 2 3 4; do
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/booking/$SLUG/otp/send" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$NEW_PHONE\",\"channel\":\"whatsapp\",\"purpose\":\"first_timer_verify\"}")
  echo "       send #$i → $status"
  send_code=$status
done
assert_http_status "5.1 4th send in window → 429"            "$send_code" "429"

echo
echo "────────────────────────────────────────────────────────────"
echo "Total: $checks_run checks, $checks_failed failed."
if [[ "$checks_failed" -gt 0 ]]; then
  exit 1
fi
exit 0
