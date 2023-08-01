/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const githubScopes = 'user project repo read:org';
  const githubRedirectUrl = `${process.env.API_ROOT_DOMAIN}/oauth/github/callback`;
  const githubAuthorizeUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=${githubScopes}&redirect_uri=${githubRedirectUrl}`;
  const github = await prisma.integrationApplication.create({
    data: {
      name: 'GitHub',
      description: 'GitHub integration',
      logoUrl: '',
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorizeUrl: githubAuthorizeUrl,
      callbackUrl: githubRedirectUrl,
      scope: githubScopes,
      provider: 'github',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    },
  });

  const jiraScopes = 'read:me read:jira-work read:jira-user manage:jira-webhook';
  const jiraRedirectUrl = `${process.env.API_ROOT_DOMAIN}/oauth/jira/callback&response_type=code&prompt=consent`;
  const jiraAuthorizeUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${process.env.JIRA_CLIENT_ID}&scope=${jiraScopes}&redirect_uri=${jiraRedirectUrl}`;
  const jira = await prisma.integrationApplication.create({
    data: {
      name: 'JIRA',
      description: 'JIRA integration',
      logoUrl: '',
      clientId: process.env.JIRA_CLIENT_ID,
      clientSecret: process.env.JIRA_CLIENT_SECRET,
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
