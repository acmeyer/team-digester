import { Config } from '../config';

export interface OAuthIntegrations {
  [key: string]: OAuthProvider;
}

export class OAuthProvider {
  label: string;
  value: string;
  description: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationBaseUri: string;
  tokenUri: string;
  scope: string;
  additionalAuthorizationParams: Record<string, string>;

  constructor(
    label: string,
    value: string,
    description: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    authorizationBaseUri: string,
    tokenUri: string,
    scope: string,
    additionalAuthorizationParams: Record<string, string> = {}
  ) {
    this.label = label;
    this.value = value;
    this.description = description;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.authorizationBaseUri = authorizationBaseUri;
    this.tokenUri = tokenUri;
    this.scope = scope;
    this.additionalAuthorizationParams = additionalAuthorizationParams;
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scope,
      state,
      ...this.additionalAuthorizationParams,
    });
    return `${this.authorizationBaseUri}?${params.toString()}`;
  }
}

export const OAUTH_INTEGRATIONS: OAuthIntegrations = {
  github: new OAuthProvider(
    'GitHub',
    'github',
    "Connect your GitHub account to stay updated on all of your team's activity on your codebase.",
    Config.GITHUB_CLIENT_ID,
    Config.GITHUB_CLIENT_SECRET,
    `${Config.API_BASE_URL}/oauth/github/callback`,
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    'user project repo read:org'
  ),
  jira: new OAuthProvider(
    'JIRA',
    'jira',
    "Connect your JIRA account to stay updated on all of your team's activity across your projects.",
    Config.JIRA_CLIENT_ID,
    Config.JIRA_CLIENT_SECRET,
    `${Config.API_BASE_URL}/oauth/jira/callback`,
    'https://auth.atlassian.com/authorize',
    'https://auth.atlassian.com/oauth/token',
    'offline_access read:account read:me read:jira-work read:jira-user manage:jira-webhook',
    {
      audience: 'api.atlassian.com',
      prompt: 'consent',
      response_type: 'code',
    }
  ),
};