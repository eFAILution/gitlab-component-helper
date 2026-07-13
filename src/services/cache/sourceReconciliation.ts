import { CachedComponent } from '../../types/cache';
import { ComponentSource } from '../../types/api';

const DEFAULT_GITLAB_INSTANCE = 'gitlab.com';

const normalizeInstance = (instance: string): string => instance.replace(/^https?:\/\//, '');

/**
 * When a dynamically fetched component belongs to a configured source, return it with that source's display `name`
 * adopted (and `tagPattern` filled in if absent). Dynamic fetches synthesize `source` as `instance/path`, which would
 * otherwise group the component under a phantom top-level instance node in the browser — separate from the configured
 * source's own components — and leave version discovery without the tag template.
 *
 * Matching is by `gitlabInstance` + `sourcePath`. No match returns the component unchanged (an ad-hoc hover on a
 * project outside any configured source).
 *
 * @param component The dynamically fetched cache entry, with `source` synthesized as `instance/path`.
 * @param sources   The configured component sources from settings to match against.
 * @returns         The component with `source`/`tagPattern` adopted from the matching source, or unchanged if none match.
 */
export function reconcileComponentSource(
  component: CachedComponent,
  sources: ComponentSource[],
): CachedComponent {
  const match = sources.find(source => {
    const sourceInstance = normalizeInstance(source.gitlabInstance || DEFAULT_GITLAB_INSTANCE);
    return sourceInstance === component.gitlabInstance && source.path === component.sourcePath;
  });

  if (!match) {
    return component;
  }

  return {
    ...component,
    source: match.name,
    tagPattern: component.tagPattern ?? match.tagPattern,
  };
}
