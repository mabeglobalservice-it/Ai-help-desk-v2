import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // docs/07-architecture-logicielle.md §10, docs/14-plan-deploiement-cloud.md
  // §3 : image Docker de production minimale (fichiers tracés + une partie de
  // node_modules seulement, sans devDependencies) — voir frontend/Dockerfile.
  output: "standalone",
};

export default nextConfig;
