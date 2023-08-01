import { Organization, IntegrationProviderAccount } from '@prisma/client';

export interface OauthStateStore {
  organizationId: string;
  userId: string;
}

export interface OrganizationWithIntegrationConnections extends Organization {
  integrationConnections: IntegrationProviderAccount[];
}
