#!/usr/bin/env fish
# Batch-derive zemer-cipher player_configs entries from player.js files.
#
# Examples:
#   ./scripts/batch-derive-players.fish --from-registry
#   ./scripts/batch-derive-players.fish --dir data/player-js
#   ./scripts/batch-derive-players.fish --fetch 66a6ea83 4918c89a f551602d
#   ./scripts/batch-derive-players.fish --compare --from-registry --limit 20
#
# Requires: deno, jq, curl (for --fetch)

set -l script_dir (status dirname)
set -l repo_root (realpath "$script_dir/..")
cd $repo_root; or exit 1

set -l limit 20
set -l out derived_player_configs.json
set -l player_dir ""
set -l hashes_file ""
set -l from_registry 0
set -l fetch 0
set -l compare 0
set -l cache_dir data/player-js
set -l hashes

argparse \
    'h/help' \
    'limit=' \
    'out=' \
    'dir=' \
    'hashes-file=' \
    'cache-dir=' \
    'from-registry' \
    'fetch' \
    'compare' \
    -- $argv
or begin
    echo "usage: $argv[0] [--from-registry] [--dir <path>] [<hash> ...]" >&2
    echo "       [--hashes-file <path>] [--fetch] [--limit 20] [--out <json>] [--compare]" >&2
    exit 1
end

if set -q _flag_help
    echo "Batch-derive zemer-cipher player_configs from player.js files."
    exit 0
end

set -q _flag_limit; and set limit $_flag_limit
set -q _flag_out; and set out $_flag_out
set -q _flag_dir; and set player_dir $_flag_dir
set -q _flag_hashes_file; and set hashes_file $_flag_hashes_file
set -q _flag_cache_dir; and set cache_dir $_flag_cache_dir
set -q _flag_from_registry; and set from_registry 1
set -q _flag_fetch; and set fetch 1
set -q _flag_compare; and set compare 1

# Registry mode downloads player_ias unless a local directory is provided.
if test $from_registry -eq 1; and test -z "$player_dir"
    set fetch 1
end

# Remaining argv after argparse are positional hashes.
set hashes $argv

if test $from_registry -eq 1
    if not test -f registry/player_configs.json
        echo "registry/player_configs.json not found" >&2
        exit 1
    end
    set hashes (
        jq -r '.players | keys[]' registry/player_configs.json | head -n $limit
    )
else if test -n "$hashes_file"
    set hashes (grep -E '^[a-f0-9]{8}$' "$hashes_file" | head -n $limit)
else if test -n "$player_dir"
    set hashes
    for file in $player_dir/*.js
        test -f $file; or continue
        set -l hash (extract_hash_from_name (basename $file))
        test -n "$hash"; and set hashes $hashes $hash
        test (count $hashes) -ge $limit; and break
    end
else if test (count $hashes) -eq 0
    echo "No inputs: use --from-registry, --dir, --hashes, or --hashes-file" >&2
    exit 1
end

if test (count $hashes) -eq 0
    echo "No player hashes/files to process" >&2
    exit 1
end

if test (count $hashes) -gt $limit
    set hashes $hashes[1..$limit]
end

command -v jq >/dev/null; or begin
    echo "jq is required" >&2
    exit 1
end

set -l players_json '{}'
set -l ok 0
set -l failed 0
set -l mismatched 0

echo "Deriving (limit=$limit, count="(count $hashes)")..." >&2

for hash in $hashes
    set -l file ""
    if test -n "$player_dir"
        set file (find_player_file $player_dir $hash)
        if test -z "$file"
            echo "  $hash  SKIP  no .js file in $player_dir" >&2
            set failed (math $failed + 1)
            continue
        end
    else if test $fetch -eq 1
        mkdir -p $cache_dir
        set file "$cache_dir/$hash.js"
        set -l url "https://www.youtube.com/s/player/$hash/player_ias.vflset/en_GB/base.js"
        if not curl -fsSL "$url" -o "$file"
            echo "  $hash  FAIL  download" >&2
            set failed (math $failed + 1)
            continue
        end
    else if test -f "$cache_dir/$hash.js"
        set file "$cache_dir/$hash.js"
    else
        echo "  $hash  SKIP  no file (use --fetch or --dir)" >&2
        set failed (math $failed + 1)
        continue
    end

    set -l derive_json (
        deno run --allow-read --allow-env scripts/derive-player-config.ts -- \
            --player-file "$file" \
            --player-hash "$hash" 2>/dev/null
    )
    if test $status -ne 0
        echo "  $hash  FAIL  derive exited $status" >&2
        set failed (math $failed + 1)
        continue
    end

    set -l entry (echo $derive_json | jq -c '.entry // null')
    if test "$entry" = null -o "$entry" = "null"
        echo "  $hash  FAIL  incomplete entry (missing sig/nClass/sts)" >&2
        set failed (math $failed + 1)
        continue
    end

    set players_json (echo $players_json | jq --arg h $hash --argjson e $entry '. + {($h): $e}')
    echo "  $hash  OK    "(echo $entry | jq -r '"sig=\(.sig) nClass=\(.nClass) sts=\(.sts)"') >&2
    set ok (math $ok + 1)

    if test $compare -eq 1 -a -f registry/player_configs.json
        set -l expected (jq -c --arg h $hash '.players[$h] // null' registry/player_configs.json)
        if test "$expected" = null -o "$expected" = "null"
            echo "       (no committed config to compare)" >&2
        else
            set -l same (echo "$expected" "$entry" | jq -s '.[0] == .[1]')
            if test "$same" = true
                echo "       matches registry" >&2
            else
                echo "       MISMATCH vs registry:" >&2
                echo "         expected: $expected" >&2
                echo "         derived:  $entry" >&2
                set mismatched (math $mismatched + 1)
            end
        end
    end
end

set -l output (
    echo $players_json | jq '{
        schemaVersion: 1,
        players: (to_entries | sort_by(.value.sts) | from_entries)
    }'
)

mkdir -p (dirname $out)
echo $output > $out

echo "" >&2
echo "Wrote $out ($ok ok, $failed failed"(test $compare -eq 1; and echo ", $mismatched mismatched"; or echo "")")" >&2

if test $ok -eq 0 -o $failed -gt 0 -o $mismatched -gt 0
    exit 1
end

exit 0

function extract_hash_from_name -a name
    string match -rq '([a-f0-9]{8})' -- $name
    and echo $matches[1]
end

function find_player_file -a dir -a hash
    for pattern in "$hash.js" "player-$hash.js" "$hash.base.js"
        set -l candidate "$dir/$pattern"
        test -f $candidate; and echo $candidate; and return 0
    end
    for file in $dir/*.js
        set -l h (extract_hash_from_name (basename $file))
        test "$h" = "$hash"; and echo $file; and return 0
    end
end
