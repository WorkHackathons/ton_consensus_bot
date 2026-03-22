import { expect, test } from "@playwright/test";

const sampleBet = {
  id: 42,
  creator_id: 111,
  opponent_id: null,
  description: "Will BTC stay above 80,000 USD by tomorrow 18:00 UTC?",
  amount_ton: 1,
  status: "pending",
  creator_deposit: 0,
  opponent_deposit: 0,
  creator_outcome: null,
  opponent_outcome: null,
  deadline: Math.floor(Date.now() / 1000) + 3600,
};

async function installTelegramMock(page) {
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "mock-init-data",
        initDataUnsafe: {
          user: {
            id: 222,
            username: "tester",
          },
        },
        platform: "tdesktop",
        viewportHeight: 900,
        ready() {},
        expand() {},
        onEvent() {},
        offEvent() {},
        openTelegramLink() {},
        switchInlineQuery() {},
        HapticFeedback: {
          impactOccurred() {},
          selectionChanged() {},
          notificationOccurred() {},
        },
      },
    };
  });
}

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;
    const method = route.request().method();

    if (pathname.endsWith("/api/platform-wallet")) {
      return route.fulfill({ json: { address: "0QAZli6nZl1hyfdJbZSdC0cszqU5mFsZbaeQPsS0dNpXsWPL" } });
    }

    if (pathname.endsWith("/api/wallet-balance")) {
      return route.fulfill({ json: { balanceTon: 5.25 } });
    }

    if (pathname.endsWith("/api/me")) {
      return route.fulfill({
        json: {
          telegram_id: 222,
          username: "tester",
          ton_address: "0QAZli6nZl1hyfdJbZSdC0cszqU5mFsZbaeQPsS0dNpXsWPL",
          arbiter_since: null,
          referral_earnings: 0,
        },
      });
    }

    if (pathname.endsWith("/api/bets/user/222")) {
      const status = searchParams.get("status");
      const bets = status && status !== "pending" ? [] : [sampleBet];
      return route.fulfill({ json: bets });
    }

    if (pathname.endsWith("/api/bets") && method === "GET") {
      const status = searchParams.get("status");
      const bets = status === "pending" ? [sampleBet] : [];
      return route.fulfill({ json: bets });
    }

    if (pathname.endsWith("/api/bets") && method === "POST") {
      return route.fulfill({
        json: {
          ok: true,
          bet: {
            ...sampleBet,
            id: 77,
            description: "Will TON stay above 7 USD by tomorrow?",
          },
        },
      });
    }

    if (pathname.endsWith("/api/bet/42")) {
      return route.fulfill({ json: sampleBet });
    }

    if (pathname.endsWith("/api/bets/42/join")) {
      return route.fulfill({
        json: {
          ok: true,
          bet: {
            ...sampleBet,
            opponent_id: 111,
          },
        },
      });
    }

    return route.fulfill({ json: {} });
  });
}

test("mini app loads, tabs switch, create modal opens, and join mode renders", async ({ page }) => {
  await installTelegramMock(page);
  await mockApi(page);

  await page.goto("/?action=join&bet=42");

  await expect(page.getByText("TON Consensus", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Review bet/i })).toBeVisible();
  await page.getByRole("button", { name: /Review bet/i }).click();
  await expect(page.getByText(/invite mode/i)).toBeVisible();
  await expect(page.getByText(/You were challenged to bet on this market/i)).toBeVisible();

  await page.getByRole("button", { name: "ACTIVE" }).click();
  await expect(page.getByRole("button", { name: "ACTIVE" })).toHaveClass(/text-white/);

  await page.getByRole("button", { name: "ORACLE" }).click();
  await expect(page.getByRole("button", { name: "ORACLE" })).toHaveClass(/text-white/);

  await page.getByRole("button", { name: "CLOSED" }).click();
  await expect(page.getByRole("button", { name: "CLOSED" })).toHaveClass(/text-white/);

  await page.getByRole("button", { name: /CREATE BET/i }).click();
  await expect(page.getByText(/Launch a new market/i)).toBeVisible();
  await expect(page.getByText("Time Window", { exact: true }).first()).toBeVisible();
});
