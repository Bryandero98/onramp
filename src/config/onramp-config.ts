import * as yaml from "js-yaml";

/** The one octokit call config-loading needs, kept minimal so it's trivial to fake in tests. */
export interface ConfigClient {
  repos: {
    getContent(args: { owner: string; repo: string; path: string }): Promise<{ data: unknown }>;
  };
}

export interface OnrampConfig {
  /** Days an issue can sit assigned/claimed with no linked PR before a nudge. */
  staleClaimDays: number;
  /** Days a PR can sit open with no review activity before a nudge. */
  staleReviewDays: number;
  /** Hard cap on nudges per item, so a stuck item gets pinged, not spammed. */
  maxNudges: number;
  /** Post a welcome comment the first time a first-time contributor opens a PR. */
  welcomeFirstTimeContributors: boolean;
}

export const DEFAULT_CONFIG: OnrampConfig = {
  staleClaimDays: 14,
  staleReviewDays: 7,
  maxNudges: 2,
  welcomeFirstTimeContributors: true,
};

const CONFIG_PATH = ".github/onramp.yml";

/**
 * Loads `.github/onramp.yml` from the repo being processed, falling back to
 * DEFAULT_CONFIG for any field the file omits (or if the file doesn't exist
 * at all - onramp works out of the box with no config).
 */
export async function loadConfig(
  octokit: ConfigClient,
  repo: { owner: string; repo: string },
): Promise<OnrampConfig> {
  try {
    const response = await octokit.repos.getContent({
      ...repo,
      path: CONFIG_PATH,
    });

    const data = response.data as { content?: unknown };
    if (typeof data.content !== "string") {
      return DEFAULT_CONFIG;
    }

    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = (yaml.load(raw) ?? {}) as Partial<OnrampConfig>;

    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    if (isNotFoundError(error)) {
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 404
  );
}
