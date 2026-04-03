from playwright.sync_api import sync_playwright
import time

def test_flow():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use an explicit context so localStorage persists across reload correctly if needed,
        # but normal page.reload() preserves localStorage in the same context anyway.
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

        # Verify it works
        profile1 = page.evaluate("""async () => {
            const token = localStorage.getItem('auth_token');
            const res = await fetch('http://localhost:3300/api/auth/profile', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            return await res.json();
        }""")
        print("Profile check 1:", profile1)

        # We simulate what happens on load by creating a NEW page in the same context
        # This will simulate closing the tab and reopening it
        page2 = context.new_page()
        page2.goto("http://localhost:4200/inbox")
        page2.wait_for_timeout(2000)

        print("URL on new page:", page2.url)

        # check token on new page
        token2 = page2.evaluate("localStorage.getItem('auth_token')")
        print(f"Token on new page: {bool(token2)}")

        # What is the profile now?
        if token2:
            profile2 = page2.evaluate("""async () => {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('http://localhost:3300/api/auth/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                return await res.json();
            }""")
            print("Profile check 2:", profile2)

        browser.close()

if __name__ == "__main__":
    test_flow()
