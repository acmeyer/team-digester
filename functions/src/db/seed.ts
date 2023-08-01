import { prisma } from '../lib/prisma';
import { Config } from '../config';

async function main() {
  const githubScopes = 'user project repo read:org';
  const githubRedirectUrl = `${Config.API_BASE_URL}/oauth/github/callback`;
  const githubAuthorizeUrl = `https://github.com/login/oauth/authorize?client_id=${
    Config.GITHUB_CLIENT_ID
  }&scope=${encodeURIComponent(githubScopes)}&redirect_uri=${githubRedirectUrl}`;
  const github = await prisma.integrationApplication.create({
    data: {
      name: 'GitHub',
      description:
        "Connect your GitHub account to stay updated on all of your team's activity on your codebase.",
      logoUrl: '',
      clientId: Config.GITHUB_CLIENT_ID,
      clientSecret: Config.GITHUB_CLIENT_SECRET,
      authorizeUrl: githubAuthorizeUrl,
      callbackUrl: githubRedirectUrl,
      scope: githubScopes,
      provider: 'github',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    },
  });

  const jiraScopes = 'read:me read:jira-work read:jira-user manage:jira-webhook';
  const jiraRedirectUrl = `${Config.API_BASE_URL}/oauth/jira/callback&response_type=code&prompt=consent`;
  const jiraAuthorizeUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${
    Config.JIRA_CLIENT_ID
  }&scope=${encodeURIComponent(jiraScopes)}&redirect_uri=${jiraRedirectUrl}`;
  const jira = await prisma.integrationApplication.create({
    data: {
      name: 'JIRA',
      description:
        "Connect your JIRA account to stay updated on all of your team's activity across your projects.",
      logoUrl: '',
      clientId: Config.JIRA_CLIENT_ID,
      clientSecret: Config.JIRA_CLIENT_SECRET,
      authorizeUrl: jiraAuthorizeUrl,
      callbackUrl: jiraRedirectUrl,
      scope: jiraScopes,
      provider: 'jira',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
    },
  });

  console.log({ github, jira });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
