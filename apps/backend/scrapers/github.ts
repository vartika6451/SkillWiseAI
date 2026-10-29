import axios from "axios";
import type { AxiosError } from "axios";

/**
 * Diagnostic record captured for each GitHub API request.
 * Contains sanitized metadata only - NEVER logs tokens, auth headers, or private user data.
 */
export interface GitHubDiagnostic {
  endpoint: string;
  statusCode: number;
  rateLimitLimit?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
  rateLimitResetDate?: string;
  rateLimitResource?: string;
  retryAfter?: string;
  sanitizedMessage?: string;
  timestamp: string;
}

export type GitHubErrorType =
  | "RATE_LIMIT_CORE"
  | "RATE_LIMIT_SEARCH"
  | "SECONDARY_RATE_LIMIT"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class GitHubApiError extends Error {
  public readonly status: number;
  public readonly errorType: GitHubErrorType;
  public readonly isRateLimit: boolean;
  public readonly isSecondaryRateLimit: boolean;
  public readonly isAuthError: boolean;
  public readonly isForbidden: boolean;
  public readonly isNotFound: boolean;
  public readonly isNetworkError: boolean;
  public readonly resetAt: Date | null;
  public readonly retryAfterSeconds: number | null;
  public readonly userMessage: string;
  public readonly diagnostic: GitHubDiagnostic;

  constructor(
    message: string,
    diagnostic: GitHubDiagnostic,
    errorType: GitHubErrorType,
    userMessage: string,
    resetAt: Date | null = null,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "GitHubApiError";
    this.status = diagnostic.statusCode;
    this.diagnostic = diagnostic;
    this.errorType = errorType;
    this.resetAt = resetAt;
    this.retryAfterSeconds = retryAfterSeconds;
    this.userMessage = userMessage;

    this.isRateLimit = errorType === "RATE_LIMIT_CORE" || errorType === "RATE_LIMIT_SEARCH";
    this.isSecondaryRateLimit = errorType === "SECONDARY_RATE_LIMIT";
    this.isAuthError = errorType === "UNAUTHORIZED";
    this.isForbidden = errorType === "FORBIDDEN";
    this.isNotFound = errorType === "NOT_FOUND";
    this.isNetworkError = errorType === "NETWORK_ERROR";
  }
}

export interface RepositorySummary {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  url: string;
  isContribution: boolean;
}

interface CacheEntry {
  data: RepositorySummary[];
  expiresAt: number;
}

// In-memory TTL cache (5-minute expiration)
const profileCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Internal rate-limit status tracker
interface QuotaTracker {
  remaining: number;
  limit: number;
  resetTime: number; // Unix epoch ms
}

function getInitialLimit(isSearch = false): number {
  const token = process.env.GITHUB_TOKEN?.trim().replace(/^["']|["']$/g, "");
  const hasToken = Boolean(token && token !== "undefined" && token !== "null" && token.length > 0);
  if (isSearch) return hasToken ? 30 : 10;
  return hasToken ? 5000 : 60;
}

let coreQuota: QuotaTracker = { remaining: getInitialLimit(false), limit: getInitialLimit(false), resetTime: 0 };
let searchQuota: QuotaTracker = { remaining: getInitialLimit(true), limit: getInitialLimit(true), resetTime: 0 };
let secondaryBlockUntil = 0; // Unix epoch ms

/**
 * Reset caches and trackers (useful for unit testing).
 */
export function resetGitHubScraperState() {
  profileCache.clear();
  coreQuota = { remaining: getInitialLimit(false), limit: getInitialLimit(false), resetTime: 0 };
  searchQuota = { remaining: getInitialLimit(true), limit: getInitialLimit(true), resetTime: 0 };
  secondaryBlockUntil = 0;
}

/**
 * Sanitizes GitHub endpoint URLs to ensure query tokens or private IDs are stripped.
 */
function sanitizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    // Keep pathname and safe query keys (e.g. q, per_page, sort), strip any secret parameters
    const safeSearchParams = new URLSearchParams();
    for (const [key, val] of parsed.searchParams.entries()) {
      if (["q", "per_page", "sort", "type", "author"].includes(key.toLowerCase())) {
        safeSearchParams.set(key, val);
      }
    }
    const query = safeSearchParams.toString();
    return parsed.pathname + (query ? `?${query}` : "");
  } catch {
    return url.split("?")[0] || url;
  }
}

/**
 * Safe diagnostic logging for each GitHub API request.
 * Strictly avoids logging Authorization headers, tokens, or private secrets.
 */
function logDiagnostic(diagnostic: GitHubDiagnostic, isError = false) {
  const resetInfo = diagnostic.rateLimitResetDate
    ? ` Reset: ${diagnostic.rateLimitResetDate}`
    : "";
  const retryInfo = diagnostic.retryAfter
    ? ` Retry-After: ${diagnostic.retryAfter}s`
    : "";
  const remainingInfo = diagnostic.rateLimitRemaining !== undefined
    ? ` [Quota: ${diagnostic.rateLimitRemaining}/${diagnostic.rateLimitLimit || "?"}]`
    : "";

  const logMessage = `[GitHub API Diagnostic] ${diagnostic.endpoint} -> ${diagnostic.statusCode}${remainingInfo}${resetInfo}${retryInfo}${
    diagnostic.sanitizedMessage ? ` | ${diagnostic.sanitizedMessage}` : ""
  }`;

  if (isError) {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

/**
 * Builds safe diagnostic record from an Axios response or error.
 */
function buildDiagnostic(
  endpoint: string,
  statusCode: number,
  headers: Record<string, any> = {},
  errorMessage?: string
): GitHubDiagnostic {
  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()] ?? headers[name];
    return val !== undefined && val !== null ? String(val) : undefined;
  };

  const limit = getHeader("x-ratelimit-limit");
  const remaining = getHeader("x-ratelimit-remaining");
  const resetSec = getHeader("x-ratelimit-reset");
  const resource = getHeader("x-ratelimit-resource");
  const retryAfter = getHeader("retry-after");

  let resetDateStr: string | undefined;
  if (resetSec && !isNaN(Number(resetSec))) {
    try {
      resetDateStr = new Date(Number(resetSec) * 1000).toISOString();
    } catch {
      // ignore date format error
    }
  }

  return {
    endpoint: sanitizeEndpoint(endpoint),
    statusCode,
    rateLimitLimit: limit,
    rateLimitRemaining: remaining,
    rateLimitReset: resetSec,
    rateLimitResetDate: resetDateStr,
    rateLimitResource: resource,
    retryAfter,
    sanitizedMessage: errorMessage ? errorMessage.slice(0, 200) : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Updates internal quota tracking from response headers.
 */
function updateQuotaFromHeaders(headers: Record<string, any> = {}) {
  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()] ?? headers[name];
    return val !== undefined && val !== null ? String(val) : undefined;
  };

  const resource = (getHeader("x-ratelimit-resource") || "core").toLowerCase();
  const remaining = getHeader("x-ratelimit-remaining");
  const limit = getHeader("x-ratelimit-limit");
  const resetSec = getHeader("x-ratelimit-reset");
  const retryAfter = getHeader("retry-after");

  const resetMs = resetSec ? Number(resetSec) * 1000 : 0;

  if (retryAfter && !isNaN(Number(retryAfter))) {
    secondaryBlockUntil = Date.now() + Number(retryAfter) * 1000;
  }

  if (remaining !== undefined && !isNaN(Number(remaining))) {
    const quota: QuotaTracker = {
      remaining: Number(remaining),
      limit: limit ? Number(limit) : 60,
      resetTime: resetMs || Date.now() + 3600000,
    };
    if (resource === "search") {
      searchQuota = quota;
    } else {
      coreQuota = quota;
    }
  }
}

/**
 * Inspects a GitHub API error and classifies its exact condition.
 */
function classifyGitHubError(err: any, endpoint: string, username: string): GitHubApiError {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<{ message?: string; documentation_url?: string }>;
    const statusCode = axiosErr.response?.status || 0;
    const responseHeaders = (axiosErr.response?.headers as Record<string, any>) || {};
    const rawMessage = axiosErr.response?.data?.message || axiosErr.message || "Unknown GitHub error";

    updateQuotaFromHeaders(responseHeaders);
    const diagnostic = buildDiagnostic(endpoint, statusCode, responseHeaders, rawMessage);
    logDiagnostic(diagnostic, true);

    const resetSec = diagnostic.rateLimitReset ? Number(diagnostic.rateLimitReset) : null;
    const resetDate = resetSec ? new Date(resetSec * 1000) : null;
    const retryAfterSec = diagnostic.retryAfter ? Number(diagnostic.retryAfter) : null;

    // 1. Network / Connection / Timeout issues
    if (statusCode === 0 || axiosErr.code === "ECONNABORTED" || axiosErr.code === "ENOTFOUND") {
      return new GitHubApiError(
        `Network error contacting GitHub API: ${axiosErr.message}`,
        diagnostic,
        "NETWORK_ERROR",
        "Unable to connect to GitHub. Please check your network connection and try again."
      );
    }

    // 2. 401 Unauthorized: Invalid or expired GITHUB_TOKEN
    if (statusCode === 401) {
      return new GitHubApiError(
        "GitHub API unauthorized: Invalid or expired GITHUB_TOKEN",
        diagnostic,
        "UNAUTHORIZED",
        "GitHub authentication failed. Your configured GITHUB_TOKEN appears invalid or expired."
      );
    }

    // 3. 404 Not Found: Username does not exist
    if (statusCode === 404) {
      return new GitHubApiError(
        `GitHub user not found: "${username}"`,
        diagnostic,
        "NOT_FOUND",
        `GitHub user "${username}" was not found. Please verify the username.`
      );
    }

    // 4. Secondary Rate Limit (abuse detection / concurrency)
    const isSecondary =
      Boolean(retryAfterSec) ||
      rawMessage.toLowerCase().includes("secondary rate limit") ||
      rawMessage.toLowerCase().includes("abuse detection") ||
      rawMessage.toLowerCase().includes("please wait a few minutes");

    if (isSecondary) {
      const waitTime = retryAfterSec || 60;
      return new GitHubApiError(
        `GitHub secondary rate limit hit: ${rawMessage}`,
        diagnostic,
        "SECONDARY_RATE_LIMIT",
        `GitHub temporarily restricted automated requests. Please wait ${waitTime} seconds before retrying.`,
        resetDate,
        waitTime
      );
    }

    // 5. Rate Limit Exceeded (x-ratelimit-remaining === "0")
    if (statusCode === 403 || statusCode === 429) {
      const remaining = diagnostic.rateLimitRemaining;
      const resource = (diagnostic.rateLimitResource || "").toLowerCase();

      if (remaining === "0") {
        const timeUntilReset = resetDate
          ? ` Resets at ${resetDate.toLocaleTimeString()}`
          : "";

        if (resource === "search") {
          return new GitHubApiError(
            `GitHub Search API rate limit exceeded.${timeUntilReset}`,
            diagnostic,
            "RATE_LIMIT_SEARCH",
            `GitHub Search rate limit reached.${timeUntilReset}. Public repository scanning is still available.`,
            resetDate
          );
        }

        return new GitHubApiError(
          `GitHub API Core quota exceeded.${timeUntilReset}`,
          diagnostic,
          "RATE_LIMIT_CORE",
          `GitHub API hourly rate limit exceeded for your IP.${timeUntilReset}. Please try again later or configure GITHUB_TOKEN in backend .env to increase the quota from 60 to 5,000 requests/hour.`,
          resetDate
        );
      }

      // If status is 403 but remaining quota is NOT 0, this is NOT a rate limit!
      // This is a permissions/administrative rules/User-Agent restriction.
      return new GitHubApiError(
        `GitHub API forbidden: ${rawMessage}`,
        diagnostic,
        "FORBIDDEN",
        `GitHub API request was forbidden: ${rawMessage}`
      );
    }

    // 6. Server errors on GitHub's side (500, 502, 503)
    if (statusCode >= 500) {
      return new GitHubApiError(
        `GitHub service error (${statusCode}): ${rawMessage}`,
        diagnostic,
        "SERVER_ERROR",
        "GitHub API is currently experiencing service disruptions. Please try again shortly."
      );
    }

    return new GitHubApiError(
      `GitHub API error (${statusCode}): ${rawMessage}`,
      diagnostic,
      "UNKNOWN",
      `Failed to fetch GitHub profile: ${rawMessage}`
    );
  }

  // Non-Axios unexpected error
  const diagnostic = buildDiagnostic(endpoint, 0, {}, err.message || "Unknown error");
  return new GitHubApiError(
    err.message || "Unknown error",
    diagnostic,
    "UNKNOWN",
    `Failed to fetch GitHub profile: ${err.message || "Unknown error"}`
  );
}

/**
 * Creates standardized request headers adhering to GitHub API guidelines:
 * - Proper application User-Agent (never spoof browser)
 * - v3 JSON accept header
 * - Safe Bearer token (only attached if non-empty string)
 */
function createGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    // Standard User-Agent identifier as requested by GitHub API docs
    "User-Agent": process.env.GITHUB_USER_AGENT || "SkillWiseAI-Scraper/1.0 (https://github.com/vartika6451/SkillWiseAI)",
    "Accept": "application/vnd.github.v3+json",
  };

  const rawToken = process.env.GITHUB_TOKEN?.trim();
  if (rawToken && rawToken !== "undefined" && rawToken !== "null" && rawToken.length > 0) {
    headers["Authorization"] = `Bearer ${rawToken}`;
  }

  return headers;
}

/**
 * Primary scraper function that inspects a user's GitHub repositories and contributions.
 * Adheres to:
 * - Safe diagnostic logging
 * - In-memory TTL caching to avoid duplicate requests
 * - No mandatory token requirement
 * - Quota-awareness (respects resets & secondary limits)
 * - Resilient fallback for external contributions
 */
export async function scrapeGithub(username: string): Promise<RepositorySummary[]> {
  const normalizedUser = username.trim().toLowerCase();

  // 1. Serve from in-memory cache if available and still valid
  const cached = profileCache.get(normalizedUser);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[GitHub Scraper] Serving cached repositories for user "${normalizedUser}" (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
    return cached.data;
  }

  // 2. Pre-flight check: Are we currently under a secondary rate limit block?
  if (secondaryBlockUntil > Date.now()) {
    const waitSec = Math.ceil((secondaryBlockUntil - Date.now()) / 1000);
    const diagnostic = buildDiagnostic("/users/" + username, 429, { "retry-after": waitSec }, "Secondary limit active");
    throw new GitHubApiError(
      `GitHub secondary rate limit active for another ${waitSec}s`,
      diagnostic,
      "SECONDARY_RATE_LIMIT",
      `GitHub temporarily restricted automated requests. Please wait ${waitSec} seconds before retrying.`,
      new Date(secondaryBlockUntil),
      waitSec
    );
  }

  // 3. Pre-flight check: Is the core quota known to be completely exhausted?
  if (coreQuota.remaining <= 0 && coreQuota.resetTime > Date.now()) {
    const resetDate = new Date(coreQuota.resetTime);
    const diagnostic = buildDiagnostic(
      `/users/${username}/repos`,
      403,
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": Math.floor(coreQuota.resetTime / 1000),
        "x-ratelimit-resource": "core"
      },
      "Core quota exhausted"
    );
    throw new GitHubApiError(
      `GitHub Core quota exhausted until ${resetDate.toISOString()}`,
      diagnostic,
      "RATE_LIMIT_CORE",
      `GitHub API hourly rate limit exceeded for your IP. Resets at ${resetDate.toLocaleTimeString()}. Please configure GITHUB_TOKEN in backend .env to increase rate limits.`,
      resetDate
    );
  }

  const headers = createGitHubHeaders();
  const hasToken = Boolean(headers["Authorization"]);

  // 4. Fetch user's own public repositories (Essential endpoint)
  const reposUrl = `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`;
  console.log(`[GitHub Scraper] Fetching public repos for: ${username} (authenticated: ${hasToken})`);

  let ownedRepos: RepositorySummary[] = [];
  try {
    const response = await axios.get(reposUrl, { headers, timeout: 10000 });
    updateQuotaFromHeaders(response.headers);
    logDiagnostic(buildDiagnostic(reposUrl, response.status, response.headers));

    if (Array.isArray(response.data)) {
      ownedRepos = response.data.map((repo: any) => ({
        name: repo.name,
        description: repo.description ?? null,
        stars: Number(repo.stargazers_count || 0),
        language: repo.language ?? null,
        url: repo.html_url,
        isContribution: false,
      }));
    }
  } catch (err: any) {
    throw classifyGitHubError(err, reposUrl, username);
  }

  // 5. Scan for external contributed repositories (Non-critical enhancement)
  // We only run external discovery if remaining core quota is sufficient (> 5)
  // to avoid consuming the user's last remaining calls.
  const contributedRepoMap = new Map<string, RepositorySummary>();

  if (coreQuota.remaining > 5) {
    // A. Query user public events (Uses standard Core API quota, very reliable for finding contributions)
    try {
      const eventsUrl = `https://api.github.com/users/${username}/events/public?per_page=30`;
      const eventsResponse = await axios.get(eventsUrl, { headers, timeout: 8000 });
      updateQuotaFromHeaders(eventsResponse.headers);
      logDiagnostic(buildDiagnostic(eventsUrl, eventsResponse.status, eventsResponse.headers));

      if (Array.isArray(eventsResponse.data)) {
        for (const event of eventsResponse.data) {
          if (event.repo && event.repo.name) {
            const repoFullName: string = event.repo.name;
            const repoOwner = repoFullName.split("/")[0]?.toLowerCase();
            if (repoOwner && repoOwner !== normalizedUser && !contributedRepoMap.has(repoFullName)) {
              contributedRepoMap.set(repoFullName, {
                name: repoFullName,
                description: `Contributed project via ${event.type || "public activity"}`,
                stars: 0,
                language: null,
                url: `https://github.com/${repoFullName}`,
                isContribution: true,
              });
            }
          }
        }
      }
    } catch (err: any) {
      // Diagnostic logging without throwing - events are non-fatal
      const classified = classifyGitHubError(err, `/users/${username}/events/public`, username);
      console.warn(`[GitHub Scraper] Optional public events check skipped: ${classified.userMessage}`);
    }

    // B. Search Pull Requests & Commits
    // GitHub Search API has a strict 10 req/min unauthenticated limit.
    // If unauthenticated and Search quota is already 0, skip to preserve performance.
    const canAttemptSearch = hasToken || (searchQuota.remaining > 1 && searchQuota.resetTime <= Date.now());

    if (canAttemptSearch) {
      // PR search
      try {
        const prUrl = `https://api.github.com/search/issues?q=type:pr+author:${username}&per_page=15`;
        const prResponse = await axios.get(prUrl, { headers, timeout: 8000 });
        updateQuotaFromHeaders(prResponse.headers);
        logDiagnostic(buildDiagnostic(prUrl, prResponse.status, prResponse.headers));

        if (prResponse.data?.items && Array.isArray(prResponse.data.items)) {
          for (const item of prResponse.data.items) {
            if (item.repository_url) {
              const parts = item.repository_url.split("/repos/");
              const repoFullName = parts[1];
              if (repoFullName) {
                const owner = repoFullName.split("/")[0]?.toLowerCase();
                if (owner && owner !== normalizedUser && !contributedRepoMap.has(repoFullName)) {
                  contributedRepoMap.set(repoFullName, {
                    name: repoFullName,
                    description: item.title ? `Contributed PR: ${item.title.slice(0, 80)}` : null,
                    stars: 0,
                    language: null,
                    url: `https://github.com/${repoFullName}`,
                    isContribution: true,
                  });
                }
              }
            }
          }
        }
      } catch (err: any) {
        const classified = classifyGitHubError(err, `/search/issues?q=type:pr+author:${username}`, username);
        console.warn(`[GitHub Scraper] Optional PR search skipped: ${classified.userMessage}`);
      }

      // If authenticated with token, also search commits for direct contributions
      if (hasToken) {
        try {
          const commitsUrl = `https://api.github.com/search/commits?q=author:${username}&per_page=15`;
          const commitsResponse = await axios.get(commitsUrl, {
            headers: {
              ...headers,
              Accept: "application/vnd.github.cloak-preview,application/vnd.github.v3+json",
            },
            timeout: 8000,
          });
          updateQuotaFromHeaders(commitsResponse.headers);
          logDiagnostic(buildDiagnostic(commitsUrl, commitsResponse.status, commitsResponse.headers));

          if (commitsResponse.data?.items && Array.isArray(commitsResponse.data.items)) {
            for (const item of commitsResponse.data.items) {
              const repoFullName = item.repository?.full_name;
              if (repoFullName) {
                const owner = repoFullName.split("/")[0]?.toLowerCase();
                if (owner && owner !== normalizedUser && !contributedRepoMap.has(repoFullName)) {
                  const firstLine = item.commit?.message ? item.commit.message.split("\n")[0] : undefined;
                  const commitDesc = firstLine ? `Direct commit: ${firstLine.slice(0, 80)}` : null;
                  contributedRepoMap.set(repoFullName, {
                    name: repoFullName,
                    description: commitDesc,
                    stars: Number(item.repository?.stargazers_count || 0),
                    language: null,
                    url: item.repository?.html_url || `https://github.com/${repoFullName}`,
                    isContribution: true,
                  });
                }
              }
            }
          }
        } catch (err: any) {
          const classified = classifyGitHubError(err, `/search/commits?q=author:${username}`, username);
          console.warn(`[GitHub Scraper] Optional commit search skipped: ${classified.userMessage}`);
        }
      }
    }
  }

  // 6. Optionally resolve repository metadata details for top external contributions (capped at 8 when authenticated)
  const externalRepos = Array.from(contributedRepoMap.values());
  const reposToEnrich = externalRepos.slice(0, hasToken ? 8 : (coreQuota.remaining > 20 ? 3 : 0));

  for (const item of reposToEnrich) {
    try {
      const detailUrl = `https://api.github.com/repos/${item.name}`;
      const repoRes = await axios.get(detailUrl, { headers, timeout: 6000 });
      updateQuotaFromHeaders(repoRes.headers);
      logDiagnostic(buildDiagnostic(detailUrl, repoRes.status, repoRes.headers));

      if (repoRes.data) {
        item.description = repoRes.data.description || item.description;
        item.stars = Number(repoRes.data.stargazers_count || 0);
        item.language = repoRes.data.language || null;
      }
    } catch {
      // Non-fatal, keep baseline entry synthesized above
    }
  }

  const combinedResult: RepositorySummary[] = [...ownedRepos, ...externalRepos];

  // 7. Store in memory cache for 5 minutes
  profileCache.set(normalizedUser, {
    data: combinedResult,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return combinedResult;
}