// Read-only GitHub calls for team roles (DESIGN.md "Team roles"): member
// counts of the viewer's teams in one GraphQL request, and the PRs the
// viewer reviewed with every reviewer requested on them, in pages of 50.
import type { ReviewedPr, ViewerTeamSize } from '@postpile/core';

/** Reviewed PRs per search page. */
export const REVIEWED_PAGE_SIZE = 50;

/** Review request events read per PR; far more than a PR ever gets. */
const REQUESTS_PER_PR = 50;

/** Like VIEWER_TEAMS_QUERY, plus each team's member count. */
export const VIEWER_TEAM_SIZES_QUERY = `query($login: String!) {
  viewer {
    organizations(first: 50) { nodes { login teams(first: 100, userLogins: [$login]) { nodes { slug members { totalCount } } } } }
  }
}`;

export interface RawTeamSizes {
  viewer: {
    organizations: {
      nodes: ({ login: string; teams: { nodes: { slug: string; members: { totalCount: number } | null }[] } } | null)[];
    };
  };
}

/** Every team as "org/slug" with its member count. Orgs the token cannot see (SAML) come back null and are skipped. */
export function teamSizes(data: RawTeamSizes | null): ViewerTeamSize[] {
  const sizes: ViewerTeamSize[] = [];
  for (const org of data?.viewer.organizations.nodes ?? []) {
    if (!org) {
      continue;
    }
    for (const team of org.teams.nodes) {
      sizes.push({ team: `${org.login}/${team.slug}`, members: team.members?.totalCount ?? null });
    }
  }
  return sizes;
}

/**
 * "is:pr reviewed-by:alice -author:alice updated:>=2026-07-02 org:acme org:beta":
 * PRs by others the viewer reviewed, in their orgs (several org: qualifiers
 * match any of them).
 */
export function reviewedSearch(login: string, orgs: string[], since: string): string {
  const scope = orgs.map((org) => `org:${org}`).join(' ');
  return `is:pr reviewed-by:${login} -author:${login} updated:>=${since} ${scope}`.trim();
}

export const REVIEWED_PRS_QUERY = `query($search: String!, $after: String) {
  search(type: ISSUE, first: ${REVIEWED_PAGE_SIZE}, query: $search, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        repository { nameWithOwner }
        timelineItems(first: ${REQUESTS_PER_PR}, itemTypes: [REVIEW_REQUESTED_EVENT]) {
          nodes { ... on ReviewRequestedEvent { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } } } }
        }
      }
    }
  }
}`;

interface RawRequestedReviewer {
  __typename?: string;
  login?: string;
  slug?: string;
  organization?: { login: string };
}

export interface RawReviewedNode {
  number?: number;
  repository?: { nameWithOwner: string };
  timelineItems?: { nodes: ({ requestedReviewer?: RawRequestedReviewer | null } | null)[] } | null;
}

export interface RawReviewedPage {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (RawReviewedNode | null)[];
  };
}

/** A user's login, a team's "org/slug"; bots and mannequins are left out. */
function requestedName(reviewer: RawRequestedReviewer | null | undefined): string | null {
  if (reviewer?.__typename === 'User' && reviewer.login) {
    return reviewer.login;
  }
  if (reviewer?.__typename === 'Team' && reviewer.slug && reviewer.organization) {
    return `${reviewer.organization.login}/${reviewer.slug}`;
  }
  return null;
}

/** One page as reviewed PRs: each with who was ever requested on it. Search hits that are issues come back empty and are skipped. */
export function reviewedPrs(page: RawReviewedPage): ReviewedPr[] {
  const prs: ReviewedPr[] = [];
  for (const node of page.search.nodes) {
    if (!node?.number || !node.repository) {
      continue;
    }
    const requested = (node.timelineItems?.nodes ?? []).flatMap((item) => {
      const name = requestedName(item?.requestedReviewer);
      return name ? [name] : [];
    });
    prs.push({ key: `${node.repository.nameWithOwner}#${node.number}`, requested: [...new Set(requested)] });
  }
  return prs;
}
