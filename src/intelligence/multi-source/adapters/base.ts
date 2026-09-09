// ═══════════════════════════════════════════════════════════
// Phase 9A: Multi-Source Discovery — Adapter Interface
// ═══════════════════════════════════════════════════════════

import type { MultiSourceConfig, RawDiscovery, SourceFetchResult } from "../types";

export interface AdapterFetchResult {
  fetchResult: SourceFetchResult;
  discoveries: RawDiscovery[];
}

export interface DiscoveryAdapter {
  readonly sourceId: string;
  fetch(config: MultiSourceConfig): Promise<AdapterFetchResult>;
}
