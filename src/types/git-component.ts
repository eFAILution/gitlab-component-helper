export interface Component {
    name: string;
    description: string;
    parameters: ComponentParameter[];
    version?: string;
    source?: string;
    documentationUrl?: string;
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
    default?: any;
}
