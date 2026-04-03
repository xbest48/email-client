const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto("http://localhost:4200/register");
    const test_email = `test_${Date.now()}@example.com`;
    await page.fill('label:has-text("Adresse email principale") + input', test_email);
    await page.fill('label:has-text("Mot de passe maitre") + input', 'password123');
    await page.click('button:has-text("S\'inscrire")');

    await page.waitForURL('http://localhost:4200/inbox');

    // Check initial user state via localStorage token + api or angular debug

    await page.click('button[aria-label="Parametres"]');
    await page.click('button:has-text("General")');
    await page.selectOption('select#undo-delay', { label: '5 secondes' });
    await page.waitForTimeout(1000);

    // Request profile to see if delay is saved
    const response = await page.evaluate(async () => {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('http://localhost:3300/api/auth/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return await res.json();
    });
    console.log("Profile after setting:", response);

    await browser.close();
})();
