{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.fishtank-server;

  # Generate the viewer config.js from module options so the browser gets the
  # correct Auth0 credentials and server URL for each environment.
  viewerConfig = pkgs.writeText "fishtank-config.js" ''
    window.FISHTANK_CONFIG = {
      serverUrl: "",
      auth0Domain: "${cfg.auth0.domain}",
      auth0ClientId: "${cfg.auth0.clientId}",
    };
  '';

  # Build the Node.js server package from the repo source.
  # Build just the server/ subdirectory as the npm package.
  # shared/ is copied separately in installPhase so the running service can
  # reference map.txt via the MAP_FILE env var.
  serverPackage = pkgs.buildNpmPackage {
    pname = "fishtank-server";
    version = "0.1.0";
    # src must be the directory containing package.json / package-lock.json
    src = "${cfg.src}/server";
    npmDepsHash = cfg.npmDepsHash;
    dontNpmBuild = true;
    installPhase = ''
      mkdir -p $out/server $out/shared
      cp -r . $out/server
      cp -r ${cfg.src}/shared/. $out/shared
    '';
  };

  # Static viewer files with config.js overridden by the generated version.
  viewerPackage = pkgs.runCommand "fishtank-viewer" { } ''
    cp -r ${cfg.src}/viewer $out
    chmod u+w $out/config.js
    # Replace the committed dev-defaults config.js with the generated one
    cp ${viewerConfig} $out/config.js
  '';

in
{
  options.services.fishtank-server = {
    enable = lib.mkEnableOption "fishtank world server";

    src = lib.mkOption {
      type = lib.types.path;
      description = "Path to the fishtank repository root (pass inputs.fishtank from the infra flake)";
    };

    npmDepsHash = lib.mkOption {
      type = lib.types.str;
      description = ''
        npmDepsHash for buildNpmPackage. Get the correct value by setting
        lib.fakeHash here, running a build, and copying the hash Nix reports.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port the Node.js world server binds to (always 127.0.0.1)";
    };

    maxTurns = lib.mkOption {
      type = lib.types.nullOr lib.types.ints.positive;
      default = null;
      description = "Maximum turns per world run before auto-reset (null = unlimited)";
    };

    matingCost = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 0;
      description = "Energy cost per parent for mating";
    };

    auth0 = {
      domain = lib.mkOption {
        type = lib.types.str;
        description = "Auth0 tenant domain (e.g. myapp.eu.auth0.com)";
        example = "myapp.eu.auth0.com";
      };

      clientId = lib.mkOption {
        type = lib.types.str;
        description = "Auth0 application client ID (for the betting viewer SPA)";
      };
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Path to a sops-nix-decrypted env file containing secrets (AUTH0_DOMAIN, AUTH0_CLIENT_SECRET, DEEPSEEK_API_KEY, etc.)";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Additional plain environment variables passed to the service";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "fishtank";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "fishtank";
    };

    nginx = {
      serverName = lib.mkOption {
        type = lib.types.str;
        description = "nginx virtual host / server_name (the public hostname)";
        example = "fishtank.example.com";
      };

      enableSSL = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Enable TLS termination on this host via ACME.
          Leave false when a Cloudflare Tunnel terminates TLS externally.
        '';
      };

      acmeEmail = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Email for ACME cert registration (only needed when enableSSL = true)";
      };
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open port 80 (and 443 if SSL) in the firewall";
    };

    agentsConfig = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to an agents YAML config file used by fishtank-launcher.
        When set, a fishtank-launcher systemd service is started alongside the
        world server to spawn all agents listed in the config.
      '';
    };

    runnerPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = ''
        The fishtank-runner Python package providing agent-llm, fishtank-launcher,
        and fishtank-narrator binaries.  Pass
        inputs.fishtank.packages.''${system}.fishtank-runner here.
        Required when agentsConfig is set.
      '';
    };
  };

  config = lib.mkIf cfg.enable {

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
    };
    users.groups.${cfg.group} = { };

    systemd.services.fishtank-server = {
      description = "Fish Tank world server";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      environment =
        {
          PORT = toString cfg.port;
          NODE_ENV = "production";
          MATING_COST = toString cfg.matingCost;
          MAP_FILE = "${serverPackage}/shared/map.txt";
          DATA_DIR = "/var/lib/fishtank";
          # Non-secret Auth0 config; secret (AUTH0_CLIENT_SECRET etc.) comes from environmentFile
          AUTH0_DOMAIN = cfg.auth0.domain;
        }
        // lib.optionalAttrs (cfg.maxTurns != null) { MAX_TURNS = toString cfg.maxTurns; }
        // cfg.environment;

      serviceConfig =
        {
          User = cfg.user;
          Group = cfg.group;
          WorkingDirectory = "${serverPackage}";
          ExecStart = "${pkgs.nodejs}/bin/node ${serverPackage}/server/src/index.js";
          StateDirectory = "fishtank";
          StateDirectoryMode = "0750";
          Restart = "on-failure";
          RestartSec = 3;
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          ReadWritePaths = [ "/var/lib/fishtank" ];
        }
        // lib.optionalAttrs (cfg.environmentFile != null) {
          EnvironmentFile = cfg.environmentFile;
        };
    };

    systemd.services.fishtank-launcher = lib.mkIf (cfg.agentsConfig != null) {
      description = "Fish Tank agent launcher";
      after = [ "fishtank-server.service" ];
      wants = [ "fishtank-server.service" ];
      wantedBy = [ "multi-user.target" ];

      # Give the world server a moment to come up before spawning agents.
      preStart = ''
        echo "Waiting for world server on port ${toString cfg.port}..."
        for i in $(seq 1 30); do
          if ${pkgs.curl}/bin/curl -sf http://127.0.0.1:${toString cfg.port}/health > /dev/null 2>&1; then
            echo "World server is ready."
            exit 0
          fi
          sleep 1
        done
        echo "World server did not become ready in time." >&2
        exit 1
      '';

      serviceConfig =
        {
          User = cfg.user;
          Group = cfg.group;
          ExecStart = "${cfg.runnerPackage}/bin/fishtank-launcher --config ${cfg.agentsConfig} --server-url http://127.0.0.1:${toString cfg.port}";
          Restart = "on-failure";
          RestartSec = 10;
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          ReadWritePaths = [ "/tmp" "/var/log/fishtank" ];
          LogsDirectory = "fishtank";
        }
        // lib.optionalAttrs (cfg.environmentFile != null) {
          EnvironmentFile = cfg.environmentFile;
        };
    };

    services.nginx = {
      enable = true;
      recommendedProxySettings = true;
      recommendedGzipSettings = true;

      virtualHosts.${cfg.nginx.serverName} = {
        forceSSL = cfg.nginx.enableSSL;
        enableACME = cfg.nginx.enableSSL;

        extraConfig = ''
          # Redirect to HTTPS when the client-facing connection was plain HTTP.
          # Cloudflare sets X-Forwarded-Proto; direct port-80 traffic has no header.
          if ($http_x_forwarded_proto = "http") {
            return 301 https://$host$request_uri;
          }
        '';

        locations = {
          # SSE streams: disable buffering, long read timeout
          "~ ^/stream/" = {
            proxyPass = "http://127.0.0.1:${toString cfg.port}";
            extraConfig = ''
              proxy_http_version 1.1;
              proxy_set_header Connection "";
              proxy_buffering off;
              proxy_cache off;
              proxy_read_timeout 3600s;
              chunked_transfer_encoding on;
            '';
          };

          # All other API endpoints
          "~ ^/(act|register|narrate|telemetry|health|pause|resume|reset|api)(/|$)" = {
            proxyPass = "http://127.0.0.1:${toString cfg.port}";
          };

          # HTML and config.js: never cache so updates are always picked up immediately
          "~* \\.(html)$" = {
            root = "${viewerPackage}";
            tryFiles = "$uri =404";
            extraConfig = ''
              expires -1;
              add_header Cache-Control "no-store, no-cache, must-revalidate";
            '';
          };

          "= /config.js" = {
            root = "${viewerPackage}";
            extraConfig = ''
              expires -1;
              add_header Cache-Control "no-store, no-cache, must-revalidate";
            '';
          };

          # Static viewer — config.js is pre-generated with the correct env values
          "/" = {
            root = "${viewerPackage}";
            tryFiles = "$uri $uri/ =404";
            extraConfig = ''
              expires 1h;
              add_header Cache-Control "public";
            '';
          };
        };
      };
    };

    security.acme = lib.mkIf (cfg.nginx.enableSSL && cfg.nginx.acmeEmail != null) {
      acceptTerms = true;
      defaults.email = cfg.nginx.acmeEmail;
    };

    networking.firewall.allowedTCPPorts =
      lib.mkIf cfg.openFirewall ([ 80 ] ++ lib.optional cfg.nginx.enableSSL 443);
  };
}
