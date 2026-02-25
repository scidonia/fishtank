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
      serverUrl: '',
      auth0Domain: '${cfg.auth0.domain}',
      auth0ClientId: '${cfg.auth0.clientId}',
    };
  '';

  # Build the Node.js server package from the repo source.
  # server/ and shared/ are both included to satisfy __dirname-relative imports.
  serverPackage = pkgs.buildNpmPackage {
    pname = "fishtank-server";
    version = "0.1.0";
    src = lib.cleanSourceWith {
      src = cfg.src;
      filter =
        path: _type:
        let
          rel = lib.removePrefix (toString cfg.src + "/") path;
        in
        lib.any (prefix: lib.hasPrefix prefix rel) [
          "server/"
          "shared/"
        ];
    };
    npmRoot = "server";
    npmDepsHash = cfg.npmDepsHash;
    dontNpmBuild = true;
    installPhase = ''
      mkdir -p $out
      cp -r server $out/server
      cp -r shared $out/shared
    '';
  };

  # Static viewer files with config.js overridden by the generated version.
  viewerPackage = pkgs.runCommand "fishtank-viewer" { } ''
    cp -r ${cfg.src}/viewer $out
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
        description = "Auth0 tenant domain (e.g. your-tenant.eu.auth0.com)";
        example = "your-tenant.eu.auth0.com";
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

    services.nginx = {
      enable = true;
      recommendedProxySettings = true;
      recommendedGzipSettings = true;

      virtualHosts.${cfg.nginx.serverName} = {
        forceSSL = cfg.nginx.enableSSL;
        enableACME = cfg.nginx.enableSSL;

        locations = {
          # SSE streams: disable buffering, long read timeout
          "~ ^/stream/" = {
            proxyPass = "http://127.0.0.1:${toString cfg.port}";
            extraConfig = ''
              proxy_http_version 1.1;
              proxy_set_header Connection '';
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
