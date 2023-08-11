import { Config } from '../config';
import { INTEGRATION_NAMES } from './constants';

export interface Integrations {
  [key: string]: Integration;
}

export class Integration {
  label: string;
  value: string;
  description: string;
  installationUrl: string;
  authorizationUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;

  constructor({
    label,
    value,
    description,
    installationUrl,
    authorizationUrl,
    clientId,
    clientSecret,
    redirectUri,
    scope,
  }: {
    label: string;
    value: string;
    description: string;
    installationUrl: string;
    authorizationUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scope: string;
  }) {
    this.label = label;
    this.value = value;
    this.description = description;
    this.installationUrl = installationUrl;
    this.authorizationUrl = authorizationUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.scope = scope;
  }

  getInstallationUrl(state: string): string {
    return `${this.installationUrl}?state=${state}`;
  }

  getAuthorizationUrl(state: string): string {
    // eslint-disable-next-line max-len
    return `${this.authorizationUrl}?client_id=${this.clientId}&redirect_uri=${this.redirectUri}&scope=${this.scope}&state=${state}`;
  }
}

export const INTEGRATIONS: Integrations = {
  github: new Integration({
    label: 'GitHub',
    value: INTEGRATION_NAMES.GITHUB,
    description:
      "Connect your GitHub account to stay updated on all of your team's activity on your codebase.",
    installationUrl: `https://github.com/apps/${Config.GITHUB_APP_SLUG}/installations/new`,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    clientId: Config.GITHUB_CLIENT_ID,
    clientSecret: Config.GITHUB_CLIENT_SECRET,
    redirectUri: `${Config.API_BASE_URL}/github/callback`,
    scope: 'user%20project%20repo%20read:org',
  }),
};
