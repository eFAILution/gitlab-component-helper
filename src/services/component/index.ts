// Main orchestrator service
export { ComponentService, getComponentService, ComponentSource } from './componentService';

// Specialized services
export { TokenManager } from './tokenManager';
export { UrlParser, ParsedComponentUrl } from './urlParser';
export { VersionManager } from './versionManager';
export { ComponentFetcher } from './componentFetcher';

// Discovery configuration
export {
  DiscoveryConfig,
  DiscoveryOverride,
  ComponentSourceWithDiscovery,
  HARD_DEFAULTS,
  DISCOVERY_LIMITS,
  mergeDiscoveryConfig,
  clampDiscoveryConfig,
  buildTemplatePathCandidates,
  matchesFilePattern,
  readGlobalDiscoveryConfig,
  getDiscoveryConfigForSource,
} from './discoveryConfig';

// Command registration
export { registerAddProjectTokenCommand } from './commands';
