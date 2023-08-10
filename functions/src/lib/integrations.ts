import { Config } from '../config';
import { INTEGRATION_NAMES } from './constants';

export interface Integrations {
  [key: string]: Integration;
}

export class Integration {
  label: string;
  value: string;
  description: string;
  connectionUrl: string;

  constructor(label: string, value: string, description: string, connectionUrl: string) {
    this.label = label;
    this.value = value;
    this.description = description;
    this.connectionUrl = connectionUrl;
  }

  getFullConnectionUrl(state: string): string {
    return `${this.connectionUrl}?state=${state}`;
  }
}

export const INTEGRATIONS: Integrations = {
  github: new Integration(
    'GitHub',
    INTEGRATION_NAMES.GITHUB,
    "Connect your GitHub account to stay updated on all of your team's activity on your codebase.",
    `https://github.com/apps/${Config.GITHUB_APP_SLUG}/installations/new`
  ),
};
