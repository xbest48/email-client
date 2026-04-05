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

  // Add an account if none exists
  try {
    await page.waitForSelector('text="Paramètres"', { timeout: 3000 });
    await page.click('text="Paramètres"');
    await page.waitForSelector('input[placeholder="Adresse e-mail"]', { timeout: 3000 });
    await page.fill('input[placeholder="Adresse e-mail"]', 'foo@example.com');
    await page.fill('input[placeholder="Serveur IMAP"]', 'imap.example.com');
    await page.fill('input[placeholder="Port IMAP"]', '993');
    await page.fill('input[placeholder="Serveur SMTP"]', 'smtp.example.com');
    await page.fill('input[placeholder="Port SMTP"]', '465');
    await page.click('button:has-text("Ajouter le compte")');
    console.log("Added account.");
  } catch (e) {
    console.log("Maybe already has account.", e.message);
  }

  await page.goto('http://localhost:4200/inbox');
  await page.waitForTimeout(1000);

  // Fake add an email
  await page.evaluate(() => {
     const emailService = window.ng.getComponent(document.querySelector('app-root')).emailService;
     emailService.currentEmails.set([{
        uid: 1,
        folder: 'INBOX',
        subject: 'Test Email',
        from: { name: 'Test User', email: 'test@example.com' },
        to: [{ name: 'You', email: 'you@example.com' }],
        date: new Date().toISOString(),
        isRead: false,
        isStarred: false,
        hasAttachments: false,
        size: 1024,
        body: 'Hello world',
        htmlBody: '<p>Hello world</p>'
     }]);
  });

  await page.waitForTimeout(1000);

  try {
    await page.click('text="Test Email"');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'email_detail.png' });
    console.log("Saved email_detail.png");
  } catch (e) {
    console.log("Could not find email");
  }

  await browser.close();
})();
