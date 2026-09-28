{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = {nixpkgs, ...}: let
    forAllSystems = f:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
        system: f nixpkgs.legacyPackages.${system}
      );
  in {
    formatter = forAllSystems (pkgs: pkgs.alejandra);

    devShells = forAllSystems (pkgs: {
      # wrangler and workerd deliberately come from devDependencies, not Nix:
      # pkgs.wrangler lags Cloudflare's weekly releases and workerd has no
      # standalone nixpkgs derivation. `bun install` fetches the matching
      # prebuilt workerd for this platform.
      default = pkgs.mkShell {
        packages = with pkgs; [
          bun
          nodejs_22 # wrangler/alchemy/vitest-pool-workers run under Node
          python3 # node-gyp
        ];
      };
    });
  };
}
