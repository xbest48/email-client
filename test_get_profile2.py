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

        page.reload()
        page.wait_for_timeout(1000)

        token2 = page.evaluate("localStorage.getItem('auth_token')")
        print("Token 2", bool(token2))

        browser.close()

if __name__ == "__main__":
    test_flow()
