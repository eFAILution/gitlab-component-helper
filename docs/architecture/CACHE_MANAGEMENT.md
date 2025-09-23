# Cache Management Features

This document describes the new cache management features added to the GitLab Component Helper extension.

## Overview

The extension now provides two distinct cache management operations to give users better control over cached GitLab component data:

1. **Update Cache** - Forces refresh of cached data while preserving cache structure
2. **Reset Cache** - Completely clears all cached data and starts fresh

## Features Added

### Commands (Available in Command Palette)

- `GitLab CI: Update Cache` - Forces fresh fetch of all component data from sources
- `GitLab CI: Reset Cache` - Completely clears all cached data (with confirmation prompt)
- `GitLab CI: Refresh Components Cache` - Existing command for standard refresh

### Component Browser UI

The component browser now includes three action buttons in the header:

- **🔄 Refresh** - Standard refresh (reloads current cached data)
- **📥 Update Cache** - Forces fresh data fetch from all GitLab sources
- **🗑️ Reset Cache** - Completely clears cache (requires confirmation)

### Cache Management Methods

#### ComponentService
- `updateCache()` - Clears internal caches to force fresh fetch
- `resetCache()` - Completely clears all cached data
- `getCacheStats()` - Returns detailed cache statistics

#### ComponentCacheManager
- `updateCache()` - Forces refresh and triggers ComponentService update
- `resetCache()` - Clears in-memory and persistent storage
- `getCacheStats()` - Returns comprehensive cache statistics

## Usage Scenarios

### Update Cache
Use when you want to:
- Fetch the latest component definitions from GitLab
- Refresh cached data without losing cache structure
- Update components after changes are made to GitLab repositories
- Resolve stale data issues

### Reset Cache
Use when you want to:
- Completely start fresh with component data
- Clear corrupted cache data
- Troubleshoot cache-related issues
- Free up storage space

## Technical Implementation

### Cache Types Managed
1. **ComponentService Caches**:
   - `catalogCache` - GitLab catalog API responses
   - `componentCache` - Individual component metadata
   - `sourceCache` - Source-level component data

2. **ComponentCacheManager Caches**:
   - In-memory component arrays
   - Project versions cache
   - VS Code global state storage
   - Source error tracking

### User Experience Features

- **Progress Indicators**: Both operations show progress notifications
- **Confirmation Prompts**: Reset cache requires user confirmation
- **Error Handling**: Graceful error handling with user-friendly messages
- **Visual Feedback**: Browser UI updates to reflect cache state
- **Loading States**: Clear loading indicators during operations

### Safety Features

- **Confirmation Required**: Reset cache asks for confirmation before proceeding
- **Error Recovery**: Failed operations don't leave cache in inconsistent state
- **Logging**: All cache operations are logged for debugging
- **Graceful Degradation**: Failures fall back to existing cached data when possible

## API Integration

Both cache management features properly handle:
- GitLab API token management
- Rate limiting considerations
- Network error recovery
- Batch processing for large datasets
- Parallel fetching optimizations

## Storage Management

The cache management system handles:
- VS Code global state persistence
- Memory-only fallback mode
- Cache size optimization
- Automatic cleanup of expired entries
- Cross-session cache persistence

## Testing

The cache management features have been tested with:
- Multiple GitLab instances
- Large component datasets
- Network connectivity issues
- Token authentication scenarios
- UI responsiveness during operations

## Future Enhancements

Potential future improvements:
- Selective cache clearing (by source)
- Cache size monitoring and alerts
- Automatic cache optimization
- Cache export/import functionality
- Advanced cache statistics dashboard
