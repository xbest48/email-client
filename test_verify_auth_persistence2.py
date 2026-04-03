from playwright.sync_api import sync_playwright
import time

def test_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Playwright creates a clean profile by default, but localStorage persists ONLY within the same origin AND the same context.
        # page.reload() works because it is same context.
        context = browser.new_context()
        page = context.new_page()

        timestamp = int(time.time() * 1000)
        test_email = f"test_{timestamp}@example.com"

        page.goto("http://localhost:4200/register")
        page.wait_for_timeout(1000)
        page.get_by_label("Adresse email principale").fill(test_email)
        page.get_by_label("Mot de passe maitre").fill("password123")
        page.get_by_role("button", name="S'inscrire").click(force=True)

        page.wait_for_url("http://localhost:4200/inbox", timeout=10000)

        # Check token initially
        token = page.evaluate("localStorage.getItem('auth_token')")
        print(f"Token after register: {bool(token)}")

        page.get_by_role("button", name="Parametres").click(force=True)
        page.get_by_text("General").click(force=True)
        page.locator('label:has-text("Mode Sombre")').click(force=True)
        page.wait_for_timeout(1000)

        # We reload the same page now, localStorage WILL persist here.
        page.reload()
        page.wait_for_timeout(2000)

        print("URL on reloaded page:", page.url)

        # check token on reloaded page
        token2 = page.evaluate("localStorage.getItem('auth_token')")
        print(f"Token on reloaded page: {bool(token2)}")

        # What is the profile now?
        if token2:
            profile2 = page.evaluate("""async () => {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('http://localhost:3300/api/auth/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                return await res.json();
            }""")
            print("Profile check 2:", profile2)

            page.get_by_role("button", name="Parametres").click(force=True)
            page.get_by_text("General").click(force=True)
            is_checked = page.locator('input[type="checkbox"]').first.is_checked()
            print(f"Is Dark Mode Checked after refresh? {is_checked}")

        browser.close()

if __name__ == "__main__":
    test_flow()
