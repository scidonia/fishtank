#!/usr/bin/env bash
# Dev shell hook — loads env files for the active profile,
# decrypting secrets via sops/age.
# Sourced automatically by the Nix devShell shellHook.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$REPO_ROOT/env"

load_env_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "warn: env file not found: $file" >&2
        return
    fi

    if [[ "$file" == */secrets/* ]]; then
        if ! command -v sops &>/dev/null; then
            echo "warn: sops not found — cannot load $file" >&2
            return
        fi
        local decrypted
        decrypted=$(sops -d "$file" 2>&1)
        if [[ $? -ne 0 ]]; then
            echo "warn: failed to decrypt $file: $decrypted" >&2
            return
        fi
        set -o allexport
        # shellcheck disable=SC1090
        source <(echo "$decrypted")
        set +o allexport
        echo "loaded secrets: $file"
    else
        set -o allexport
        # shellcheck disable=SC1090
        source "$file"
        set +o allexport
        echo "loaded env: $file"
    fi
}

# Determine active profile
profile_file="$REPO_ROOT/.env.profile"
if [[ -z "${FISHTANK_ENV_PROFILE:-}" ]]; then
    if [[ -f "$profile_file" ]]; then
        FISHTANK_ENV_PROFILE="$(tr -d ' \t\n\r' < "$profile_file")"
    fi
fi
FISHTANK_ENV_PROFILE="${FISHTANK_ENV_PROFILE:-local}"
export FISHTANK_ENV_PROFILE

profiles_yaml="$ENV_DIR/profiles.yaml"
if [[ ! -f "$profiles_yaml" ]]; then
    echo "warn: env/profiles.yaml not found" >&2
else
    # Extract file list for the active profile using a minimal awk parser
    profile_files="$(awk -v profile="$FISHTANK_ENV_PROFILE:" '
        /^[^ ]/ { in_profile = ($0 == profile) }
        in_profile && /^  - / { sub(/^  - /, ""); print }
    ' "$profiles_yaml")"

    if [[ -z "$profile_files" ]]; then
        echo "warn: unknown profile '$FISHTANK_ENV_PROFILE' in env/profiles.yaml" >&2
    else
        while IFS= read -r rel_path; do
            load_env_file "$ENV_DIR/$rel_path"
        done <<< "$profile_files"
    fi
fi
