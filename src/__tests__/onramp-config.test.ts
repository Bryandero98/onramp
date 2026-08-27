import { loadConfig, DEFAULT_CONFIG, type ConfigClient } from "../config/onramp-config";

function fakeClientReturning(content: string | null): ConfigClient {
  return {
    repos: {
      async getContent() {
        if (content === null) {
          const notFound = Object.assign(new Error("Not Found"), { status: 404 });
          throw notFound;
        }
        return { data: { content: Buffer.from(content).toString("base64") } };
      },
    },
  };
}

describe("loadConfig", () => {
  it("falls back to defaults when .github/onramp.yml doesn't exist", async () => {
    const config = await loadConfig(fakeClientReturning(null), { owner: "acme", repo: "widgets" });
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config over the defaults", async () => {
    const config = await loadConfig(fakeClientReturning("staleClaimDays: 30\nmaxNudges: 1\n"), {
      owner: "acme",
      repo: "widgets",
    });

    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      staleClaimDays: 30,
      maxNudges: 1,
    });
  });

  it("propagates a non-404 error instead of silently falling back", async () => {
    const client: ConfigClient = {
      repos: {
        async getContent() {
          throw Object.assign(new Error("rate limited"), { status: 403 });
        },
      },
    };

    await expect(loadConfig(client, { owner: "acme", repo: "widgets" })).rejects.toThrow(
      "rate limited",
    );
  });
});
