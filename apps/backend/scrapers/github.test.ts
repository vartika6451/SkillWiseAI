import { test, expect, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  scrapeGithub,
  resetGitHubScraperState,
  GitHubApiError,
} from "./github";

// Keep reference to real axios.get
const originalAxiosGet = axios.get;

beforeEach(() => {
  resetGitHubScraperState();
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  axios.get = originalAxiosGet;
});

test("Scenario 1: Public repository scanning without a token succeeds and parses repos", async () => {
  axios.get = (async (url: string) => {
    if (url.includes("/repos?")) {
      return {
        status: 200,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "59",
          "x-ratelimit-reset": "1730000000",
          "x-ratelimit-resource": "core",
        },
        data: [
          {
            name: "test-repo",
            description: "A public test repository",
            stargazers_count: 42,
            language: "TypeScript",
            html_url: "https://github.com/octocat/test-repo",
          },
        ],
      };
    }
    // Return empty for events/search
    return { status: 200, headers: {}, data: [] };
  }) as any;

  const repos = await scrapeGithub("octocat");
  expect(repos.length).toBeGreaterThanOrEqual(1);
  expect(repos[0]?.name).toBe("test-repo");
  expect(repos[0]?.stars).toBe(42);
  expect(repos[0]?.language).toBe("TypeScript");
  expect(repos[0]?.isContribution).toBe(false);
});

test("Scenario 2: In-memory caching avoids duplicate requests on subsequent calls", async () => {
  let callCount = 0;
  axios.get = (async (url: string) => {
    callCount++;
    return {
      status: 200,
      headers: { "x-ratelimit-remaining": "55" },
      data: [{ name: "cached-repo", stargazers_count: 5, html_url: "https://github.com/user/cached-repo" }],
    };
  }) as any;

  const first = await scrapeGithub("cacheUser");
  const callCountAfterFirst = callCount;
  expect(first[0]?.name).toBe("cached-repo");

  // Second call within TTL should serve from cache directly without making network calls
  const second = await scrapeGithub("cacheUser");
  expect(callCount).toBe(callCountAfterFirst);
  expect(second[0]?.name).toBe("cached-repo");
});

test("Scenario 3: Primary Core API quota exhaustion produces RATE_LIMIT_CORE with reset time", async () => {
  const resetEpoch = Math.floor(Date.now() / 1000) + 1800; // 30 mins in future
  axios.get = (async () => {
    const err: any = new Error("Request failed with status code 403");
    err.isAxiosError = true;
    err.response = {
      status: 403,
      headers: {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(resetEpoch),
        "x-ratelimit-resource": "core",
      },
      data: {
        message: "API rate limit exceeded for xxx.xxx.xxx.xxx. (But here's the good news: Authenticated requests get a higher rate limit...)",
      },
    };
    throw err;
  }) as any;

  try {
    await scrapeGithub("octocat");
    expect(true).toBe(false); // should have thrown
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("RATE_LIMIT_CORE");
    expect(err.isRateLimit).toBe(true);
    expect(err.isSecondaryRateLimit).toBe(false);
    expect(err.isForbidden).toBe(false);
    expect(err.status).toBe(403);
    expect(err.userMessage).toContain("rate limit exceeded");
    expect(err.resetAt).toBeTruthy();
  }
});

test("Scenario 4: Secondary rate limit produces SECONDARY_RATE_LIMIT with retryAfterSeconds", async () => {
  axios.get = (async () => {
    const err: any = new Error("Request failed with status code 403");
    err.isAxiosError = true;
    err.response = {
      status: 403,
      headers: {
        "retry-after": "45",
      },
      data: {
        message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      },
    };
    throw err;
  }) as any;

  try {
    await scrapeGithub("octocat");
    expect(true).toBe(false);
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("SECONDARY_RATE_LIMIT");
    expect(err.isSecondaryRateLimit).toBe(true);
    expect(err.isRateLimit).toBe(false);
    expect(err.retryAfterSeconds).toBe(45);
    expect(err.userMessage).toContain("45 seconds");
  }
});

test("Scenario 5: 403 Forbidden caused by administrative rules / WAF is NOT misidentified as rate limit", async () => {
  axios.get = (async () => {
    const err: any = new Error("Request failed with status code 403");
    err.isAxiosError = true;
    err.response = {
      status: 403,
      headers: {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "48", // NOT 0!
        "x-ratelimit-reset": "1730000000",
      },
      data: {
        message: "Request forbidden by administrative rules. Please make sure your request has a User-Agent header.",
      },
    };
    throw err;
  }) as any;

  try {
    await scrapeGithub("octocat");
    expect(true).toBe(false);
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("FORBIDDEN");
    expect(err.isRateLimit).toBe(false);
    expect(err.isSecondaryRateLimit).toBe(false);
    expect(err.isForbidden).toBe(true);
    expect(err.userMessage).toContain("request was forbidden");
  }
});

test("Scenario 6: 401 Unauthorized produces UNAUTHORIZED when GITHUB_TOKEN is invalid", async () => {
  axios.get = (async () => {
    const err: any = new Error("Request failed with status code 401");
    err.isAxiosError = true;
    err.response = {
      status: 401,
      headers: {},
      data: {
        message: "Bad credentials",
      },
    };
    throw err;
  }) as any;

  try {
    await scrapeGithub("octocat");
    expect(true).toBe(false);
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("UNAUTHORIZED");
    expect(err.isAuthError).toBe(true);
    expect(err.status).toBe(401);
    expect(err.userMessage).toContain("GITHUB_TOKEN");
  }
});

test("Scenario 7: 404 User Not Found produces NOT_FOUND", async () => {
  axios.get = (async () => {
    const err: any = new Error("Request failed with status code 404");
    err.isAxiosError = true;
    err.response = {
      status: 404,
      headers: {},
      data: {
        message: "Not Found",
      },
    };
    throw err;
  }) as any;

  try {
    await scrapeGithub("nonexistent_user_12345");
    expect(true).toBe(false);
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("NOT_FOUND");
    expect(err.isNotFound).toBe(true);
    expect(err.status).toBe(404);
    expect(err.userMessage).toContain("not found");
  }
});

test("Scenario 8: Network connection failure produces NETWORK_ERROR", async () => {
  axios.get = (async () => {
    const err: any = new Error("getaddrinfo ENOTFOUND api.github.com");
    err.isAxiosError = true;
    err.code = "ENOTFOUND";
    throw err;
  }) as any;

  try {
    await scrapeGithub("octocat");
    expect(true).toBe(false);
  } catch (err: any) {
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.errorType).toBe("NETWORK_ERROR");
    expect(err.isNetworkError).toBe(true);
    expect(err.userMessage).toContain("Unable to connect to GitHub");
  }
});

test("Scenario 9: Search API quota exhaustion during external discovery does NOT crash main repos", async () => {
  axios.get = (async (url: string) => {
    if (url.includes("/repos?")) {
      return {
        status: 200,
        headers: {
          "x-ratelimit-remaining": "50",
          "x-ratelimit-limit": "60",
        },
        data: [{ name: "primary-repo", stargazers_count: 10, html_url: "https://github.com/octocat/primary-repo" }],
      };
    }
    if (url.includes("/events/public")) {
      return {
        status: 200,
        headers: { "x-ratelimit-remaining": "49" },
        data: [{ type: "PushEvent", repo: { name: "other-org/cool-lib" } }],
      };
    }
    if (url.includes("/search/")) {
      // Search API returns 403 Rate Limit
      const err: any = new Error("Request failed with status code 403");
      err.isAxiosError = true;
      err.response = {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-resource": "search",
        },
        data: { message: "Search rate limit exceeded" },
      };
      throw err;
    }
    return { status: 200, headers: {}, data: [] };
  }) as any;

  // The primary repos scan should gracefully succeed even if Search API rate limit is exceeded!
  const results = await scrapeGithub("octocat");
  expect(results.length).toBeGreaterThanOrEqual(1);
  expect(results[0]?.name).toBe("primary-repo");
});

test("Scenario 10: Configured GITHUB_TOKEN attaches Bearer authorization header and enables commit search and enriched contributions", async () => {
  process.env.GITHUB_TOKEN = "github_pat_test123456789";
  resetGitHubScraperState();

  const capturedHeaders: Record<string, string>[] = [];
  const requestedEndpoints: string[] = [];

  axios.get = (async (url: string, config: any) => {
    requestedEndpoints.push(url);
    if (config?.headers) {
      capturedHeaders.push(config.headers);
    }
    if (url.includes("/repos?")) {
      return {
        status: 200,
        headers: {
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-limit": "5000",
        },
        data: [{ name: "auth-repo", stargazers_count: 100, html_url: "https://github.com/octocat/auth-repo" }],
      };
    }
    if (url.includes("/events/public")) {
      return {
        status: 200,
        headers: { "x-ratelimit-remaining": "4998" },
        data: [{ type: "PushEvent", repo: { name: "external-org/cool-project" } }],
      };
    }
    if (url.includes("/search/issues")) {
      return {
        status: 200,
        headers: { "x-ratelimit-remaining": "29" },
        data: { items: [{ title: "Fix feature", repository_url: "https://api.github.com/repos/external-org/pr-project" }] },
      };
    }
    if (url.includes("/search/commits")) {
      return {
        status: 200,
        headers: { "x-ratelimit-remaining": "28" },
        data: {
          items: [
            {
              commit: { message: "Add feature" },
              repository: { full_name: "external-org/commit-project", stargazers_count: 50, html_url: "https://github.com/external-org/commit-project" },
            },
          ],
        },
      };
    }
    if (url.includes("/repos/")) {
      return {
        status: 200,
        headers: { "x-ratelimit-remaining": "4995" },
        data: { description: "Enriched external project", stargazers_count: 250, language: "Rust" },
      };
    }
    return { status: 200, headers: {}, data: [] };
  }) as any;

  const results = await scrapeGithub("octocat");

  // Verify Bearer token was attached
  expect(capturedHeaders.length).toBeGreaterThan(0);
  expect(capturedHeaders[0]?.["Authorization"]).toBe("Bearer github_pat_test123456789");

  // Verify commit search was triggered when authenticated
  const commitSearchCalled = requestedEndpoints.some((url) => url.includes("/search/commits"));
  expect(commitSearchCalled).toBe(true);

  // Verify repo results contain both owned and contributed projects
  expect(results.length).toBeGreaterThan(1);
  const externalContribution = results.find((r) => r.isContribution);
  expect(externalContribution).toBeDefined();
});

