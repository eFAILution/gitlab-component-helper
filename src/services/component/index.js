"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAddProjectTokenCommand = exports.getDiscoveryConfigForSource = exports.readGlobalDiscoveryConfig = exports.matchesFilePattern = exports.buildTemplatePathCandidates = exports.clampDiscoveryConfig = exports.mergeDiscoveryConfig = exports.DISCOVERY_LIMITS = exports.HARD_DEFAULTS = exports.ComponentFetcher = exports.VersionManager = exports.UrlParser = exports.TokenManager = exports.getComponentService = exports.ComponentService = void 0;
// Main orchestrator service
var componentService_1 = require("./componentService");
Object.defineProperty(exports, "ComponentService", { enumerable: true, get: function () { return componentService_1.ComponentService; } });
Object.defineProperty(exports, "getComponentService", { enumerable: true, get: function () { return componentService_1.getComponentService; } });
// Specialized services
var tokenManager_1 = require("./tokenManager");
Object.defineProperty(exports, "TokenManager", { enumerable: true, get: function () { return tokenManager_1.TokenManager; } });
var urlParser_1 = require("./urlParser");
Object.defineProperty(exports, "UrlParser", { enumerable: true, get: function () { return urlParser_1.UrlParser; } });
var versionManager_1 = require("./versionManager");
Object.defineProperty(exports, "VersionManager", { enumerable: true, get: function () { return versionManager_1.VersionManager; } });
var componentFetcher_1 = require("./componentFetcher");
Object.defineProperty(exports, "ComponentFetcher", { enumerable: true, get: function () { return componentFetcher_1.ComponentFetcher; } });
// Discovery configuration
var discoveryConfig_1 = require("./discoveryConfig");
Object.defineProperty(exports, "HARD_DEFAULTS", { enumerable: true, get: function () { return discoveryConfig_1.HARD_DEFAULTS; } });
Object.defineProperty(exports, "DISCOVERY_LIMITS", { enumerable: true, get: function () { return discoveryConfig_1.DISCOVERY_LIMITS; } });
Object.defineProperty(exports, "mergeDiscoveryConfig", { enumerable: true, get: function () { return discoveryConfig_1.mergeDiscoveryConfig; } });
Object.defineProperty(exports, "clampDiscoveryConfig", { enumerable: true, get: function () { return discoveryConfig_1.clampDiscoveryConfig; } });
Object.defineProperty(exports, "buildTemplatePathCandidates", { enumerable: true, get: function () { return discoveryConfig_1.buildTemplatePathCandidates; } });
Object.defineProperty(exports, "matchesFilePattern", { enumerable: true, get: function () { return discoveryConfig_1.matchesFilePattern; } });
Object.defineProperty(exports, "readGlobalDiscoveryConfig", { enumerable: true, get: function () { return discoveryConfig_1.readGlobalDiscoveryConfig; } });
Object.defineProperty(exports, "getDiscoveryConfigForSource", { enumerable: true, get: function () { return discoveryConfig_1.getDiscoveryConfigForSource; } });
// Command registration
var commands_1 = require("./commands");
Object.defineProperty(exports, "registerAddProjectTokenCommand", { enumerable: true, get: function () { return commands_1.registerAddProjectTokenCommand; } });
//# sourceMappingURL=index.js.map