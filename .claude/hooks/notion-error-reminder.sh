#!/usr/bin/env bash
# PostToolUse hook for Notion MCP tools.
# Triggers when mcp__better-notion__* returns an error response,
# injects a reminder to write a reverse test for the contract
# disclosed by the error message.
#
# Hook input (stdin): JSON with tool_name, tool_input, tool_response.
# Hook output (stdout): JSON with optional systemMessage shown to the model.

set -euo pipefail

# Read hook input
INPUT="$(cat)"

# Extract tool name and response
TOOL_NAME="$(printf '%s' "$INPUT" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/' || true)"
TOOL_RESPONSE="$(printf '%s' "$INPUT" | sed -nE 's/.*"tool_response"[[:space:]]*:[[:space:]]*"(.*)"[,}]?$/\1/p' | head -1 || true)"

# If we couldn't parse, fall back to checking the whole input for error patterns
if [ -z "$TOOL_RESPONSE" ]; then
  TOOL_RESPONSE="$INPUT"
fi

# Only act on better-notion MCP tools
case "$TOOL_NAME" in
  mcp__better-notion__*) ;;
  *) exit 0 ;;
esac

# Notion error indicators (from real Notion API responses):
#   - "validation_error" (400)
#   - "fetch failed" (network, often transient)
#   - "object_not_found" (404)
#   - "Integration does not have access" (auth)
#   - "is expected to be ..." (type contract)
#   - "should be defined" / "should not be present" (schema contract)
ERROR_PATTERNS='validation_error|fetch failed|object_not_found|Integration does not have access|is expected to be|should be defined|should not be present|unauthorized|rate_limited'

if ! printf '%s' "$TOOL_RESPONSE" | grep -qE "$ERROR_PATTERNS"; then
  exit 0
fi

# Extract a short hint of the error for the reminder
HINT="$(printf '%s' "$TOOL_RESPONSE" | grep -oE '"message"[[:space:]]*:[[:space:]]*"[^"]{0,200}"' | head -1 | sed -E 's/.*"message"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' || true)"
if [ -z "$HINT" ]; then
  HINT="$(printf '%s' "$TOOL_RESPONSE" | grep -oE '(validation_error|fetch failed|object_not_found|Integration does not have access)[^"]{0,150}' | head -1 || true)"
fi

# Build the reminder message
cat <<EOF
{
  "systemMessage": "⚠️ Notion API error in ${TOOL_NAME}. Hint: ${HINT}\\n\\n**按 CLAUDE.md 'Testing methodology' 规则**: 这个 error 信息包含 schema contract (\"X should be defined\" / \"X should not be present\" / \"is expected to be X\"). 提取 contract → 写一个反向测试固化它 (TDD: red → green → refactor)。Mock data 抓不到这类 edge case；只有真实 Notion 才会暴露。考虑: (1) error contract 是 API 真实行为, doc 不可信, (2) 把这个 case 加到 fixtures/probe-notion.ts 让以后自动捕获。"
}
EOF
