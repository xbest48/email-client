from playwright.sync_api import sync_playwright
import time

def test_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # intercept dialogs like window.alert
        page.on("dialog", lambda dialog: print(f"DIALOG: {dialog.message}") or dialog.accept())

        timestamp = int(time.time() * 1000)
        test_email = f"test_{timestamp}@example.com"

        page.goto("http://localhost:4200/register")
        page.wait_for_timeout(1000)
        page.get_by_label("Adresse email principale").fill(test_email)
        page.get_by_label("Mot de passe maitre").fill("password123")
        page.get_by_role("button", name="S'inscrire").click(force=True)

        page.wait_for_url("http://localhost:4200/inbox", timeout=10000)

        # Open Settings
        page.locator('button[aria-label="Parametres"]').click(force=True)

        # We should be on Accounts tab by default. Fill out the form.
        page.get_by_label("Adresse email").fill("fake@example.com")
        page.get_by_label("Mot de passe").fill("fakepass")
        page.get_by_label("Serveur IMAP").fill("imap.fake.com")
        page.get_by_label("Serveur SMTP").fill("smtp.fake.com")

        # Click test connection
        page.get_by_role("button", name="Tester la connexion").click(force=True)

        page.wait_for_timeout(3000)

        page.screenshot(path="verification_test_button.png")
        print("Done")

        browser.close()

if __name__ == "__main__":
    test_flow()
