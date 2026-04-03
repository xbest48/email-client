from playwright.sync_api import sync_playwright
import time

def test_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        timestamp = int(time.time() * 1000)
        test_email = f"test_{timestamp}@example.com"

        print("Navigating to register...")
        page.goto("http://localhost:4200/register")

        # Take a screenshot if there's an error overlay
        page.wait_for_timeout(2000)
        page.screenshot(path="verification_error.png")

        print(f"Registering with email: {test_email}")
        page.get_by_label("Adresse email principale").fill(test_email)
        page.get_by_label("Mot de passe maitre").fill("password123")
        page.get_by_role("button", name="S'inscrire").click(force=True)

        print("Waiting for inbox redirect...")
        page.wait_for_url("http://localhost:4200/inbox", timeout=10000)

        print("Opening settings...")
        page.get_by_role("button", name="Parametres").click(force=True)
        page.get_by_text("General").click(force=True)

        print("Toggling Dark Mode...")
        # Toggle dark mode
        page.locator('label:has-text("Mode Sombre")').click(force=True)
        page.wait_for_timeout(1000)

        page.screenshot(path="verification_dark_mode_settings.png")

        print("Closing settings...")
        page.get_by_label("Fermer").click(force=True)

        print("Taking inbox screenshot in dark mode...")
        page.wait_for_timeout(500)
        page.screenshot(path="verification_dark_mode_inbox.png")

        browser.close()

if __name__ == "__main__":
    test_flow()
