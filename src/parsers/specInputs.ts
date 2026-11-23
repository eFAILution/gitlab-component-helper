/**
 * Read the `spec.inputs` of a GitLab component template as `ComponentParameter[]`. Remote templates and local includes
 * both read their inputs through here, so the two agree on every input.
 *
 * The text is converted twice: with the core schema for typed values (`false`, `8080`, `[a, b]`), and with the failsafe
 * schema, where every scalar stays the text it was written as. A `string` input takes its values from the second (see
 * {@link stringDefault}). Both conversions apply `<<` merge keys, as GitLab (Ruby's Psych) does.
 */

import { parseAllDocuments } from 'yaml';
import { isParameterDefault } from './parameterDefaultShape';
import { isYamlNode, type YamlNode } from '../utils/yamlParser';
import type { ComponentParameter, ParameterDefault } from '../types/git-component';

type OptionValue = string | number | boolean;

export type SpecReadResult =
  /** The text isn't valid YAML, or expands past the alias limit. */
  | { kind: 'invalid'; reason: string }
  /** No document declares `spec`. */
  | { kind: 'no-spec' }
  /** `inputs` is `null` when the spec declares no `inputs` mapping. */
  | { kind: 'spec'; inputs: ComponentParameter[] | null };

function isOptionList(value: unknown): value is OptionValue[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
  );
}

function toPlainDocuments(text: string, schema: 'core' | 'failsafe'): unknown[] {
  const docs = parseAllDocuments(text, { merge: true, schema });
  const error = 'empty' in docs ? docs.errors[0] : docs.flatMap((d) => d.errors)[0];
  if (error) throw error;
  return docs.map((d) => d.toJS());
}

function inputsOf(doc: unknown): YamlNode | undefined {
  if (!isYamlNode(doc) || !isYamlNode(doc.spec)) return undefined;
  return isYamlNode(doc.spec.inputs) ? doc.spec.inputs : undefined;
}

/**
 * The default of a `string` input. GitLab resolves an untyped or `type: string` input as StringInput and coerces its
 * default with `to_s`, so a scalar is the text as written (`0755`, `1.0` and `1e5` are not renumbered) and an empty or
 * `~` default is `''`.
 */
function stringDefault(typed: unknown, literal: unknown): ParameterDefault | undefined {
  if (typed === null || typed === undefined) return '';
  if (Array.isArray(typed)) return isParameterDefault(typed) ? typed : undefined;
  return typeof literal === 'string' ? literal : undefined;
}

/**
 * The default of a non-`string` input, as YAML types it. An empty `default:` is an explicit empty string, which keeps
 * the input optional.
 */
function typedDefault(typed: unknown): ParameterDefault | undefined {
  if (typed === null) return '';
  return isParameterDefault(typed) ? typed : undefined;
}

function mapInputs(typedInputs: YamlNode, literalInputs: YamlNode | undefined): ComponentParameter[] {
  return Object.entries(typedInputs).map(([name, rawDefinition]) => {
    const definition = isYamlNode(rawDefinition) ? rawDefinition : {};
    const literal = literalInputs && isYamlNode(literalInputs[name]) ? literalInputs[name] : {};
    const type = typeof definition.type === 'string' ? definition.type : 'string';
    const hasDefault = 'default' in definition;

    // Options are typed like the default, so a default naming an option compares equal to it.
    const options = type === 'string' ? literal.options : definition.options;
    let defaultValue: ParameterDefault | undefined;
    if (hasDefault) {
      defaultValue = type === 'string' ? stringDefault(definition.default, literal.default) : typedDefault(definition.default);
    }

    return {
      name,
      description: typeof definition.description === 'string' ? definition.description : `Parameter: ${name}`,
      required: !hasDefault,
      type,
      default: defaultValue,
      options: isOptionList(options) ? options : undefined,
    };
  });
}

/**
 * Find the first document in `text` that declares `spec`, and read its inputs. An input with no `default:` key is
 * required, as GitLab treats it.
 *
 * @param text - YAML text holding one or more documents.
 */
export function readSpecInputs(text: string): SpecReadResult {
  let typedDocs: unknown[];
  let literalDocs: unknown[];
  try {
    typedDocs = toPlainDocuments(text, 'core');
    literalDocs = toPlainDocuments(text, 'failsafe');
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }

  const index = typedDocs.findIndex((d) => isYamlNode(d) && 'spec' in d);
  if (index === -1) return { kind: 'no-spec' };

  const typedInputs = inputsOf(typedDocs[index]);
  if (!typedInputs) return { kind: 'spec', inputs: null };
  return { kind: 'spec', inputs: mapInputs(typedInputs, inputsOf(literalDocs[index])) };
}
