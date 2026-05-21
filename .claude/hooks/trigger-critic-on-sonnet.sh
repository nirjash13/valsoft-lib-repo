#!/usr/bin/env bash
#
# trigger-critic-on-sonnet.sh
#
# SubagentStop hook: when builder-sonnet or bug-fixer-sonnet completes, inject
# a system-level instruction into the parent agent's context telling it to
# spawn critic-opus for review before doing anything else.
#
# Loop prevention: for any other agent_type (critic-opus, writer-haiku,
# architect-opus, debugger-buddy, python-reviewer, general-purpose, etc.) the
# hook exits silently so the review agent's own completion does not retrigger
# another review cycle.
#
# This script uses only POSIX tools (no jq) so it works on any bash shell,
# including minimal Git-Bash installs on Windows.
#
# Usage: registered in .claude/settings.json under hooks.SubagentStop.
# Input:  JSON on stdin, shape documented at
#         https://code.claude.com/docs/en/hooks.md
# Output: JSON on stdout OR empty (pass-through). Exit 0 always.

set -euo pipefail

# --- read hook input --------------------------------------------------------

input="$(cat)"

# --- extract agent_type without jq ------------------------------------------
#
# The hook input is a flat JSON object with a string field "agent_type".
# A single POSIX grep + sed extracts it. If the field is absent or the JSON
# shape changes in a future Claude Code version, agent_type is empty and we
# fall through to the pass-through branch.

agent_type="$(
  printf '%s' "$input" \
    | grep -oE '"agent_type"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed -E 's/.*"agent_type"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' \
    | head -n1 \
    || true
)"

# --- optional debug log -----------------------------------------------------
#
# Uncomment the next two lines while debugging. They append one line per hook
# invocation to a log file so you can verify the hook is firing and that
# agent_type parsing is working.
#
# log_file="${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/subagent-stop.log"
# printf '[%s] agent_type=%q\n' "$(date -Iseconds)" "${agent_type:-}" >> "$log_file"

# --- routing ----------------------------------------------------------------

case "${agent_type:-}" in
  builder-sonnet|bug-fixer-sonnet)
    # Inject a hard instruction back into the parent agent's context telling
    # it to run critic-opus now. The message is intentionally imperative and
    # specific so the parent cannot reasonably skip it.
    #
    # Note: hooks cannot directly invoke the Task tool. They can only inject
    # context. The strong wording + project-policy reference is what keeps
    # this reliable in practice.
    cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStop",
    "additionalContext": "AUTO-REVIEW HOOK FIRED.\n\nA Sonnet implementation subagent (builder-sonnet or bug-fixer-sonnet) just finished. Per the auto-review policy in .claude/AGENTS.md and .claude/CLAUDE.md you MUST now spawn `critic-opus` via the Task tool to review the changes BEFORE doing anything else.\n\nHard rules for this turn:\n1. Do NOT write a summary to the user yet.\n2. Do NOT mark any task as completed yet.\n3. Do NOT move on to another task or file.\n4. Your very next action must be a Task tool call with subagent_type=\"critic-opus\".\n5. If critic-opus returns REQUEST CHANGES or REJECT, spawn bug-fixer-sonnet (or builder-sonnet) to fix the issues, then re-run critic-opus. Loop until APPROVE.\n6. Only after APPROVE may you report back to the user.\n\nYou may additionally spawn `dotnet-reviewer` in the SAME message as critic-opus (parallel Task calls) to get deterministic build/test/format/vuln output alongside the reasoning review.\n\nThis instruction was injected by the SubagentStop hook at .claude/hooks/trigger-critic-on-sonnet.sh and is not optional."
  }
}
JSON
    exit 0
    ;;

  *)
    # Pass-through for every other agent type. Critically this includes
    # critic-opus itself, which is how we avoid an infinite review loop.
    exit 0
    ;;
esac
