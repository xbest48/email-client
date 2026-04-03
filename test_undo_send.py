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

        print(f"Registering with email: {test_email}")
        page.get_by_label("Adresse email principale").fill(test_email)
        page.get_by_label("Mot de passe maitre").fill("password123")
        page.get_by_role("button", name="S'inscrire").click()

        print("Waiting for inbox redirect...")
        try:
            page.wait_for_url("http://localhost:4200/inbox", timeout=10000)
            print("Successfully reached inbox!")

            print("Clicking settings...")
            page.get_by_role("button", name="Parametres").click()

            print("Clicking General tab...")
            page.get_by_text("General").click()

            print("Setting Undo Send Delay...")
            page.locator('select#undo-delay').select_option(label="5 secondes")
            # Wait a bit for the API call to complete
            page.wait_for_timeout(1000)

            print("Closing settings...")
            page.get_by_label("Fermer").click()

            print("Opening Compose...")
            page.get_by_role("button", name="Nouveau message").click()

            print("Filling compose form...")
            # We wait a bit to make sure Compose is fully open
            page.wait_for_timeout(500)

            page.get_by_placeholder("destinataire@email.com").fill("test@example.com")
            page.get_by_placeholder("Objet du message").fill("Test Undo Send")

            # Use click + type for contenteditable
            page.locator("div[contenteditable='true']").click()
            page.keyboard.type("This is a test message.")

            print("Sending email...")
            # Using evaluate to bypass any intercept issues
            page.evaluate("() => document.querySelector('button[type=submit]').click()")

            print("Waiting for Undo Toast...")
            # We look for "Envoi a test@example.com"
            toast = page.locator("text=/Envoi a test@example.com/")
            toast.wait_for(state="visible", timeout=10000)

            print("Success! Taking screenshot...")
            page.screenshot(path="verification_undo_send.png")

            print("Clicking cancel...")
            page.get_by_role("button", name="Annuler").click()

            print("Waiting for toast to disappear...")
            toast.wait_for(state="hidden", timeout=5000)
            print("Done.")

        except Exception as e:
            print(f"Error occurred: {e}")
            page.screenshot(path="error.png")
            print("Saved error screenshot.")

        browser.close()

if __name__ == "__main__":
    test_flow()
