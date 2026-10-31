{
  description = "mensa. – a static menu browser for Studentenwerk Dresden cafeterias";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

      # Files that are published together. Keep in sync with the deploy list in README.md.
      siteFiles = [
        "app.js"
        "calendar.js"
        "favicon.svg"
        "index.html"
        "meal-filters.js"
        "meal-picker.js"
        "meal-slot.js"
        "styles.css"
        "swipe.js"
        "theme.js"
      ];

      # The site has no build step: the package is just the deployable file set.
      mkSite =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "mensa";
          version = "0-unstable-${self.shortRev or self.dirtyShortRev or "dirty"}";
          src = self;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/mensa
            cp ${nixpkgs.lib.escapeShellArgs siteFiles} $out/share/mensa/
            runHook postInstall
          '';
        };
    in
    {
      packages = forAllSystems (system: {
        default = mkSite system;
      });

      # `nix run` serves the built site; PORT=8006 BIND=0.0.0.0 for phone testing.
      apps = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          site = mkSite system;
        in
        {
          default = {
            type = "app";
            meta.description = "Serve the built mensa. site over HTTP";
            program = "${pkgs.writeShellScript "mensa-serve" ''
              port=''${PORT:-8000}
              bind=''${BIND:-127.0.0.1}
              echo "Serving mensa on http://$bind:$port (Ctrl-C to stop)" >&2
              exec ${nixpkgs.lib.getExe pkgs.python3} -m http.server "$port" --bind "$bind" \
                --directory ${site}/share/mensa
            ''}";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = nixpkgs.lib;
          site = mkSite system;
        in
        {
          # Runs the /tests/*.html regression pages against the *built* site in headless
          # Chromium, so deployment drift breaks the check, not production.
          browser =
            pkgs.runCommand "mensa-browser-checks"
              {
                nativeBuildInputs = [
                  pkgs.chromium
                  pkgs.nodejs
                  pkgs.python3
                ];
                src = self;
                CHROMIUM = lib.getExe pkgs.chromium;
                NODE = lib.getExe pkgs.nodejs;
                PYTHON = lib.getExe pkgs.python3;
                # Chromium aborts without any fonts in the sandbox (Skia font manager).
                FONTCONFIG_FILE = pkgs.makeFontsConf {
                  fontDirectories = [
                    pkgs.dejavu_fonts
                    pkgs.liberation_ttf
                    pkgs.noto-fonts-color-emoji
                  ];
                };
              }
              ''
                export HOME=$(mktemp -d)
                mkdir site
                cp -r ${site}/share/mensa/. site/
                cp -r $src/tests site/tests
                bash $src/tests/browser-tests.sh site
                touch $out
              '';
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.chromium
              pkgs.nodejs
              pkgs.python3
              pkgs.nixfmt
            ];
            shellHook = ''
              echo "mensa devShell"
              echo "  serve:  python3 -m http.server 8000"
              echo "  tests:  tests/browser-tests.sh   (headless Chromium, all /tests pages)"
              echo "  format: nix fmt flake.nix"
            '';
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
