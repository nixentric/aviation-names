import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/airport.ts", "src/airline.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  platform: "neutral",
  // Each entry inlines only the data it needs, so importing "aviation-names/airline"
  // never pulls the airport dataset into a consumer bundle.
  unbundle: false,
});
