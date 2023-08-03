import {
  Organization,
  IntegrationProviderAccount,
  User,
  Team,
  TeamMembership,
} from '@prisma/client';

export interface OauthStateStore {
  organizationId: string;
  userId: string;
}

export interface OrganizationWithIntegrationConnections extends Organization {
  integrationConnections: IntegrationProviderAccount[];
}

export interface OrganizationWithTeams extends Organization {
  teams: Team[];
}

export interface OrganizationWithIntegrationConnectionsAndTeams
  extends OrganizationWithIntegrationConnections {
  teams: Team[];
}

export interface TeamMembershipWithTeam extends TeamMembership {
  team: Team;
}

export interface UserWithTeams extends User {
  teamMemberships: TeamMembershipWithTeam[];
}
