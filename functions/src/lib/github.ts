import { Config } from '../config';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/core';
import { RequestParameters, OctokitResponse } from '@octokit/types';
import { components } from '@octokit/openapi-types';
import { Installation as GithubIntegrationInstallationData } from '@octokit/webhooks-types';
import fs from 'fs';
import { prisma } from './prisma';
import { IntegrationInstallation } from '@prisma/client';

const privateKey = fs.readFileSync(Config.GITHUB_PRIVATE_KEY_PATH, 'utf-8');

export const getInstallationAuth = async (installationId: string) => {
  const auth = createAppAuth({
    appId: Config.GITHUB_APP_ID,
    privateKey: privateKey,
    installationId: installationId,
  });
  return await auth({ type: 'installation' });
};

export const saveInstallationAuth = async (
  integrationInstallationId: string,
  githubInstallationId: string
) => {
  return prisma.integrationInstallation.update({
    where: {
      id: integrationInstallationId,
    },
    data: {
      accessToken: (await getInstallationAuth(githubInstallationId)).token,
    },
  });
};

export const githubApiRequestWithRetry = async (
  integrationInstallation: IntegrationInstallation,
  route: string,
  options?: RequestParameters,
  retryCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<OctokitResponse<any>> => {
  try {
    const octokit = new Octokit({ auth: integrationInstallation.accessToken });
    let response = await octokit.request(route, options);
    console.log('octokit response status', response.status);
    if (response.status === 401 && retryCount < 3) {
      integrationInstallation = await saveInstallationAuth(
        integrationInstallation.id,
        (integrationInstallation.data as unknown as GithubIntegrationInstallationData).id.toString()
      );
      response = await githubApiRequestWithRetry(
        integrationInstallation,
        route,
        options,
        retryCount + 1
      );
    }
    return response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.log('Error in githubApiRequestWithRetry');
    console.error(error);
    if (error.status === 401 && retryCount < 3) {
      integrationInstallation = await saveInstallationAuth(
        integrationInstallation.id,
        (integrationInstallation.data as unknown as GithubIntegrationInstallationData).id.toString()
      );
      return await githubApiRequestWithRetry(
        integrationInstallation,
        route,
        options,
        retryCount + 1
      );
    } else {
      throw error;
    }
  }
};

export const getCommitDetailsMessage = (commit: components['schemas']['commit']) => {
  return `Commit: ${commit.sha}
URL: ${commit.url}
Message: ${commit.commit.message}
${
  commit.stats
    ? `Stats: ${commit.stats.additions} additions and ${commit.stats.deletions} deletions`
    : ''
}
${commit.files ? `Changes: ${getFilesChangesMessage(commit.files)}` : ''}`;
};

export const getFilesChangesMessage = (files: components['schemas']['commit']['files']) => {
  return files?.map((file) => {
    return `
Filename: ${file.filename}
Stats: ${file.changes} changes, ${file.additions} additions and ${file.deletions} deletions
Code changes: "${file.patch}"`;
  });
};
