from playwright.sync_api import sync_playwright
import time

def test_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        timestamp = int(time.time() * 1000)
        test_email = f"test_{timestamp}@example.com"

        page.goto("http://localhost:4200/register")
        page.get_by_label("Adresse email principale").fill(test_email)
        page.get_by_label("Mot de passe maitre").fill("password123")
        page.get_by_role("button", name="S'inscrire").click()

        page.wait_for_url("http://localhost:4200/inbox", timeout=10000)

        page.get_by_role("button", name="Parametres").click()
        page.get_by_text("General").click()
        page.locator('select#undo-delay').select_option(label="5 secondes")
        page.wait_for_timeout(2000)

        profile = page.evaluate("""async () => {
            const token = localStorage.getItem('auth_token');
            const res = await fetch('http://localhost:3300/api/auth/profile', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            return await res.json();
        }""")
        print("Profile after setting:", profile)
        browser.close()

if __name__ == "__main__":
    test_flow()
