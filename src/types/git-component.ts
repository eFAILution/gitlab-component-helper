/**
 * Default value of a GitLab CI component input parameter.
 *
 * Mirrors the value shapes GitLab accepts in a component spec's `inputs.*.default` field: a primitive
 * (`string`, `number`, `boolean`), `null` for explicit absence, or an array of primitives for `options`-style
 * inputs that enumerate allowed values.
 */
export type ParameterDefault = string | number | boolean | null | Array<string | number | boolean>;

export interface Component {
    name: string;
    description: string;
    parameters: ComponentParameter[];
    version?: string;
    source?: string;
    documentationUrl?: string;
    templatePath?: string;
    context?: {
        gitlabInstance: string;
        path: string;
    };
}

export interface ComponentParameter {
    name: string;
    description: string;
    required: boolean;
    type: string;
    default?: ParameterDefault;
    /**
     * Allowed values for the input, from the spec's `options:` field. When present, completion offers these as a
     * choice rather than a free-text placeholder. Entries mirror the primitive shapes a default can take.
     */
    options?: Array<string | number | boolean>;
}
