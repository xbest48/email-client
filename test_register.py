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

        # Listen for requests and responses
        page.on("request", lambda request: print(f"> {request.method} {request.url}"))
        page.on("response", lambda response: print(f"< {response.status} {response.url}"))

        page.get_by_role("button", name="S'inscrire").click()

        print("Waiting for inbox redirect...")
        try:
            page.wait_for_url("http://localhost:4200/inbox", timeout=10000)
            print("Successfully reached inbox!")

            print("Clicking settings...")
            page.get_by_role("button", name="Parametres").click()

            print("Clicking Security tab...")
            page.get_by_text("Sécurité").click()

            print("Checking for settings content...")
            page.wait_for_selector(".settings-content", timeout=5000)
            print("Success! Taking screenshot...")
            page.screenshot(path="verification_success.png")
            print("Done.")

        except Exception as e:
            print(f"Error occurred: {e}")
            page.screenshot(path="error.png")
            print("Saved error screenshot.")

        browser.close()

if __name__ == "__main__":
    test_flow()
