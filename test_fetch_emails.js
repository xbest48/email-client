const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to register...");
  await page.goto('http://localhost:4200/register');

  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  const randomEmail = `test_${Math.random()}@example.com`;
  await page.fill('input[type="email"]', randomEmail);
  await page.fill('input[type="password"]', 'test1');
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL('http://localhost:4200/inbox', { timeout: 10000 });
    console.log("Logged in and navigated to inbox.");
  } catch (e) {
    console.log("Failed to register. Taking screenshot...");
    await page.screenshot({ path: 'register_error.png' });
    throw e;
  }

  console.log("Checking spam fetching...");
  await page.goto('http://localhost:4200/spam');

  await page.waitForTimeout(3000); // Give it some time to load
  await page.screenshot({ path: 'spam_auto_load.png' });
  console.log("Saved spam_auto_load.png");

  await browser.close();
})();
